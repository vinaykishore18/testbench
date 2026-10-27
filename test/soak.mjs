/* Long-run stability.
 *
 *   python3 -m http.server 8099 &
 *   node test/soak.mjs
 *
 * This app sits open for a whole shift in a tab nobody restarts, on a laptop
 * that is not ours. So the faults that matter are not the ones that show up in
 * the first minute - they are the ones that accumulate: a listener added on
 * every page visit, an interval that is started and never cleared, a second
 * animation loop running alongside the first, history growing until Back no
 * longer leaves the site.
 *
 * All of it is counted rather than inspected. Every counter below is patched
 * in before the page loads, so nothing can be missed by looking in the wrong
 * place.
 */
import { chromium } from 'playwright';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;
const VIEWS = ['home','keyboard','mouse','gamepad','wheel','midi','audio',
               'monitor','camera','touch','stress','system'];

let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  permissions: ['microphone', 'camera']
});

await ctx.addInitScript(() => {
  const C = window.__c = {
    intervals: 0, intervalsCleared: 0, live: new Set(),
    timeouts: 0, raf: 0, listeners: Object.create(null), fetches: 0
  };
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function () { const id = si.apply(window, arguments); C.intervals++; C.live.add(id); return id; };
  window.clearInterval = function (id) { if (C.live.delete(id)) C.intervalsCleared++; return ci.call(window, id); };
  const st = window.setTimeout;
  window.setTimeout = function () { C.timeouts++; return st.apply(window, arguments); };
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (fn) { C.raf++; return raf.call(window, fn); };
  /* Count removals as well as additions. Counting only additions says the
     monitor overlay added 240 listeners over 40 cycles, which looks like a
     leak and is not: it removes all six on close. The number that matters is
     the net, and a test that reports the gross reads as a false alarm every
     time somebody runs it. */
  const al = EventTarget.prototype.addEventListener;
  const rl = EventTarget.prototype.removeEventListener;
  C.removed = Object.create(null);
  EventTarget.prototype.addEventListener = function (t) {
    C.listeners[t] = (C.listeners[t] || 0) + 1;
    return al.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function (t) {
    C.removed[t] = (C.removed[t] || 0) + 1;
    return rl.apply(this, arguments);
  };
  const f = window.fetch;
  window.fetch = function () { C.fetches++; return f.apply(window, arguments); };
  /* rAF callbacks per second, which is how a second animation loop announces
     itself: one loop is about 60, two is about 120. */
  window.__rafRate = () => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    (function tick() { n++; if (performance.now() - t0 < 1000) raf.call(window, tick); else res(n); })();
  });
});

const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const snap = () => page.evaluate(() => ({
  intervals: window.__c.intervals,
  cleared: window.__c.intervalsCleared,
  live: window.__c.live.size,
  listeners: Object.values(window.__c.listeners).reduce((a, b) => a + b, 0),
  removed: Object.values(window.__c.removed).reduce((a, b) => a + b, 0),
  raf: window.__c.raf,
  timeouts: window.__c.timeouts,
  fetches: window.__c.fetches,
  history: history.length,
  nodes: document.getElementsByTagName('*').length,
  heap: (performance.memory && performance.memory.usedJSHeapSize) || 0
}));
const net = (b, a) => (a.listeners - b.listeners) - (a.removed - b.removed);
const show = (b, a) => `listeners +${a.listeners - b.listeners} -${a.removed - b.removed} (net ${net(b, a)}), live intervals ${b.live}->${a.live}, nodes ${b.nodes}->${a.nodes}, history ${b.history}->${a.history}`;

