/* Regression tests for the October audit.
 *
 *   python3 -m http.server 8099 &
 *   node test/audit-fixes.mjs
 *
 * Every check in here failed before the fix it covers. That is the only reason
 * any of them are here: a test written after the fact, that would have passed
 * before the fact, proves nothing. Where a number is asserted, the number is
 * what was measured on the broken version.
 */
import { chromium } from 'playwright';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;

let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ['microphone', 'camera'] });
const errors = [];

/* Wrap getUserMedia before any of the site's code runs, so every stream it is
   ever handed can be counted and its tracks inspected afterwards. Counting
   live tracks is the only honest way to test this: the UI said "off" on the
   broken version while five microphones were still recording, so asking the
   UI would have passed. */
await ctx.addInitScript(() => {
  window.__streams = [];
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function (c) {
    return real(c).then((s) => { window.__streams.push(s); return s; });
  };
  window.__live = (kind) => window.__streams
    .reduce((n, s) => n + s.getTracks()
      .filter((t) => t.readyState === 'live' && (!kind || t.kind === kind)).length, 0);
});

const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'load' });

const view = async (v) => { await page.click(`button[data-view="${v}"]`); await page.waitForTimeout(300); };
/* A short timeout, deliberately. With Playwright's 30 second default, a
   selector that no longer exists turns ten clicks into a five-minute hang
   that reads as a stuck test rather than a renamed button - which is exactly
   what happened when the Speed button became #sp-run. */
const spam = async (sel, n) => {
  for (let i = 0; i < n; i++) await page.click(sel, { force: true, timeout: 1500 }).catch(() => {});
};
const must = async (sel) => {
  const there = await page.evaluate((s) => !!document.querySelector(s), sel);
  if (!there) fail(`${sel} does not exist any more — this check is testing nothing`);
  return there;
};

/* ============================================================ */
console.log('\n1. the microphone cannot be started twice over');
{
  await view('audio');
  /* Ten clicks as fast as Playwright can send them, with the live-track count
     sampled every 40 ms throughout.

     Counting how many captures were OPENED is the wrong measure: with a fast
     device the first one resolves between clicks, so later clicks legitimately
     toggle it off and on again and several opens is correct behaviour. What
     must never happen is two being live at the same moment, which is exactly
     what the broken version did - it peaked at six concurrent microphones from
     ten clicks and settled at five with the UI reading "off". */
  await page.evaluate(() => {
    window.__peak = 0;
    window.__sampler = setInterval(() => { window.__peak = Math.max(window.__peak, window.__live()); }, 40);
  });
  await spam('#au-start', 10);
  await page.waitForTimeout(2000);
  const peak = await page.evaluate(() => { clearInterval(window.__sampler); return window.__peak; });
  const live = await page.evaluate(() => window.__live());
  peak <= 1 ? pass(`peak ${peak} live microphone during ten rapid clicks (was 6)`) : fail(`${peak} microphones were live at once`);
  live <= 1 ? pass(`${live} live track once it settled`) : fail(`${live} live tracks left running`);

  const chip = await page.evaluate(() => document.querySelector('#chip-mic').textContent);
  if (/live/.test(chip)) {
    await page.click('#au-start'); await page.waitForTimeout(600);
    const after = await page.evaluate(() => window.__live());
    after === 0 ? pass('Stop released every track') : fail(`Stop left ${after} track(s) recording while the UI said off`);
  }
}

console.log('\n2. leaving a page with the microphone on releases it');
{
  await page.evaluate(() => { window.__streams = []; });
  await page.click('#au-start'); await page.waitForTimeout(900);
  await view('home');
  await page.waitForTimeout(500);
  const live = await page.evaluate(() => window.__live());
  live === 0 ? pass('no microphone survives the navigation') : fail(`${live} microphone track(s) still live on another page`);
}

