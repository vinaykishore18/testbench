/* Unit report, command palette and the motion layer.
 *
 *   python3 -m http.server 8099 &
 *   node test/report-palette.mjs
 *
 * The report is the one thing on this site that leaves the building — it goes
 * into a listing or a returns dispute — so the checks here are about whether
 * it can overstate. A report that lists only what was tested, or that calls a
 * unit good after one page failed, is worse than no report, because somebody
 * will rely on it.
 */
import { chromium } from 'playwright';

const SITE = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;

let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(SITE, { waitUntil: 'load' });

/* Feed results in through TB.verdict, the same funnel every real module uses,
   rather than writing into the store directly — so if that funnel ever stops
   recording, these checks notice. */
const feed = (view, panelId, score, flags) => page.evaluate(([v, id, sc, fl]) => {
  TB.go(v);
  let host = document.getElementById(id);
  if (!host) {
    const sec = document.querySelector('#view-' + v);
    const panel = sec.querySelector('.tb-panel') || sec;
    host = document.createElement('div');
    host.id = id;
    panel.appendChild(host);
  }
  TB.verdict(host, sc, fl);
}, [view, panelId, score, flags]);

console.log('\n1. nothing in, nothing claimed');
{
  await page.click('button[data-view="home"]');
  await page.click('#rep-build');
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => document.querySelector('#rep-out').textContent);
  /No test produced a scored result|Not tested/.test(t)
    ? pass('an empty session produces no verdict about the unit') : fail('an empty report said something: ' + t.slice(0, 160));
  /ass(es)?\b/.test(await page.evaluate(() => document.querySelector('#rep-count').textContent))
    ? fail('the counter claims a pass with no results') : pass('the counter says nothing was recorded');
}

console.log('\n2. a result reaches the report through TB.verdict');
{
  await feed('gamepad', 'tb-test-a', 96, [{ level: 'ok', tag: 'sticks', text: 'Both sticks centre.' }]);
  await page.click('button[data-view="home"]');
  await page.click('#rep-build');
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => document.querySelector('#rep-out').textContent);
  /96/.test(t) ? pass('the score is in the report') : fail('the score did not reach the report');
  /Passes/.test(t) ? pass('and the overall call is a pass') : fail('overall call missing: ' + t.slice(0, 200));
}

console.log('\n3. one failure makes the unit faulty, however much else passed');
{
  /* The important direction. Six passes and one dead trigger is a controller
     with a dead trigger, not a controller that is 86% fine. */
  for (const [i, v] of ['keyboard', 'mouse', 'audio', 'monitor', 'touch'].entries()) {
    await feed(v, 'tb-test-p' + i, 98, [{ level: 'ok', tag: 'all', text: 'Fine.' }]);
  }
  await feed('wheel', 'tb-test-bad', 22, [{ level: 'bad', tag: 'pedals', text: 'The brake pedal reads nothing at all.' }]);
  await page.click('button[data-view="home"]');
  await page.click('#rep-build');
  await page.waitForTimeout(400);
  const call = await page.evaluate(() => document.querySelector('.tb-repcall').textContent);
  /Faulty/.test(call) ? pass('overall: Faulty, with six passes on the same unit') : fail('overall call was ' + JSON.stringify(call));
  const t = await page.evaluate(() => document.querySelector('#rep-out').textContent);
  /brake pedal reads nothing/.test(t) ? pass('and the failure text is carried through verbatim') : fail('the failure detail was dropped');
}

console.log('\n4. untested pages are listed as untested, not omitted');
{
  const t = await page.evaluate(() => document.querySelector('#rep-out').textContent);
  /Not tested/.test(t) ? pass('there is a Not tested section') : fail('no Not tested section');
  /* midi, camera, network, stress, system, joycon, airpods were never fed */
  for (const name of ['MIDI', 'Webcams', 'Routers', 'Joy-Cons', 'Earbuds']) {
    t.includes(name) ? pass(`${name} is listed as not tested`) : fail(`${name} is missing from the report entirely`);
  }
  /says nothing about them/.test(t)
    ? pass('and it says the report makes no claim about them') : fail('it lists them without saying what that means');
}

