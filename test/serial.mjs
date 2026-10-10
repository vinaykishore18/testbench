/* Apple serial check.
 *
 *   python3 -m http.server 8099 &
 *   node test/serial.mjs
 *
 * The thing worth testing here is not that the checker produces output. It is
 * that it fails on the serials it should fail on and, just as importantly,
 * passes on the ones it should pass on. A validator that rejects everything
 * catches every fake and is still useless, so both directions are asserted.
 *
 * It also checks the page never reaches out to Apple on its own, because a
 * check that quietly phones home is not the check the page says it is.
 */
import { chromium } from 'playwright';

const SITE = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;

let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

/* Anything leaving for a third party is a failure by itself. */
const offsite = [];
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') offsite.push(r.url());
});

await page.goto(SITE, { waitUntil: 'load' });

const check = (sn, model) => page.evaluate(([s, m]) => {
  const r = window.SERIALCHECK.analyse(s, m);
  return { ok: r.ok, shape: r.shape, cross: r.cross,
           built: r.built, factory: r.factory,
           tags: r.findings.map((f) => f.level + ':' + f.tag),
           text: r.findings.map((f) => f.text).join(' ') };
}, [sn, model || '']);

/* GH1 factory, V = 2017 second half, K = 16th week character, so week 42. */
const GOOD12 = 'GH1VK1230A1B';

console.log('\n1. a well-formed 12-character serial decodes');
{
  const r = await check(GOOD12);
  r.ok ? pass('accepted') : fail('a valid 12-character serial was rejected: ' + r.text.slice(0, 200));
  r.built && r.built.year === 2017 ? pass('year decoded as 2017') : fail('year decoded as ' + JSON.stringify(r.built));
  r.built && r.built.week === 42 ? pass('week decoded as 42') : fail('week decoded as ' + (r.built && r.built.week));
  /shape/.test(r.shape) || /12-character/.test(r.shape) ? pass('shape: ' + r.shape) : fail('shape: ' + r.shape);
}

console.log('\n2. the date characters are not free text');
{
  /* A is a vowel and is not in the half-year table at all. An invented serial
     of the right length almost never gets both date positions right, which is
     the whole value of checking them. */
  const r = await check('GH1AE1230A1B');
  !r.ok ? pass('a 12-character serial with an impossible date code was rejected') : fail('an impossible date code was accepted');
  /not a date Apple uses/.test(r.text) ? pass('and it said why') : fail('no explanation: ' + r.text.slice(0, 200));
}

console.log('\n3. O-for-zero and S-for-5 get called out');
{
  const r = await check('GH1OK1230A1B');
  !r.ok ? pass('rejected') : fail('an O in the year position was accepted');
  /misread/.test(r.text) ? pass('and it suggests checking for a misread character') : fail('no lookalike hint: ' + r.text.slice(0, 200));
}

console.log('\n4. a build date before the model existed is impossible');
{
  /* W = 2018 first half, week character 1 = week 1. Against AirPods Pro 2,
     released September 2022. */
  const r = await check('GH1W11230A1B', '2022-09');
  r.cross === 'impossible' ? pass('flagged as impossible') : fail('cross-check said: ' + r.cross);
  !r.ok ? pass('and the overall result is a fail') : fail('the contradiction did not fail the serial');
  /cannot be built before its own model/.test(r.text) ? pass('and it explains the contradiction') : fail('no explanation: ' + r.text.slice(0, 200));
}

console.log('\n5. a randomised serial on a pre-2021 model is impossible too');
{
  const r = await check('FVFJQ2M3LX', '2016-12');
  r.cross === 'impossible' ? pass('flagged as impossible') : fail('cross-check said: ' + r.cross);
}

console.log('\n6. and the same serial on a current model is fine');
{
  const r = await check('FVFJQ2M3LX', '2022-09');
  r.ok ? pass('accepted') : fail('a valid randomised serial was rejected: ' + r.text.slice(0, 200));
  /randomised/.test(r.shape) ? pass('shape: ' + r.shape) : fail('shape: ' + r.shape);
  /nothing encoded/.test(r.text) ? pass('and it says there is nothing in it to decode') : fail('it implies it decoded something: ' + r.text.slice(0, 160));
}

console.log('\n7. an 11-character serial decodes, ambiguously, and says so');
{
  const r = await check('C09341234BC');
  r.ok ? pass('accepted') : fail('rejected: ' + r.text.slice(0, 200));
  r.built && r.built.week === 34 ? pass('week 34') : fail('week read as ' + (r.built && r.built.week));
  /genuinely ambiguous/.test(r.text) ? pass('and it admits the year is ambiguous rather than guessing')
    : fail('it does not admit the one-digit year is ambiguous: ' + r.text.slice(0, 200));
}

console.log('\n8. junk is rejected');
{
  for (const [sn, why] of [['ABC', 'too short'], ['GH1VK1230A1BQQQQ', 'too long'],
                           ['GH1VK123!A1B', 'a character Apple never uses']]) {
    const r = await check(sn);
    !r.ok ? pass(`rejected ${JSON.stringify(sn)} (${why})`) : fail(`accepted ${JSON.stringify(sn)} — ${why}`);
  }
}

console.log('\n9. the human things are forgiven, not failed');
{
  const r = await check('  gh1vk123 0a1b ');
  r.ok ? pass('spaces and lower case are read, not rejected') : fail('a serial with spaces and lower case was rejected');
  const r2 = await check('S/N: GH1VK1230A1B');
  r2.ok ? pass('an "S/N:" prefix is stripped') : fail('the S/N prefix broke it');
}

console.log('\n10. it never claims a pass proves anything');
{
  const r = await check(GOOD12, '2016-12');
  /NOT proven genuine/.test(r.text) ? pass('every result carries the limit of what it proved')
    : fail('a passing result does not state its own limits');
}

console.log('\n11. nothing is sent anywhere');
{
  /* Drive it through the actual UI, not just the exposed function, so a
     fetch wired to the button would show up. */
  await page.click('button[data-view="airpods"]');
  await page.waitForTimeout(250);
  await page.click('#ap-tabs button[data-t="serial"]');
  await page.waitForTimeout(250);
  await page.fill('#sn-in', GOOD12);
  await page.selectOption('#sn-model', '2016-12');
  await page.click('#sn-check');
  await page.waitForTimeout(1200);

  offsite.length === 0 ? pass('no request left this origin') : fail('requests went off-site: ' + offsite.slice(0, 3).join(', '));

  const shown = await page.evaluate(() => (document.querySelector('#sn-out') || {}).textContent || '');
  /week 42 of 2017/.test(shown) ? pass('the UI shows the decoded date') : fail('the UI did not render the result: ' + shown.slice(0, 160));
  const built = await page.evaluate(() => (document.querySelector('#sn-built') || {}).textContent);
  /42/.test(built || '') ? pass('and the readout agrees: ' + built) : fail('readout: ' + built);
}

console.log('\n12. no console errors');
errors.length ? errors.slice(0, 6).forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