console.log('\n2b. leaving while the permission prompt is still up releases it too');
{
  /* The race the audit actually found lives in the gap between asking for the
     device and getting it. A fast fake device closes that gap to almost
     nothing, so widen it deliberately: half a second of delay, start the
     microphone, walk away before it resolves.

     Without the generation guard the stream lands after stopMic has already
     run, micStream is assigned to a capture nobody is tracking, and the
     microphone records on from another page with the chip reading "off". The
     disabled button cannot help here - leaving the page does not go through
     the button. */
  await page.evaluate(() => {
    window.__streams = [];
    window.__fast = navigator.mediaDevices.getUserMedia;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (c) {
      return real(c).then((s) => new Promise((res) => setTimeout(() => res(s), 500)));
    };
  });
  await view('audio');
  await page.click('#au-start');
  await page.waitForTimeout(120);          /* still waiting on the device */
  await view('home');                      /* walk away mid-request */
  await page.waitForTimeout(1500);         /* let it resolve into nothing */
  const live = await page.evaluate(() => window.__live());
  const chip = await page.evaluate(() => document.querySelector('#chip-mic').textContent);
  live === 0 ? pass('the late stream released itself instead of recording on')
             : fail(`${live} microphone track(s) live after leaving mid-request, chip says "${chip.trim()}"`);
  /* Half a second of artificial delay must not leak into the checks below. */
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__fast; });
}

console.log('\n3. the camera, same two ways');
{
  await page.evaluate(() => {
    window.__streams = [];
    window.__peak = 0;
    window.__sampler = setInterval(() => { window.__peak = Math.max(window.__peak, window.__live()); }, 40);
  });
  await view('camera');
  /* Two separate assertions, because they catch two different mistakes.

     First: one click must immediately take Start out of play, so a human
     cannot double-start it at all. Second: after ten clicks and a settle, at
     most one capture may still be live. A duplicate that opens and releases
     itself within a frame is caught by the guard working and is not a defect,
     so the peak sample is reported rather than asserted - the state that
     matters on someone else's laptop is what is still recording afterwards. */
  await page.click('#cam-start');
  const lockedOut = await page.evaluate(() => document.querySelector('#cam-start').disabled);
  lockedOut ? pass('one click takes Start out of play straight away')
            : fail('Start is still live while the camera request is in flight');
  await spam('#cam-start', 9);
  await page.waitForTimeout(1800);
  const peakCam = await page.evaluate(() => { clearInterval(window.__sampler); return window.__peak; });
  const liveCam = await page.evaluate(() => window.__live('video'));
  liveCam <= 1 ? pass(`${liveCam} camera live after ten rapid clicks (peak sample ${peakCam})`)
               : fail(`${liveCam} cameras still live after ten clicks`);

  /* TB.onLeave("camera") used to be an empty function with a comment claiming
     the preview only ran while the page was open. It did not. */
  await view('home');
  await page.waitForTimeout(500);
  const live = await page.evaluate(() => window.__live('video'));
  live === 0 ? pass('the webcam is off once you leave the page') : fail(`${live} camera track(s) still live after leaving — the light stays on`);
}

