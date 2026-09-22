/* The guided bench run: does it advance on its own, and does it refuse to
 * advance when the step has not actually been satisfied?
 *
 * The second half matters more. A guide that waves everything through is worse
 * than no guide, because it tells you a unit passed when nobody checked.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/bench-run.mjs
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

await page.addInitScript(() => {
  window.__pads = [];
  navigator.getGamepads = () => window.__pads;
  window.__plug = () => {
    window.__held = -1;
    window.__pads = [{
      index: 0, id: 'Test Pad (STANDARD GAMEPAD)', mapping: 'standard',
      connected: true, timestamp: performance.now(), axes: [0, 0, 0, 0],
      get buttons() {
        return Array.from({ length: 17 }, (_, i) => {
          const on = window.__held === i;
          return { pressed: on, touched: on, value: on ? 1 : 0 };
        });
      },
      vibrationActuator: null
    }];
  };
});

const bar = () => page.evaluate(() => {
  const b = document.querySelector('.tb-run');
  if (!b) return null;
  return {
    kick: b.querySelector('.tb-run-kick').textContent,
    title: b.querySelector('.tb-run-title').textContent,
    count: b.querySelector('.tb-run-count').textContent,
    done: [...b.querySelector('.tb-run-dots').children].filter(d => d.className === 'done').length
  };
});
const tab = () => page.evaluate(() => (document.querySelector('#ms-tabs [aria-selected="true"]') || {}).dataset?.t);
/* a button the harness cannot press for real */
const pressBtn = (n) => page.evaluate((n) => {
  const t = document.querySelector('#view-mouse .tb-panel');
  for (const type of ['mousedown', 'mouseup']) {
    t.dispatchEvent(new MouseEvent(type, { bubbles: true, button: n, buttons: type === 'mousedown' ? 1 << n : 0 }));
  }
}, n);

await page.goto(URL);
await page.waitForTimeout(1300);
await page.click('button[data-view="mouse"]');
await page.waitForTimeout(300);

console.log('1. the run starts on the first step and opens the right tab');
await page.click('#run-start');
await page.waitForTimeout(400);
{
  const b = await bar();
  b ? pass('bar is up: ' + b.kick) : fail('no bench run bar appeared');
  (await tab()) === 'buttons' ? pass('switched to Buttons') : fail('tab was ' + await tab());
  b && /step 1 of 5/.test(b.kick) ? pass('five steps in the mouse flow') : fail('step count wrong: ' + (b && b.kick));
}

console.log('\n2. it will not advance on one button');
await pressBtn(0);
await page.waitForTimeout(3400);
{
  const b = await bar();
  b && /step 1 of/.test(b.kick) ? pass('held at step 1 below the minimum') : fail('advanced too early: ' + (b && b.kick));
}

console.log('\n3. three distinct buttons, then a pause, advances it');
await pressBtn(1); await page.waitForTimeout(120);
await pressBtn(2); await page.waitForTimeout(120);
await pressBtn(3); await page.waitForTimeout(3600);
{
  const b = await bar();
  b && /step 2 of/.test(b.kick) ? pass('advanced to step 2 once the count settled') : fail('did not advance: ' + (b && b.kick));
  (await tab()) === 'scroll' ? pass('opened the Scroll wheel tab by itself') : fail('tab was ' + await tab());
  b && b.done === 1 ? pass('step 1 marked done') : fail('dots show ' + (b && b.done) + ' done');
}

console.log('\n4. Skip moves on without pretending the step passed');
await page.click('.tb-run-acts .tb-btn:nth-child(2)');
await page.waitForTimeout(400);
{
  const b = await bar();
  b && /step 3 of/.test(b.kick) ? pass('skipped to step 3') : fail('skip did nothing: ' + (b && b.kick));
}

console.log('\n5. End run removes the bar');
await page.click('#run-start');
await page.waitForTimeout(300);
(await bar()) === null ? pass('bar removed') : fail('bar still showing after End run');

console.log('\n6. leaving the page ends the run');
await page.click('#run-start'); await page.waitForTimeout(300);
await page.click('button[data-view="home"]'); await page.waitForTimeout(500);
(await bar()) === null ? pass('run stopped on navigation') : fail('run survived navigation');

console.log('\n7. the controller flow drops steps a pad cannot do');
await page.click('button[data-view="gamepad"]'); await page.waitForTimeout(300);
await page.evaluate(() => window.__plug());
await page.waitForTimeout(2500);
await page.click('#run-start'); await page.waitForTimeout(400);
{
  const b = await bar();
  b && /Controller/.test(b.kick) ? pass('controller flow started: ' + b.kick) : fail('no controller flow: ' + (b && b.kick));
  b && /step 1 of 4/.test(b.kick) ? pass('all four steps apply to a standard pad') : fail('step count: ' + (b && b.kick));
}

console.log('\n8. a page with no flow says so instead of failing silently');
await page.click('#run-start'); await page.waitForTimeout(200);
await page.click('button[data-view="stress"]'); await page.waitForTimeout(300);
await page.click('#run-start'); await page.waitForTimeout(400);
{
  const b = await bar();
  const toast = await page.evaluate(() => (document.querySelector('#toasts') || {}).textContent || '');
  b === null && /No guided run here yet/.test(toast)
    ? pass('explained itself, no bar')
    : fail('bar=' + JSON.stringify(b) + ' toast=' + JSON.stringify(toast.slice(0, 120)));
}

console.log('\n9. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
