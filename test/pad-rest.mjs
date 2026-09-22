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

console.log('\n4. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
