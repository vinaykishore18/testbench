/* Lock keys: Caps, Num and Scroll.
 *
 * The page cannot stop them toggling — the keyboard firmware and the OS flip
 * the lock before any browser sees the key, and the Keyboard Lock API leaves
 * these three out on purpose. So the test is not "was it suppressed" but
 * "did the state actually change", which is the more useful question anyway:
 * a lock key that reports a press but never moves the light is dead.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/lock-keys.mjs
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
await page.waitForTimeout(1300);
await page.click('button[data-view="keyboard"]');
await page.waitForTimeout(300);

const pills = () => page.evaluate(() =>
  [...document.querySelectorAll('#kb-locks .tb-lockpill')].map(p => ({
    key: p.dataset.k, on: p.classList.contains('on'),
    unknown: p.classList.contains('unknown'), text: p.querySelector('small').textContent
  })));
const verdictText = () => page.evaluate(() => (document.querySelector('#kb-verdict') || {}).innerText || '');

console.log('1. all three locks are shown before anything is pressed');
{
  const p = await pills();
  p.length === 3 ? pass('three pills') : fail('found ' + p.length + ' pills');
  p.map(x => x.key).join(',') === 'CapsLock,NumLock,ScrollLock'
    ? pass('Caps, Num and Scroll') : fail('keys were ' + p.map(x => x.key).join(','));
}

/* Playwright cannot flip a real Caps Lock: the automation API drives key
   events, not the OS lock state, so getModifierState stays false however many
   times you press it. These events reproduce what a real keyboard does — the
   state is still the old one on keydown and the new one by keyup — with the
   lock map under the test's control. */
const fakeLock = (code, map) => page.evaluate(({ code, map }) => {
  for (const type of ['keydown', 'keyup']) {
    const e = new KeyboardEvent(type, { code, key: code, bubbles: true });
    const m = type === 'keydown' ? map.before : map.after;
    Object.defineProperty(e, 'getModifierState', { value: (k) => !!m[k] });
    window.dispatchEvent(e);
  }
}, { code, map });

console.log('\n2. a lock key that flips the state is credited with toggling');
await fakeLock('CapsLock', { before: {}, after: { CapsLock: true } });
await page.waitForTimeout(250);
{
  const caps = (await pills()).find(x => x.key === 'CapsLock');
  caps && caps.on ? pass('Caps reads ON: "' + caps.text + '"') : fail('Caps pill did not light: ' + JSON.stringify(caps));
  caps && /toggles/.test(caps.text) ? pass('recorded that it toggles') : fail('no toggle credit: ' + (caps && caps.text));
}

console.log('\n3. the verdict credits the key and warns it was left on');
{
  const v = await verdictText();
  /still on/i.test(v) ? pass('warned about the lock left on') : fail('no warning: ' + v.replace(/\s+/g, ' ').slice(0, 200));
  /toggled the lock properly/i.test(v) ? pass('credited the working key') : fail('no pass flag: ' + v.replace(/\s+/g, ' ').slice(0, 200));
}

console.log('\n4. pressing it again clears the light and the warning');
await fakeLock('CapsLock', { before: { CapsLock: true }, after: {} });
await page.waitForTimeout(250);
{
  const caps = (await pills()).find(x => x.key === 'CapsLock');
  caps && !caps.on ? pass('Caps reads off again') : fail('Caps still lit: ' + JSON.stringify(caps));
  const v = await verdictText();
  /still on/i.test(v) ? fail('warning did not clear') : pass('warning cleared');
}

console.log('\n5. a lock key that presses but never toggles is called out');
await fakeLock('ScrollLock', { before: {}, after: {} });
await page.waitForTimeout(300);
{
  const v = await verdictText();
  /dead lock key/i.test(v) ? pass('flagged as a dead lock key') : fail('not flagged: ' + v.replace(/\s+/g, ' ').slice(0, 220));
}

console.log('\n6. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