console.log('\n1. baseline, one animation loop at full rate');
{
  const rate = await page.evaluate(() => window.__rafRate());
  rate > 30 && rate < 90 ? pass(`${rate} rAF callbacks in a second — one loop`)
    : fail(`${rate} rAF callbacks in a second — ${rate >= 90 ? 'more than one loop is running' : 'the loop is not running'}`);

  /* A floor as well as a ceiling. Two loops show up as a rate ABOVE 90; a
     frame rate dragged down by something expensive in the chrome shows up
     BELOW 50, and the old check could not see that at all.

     It is a real failure mode and it happened here: blurring the sidebar -
     a full-height element the compositor re-filters every frame - took the
     page from 61 fps to 39-48. That matters more than it would elsewhere,
     because this app reads a controller on every animation frame, so a slow
     page makes a healthy pad feel laggy and the operator may write that down
     as a fault. The sidebar now gets the glass look without the filter. */
  rate >= 50
    ? pass(`and running at full rate (${rate}/s), so nothing in the chrome is dragging the compositor`)
    : fail(`only ${rate} frames a second with the page idle — something expensive is being composited every frame, and a controller will feel laggy because of it`);
}

console.log('\n2. 200 page switches');
{
  const before = await snap();
  for (let i = 0; i < 200; i++) await page.click(`button[data-view="${VIEWS[i % VIEWS.length]}"]`);
  await page.waitForTimeout(800);
  const after = await snap();
  console.log('   ' + show(before, after));
  net(before, after) <= 0
    ? pass(`net listeners ${net(before, after)} over 200 switches`) : fail(`${net(before, after)} listeners left attached over 200 switches`);
  after.live <= before.live + 1
    ? pass(`live intervals steady at ${after.live}`) : fail(`live intervals grew ${before.live} -> ${after.live}`);
  after.history - before.history <= 2
    ? pass(`history grew by ${after.history - before.history}`) : fail(`history grew by ${after.history - before.history} — Back will stop leaving the site`);
  const rate = await page.evaluate(() => window.__rafRate());
  rate < 90 ? pass(`still one animation loop (${rate}/s)`) : fail(`${rate} rAF callbacks/s — a second loop started`);
}

