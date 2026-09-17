/* Regression: a side button remapped to a shortcut.
 *
 * Vinay's Razer has buttons 4 and 5 bound to Copy and Paste in Synapse. Those
 * buttons never send a mouse button — Windows and the browser both see Ctrl+C
 * and Ctrl+V — so the old page ignored them entirely and the mouse looked dead.
 * Detection must work with no toggle flipped.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/remapped-buttons.mjs
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

await page.goto(URL);
await page.waitForTimeout(1200);
await page.click('button[data-view="mouse"]');
await page.waitForTimeout(300);

console.log('1. nothing is claimed before any button is pressed');
{
  const t = await page.textContent('#ms-remap');
  (t && /None yet/.test(t)) ? pass('empty state explains itself') : fail('empty state missing: ' + JSON.stringify(t));
  const n = await page.textContent('#ms-macros');
  n === '0' ? pass('macro count starts at 0') : fail('macro count was ' + n);
}

console.log('\n2. Ctrl+C and Ctrl+V are recognised with no toggle flipped');
await page.keyboard.press('Control+c');
await page.waitForTimeout(60);
await page.keyboard.press('Control+v');
await page.waitForTimeout(60);
{
  const t = await page.textContent('#ms-remap');
  /Ctrl\+C/.test(t) ? pass('Ctrl+C listed') : fail('Ctrl+C not listed: ' + t);
  /Ctrl\+V/.test(t) ? pass('Ctrl+V listed') : fail('Ctrl+V not listed: ' + t);
  /Copy/.test(t) ? pass('named as Copy') : fail('Copy label missing');
  /Paste/.test(t) ? pass('named as Paste') : fail('Paste label missing');
  const n = await page.textContent('#ms-macros');
  n === '2' ? pass('macro count is 2') : fail('macro count was ' + n);
}

console.log('\n3. pressing the same button again counts, it does not duplicate');
await page.keyboard.press('Control+c');
await page.waitForTimeout(60);
{
  const n = await page.textContent('#ms-macros');
  n === '2' ? pass('still 2 distinct shortcuts') : fail('macro count drifted to ' + n);
  const t = await page.textContent('#ms-remap');
  /2 presses/.test(t) ? pass('press count incremented') : fail('press count not shown: ' + t);
}

console.log('\n4. a bare modifier is not mistaken for a remapped button');
await page.keyboard.down('Shift');
await page.waitForTimeout(40);
await page.keyboard.up('Shift');
await page.waitForTimeout(40);
{
  const n = await page.textContent('#ms-macros');
  n === '2' ? pass('bare Shift ignored') : fail('bare Shift counted, macro count now ' + n);
}

console.log('\n5. the verdict explains the remap instead of failing the mouse');
{
  const v = await page.textContent('#ms-verdict');
  /remapp/i.test(v) ? pass('verdict names the remap') : fail('verdict silent on remap: ' + v);
  /Synapse|mouse software/i.test(v) ? pass('verdict says how to test them as buttons') : fail('no remedy given');
}

console.log('\n6. typing in a text field is never treated as a mouse macro');
await page.click('#ms-tabs [data-t="dbl"]');
await page.waitForTimeout(80);
await page.fill('#ms-dcth', '90');
await page.waitForTimeout(60);
{
  const n = await page.textContent('#ms-macros');
  n === '2' ? pass('form input ignored') : fail('typing counted as macros, now ' + n);
}

console.log('\n7. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