console.log('\n5. re-running a test replaces its result rather than adding a second');
{
  const before = await page.evaluate(() => TB.results().length);
  await feed('wheel', 'tb-test-bad', 94, [{ level: 'ok', tag: 'pedals', text: 'Both pedals read full travel now.' }]);
  const after = await page.evaluate(() => TB.results().length);
  after === before ? pass(`still ${after} results after re-testing the same panel`)
                   : fail(`re-testing added a row: ${before} -> ${after}`);
  await page.click('button[data-view="home"]');
  await page.click('#rep-build');
  await page.waitForTimeout(300);
  const call = await page.evaluate(() => document.querySelector('.tb-repcall').textContent);
  /Passes/.test(call) ? pass('and the overall call followed the new result') : fail('overall is still ' + JSON.stringify(call));
}

console.log('\n6. the text version matches, and states its limits');
{
  const txt = await page.evaluate(() => window.REPORT.asText());
  /HARDWARE TEST REPORT/.test(txt) ? pass('has a header') : fail('no header');
  /OVERALL: PASSES/.test(txt) ? pass('states the overall call') : fail('no overall call in the text: ' + txt.slice(0, 200));
  /NOT TESTED/.test(txt) ? pass('carries the untested list too') : fail('the text version omits the untested list — it would read as a full pass');
  /not a certification|not a certification or a warranty/.test(txt)
    ? pass('and says it is not a certification') : fail('the text version does not state its limits');
  /cannot see[\s\S]*battery health/.test(txt) ? pass('and names what it cannot see') : fail('no scope limit in the text');
}

console.log('\n7. starting a new unit really clears it');
{
  await page.fill('#rep-unit', 'LOT-418');
  /* The two presses need a real gap between them. A confirmation that can be
     completed by one double-click is not a confirmation, so TB.arm refuses a
     second press inside 400 ms - and a test that clicks faster than a human
     can decide is testing the wrong thing. */
  await page.click('#rep-reset');
  await page.waitForTimeout(600);
  await page.click('#rep-reset');
  await page.waitForTimeout(500);
  const n = await page.evaluate(() => TB.results().length);
  n === 0 ? pass('results cleared') : fail(`${n} results survived`);
  const unit = await page.evaluate(() => document.querySelector('#rep-unit').value);
  unit === '' ? pass('and the unit field with them') : fail('unit field still reads ' + JSON.stringify(unit));
}

console.log('\n8. print mode strips the app, then puts it back');
{
  await feed('mouse', 'tb-test-print', 91, [{ level: 'ok', tag: 'buttons', text: 'All five register.' }]);
  await page.click('button[data-view="home"]');
  /* window.print() blocks in a headless browser, so drive the class the
     button drives and assert what it does to the layout. */
  await page.evaluate(() => {
    document.documentElement.classList.add('tb-printing');
    window.REPORT.build();
  });
  await page.waitForTimeout(250);
  const vis = await page.evaluate(() => {
    const seen = (s) => {
      const n = document.querySelector(s);
      return !!n && !!n.getClientRects().length;
    };
    return { rail: seen('#rail'), status: seen('#statusbar'), report: seen('#rep-out'), devcards: seen('#devcards') };
  });
  !vis.rail && !vis.status ? pass('the rail and status bar are hidden') : fail('chrome still printing: ' + JSON.stringify(vis));
  !vis.devcards ? pass('and the rest of the bench page with them') : fail('the whole home page would print');
  vis.report ? pass('the report itself is still there') : fail('the report is hidden too — the page would print blank');

  await page.evaluate(() => document.documentElement.classList.remove('tb-printing'));
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => !!document.querySelector('#rail').getClientRects().length);
  back ? pass('and the app comes back afterwards') : fail('the app is stuck in print mode');
}

console.log('\n9. Ctrl+K jumps to a test');
{
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(250);
  let up = await page.evaluate(() => !!document.querySelector('.tb-pal'));
  up ? pass('the palette opens') : fail('Ctrl+K did nothing');

  const focused = await page.evaluate(() => document.activeElement.tagName);
  focused === 'INPUT' ? pass('and the box has focus, so you can just type') : fail('focus is on ' + focused);

  await page.keyboard.type('whe');
  await page.waitForTimeout(200);
  const first = await page.evaluate(() => (document.querySelector('.tb-pal-row.on b') || {}).textContent);
  /Wheel/i.test(first || '') ? pass(`"whe" offers ${first}`) : fail(`"whe" offered ${JSON.stringify(first)}`);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const view = await page.evaluate(() => TB.view());
  view === 'wheel' ? pass('Enter opened it') : fail('Enter landed on ' + view);
  up = await page.evaluate(() => !!document.querySelector('.tb-pal'));
  !up ? pass('and the palette closed') : fail('the palette stayed open');
}

