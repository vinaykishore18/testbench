/* The automatic monitor run.
 *
 * It was starting and then sitting on the first pattern forever: open() calls
 * close() defensively before it begins, close() clears every piece of run state
 * including the auto flag, and open() then tested that flag a few lines later.
 * Every "automatic" run was waiting for a click.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/monitor-run.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;
let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource/.test(t)) errors.push('CONSOLE: ' + t);
});

await page.goto(URL);
await page.waitForTimeout(1300);
await page.click('button[data-view="monitor"]');
await page.waitForTimeout(300);

const hud = () => page.evaluate(() => {
  const h = document.querySelector('.tb-fullhud');
  if (!h) return null;
  const prog = h.querySelector('.prog i');
  return {
    name: (h.querySelector('b:not(.count)') || {}).textContent || '',
    step: (h.querySelector('span:nth-of-type(1)') || {}).textContent || '',
    count: (h.querySelector('b.count') || {}).textContent || '',
    width: prog ? parseFloat(prog.style.width) || 0 : -1,
    open: document.querySelector('#fullstage').classList.contains('on')
  };
});

console.log('1. a quick run starts moving on its own');
await page.selectOption('#mn-dwell', '4');
await page.click('#mn-runquick');
await page.waitForTimeout(600);
{
  const a = await hud();
  a && a.open ? pass('overlay up on ' + a.name) : fail('overlay did not open');
  a && a.count ? pass('countdown showing: ' + a.count) : fail('no countdown in the HUD');
  await page.waitForTimeout(1400);
  const b = await hud();
  b && b.width > (a ? a.width : 0) ? pass('progress advanced ' + a.width.toFixed(0) + '% to ' + b.width.toFixed(0) + '%')
                                   : fail('progress stuck at ' + (b && b.width) + '% — the run is not running');
  parseFloat(b.count) < parseFloat(a.count) ? pass('countdown falling: ' + a.count + ' to ' + b.count)
                                            : fail('countdown frozen at ' + b.count);
}

console.log('\n2. it moves to the next pattern by itself');
{
  const before = (await hud()).step;
  await page.waitForTimeout(3200);
  const after = await hud();
  after && after.step !== before
    ? pass('stepped from "' + before + '" to "' + after.step + '" with no input')
    : fail('still on ' + before + ' after a full dwell');
}

console.log('\n3. Escape stops it');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
(await hud()) === null ? pass('overlay closed') : fail('overlay still up after Escape');

console.log('\n4. F and Q start the runs from the keyboard');
await page.keyboard.press('q');
await page.waitForTimeout(600);
{
  const a = await hud();
  a && a.open ? pass('Q started the quick run') : fail('Q did nothing');
  const steps = a ? Number((a.step.match(/of (\d+)/) || [])[1]) : 0;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('f');
  await page.waitForTimeout(600);
  const b = await hud();
  b && b.open ? pass('F started the full run') : fail('F did nothing');
  const full = b ? Number((b.step.match(/of (\d+)/) || [])[1]) : 0;
  full > steps ? pass('the full run has more steps (' + full + ') than the quick one (' + steps + ')')
               : fail('full run had ' + full + ' steps, quick had ' + steps);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

console.log('\n4b. the one-second sweep really does advance once a second');
{
  /* A one-second dwell is where a timing bug shows up, because every source of
     slack - the fullscreen transition, the first frame, an animated pattern
     setting up - is now a sizeable fraction of the whole step. At six seconds
     a half-second stall is invisible; at one second it halts the run. */
  await page.selectOption('#mn-dwell', '1');
  await page.click('#mn-runquick');
  await page.waitForTimeout(500);
  const stepOf = () => page.evaluate(() => {
    const t = document.querySelector('.tb-fullhud')?.textContent || '';
    const m = t.match(/(\d+)\s+of\s+(\d+)/);
    return m ? Number(m[1]) : -1;
  });
  const first = await stepOf();
  await page.waitForTimeout(3200);
  const later = await stepOf();
  const advanced = later - first;
  /* Three seconds at a one-second dwell should move three steps. Allow two in
     case the fullscreen transition eats one, but standing still is a failure. */
  advanced >= 2 ? pass(`advanced ${advanced} steps in 3.2 s at a 1 s dwell`)
                : fail(`only advanced ${advanced} step(s) in 3.2 s at a 1 s dwell (${first} -> ${later})`);

  /* Read the countdown element itself. Matching a number-followed-by-s against
     the whole HUD picks up the step label and the pattern name too - it read
     "80.3 s" off text that had nothing to do with the timer. */
  const counting = await page.evaluate(() => {
    const b = document.querySelector('.tb-fullhud .count');
    const m = (b?.textContent || '').match(/([\d.]+)/);
    return m ? Number(m[1]) : -1;
  });
  counting >= 0 && counting <= 1.05 ? pass(`countdown reads ${counting} s, inside the one-second step`)
    : fail(`countdown reads ${counting} s on a one-second dwell`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.selectOption('#mn-dwell', '6');
}

console.log('\n5. typing in the dwell selector does not fire a run');
await page.selectOption('#mn-dwell', '6');
await page.waitForTimeout(400);
(await hud()) === null ? pass('no run started from the dropdown') : fail('a run started while using a form control');

console.log('\n6. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
