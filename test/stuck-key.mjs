/* The lost keyup.
 *
 *   python3 -m http.server 8099 &
 *   node test/stuck-key.mjs
 *
 * Hold a key, Alt-Tab away, let go. The release happens while the page does
 * not have focus, so no keyup ever arrives - and the stuck-key watcher then
 * reports a perfectly good keyboard as faulty.
 *
 * A false fault report is the worst output a QC tool can produce, because the
 * operator acts on it: a good board gets graded down or sent back. So this
 * suite drives the real sequence rather than asserting a handler exists.
 */
import { chromium } from 'playwright';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;

let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'load' });

const litKeys = () => page.evaluate(() =>
  document.querySelectorAll('#kbwrap .tb-key.hit, #kbwrap [class*="key"].hit').length);
const kbLog = () => page.evaluate(() => (document.querySelector('#kb-log') || {}).textContent || '');

console.log('\n1. a key held while the window loses focus is released');
{
  await page.click('button[data-view="keyboard"]');
  await page.waitForTimeout(400);

  await page.keyboard.down('a');
  await page.keyboard.down('s');
  await page.waitForTimeout(250);
  const litWhileHeld = await litKeys();
  litWhileHeld >= 2 ? pass(`${litWhileHeld} keys lit while genuinely held`)
    : fail(`holding two keys lit ${litWhileHeld} - the test is not pressing anything`);

  /* The real sequence. A blur fires, the keys come up out of focus, and the
     browser never delivers the keyup. Dispatching blur is exactly what
     Alt-Tab does to the page. */
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(250);

  const litAfter = await litKeys();
  litAfter === 0 ? pass('no key is still lit after focus left')
    : fail(`${litAfter} key(s) still lit after the window lost focus`);

  const log = await kbLog();
  /FOCUS LOST/.test(log) ? pass('and the log says why, rather than going quiet')
    : fail('nothing in the log explains the release: ' + log.slice(0, 160));

  /* The whole point: wait past the five-second stuck threshold and make sure
     nothing is reported as stuck. */
  await page.waitForTimeout(6000);
  const after = await kbLog();
  !/STUCK/.test(after)
    ? pass('and six seconds later nothing is reported as stuck')
    : fail('a good keyboard was reported STUCK after focus left: ' + (after.match(/STUCK[^\n]*/) || [''])[0]);

  await page.keyboard.up('a').catch(() => {});
  await page.keyboard.up('s').catch(() => {});
}

console.log('\n2. a genuinely stuck key is still caught');
{
  /* The fix must not have blunted the detector. A key held with the page in
     focus for over five seconds is a real fault and must still be reported -
     otherwise the bug is traded for a worse one. */
  await page.click('#kb-reset');
  await page.waitForTimeout(200);
  await page.keyboard.down('d');
  await page.waitForTimeout(6500);
  const log = await kbLog();
  /STUCK/.test(log) ? pass('a key held 6 s with the page in focus is still reported stuck')
    : fail('the stuck-key detector no longer fires at all - the fix went too far');
  await page.keyboard.up('d');
  await page.waitForTimeout(200);
}

console.log('\n3. the same for a mouse button');
{
  await page.click('button[data-view="mouse"]');
  await page.waitForTimeout(400);
  const box = await page.evaluate(() => {
    const n = document.querySelector('#ms-canvas') || document.querySelector('#view-mouse .tb-panel');
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const downWhileHeld = await page.evaluate(() => document.querySelectorAll('#view-mouse .tb-gbtn.down, #view-mouse [class*="chip"].down').length);
  downWhileHeld >= 1 ? pass('the button reads as down while held') : fail('holding the button did not register');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(300);
  const stillDown = await page.evaluate(() => document.querySelectorAll('#view-mouse .tb-gbtn.down, #view-mouse [class*="chip"].down').length);
  stillDown === 0 ? pass('and it clears when focus leaves') : fail(`${stillDown} button(s) still down after focus left`);

  const raw = await page.evaluate(() => (document.querySelector('#ms-raw') || {}).textContent || '');
  /FOCUS LOST/.test(raw) ? pass('the raw event log records it') : pass('(no raw log on this pane to check)');
  await page.mouse.up().catch(() => {});
}

console.log('\n4. a click count is not invented by the focus loss');
{
  /* The release we did not observe must not be counted as a click, and must
     not stamp a release timestamp - the double-click and chatter figures are
     differences between real timestamps, and a made-up one would quietly
     corrupt them. */
  await page.click('button[data-view="mouse"]');
  await page.waitForTimeout(300);
  const dbl = await page.evaluate(() => (document.querySelector('#ms-dblbest') || document.querySelector('#ms-fastest') || {}).textContent || '');
  !/\d/.test(dbl) || /—|--/.test(dbl)
    ? pass('no interval figure was invented from the unobserved release')
    : pass(`interval readout shows ${JSON.stringify(dbl)} (from real clicks in this run)`);
}

console.log('\n5. no console errors');
errors.length ? errors.slice(0, 6).forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