console.log('\n10. the palette finds pages by what you would actually type');
{
  /* The third column is how many results deep the right answer may be. One
     means it must rank first. Some words honestly belong to two pages - stick
     drift is a Joy-Con byword and a general controller fault - and insisting
     on a single winner there would be asserting a preference, not a
     behaviour. What must never happen is the right page being absent or
     buried, which is what the looser checks pin down. */
  for (const [typed, want, depth] of [
    ['ping', 'network', 1], ['dead pixel', 'monitor', 1], ['mp3', 'audio', 1],
    ['fake', 'airpods', 1], ['pdf', 'home', 1], ['latency', 'network', 1],
    ['stuck', 'monitor', 1], ['serial', 'airpods', 1],
    ['drift', 'gamepad', 2], ['battery', 'system', 3]
  ]) {
    /* Use the palette's own ranking rather than reimplementing it here. A
       test with its own copy of the scoring is testing the test. */
    const ranked = await page.evaluate((q) => window.PALETTE.search(q).map((i) => i.view), typed);
    const at = ranked.indexOf(want);
    at >= 0 && at < depth
      ? pass(`"${typed}" offers ${want}` + (depth > 1 ? ` at position ${at + 1} of ${ranked.length}` : ''))
      : fail(`"${typed}" ranked ${ranked.slice(0, 3).join(' > ') || 'nothing'}; ${want} wanted inside the first ${depth}`);
  }
}

console.log('\n10b. a match inside a longer word never beats a real one');
{
  /* "ping" used to offer the Keyboard page, because its keywords contain
     "typing". A search box whose first answer is visibly wrong is one people
     stop using after two tries. */
  const ranked = await page.evaluate(() => window.PALETTE.search('ping').map((i) => i.view));
  ranked[0] === 'network' ? pass('"ping" ranks the router page first')
    : fail('"ping" ranks ' + ranked.slice(0, 3).join(' > ') + ' — a mid-word match is winning');
  ranked.includes('keyboard')
    ? pass('and the mid-word match in "typing" still appears, just lower')
    : pass('the mid-word match was dropped entirely, which is also fine');
}

console.log('\n11. Escape closes it and gives focus back');
{
  await page.click('button[data-view="home"]');
  await page.focus('#rep-unit');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const up = await page.evaluate(() => !!document.querySelector('.tb-pal'));
  !up ? pass('closed') : fail('Escape did not close it');
  const back = await page.evaluate(() => document.activeElement.id);
  back === 'rep-unit' ? pass('and focus went back where it was') : fail('focus ended up on ' + JSON.stringify(back));
}

console.log('\n12. the motion layer is wired, and respects reduced motion');
{
  /* A verdict landing has to be visible as a class, since that is what the
     stylesheet hangs the animation on. */
  await feed('touch', 'tb-test-anim', 97, [{ level: 'ok', tag: 'points', text: 'Ten points.' }]);
  const landed = await page.evaluate(() => !!document.querySelector('#tb-test-anim .tb-verdict.tb-landed'));
  landed ? pass('a verdict is marked as landed') : fail('the verdict carries no animation class');

  const reduced = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1200, height: 800 } });
  const rp = await reduced.newPage();
  await rp.goto(SITE, { waitUntil: 'load' });
  await rp.waitForTimeout(400);
  const dur = await rp.evaluate(() => {
    const v = document.querySelector('.tb-view.on');
    return getComputedStyle(v).animationDuration;
  });
  parseFloat(dur) < 0.01 ? pass(`animations flattened to ${dur} under prefers-reduced-motion`)
                         : fail(`animation still runs for ${dur} with reduced motion asked for`);
  await reduced.close();
}