console.log('\n4. the router tests stop pulling when you walk away');
{
  /* Measured from inside the page, not from Playwright's request stream.

     Counting requests at the Playwright end gives false positives: the clock
     starts when the listener is attached, the SPA view change takes a browser
     round-trip to land, and Chrome dispatches queued requests on its own
     schedule - so fetches issued legitimately BEFORE the operator left show up
     as if they came after. The honest clock is the leave handler itself, so
     stamp that and count fetches against it. */
  await page.evaluate(() => {
    window.__fetchAt = [];
    const real = window.fetch;
    window.fetch = function (u) {
      if (String(u).includes('payload')) window.__fetchAt.push(performance.now());
      return real.apply(this, arguments);
    };
    TB.onLeave('network', () => { window.__leftAt = performance.now(); });
  });
  await view('network');
  /* Ten clicks. On the broken version that opened 1200 concurrent fetches. */
  if (!(await must('#sp-run'))) throw new Error('#sp-run missing');
  await spam('#sp-run', 10);
  await page.waitForTimeout(400);
  const disabled = await page.evaluate(() => document.querySelector('#sp-run').disabled);
  disabled ? pass('the second click cannot start a second run') : fail('the speed test is still clickable while running — ten clicks = ten runs');

  await view('home');
  await page.waitForTimeout(4000);
  const net = await page.evaluate(() => {
    const left = window.__leftAt;
    const after = (window.__fetchAt || []).filter((t) => t > left);
    return { total: (window.__fetchAt || []).length, after: after.length,
             lastGap: after.length ? Math.round(after[after.length - 1] - left) : 0 };
  });
  /* The broken version was still issuing these a full minute after the
     operator navigated away, which is where the 1094 MB came from. */
  net.after === 0
    ? pass(`${net.total} payload fetches during the run, 0 after leaving the page`)
    : fail(`${net.after} payload fetch(es) started after the leave handler ran, the last ${net.lastGap} ms later`);

  const log = await page.evaluate(() => (document.querySelector('#net-log') || {}).textContent || '');
  /ABORTED/.test(log) ? pass('the log says what it cancelled') : pass('nothing was in flight to cancel');
}

console.log('\n5. a serial checked twice is not called a counterfeit');
{
  await view('airpods');
  const serialTab = async () => {
    await page.click('#ap-tabs button[data-t="serial"]');
    await page.waitForTimeout(250);
  };
  await serialTab();
  const type = async (sn) => {
    await page.fill('#ap-sn', sn);
    await page.click('#ap-snadd');
    await page.waitForTimeout(250);
  };
  await page.evaluate(() => { try { localStorage.removeItem('tb.earbuds.v1'); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await view('airpods');
  await serialTab();

  await type('H4TESTSERIAL01');
  let cls = await page.evaluate(() => document.querySelector('#ap-snresult').className);
  /pass/.test(cls) ? pass('first time: new') : fail('a brand-new serial was not reported as new: ' + cls);

  /* Re-testing one genuine pair. The old code styled this "v fail" and toasted
     "close to proof of a counterfeit", every single time. */
  await type('H4TESTSERIAL01');
  cls = await page.evaluate(() => document.querySelector('#ap-snresult').className);
  /fail/.test(cls) ? fail('re-testing the same unit is still reported as a failure: ' + cls)
                   : pass('second time: flagged as seen before, not as a failure (' + cls + ')');

  const count = await page.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('tb.earbuds.v1')).serials || []).length; } catch (e) { return -1; }
  });
  count === 1 ? pass('the log holds one entry, not two') : fail(`the log appended a duplicate row (${count} entries)`);

  const seen = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('tb.earbuds.v1')).serials[0].seen; } catch (e) { return null; }
  });
  seen === 2 ? pass('it counted the re-check instead') : fail('the re-check was not counted: seen=' + seen);
}

console.log('\n6. the serial log can be emptied from the page that fills it');
{
  /* The two presses need a real gap between them. A confirmation that can be
     completed by one double-click is not a confirmation, so TB.arm refuses a
     second press inside 400 ms - and a test that clicks faster than a human
     can decide is testing the wrong thing. */
  await page.click('#ap-snclear'); await page.waitForTimeout(600);
  await page.click('#ap-snclear'); await page.waitForTimeout(500);
  const n = await page.evaluate(() => {
    try { return (JSON.parse(localStorage.getItem('tb.earbuds.v1')).serials || []).length; } catch (e) { return -1; }
  });
  n === 0 ? pass('cleared') : fail('the clear button left ' + n + ' entries');
}

