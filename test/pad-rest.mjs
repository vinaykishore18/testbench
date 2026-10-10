/* Regression: the resting measurement must not score the press that revealed
 * the pad.
 *
 * Browsers hide a gamepad until you press something. The old sampler started
 * the moment the pad appeared — which is the moment a button is down — took the
 * peak value of every button over the next 850 ms, and reported
 * "Held down with no one touching it: A", docking twenty points. Every pad
 * tested by pressing A failed for being tested.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/pad-rest.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;
let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource/.test(t)) errors.push('CONSOLE: ' + t);
});

/* a pad whose buttons we can hold and release from the test */
await page.addInitScript(() => {
  window.__pads = [];
  navigator.getGamepads = () => window.__pads;
  window.__plug = (held) => {
    window.__held = held;
    window.__pads = [{
      index: 0, id: 'Test Pad (STANDARD GAMEPAD)', mapping: 'standard',
      connected: true, timestamp: performance.now(),
      axes: [0, 0, 0, 0],
      get buttons() {
        return Array.from({ length: 17 }, (_, i) => {
          const on = window.__held === i;
          return { pressed: on, touched: on, value: on ? 1 : 0 };
        });
      },
      vibrationActuator: null
    }];
  };
  window.__release = () => { window.__held = -1; };
});

await page.goto(URL);
await page.waitForTimeout(1200);
await page.click('button[data-view="gamepad"]');
await page.waitForTimeout(300);

/* the verdict panel is built into #gp-body, so read the whole page body */
const verdict = () => page.evaluate(() => (document.querySelector('#gp-body') || {}).innerText || '');

console.log('1. a pad that appears with A held waits instead of measuring');
await page.evaluate(() => window.__plug(0));
await page.waitForTimeout(1400);
{
  const v = await verdict();
  /let go|waiting for it to sit still/i.test(v)
    ? pass('panel asks you to let go')
    : fail('expected a "let go" prompt, got: ' + v.replace(/\s+/g, ' ').slice(0, 140));
  /Held down with no one touching it/i.test(v)
    ? fail('scored the press that revealed the pad')
    : pass('no false stuck-button flag while waiting');
}

console.log('\n2. releasing it produces a clean reading');
await page.evaluate(() => window.__release());
await page.waitForTimeout(2200);
{
  const v = await verdict();
  /Held down with no one touching it/i.test(v)
    ? fail('still flagged as stuck after release: ' + v.replace(/\s+/g, ' ').slice(0, 140))
    : pass('no stuck-button flag');
  /dead centre|off centre/i.test(v) ? pass('drift was measured') : fail('no drift reading: ' + v.replace(/\s+/g, ' ').slice(0, 140));
  const score = await page.evaluate(() => {
    const p = TB.pads(); const k = Object.keys(p)[0];
    return k == null ? null : p[k].score;
  });
  Number(score) >= 90 ? pass('score ' + score + ' — not docked for the press') : fail('score was ' + score);
}

console.log('\n3. a button that really is stuck is still caught');
await page.evaluate(() => { window.__held = 1; TB.beginRestSample(TB.pads()[0] || Object.values(TB.pads())[0]); });
await page.waitForTimeout(11000);
{
  const v = await verdict();
  /Held down for eight seconds straight/i.test(v)
    ? pass('reported after the patience window, with the reason')
    : fail('a genuinely stuck button was not reported: ' + v.replace(/\s+/g, ' ').slice(0, 200));
}

console.log('\n3b. drift is drawn, not just scored');
{
  /* A figure like "rests at 0.071" means nothing at a glance, and the drift
     score read it without ever showing it. The plot now marks the measured
     rest point and the deadzone ring, so an operator sees whether a stick has
     crept outside what a game would ignore - which is the difference between
     a pad that is fine and one that walks the camera on its own.

     A second context, because this one needs a pad that is drifting from the
     moment it connects: the rest point comes from the settle sample taken on
     connection, so it cannot be introduced later. */
  const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx2.addInitScript(() => {
    const axes = [0.11, -0.06, 0, 0];          /* left stick resting off-centre */
    navigator.getGamepads = () => [{
      index: 0, id: 'Wireless Controller (STANDARD GAMEPAD)', mapping: 'standard',
      connected: true, timestamp: performance.now(), axes: axes,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: null
    }];
  });
  const p2 = await ctx2.newPage();
  await p2.goto(URL, { waitUntil: 'load' });
  await p2.click('button[data-view="gamepad"]');
  await p2.waitForTimeout(2600);               /* settle 450 ms + measure 850 ms, with slack */

  const reads = await p2.evaluate(() =>
    [...document.querySelectorAll('.tb-stickread')].map((n) => ({ text: n.textContent, cls: n.className })));

  reads.length >= 2 ? pass(`${reads.length} stick readouts rendered`) : fail(`${reads.length} stick readouts`);

  const left = reads[0] || { text: '', cls: '' };
  /rests 12\.5%/.test(left.text)
    ? pass('the left stick reports its measured rest magnitude: 12.5%')
    : fail('no rest magnitude on the drifting stick: ' + JSON.stringify(left.text));
  /OUTSIDE the deadzone/.test(left.text)
    ? pass('and says it is outside the deadzone, in words')
    : fail('it does not say the drift is outside the deadzone: ' + JSON.stringify(left.text));
  /\bbad\b/.test(left.cls)
    ? pass('and the readout is tinted to match') : fail('readout class is ' + JSON.stringify(left.cls));

  const right = reads[1] || { text: '', cls: '' };
  /inside the deadzone/.test(right.text) && !/\bbad\b/.test(right.cls)
    ? pass('the clean right stick is not flagged')
    : fail('a centred stick was flagged: ' + JSON.stringify(right));

  /* And the canvas must actually have drawn something other than the grid -
     a marker that exists only in the readout text is not a visual. */
  const drawn = await p2.evaluate(() => {
    const c = document.querySelector('.tb-stick canvas');
    if (!c) return -1;
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) lit++;
    return lit;
  });
  drawn > 500 ? pass(`the plot is drawn (${drawn} lit pixels)`)
    : fail(`the stick canvas is empty or nearly so (${drawn} lit pixels)`);

  await ctx2.close();
}

console.log('\n4. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