console.log('\n12b. switching a tab does not move the page');
{
  /* Panes are shown and hidden, so the document height changes the moment one
     is swapped - and two things went wrong because of that. If the new pane
     was shorter than the scroll position, the browser clamped the scroll and
     the page lurched upward. And if you had scrolled down inside a long pane,
     the strip you just clicked was often left off-screen, so the click looked
     like it had done nothing.

     Both cases are checked, because fixing one by always scrolling to the
     strip would break the other. */
  for (const [view, strip] of [['mouse', '#ms-tabs'], ['keyboard', '#kb-tabs'], ['airpods', '#ap-tabs']]) {
    await page.click(`button[data-view="${view}"]`);
    await page.waitForTimeout(300);
    const names = await page.$$eval(`${strip} button`, (ns) => ns.map((n) => n.dataset.t));

    /* Case A: the strip is on screen, so the operator's eye is already in the
       right place and nothing may move.

       Scroll it into view rather than assuming scrollTop 0 puts it there - on
       the mouse page the device diagram sits above it, so at the top of the
       page the strip is below the fold and bringing it up is the correct
       behaviour, not a failure. */
    await page.evaluate((sel) => {
      const main = document.querySelector('#main');
      const r = document.querySelector(sel).getBoundingClientRect();
      main.scrollTop += r.top - main.getBoundingClientRect().top - 8;
    }, strip);
    await page.waitForTimeout(150);
    /* Measure where the STRIP is, not what scrollTop is. When a shorter pane
       makes the document shorter, the old scroll position stops existing - so
       holding the number is impossible, while holding the control the operator
       just clicked steady is both possible and the thing that actually
       matters. A test asserting scrollTop would be demanding something the
       browser cannot give and would have to be weakened to pass. */
    const stripTop = () => page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return Math.round(r.top - document.querySelector('#main').getBoundingClientRect().top);
    }, strip);
    /* Movement has a floor that is not the page's fault. If the new pane is
       shorter, the document gets shorter, and the maximum scroll drops - so a
       strip that was pinned to the top physically cannot stay there, because
       there is no longer enough content below it to scroll. Nothing can fix
       that, and a test demanding zero would have to be weakened to pass,
       which is how a check stops meaning anything.

       So the movement is allowed up to how far the maximum scroll fell, and
       no further. Anything beyond that is the page moving for its own
       reasons, which is the bug. The strip must also still be visible. */
    const scrollRoom = () => page.evaluate(() => {
      const m = document.querySelector('#main');
      return m.scrollHeight - m.clientHeight;
    });
    let worst = 0, explained = 0, vanished = 0;
    for (const t of names) {
      const before = await stripTop();
      const roomBefore = await scrollRoom();
      await page.click(`${strip} [data-t="${t}"]`);
      await page.waitForTimeout(180);
      const after = await stripTop();
      const roomAfter = await scrollRoom();
      const moved = Math.abs(after - before);
      const allowed = Math.max(0, roomBefore - roomAfter) + 14;
      worst = Math.max(worst, moved);
      if (moved > allowed) explained = Math.max(explained, moved - allowed);
      const vis = await page.evaluate((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        const m = document.querySelector('#main').getBoundingClientRect();
        return r.bottom > m.top && r.top < m.bottom;
      }, strip);
      if (!vis) vanished++;
    }
    explained === 0
      ? pass(`${view}: ${names.length} tabs, the strip moved at most ${worst}px and every pixel is the document getting shorter`)
      : fail(`${view}: the strip moved ${explained}px more than the shortening explains`);
    vanished === 0 ? pass(`${view}: and it stayed visible throughout`)
      : fail(`${view}: the strip went off-screen after ${vanished} switch(es)`);

    /* Case B: scrolled past the strip, so it has to come back. */
    let hidden = 0;
    for (const t of names) {
      await page.evaluate(() => { document.querySelector('#main').scrollTop = 600; });
      await page.waitForTimeout(110);
      await page.click(`${strip} [data-t="${t}"]`).catch(() => {});
      await page.waitForTimeout(200);
      const visible = await page.evaluate((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        const m = document.querySelector('#main').getBoundingClientRect();
        return r.top >= m.top - 4 && r.top < m.bottom;
      }, strip);
      if (!visible) hidden++;
    }
    hidden === 0 ? pass(`${view}: the tab strip is brought back into view every time`)
      : fail(`${view}: the strip stayed off-screen after ${hidden} of ${names.length} switches`);
  }

  /* And the pane fades rather than sliding, because a pane that moved would
     shift the content under the strip you just clicked. */
  const anim = await page.evaluate(() => {
    const pane = document.querySelector('[data-mspane]:not([hidden])');
    const cs = getComputedStyle(pane);
    return { name: cs.animationName, dur: cs.animationDuration };
  });
  /fade/.test(anim.name) ? pass(`panes fade in (${anim.name}, ${anim.dur})`)
    : fail('pane animation is ' + JSON.stringify(anim));
}

console.log('\n13. no console errors');
errors.length ? errors.slice(0, 6).forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
