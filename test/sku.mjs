/* The SKU gate.
 *
 *   python3 -m http.server 8099 &
 *   node test/sku.mjs
 *
 * A report has to be about something. Without a unit number it is a page of
 * scores that could belong to any of the forty units on the trolley, and a
 * file called testbench_unit_20261011.csv sitting in an inventory folder is
 * worse than no file - somebody will match it to the wrong item.
 *
 * So the gate is on the REPORT, never on the bench. Plugging a controller in
 * and testing it must still need no typing at all, because that is most of
 * what happens on a bench.
 */
import { chromium } from 'playwright';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;

let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'load' });

const plug = (id) => page.evaluate((i) =>
  window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: { id: i, index: 0 } })), id);
const toastText = () => page.evaluate(() => (document.querySelector('#toasts') || {}).textContent || '');
const barUp = () => page.evaluate(() => !!document.querySelector('.tb-skubar'));

console.log('\n1. the bench is not gated, only the report');
{
  /* The single most important property. If plugging a controller in demanded
     a form before anything would respond, the tool would be slower than the
     thing it replaced and nobody would use it. */
  await page.click('button[data-view="gamepad"]');
  await page.waitForTimeout(300);
  const drew = await page.evaluate(() => (document.querySelector('#view-gamepad').textContent || '').length);
  drew > 200 ? pass('the controllers page works with no SKU entered') : fail('the page is blocked without a SKU');
  const blocking = await page.evaluate(() => {
    const b = document.querySelector('.tb-skubar');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > innerWidth * 0.98 && r.height > innerHeight * 0.5;
  });
  !blocking ? pass('nothing modal is in the way') : fail('a full-screen prompt is blocking the bench');
}

console.log('\n2. plugging a device offers a report');
{
  await page.click('button[data-view="home"]');
  await plug('Wireless Controller (STANDARD GAMEPAD)');
  await page.waitForTimeout(500);
  (await barUp()) ? pass('the bar appears on plug-in') : fail('nothing offered when a device arrived');
  const named = await page.evaluate(() => (document.querySelector('.tb-skubar .what') || {}).textContent || '');
  /Wireless Controller/.test(named) ? pass('and names the device: ' + named)
    : fail('the bar does not say what was plugged in: ' + JSON.stringify(named));
}

console.log('\n3. "Not now" means not now');
{
  await page.click('.tb-skubar .act .tb-btn:not(.pri)');
  await page.waitForTimeout(300);
  !(await barUp()) ? pass('dismissed') : fail('the bar would not go away');
  /* Same device again must not re-offer. A prompt that comes back every time
     the pad reconnects is the kind of thing people disable the feature over. */
  await plug('Wireless Controller (STANDARD GAMEPAD)');
  await page.waitForTimeout(400);
  !(await barUp()) ? pass('and the same device does not ask again') : fail('it came back for a device already dismissed');
}

console.log('\n4. no SKU, no report — on every path');
{
  await page.click('button[data-view="home"]');
  await page.evaluate(() => {
    const sec = document.querySelector('#view-mouse');
    const n = document.createElement('div'); n.id = 'sku-t1'; sec.appendChild(n);
    TB.verdict(n, 93, [{ level: 'ok', tag: 'buttons', text: 'All five register.' }]);
  });
  for (const btn of ['#rep-build', '#rep-copy', '#rep-csv', '#rep-json']) {
    await page.evaluate(() => { const t = document.querySelector('#toasts'); if (t) t.textContent = ''; });
    await page.click(btn);
    await page.waitForTimeout(400);
    /needs a unit number/.test(await toastText())
      ? pass(`${btn} refused`) : fail(`${btn} produced a report with no unit number`);
  }
  const out = await page.evaluate(() => (document.querySelector('#rep-out') || {}).textContent || '');
  out.trim() === '' ? pass('and nothing was rendered') : fail('a report was built anyway');
}

console.log('\n5. the SKU becomes the report number');
{
  await plug('Razer DeathAdder V3');
  await page.waitForTimeout(400);
  (await barUp()) ? pass('a different device does ask') : fail('the bar did not appear for a new device');
  await page.fill('.tb-skubar input', 'DS4-LOT-418');
  await page.click('.tb-skubar .tb-btn.pri');
  await page.waitForTimeout(500);

  const v = await page.evaluate(() => document.querySelector('#rep-unit').value);
  v === 'DS4-LOT-418' ? pass('the field is filled from the bar') : fail('field reads ' + JSON.stringify(v));

  const badge = await page.evaluate(() => (document.querySelector('#sku-badge') || {}).textContent || '');
  /DS4-LOT-418/.test(badge) ? pass('and the top bar shows which unit is being recorded: ' + badge.trim())
    : fail('no unit badge in the status bar');

  await page.click('#rep-build');
  await page.waitForTimeout(400);
  const head = await page.evaluate(() => (document.querySelector('.tb-rephead') || {}).textContent || '');
  /Report DS4-LOT-418/.test(head) ? pass('the report carries the number') : fail('report header: ' + head.slice(0, 120));
  const body = await page.evaluate(() => (document.querySelector('#rep-out') || {}).textContent || '');
  /Report number[\s\S]{0,40}DS4-LOT-418/.test(body) ? pass('and lists it as the report number')
    : fail('the report does not state its number');
}

console.log('\n6. the filename is the SKU');
{
  for (const [btn, ext] of [['#rep-csv', '.csv'], ['#rep-json', '.json']]) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
      page.click(btn)
    ]);
    if (!dl) { fail(`${btn} produced no download`); continue; }
    const n = dl.suggestedFilename();
    n.includes('DS4-LOT-418') && n.endsWith(ext)
      ? pass(`${ext} saved as ${n}`) : fail(`filename does not carry the SKU: ${n}`);
  }
}

console.log('\n7. starting a new unit clears the number too');
{
  await page.click('#rep-reset'); await page.waitForTimeout(600);
  await page.click('#rep-reset'); await page.waitForTimeout(500);
  const v = await page.evaluate(() => document.querySelector('#rep-unit').value);
  v === '' ? pass('SKU cleared') : fail('SKU survived the reset: ' + JSON.stringify(v));
  const badge = await page.evaluate(() => !!document.querySelector('#sku-badge'));
  !badge ? pass('and the badge went with it') : fail('the status bar still claims a unit is being recorded');
  await page.evaluate(() => { const t = document.querySelector('#toasts'); if (t) t.textContent = ''; });
  await page.click('#rep-csv'); await page.waitForTimeout(400);
  /needs a unit number/.test(await toastText())
    ? pass('and the gate is closed again') : fail('exports still work after the unit was cleared');
}

console.log('\n8. no console errors');
errors.length ? errors.slice(0, 6).forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