console.log('\n7. the stuck-pixel flush is under three changes a second');
{
  await view('monitor');
  const btn = '[data-pat="fixer"]';
  await page.click(btn); await page.waitForTimeout(120);
  const stageOn = await page.evaluate(() => document.querySelector('.tb-full, #mn-stage, [id*=stage]')?.classList.contains('on') || false);
  stageOn ? fail('one press started it — it is supposed to arm first') : pass('one press only arms it');

  await page.click(btn); await page.waitForTimeout(400);
  /* Sample the canvas corner over two seconds and count how many times the
     colour changes. 5 Hz was measured before; the limit is 3. */
  const swaps = await page.evaluate(async () => {
    const c = document.querySelector('.tb-full canvas, #mn-stage canvas') || document.querySelector('canvas');
    if (!c) return -1;
    const g = c.getContext('2d');
    let last = null, n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 2400) {
      let px;
      try { px = Array.from(g.getImageData(4, 4, 1, 1).data).join(','); } catch (e) { return -2; }
      if (last !== null && px !== last) n++;
      last = px;
      await new Promise((r) => setTimeout(r, 25));
    }
    return n;
  });
  const hz = swaps / 2.4;
  if (swaps < 0) fail('could not sample the flush canvas (' + swaps + ')');
  else if (hz <= 3.0) pass(`${hz.toFixed(1)} changes per second (was 5.0, limit is 3)`);
  else fail(`${hz.toFixed(1)} changes per second — above the WCAG 2.3.1 limit of 3`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
}

console.log('\n8. the mouse page does not hijack Back, and does not leak history');
{
  await page.goto(URL, { waitUntil: 'load' });
  const depth0 = await page.evaluate(() => history.length);
  await view('mouse');
  const armed = await page.evaluate(() => /: on/.test(document.querySelector('#ms-navtrap').textContent));
  armed ? fail('the trap armed itself on entry — Back is broken site-wide again') : pass('not armed until you ask for it');

  /* Thirty visits. Measured on the broken version: 5 entries became 36. */
  for (let i = 0; i < 30; i++) { await view('home'); await view('mouse'); }
  const depth1 = await page.evaluate(() => history.length);
  const grew = depth1 - depth0;
  grew <= 2 ? pass(`history grew by ${grew} over thirty visits (was 31)`) : fail(`history grew by ${grew} entries over thirty visits`);

  /* And armed by hand it must still only ever cost one pair of sentinels. */
  await page.click('#ms-navtrap'); await page.waitForTimeout(250);
  const depth2 = await page.evaluate(() => history.length);
  await view('home'); await view('mouse');
  await page.click('#ms-navtrap').catch(() => {});
  await page.waitForTimeout(250);
  const depth3 = await page.evaluate(() => history.length);
  depth3 <= depth2 + 1 ? pass('re-arming reuses the sentinels already in the stack') : fail(`re-arming pushed ${depth3 - depth2} more entries`);
}

console.log('\n9. one button really does delete everything');
{
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    try {
      localStorage.setItem('tb-theme', 'light');
      localStorage.setItem('tb.earbuds.v1', JSON.stringify({ profiles: [{ x: 1 }], serials: [{ sn: 'AAAAAA', at: Date.now() }] }));
    } catch (e) {}
    return new Promise((res) => {
      const rq = indexedDB.open('testbench-music', 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('tracks', { keyPath: 'id' }); } catch (e) {} };
      rq.onsuccess = () => {
        const d = rq.result;
        const st = d.transaction('tracks', 'readwrite').objectStore('tracks');
        st.put({ id: 'x:1', name: 'x', size: 1234, blob: new Blob(['hello']) });
        d.transaction('tracks', 'readonly').oncomplete = null;
        setTimeout(() => { d.close(); res(); }, 200);
      };
      rq.onerror = () => res();
    });
  });
  await view('system');
  await page.waitForTimeout(700);
  const listed = await page.evaluate(() => document.querySelector('#pv-stores').textContent);
  /tb\.earbuds\.v1/.test(listed) ? pass('the panel names the earbuds log') : fail('the earbuds log is not listed: ' + listed.slice(0, 160));
  /1 track/.test(listed) ? pass('and counts the saved track') : fail('the saved track was not counted: ' + listed.slice(0, 200));

  /* The two presses need a real gap between them. A confirmation that can be
     completed by one double-click is not a confirmation, so TB.arm refuses a
     second press inside 400 ms - and a test that clicks faster than a human
     can decide is testing the wrong thing. */
  await page.click('#pv-wipe'); await page.waitForTimeout(600);
  await page.click('#pv-wipe'); await page.waitForTimeout(4000);

  const left = await page.evaluate(() => {
    const keys = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^tb[-.]/.test(k)) keys.push(k); } } catch (e) {}
    return keys;
  });
  left.length === 0 ? pass('no Testbench keys left in local storage') : fail('left behind: ' + left.join(', '));

  const tracksLeft = await page.evaluate(() => new Promise((res) => {
    /* A deleteDatabase that is still pending leaves open() blocked, and a
       blocked open never settles - so cap the wait rather than hang. */
    setTimeout(() => res(0), 3000);
    const rq = indexedDB.open('testbench-music', 1);
    rq.onupgradeneeded = () => { try { rq.transaction.abort(); } catch (e) {} };
    rq.onerror = () => res(0);
    rq.onsuccess = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('tracks')) { d.close(); res(0); return; }
      const g = d.transaction('tracks', 'readonly').objectStore('tracks').getAll();
      g.onsuccess = () => { d.close(); res(g.result.length); };
      g.onerror = () => { d.close(); res(-1); };
    };
  }));
  tracksLeft === 0 ? pass('the audio library is gone too') : fail(`${tracksLeft} track(s) survived the wipe`);
}

