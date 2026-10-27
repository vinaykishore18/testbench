/* Wheels, driven by a simulated G923.
 *
 * The page assumed steering lived on axis 0. A G923 reports ten axes and puts
 * the wheel wherever its driver feels like — so the page was reading a pedal
 * sitting at rest, drew 0° forever, and looked stone dead while the wheel was
 * being turned lock to lock in front of it.
 *
 * Every check here moves a real axis and looks at what the page does. Reading
 * the source would never have caught this; only turning the wheel does.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/wheel.mjs
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

/* A G923 as Chrome actually reports it: ten axes, fourteen buttons, no standard
   mapping, and steering on axis 3 rather than axis 0. Axis 0 holds a pedal that
   rests near one end, which is exactly the decoy that broke the real page. */
await page.addInitScript(() => {
  window.__ax = [ -0.98, 1, 1, 0, 0, 0, 0, 0, 0, 1.2857 ];  /* axis 9 is the hat, resting */
  window.__btn = new Array(14).fill(0);
  navigator.getGamepads = () => [{
    index: 0,
    id: 'G923 Racing Wheel for PlayStation and PC (Vendor: 046d Product: c266)',
    mapping: '', connected: true, timestamp: performance.now(),
    axes: window.__ax.slice(),
    buttons: window.__btn.map(v => ({ pressed: v > 0.5, touched: v > 0.5, value: v })),
    vibrationActuator: null
  }];
  window.__steer = (v) => { window.__ax[3] = v; };
  window.__pedal = (i, v) => { window.__ax[i] = v; };
  window.__hat = (v) => { window.__ax[9] = v; };
});

await page.goto(URL);
await page.waitForTimeout(1500);
await page.click('button[data-view="wheel"]');
await page.waitForTimeout(600);

const read = () => page.evaluate(() => {
  const g = document.querySelector('#whrot');
  const ws = (window.TB && TB.wheelState) ? TB.wheelState() : {};
  return {
    transform: g ? g.getAttribute('transform') || '' : null,
    angle: (document.querySelector('#wh-deg') || {}).textContent || '',
    axis: String(ws.steerAxis),
    pedals: ws.pedals || []
  };
});

console.log('1. the wheel is detected at all');
{
  const chip = await page.textContent('#chip-wheel');
  /logitech|g923|playstation/i.test(chip) || !/—/.test(chip)
    ? pass('status chip: ' + chip.trim()) : fail('wheel not detected: ' + chip);
  const body = await page.textContent('#wh-body');
  /G923/.test(body) ? pass('named on the page') : fail('device name missing');
}

console.log('\n2. turning it moves the diagram — the bug');
{
  const before = await read();
  /* lock to lock, the way a person tests one */
  for (const v of [-1, -0.5, 0, 0.5, 1, 0.5, 0, -0.5, -1, 0]) {
    await page.evaluate(v => window.__steer(v), v);
    await page.waitForTimeout(90);
  }
  await page.evaluate(() => window.__steer(0.6));
  await page.waitForTimeout(250);
  const after = await read();
  after.transform !== before.transform
    ? pass('diagram rotated: ' + after.transform)
    : fail('diagram never moved, still ' + after.transform + ' — the wheel reads dead');
  const deg = parseFloat(after.angle);
  Math.abs(deg) > 5 ? pass('angle reads ' + after.angle) : fail('angle stuck at ' + after.angle);
}

console.log('\n3. it found the steering axis by itself');
{
  const st = await read();
  st.axis === '3' ? pass('picked axis 3, where the steering actually is')
                  : fail('selector says axis ' + st.axis + ' — it is still guessing');
}

console.log('\n4. pedals are found on their own and fill when pressed');
{
  /* axis 0 rests at one end like a real pedal, then gets stamped to the floor */
  await page.evaluate(() => window.__pedal(0, -0.98)); await page.waitForTimeout(120);
  await page.evaluate(() => window.__pedal(0, 1)); await page.waitForTimeout(220);
  const st = await read();
  st.pedals.includes(0) ? pass('axis 0 found as a pedal, no setup')
                        : fail('pedal not detected, pedals = ' + JSON.stringify(st.pedals));
  const fill = await page.evaluate(() => {
    const f = document.querySelector('#wh-peds .tb-pedbar i');
    return f ? parseFloat(f.style.height || '0') : -1;
  });
  fill > 50 ? pass('its bar fills as it travels: ' + fill + '%') : fail('the pedal bar did not fill: ' + fill);
  await page.evaluate(() => window.__pedal(0, -0.98)); await page.waitForTimeout(120);
}

console.log('\n5. a pedal is not mistaken for the steering');
{
  const st = await read();
  st.axis === '3' ? pass('still on axis 3 — a one-ended travel is not steering')
                  : fail('switched to axis ' + st.axis + ' after a pedal moved');
}

console.log('\n7. buttons register');
{
  await page.evaluate(() => { window.__btn[6] = 1; });
  await page.waitForTimeout(250);
  const down = await page.evaluate(() => document.querySelectorAll('#wh-body .tb-gbtn.down, #wh-body .down').length);
  down > 0 ? pass(down + ' button lit') : fail('no button lit while one is held');
  await page.evaluate(() => { window.__btn[6] = 0; });
}

console.log('\n8. the D-pad lights up — it arrives on a hat axis, not as buttons');
{
  const lit = async () => page.evaluate(() =>
    [...document.querySelectorAll('.tb-hatkey.on')].map(n => n.className.replace('tb-hatkey ', '').replace(' seen', '').replace(' on', '').trim()));
  (await lit()).length === 0 ? pass('nothing lit while the hat rests') : fail('a direction was lit at rest');
  await page.evaluate(() => window.__hat(0.714));   /* left */
  await page.waitForTimeout(250);
  const l = await lit();
  l.includes('left') ? pass('left lights: ' + JSON.stringify(l)) : fail('left pressed, lit ' + JSON.stringify(l));
  await page.evaluate(() => window.__hat(-1));      /* up */
  await page.waitForTimeout(250);
  const u = await lit();
  u.includes('up') ? pass('up lights: ' + JSON.stringify(u)) : fail('up pressed, lit ' + JSON.stringify(u));
  await page.evaluate(() => window.__hat(1.2857));
  await page.waitForTimeout(250);
  (await lit()).length === 0 ? pass('released cleanly') : fail('a direction stayed lit after release');
}

console.log('\n9. face buttons are named and coloured, not numbered');
{
  const faces = await page.evaluate(() =>
    [...document.querySelectorAll('#wh-body .tb-gbtn')].slice(0, 4).map(n => ({
      label: n.querySelector('span').textContent,
      face: n.dataset.face || '',
      border: getComputedStyle(n).borderTopColor
    })));
  faces.every(f => !/^B\d/.test(f.label))
    ? pass('named: ' + faces.map(f => f.label).join(', ')) : fail('still numbered: ' + JSON.stringify(faces.map(f => f.label)));
  const colours = new Set(faces.map(f => f.border));
  colours.size === 4 ? pass('four distinct face colours') : fail('only ' + colours.size + ' distinct colours across the four face buttons');
}

console.log('\n10. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
