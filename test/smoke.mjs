/* Smoke test. Run this before shipping anything.
 *
 *   python3 -m http.server 8099 &
 *   npm install playwright
 *   node test/smoke.mjs
 *
 * It exists because a bug shipped where the Controllers page rendered nothing
 * at all with no controller attached — the single most common state in the whole
 * app, and the one nobody had ever tested. Both states are checked here now:
 * empty, and with a device present.
 */
import { chromium } from 'playwright';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const VIEWS = ['home','keyboard','mouse','gamepad','joycon','wheel','audio','airpods',
               'monitor','camera','touch','network','stress','system'];
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
  if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource/.test(t)) errors.push(t);
});

/* a controller we can plug and unplug at will */
await page.addInitScript(() => {
  window.__pads = [];
  navigator.getGamepads = () => window.__pads;
  window.__plug = (id, nb, na) => {
    window.__pads = [{ index: 0, id, mapping: 'standard', connected: true, timestamp: performance.now(),
      axes: new Array(na).fill(0),
      buttons: Array.from({ length: nb }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: null }];
  };
  window.__unplug = () => { window.__pads = []; };
});

await page.goto(URL);
await page.waitForTimeout(1500);

console.log('\n1. every page renders something with nothing plugged in');
for (const v of VIEWS) {
  await page.click(`button[data-view="${v}"]`);
  await page.waitForTimeout(300);
  const chars = await page.evaluate(v => (document.querySelector('#view-' + v).innerText || '').trim().length, v);
  chars < 200 ? fail(`${v} renders only ${chars} characters — probably blank`) : pass(`${v} (${chars} chars)`);
}

console.log('\n2. leaving a page and coming back still renders it');
for (let i = 1; i <= 3; i++) {
  await page.click('button[data-view="home"]'); await page.waitForTimeout(200);
  await page.click('button[data-view="gamepad"]'); await page.waitForTimeout(320);
  const ok = await page.evaluate(() => /Listening for a/.test(document.querySelector('#view-gamepad').innerText || ''));
  ok ? pass(`round trip ${i}`) : fail(`round trip ${i}: waiting panel missing`);
}

console.log('\n3. plugging a controller in is picked up');
await page.evaluate(() => window.__plug('Xbox One Game Controller (STANDARD GAMEPAD)', 17, 4));
await page.waitForTimeout(1600);
const named = await page.evaluate(() => /Xbox/.test(document.querySelector('#view-gamepad').innerText || ''));
named ? pass('controller detected and named') : fail('controller connected but the page never showed it');
const chip = await page.$eval('#chip-pad', n => n.textContent.trim());
/1/.test(chip) ? pass('status chip: ' + chip) : fail('status chip wrong: ' + chip);

console.log('\n4. unplugging returns to the waiting state');
await page.evaluate(() => window.__unplug());
await page.waitForTimeout(900);
await page.click('button[data-view="home"]'); await page.waitForTimeout(200);
await page.click('button[data-view="gamepad"]'); await page.waitForTimeout(350);
const back = await page.evaluate(() => /Listening for a/.test(document.querySelector('#view-gamepad').innerText || ''));
back ? pass('back to waiting panel') : fail('stuck showing a controller that is gone');

console.log('\n5. only one animation loop is running');
await page.evaluate(() => { window.__f = 0; const t = () => { window.__f++; requestAnimationFrame(t); }; requestAnimationFrame(t); });
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__plug('Xbox One Game Controller (STANDARD GAMEPAD)', 17, 4));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__unplug());
  await page.waitForTimeout(300);
}
const frames = await page.evaluate(() => window.__f);
frames > 100 ? pass(`${frames} frames — loop healthy`) : fail(`only ${frames} frames — loops are piling up and starving the page`);

console.log('\n6. refreshing stays on the same page');
await page.click('button[data-view="monitor"]'); await page.waitForTimeout(300);
const hash = await page.evaluate(() => location.hash);
hash === '#monitor' ? pass('address bar shows ' + hash) : fail('address bar shows "' + hash + '", expected #monitor');
await page.reload(); await page.waitForTimeout(1400);
const after = await page.evaluate(() => {
  const on = document.querySelector('.tb-view.on');
  return on ? on.id.replace('view-', '') : 'none';
});
after === 'monitor' ? pass('reload landed back on monitor') : fail('reload landed on "' + after + '" instead of monitor');

console.log('\n7. no console errors anywhere');
errors.length ? fail(errors.length + ' error(s):\n    ' + errors.join('\n    ')) : pass('clean');

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