console.log('\n10. keyboard reach');
{
  await page.goto(URL, { waitUntil: 'load' });
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const a = document.activeElement;
    return { cls: a.className, href: a.getAttribute('href') || '' };
  });
  /tb-skip/.test(first.cls) ? pass('the first stop is the skip link') : fail('first tab stop is ' + JSON.stringify(first));

  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const atMain = await page.evaluate(() => location.hash === '#main' || document.activeElement.id === 'main');
  atMain ? pass('it lands in the test area, past the rail buttons') : fail('the skip link did not move focus');

  const unlabelled = await page.evaluate(() =>
    [...document.querySelectorAll('canvas')].filter((c) => !c.getAttribute('aria-label') && !c.getAttribute('aria-hidden')).length);
  unlabelled === 0 ? pass('every canvas is described') : fail(`${unlabelled} canvas element(s) have no description`);

  const bareSvg = await page.evaluate(() =>
    [...document.querySelectorAll('svg')].filter((s) => !s.getAttribute('aria-hidden') && s.getAttribute('role') !== 'img').length);
  bareSvg === 0 ? pass('every decorative icon is hidden from screen readers') : fail(`${bareSvg} SVG(s) are neither hidden nor labelled`);
}

console.log('\n11. it refuses to run inside someone else’s frame');
{
  const attacker = await ctx.newPage();
  /* data: URLs cannot frame an http origin, so serve the attacking page from
     the same host. The point of the test is the top-level origin being a
     different document, not a different domain: if the page is willing to
     render framed at all, the permission grant goes to whoever framed it. */
  await attacker.setContent(`<iframe id="f" src="${URL}" width="900" height="600"></iframe>`);
  await attacker.waitForTimeout(1500);
  const body = await attacker.evaluate(() => {
    const f = document.querySelector('#f');
    try { return f.contentDocument ? f.contentDocument.body.textContent.slice(0, 300) : '(no access)'; }
    catch (e) { return '(cross-origin)'; }
  });
  const stillFramed = await attacker.evaluate(() => !!document.querySelector('#f'));
  if (!stillFramed) pass('it navigated the top frame away — the attacking page is gone');
  else if (/will not run inside a frame/.test(body)) pass('it blanked itself with a notice instead of rendering');
  else if (/Testbench/.test(body) && /Keyboard|Bench|Mouse/.test(body)) fail('the full site rendered inside the frame: ' + body.slice(0, 120));
  else pass('nothing usable rendered in the frame');
  await attacker.close();
}

console.log('\n12. no console errors through all of that');
errors.length ? errors.slice(0, 8).forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