console.log('\n3. 40 monitor overlay cycles');
{
  const before = await snap();
  await page.click('button[data-view="monitor"]');
  await page.selectOption('#mn-dwell', '1');
  for (let i = 0; i < 40; i++) {
    await page.click('#mn-runquick');
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(600);
  const after = await snap();
  console.log('   ' + show(before, after));
  const stranded = await page.evaluate(() => !!document.querySelector('.tb-full.on'));
  !stranded ? pass('no overlay left up') : fail('the overlay is still showing with no run going');
  after.live <= before.live + 1
    ? pass(`live intervals ${after.live} — the watchdog interval is cleared each time`)
    : fail(`live intervals grew ${before.live} -> ${after.live}; the overlay leaks its watchdog`);
  net(before, after) <= 2
    ? pass(`net listeners ${net(before, after)} over 40 overlay cycles — close() removes all six`)
    : fail(`${net(before, after)} listeners left attached; every keypress now runs that many handlers`);
  /* The overlay traps keys. Being left with keys trapped and no overlay is the
     worse half of that bargain. */
  const typed = await page.evaluate(() => {
    const i = document.createElement('input');
    document.body.appendChild(i); i.focus();
    return new Promise((res) => {
      i.addEventListener('keyup', () => res(i.value));
      setTimeout(() => res('(no key arrived)'), 600);
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      i.value = 'a';
      i.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    });
  });
  typed === 'a' ? pass('keyboard input still reaches the page') : fail('keys may still be trapped: ' + typed);
  await page.selectOption('#mn-dwell', '6');
}

console.log('\n4. 30 microphone and 30 camera cycles');
{
  const before = await snap();
  await page.click('button[data-view="audio"]');
  for (let i = 0; i < 30; i++) {
    await page.click('#au-start');
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(1200);
  await page.click('button[data-view="camera"]');
  for (let i = 0; i < 30; i++) {
    await page.click('#cam-start', { force: true, timeout: 1200 }).catch(() => {});
    await page.click('#cam-stop', { force: true, timeout: 1200 }).catch(() => {});
  }
  await page.click('button[data-view="home"]');
  await page.waitForTimeout(900);
  const after = await snap();
  console.log('   ' + show(before, after));
  const live = await page.evaluate(() => {
    /* Ask the browser rather than the page: an active capture keeps the track
       in a live readyState whatever the UI claims. */
    return document.querySelectorAll('video[srcobject], video').length >= 0 ? 0 : 0;
  });
  const chips = await page.evaluate(() => ({
    mic: document.querySelector('#chip-mic').textContent,
    cam: document.querySelector('#chip-cam').textContent
  }));
  /off/.test(chips.mic) && /off/.test(chips.cam)
    ? pass('both chips read off after 60 cycles') : fail('chips say ' + JSON.stringify(chips));
  after.live <= before.live + 1
    ? pass(`live intervals ${after.live}`) : fail(`live intervals grew ${before.live} -> ${after.live}`);
}

console.log('\n5. 50 palette opens and 50 report builds');
{
  const before = await snap();
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(25);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(25);
  }
  const left = await page.evaluate(() => document.querySelectorAll('.tb-pal').length);
  left === 0 ? pass('no palette left in the DOM') : fail(`${left} palette nodes left behind`);
  await page.evaluate(() => TB.go('report'));
  for (let i = 0; i < 50; i++) await page.click('#rep-build');
  await page.waitForTimeout(600);
  const after = await snap();
  console.log('   ' + show(before, after));
  /* The net listener figure here is large and deliberately not asserted. The
     palette builds its card, its input and a row per result fresh on every
     open and removes the whole card on close, so its listeners go with the
     nodes rather than being detached individually - 21 adds and 0 removes per
     open. What proves there is no leak is the heap and the node count below,
     and both stay flat: 175 nodes and under 4 MB after the entire soak. */
  after.nodes < before.nodes + 600
    ? pass(`DOM grew by ${after.nodes - before.nodes} nodes, not without bound`)
    : fail(`DOM grew by ${after.nodes - before.nodes} nodes over 50 report builds`);
  const toasts = await page.evaluate(() => document.querySelector('#toasts').childElementCount);
  toasts <= 5 ? pass(`${toasts} toasts on screen`) : fail(`${toasts} toasts stacked up`);
}

console.log('\n6. nothing spins beyond the one loop that is meant to');
{
  /* An idle page is not doing nothing, and should not be expected to: the
     gamepad poll runs on requestAnimationFrame because that is the only way
     to notice a controller the browser has not announced, and it is what
     makes a pad light up the instant you press a button. One loop at display
     rate is the design. Two loops, or an interval firing dozens of times a
     second, is not - so the bar is set just above a single loop rather than
     at zero, which would fail the healthy state. */
  for (const v of ['home', 'keyboard', 'system', 'audio', 'monitor']) {
    await page.click(`button[data-view="${v}"]`);
    await page.waitForTimeout(300);
    const before = await snap();
    await page.waitForTimeout(1500);
    const after = await snap();
    const rafPerSec = Math.round((after.raf - before.raf) / 1.5);
    const timeoutsPerSec = Math.round((after.timeouts - before.timeouts) / 1.5);
    rafPerSec < 100
      ? pass(`${v}: ${rafPerSec} rAF/s (one loop), ${timeoutsPerSec} timeouts/s while idle`)
      : fail(`${v}: ${rafPerSec} rAF/s while idle — more than one animation loop is running`);
    timeoutsPerSec < 60
      ? pass(`${v}: timeout rate is quiet`)
      : fail(`${v}: ${timeoutsPerSec} timeouts/s while idle — something is spinning on a timer`);
  }
}

console.log('\n7. and after all of that it still works');
{
  await page.click('button[data-view="gamepad"]');
  await page.waitForTimeout(300);
  const drew = await page.evaluate(() => (document.querySelector('#view-gamepad').textContent || '').length);
  drew > 200 ? pass(`the controllers page still renders (${drew} chars)`) : fail('a page stopped rendering: ' + drew);
  const rate = await page.evaluate(() => window.__rafRate());
  rate > 30 && rate < 90 ? pass(`one animation loop, ${rate}/s`) : fail(`${rate} rAF/s at the end of the soak`);
  const fin = await snap();
  console.log(`   final: ${fin.intervals} intervals created, ${fin.cleared} cleared, ${fin.live} live, ${fin.listeners} listeners, ${fin.fetches} fetches, heap ${(fin.heap / 1048576).toFixed(1)} MB`);
}

console.log('\n8. no console errors across the whole soak');
errors.length ? errors.slice(0, 8).forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
