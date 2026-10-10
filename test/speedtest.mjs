/* Speed test checks.
 *
 *   python3 -m http.server 8099 &
 *   node test/speedtest.mjs
 *
 * A speed test that reports a plausible-looking number is worthless if the
 * number is not derived from anything, so these checks go after the arithmetic
 * rather than the appearance: throttle the connection to a known rate and see
 * whether the reading lands near it, and inject latency and see whether the
 * loaded figure and the bufferbloat grade move the way they should.
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
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const num = async (sel) => page.evaluate((s) => {
  const t = (document.querySelector(s) || {}).textContent || '';
  const m = t.match(/[\d.]+/);
  return m ? Number(m[0]) : null;
}, sel);

await page.goto(URL, { waitUntil: 'load' });
await page.click('button[data-view="network"]');
await page.waitForTimeout(300);

console.log('\n1. a throttled line reads back near the rate it was throttled to');
{
  /* 8 Mbit/s through CDP, which the page has no way of knowing about. If the
     reading comes back near 8 the arithmetic is sound; if it comes back at 400
     the page is measuring something other than the connection. */
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 20, downloadThroughput: 8 * 1000 * 1000 / 8, uploadThroughput: 1e6
  });

  await page.selectOption('#sp-len', '5');
  await page.click('#sp-run');
  await page.waitForTimeout(14000);

  const mbps = await num('#sp-mbps');
  if (mbps == null) fail('no download figure was produced at all');
  else if (mbps > 4 && mbps < 14) pass(`read ${mbps} Mbps on a line throttled to 8`);
  else fail(`read ${mbps} Mbps on a line throttled to 8 — the figure is not derived from the connection`);

  const idle = await num('#sp-ping');
  /* CDP's 20 ms is applied per request, so expect roughly that and not zero. */
  if (idle == null) fail('no idle latency figure');
  else if (idle >= 10 && idle < 400) pass(`idle latency ${idle} ms with 20 ms injected`);
  else fail(`idle latency read ${idle} ms with 20 ms injected`);

  const bytes = await page.evaluate(() => (document.querySelector('#sp-bytes') || {}).textContent);
  /KB|MB|GB/.test(bytes || '') ? pass(`it reports what it pulled: ${bytes}`) : fail('no byte total shown: ' + bytes);

  const streams = await num('#sp-streams');
  streams >= 1 && streams <= 8 ? pass(`${streams} streams used, inside the cap`) : fail(`${streams} streams — outside the 1-8 cap`);

  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
  });
}

console.log('\n2. the verdict says something, and says what it cannot do');
{
  const v = await page.evaluate(() => (document.querySelector('#sp-verdict') || {}).textContent || '');
  /Mbps steady/.test(v) ? pass('the verdict states the throughput') : fail('no throughput in the verdict');
  /[Uu]pload is not measured/.test(v) ? pass('it says upload is not measured') : fail('the verdict does not admit upload is unmeasured');
  /cannot prove a router does gigabit|capped by/.test(v) ? pass('it states what caps the figure') : fail('the verdict overstates what it proved');
}

console.log('\n3. latency under load is measured, and bufferbloat is graded');
{
  const loaded = await num('#sp-loaded');
  const idle = await num('#sp-ping');
  const g = await page.evaluate(() => (document.querySelector('#sp-grade') || {}).textContent || '');
  loaded != null ? pass(`loaded latency measured: ${loaded} ms against ${idle} ms idle`) : fail('no loaded-latency figure — this is the whole point of the panel');
  /^[ABCDF]\+?$/.test(g.trim()) ? pass(`graded ${g.trim()}`) : fail('no bufferbloat grade: ' + JSON.stringify(g));

  /* The grade must follow the gap, not be decorative. The two figures on
     screen are rounded to whole milliseconds, so a gap landing within a
     millisecond of a boundary can legitimately grade either side of it -
     accept the neighbours rather than failing on a rounding artefact. */
  const letter = (x) => (x < 5 ? 'A+' : x < 30 ? 'A' : x < 60 ? 'B' : x < 200 ? 'C' : x < 400 ? 'D' : 'F');
  const d = loaded - idle;
  const okGrades = [letter(d - 1), letter(d), letter(d + 1)];
  okGrades.includes(g.trim())
    ? pass(`the grade follows the gap (${Math.round(d)} ms -> ${g.trim()})`)
    : fail(`grade ${g.trim()} but a ${Math.round(d)} ms gap should be one of ${[...new Set(okGrades)].join('/')}`);
}

console.log('\n4. it cannot be started twice, and stops when you walk away');
{
  await page.selectOption('#sp-len', '20');
  await page.evaluate(() => {
    window.__fetchAt = [];
    const real = window.fetch;
    window.fetch = function (u) {
      if (String(u).includes('payload')) window.__fetchAt.push(performance.now());
      return real.apply(this, arguments);
    };
    TB.onLeave('network', () => { window.__leftAt = performance.now(); });
  });
  for (let i = 0; i < 8; i++) await page.click('#sp-run', { force: true }).catch(() => {});
  await page.waitForTimeout(2500);
  const disabled = await page.evaluate(() => document.querySelector('#sp-run').disabled);
  disabled ? pass('the button locks out while a run is going') : fail('eight clicks can start eight runs');

  await page.click('button[data-view="home"]');
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => {
    const left = window.__leftAt;
    return (window.__fetchAt || []).filter((t) => t > left).length;
  });
  after === 0 ? pass('no payload fetch started after leaving the page')
              : fail(`${after} payload fetch(es) started after the operator left`);

  const phase = await page.evaluate(() => (document.querySelector('#sp-phase') || {}).textContent || '');
  /stopped/.test(phase) ? pass('and it says so: "' + phase + '"') : fail('the panel does not say it was stopped: ' + phase);
}

console.log('\n4b. leaving during the FIRST phase stops it too');
{
  /* A different hole from leaving during the download, and it was real: the
     run's teardown was armed when the download started, so walking away
     during the idle-latency pass left nothing holding the run - and the idle
     pass then went on to start the download on a page nobody was looking at.
     Measured three payload fetches up to 829 ms after the leave.

     The idle pass takes about 1.3 seconds, so leaving after 400 ms lands
     squarely inside it. */
  await page.goto(URL, { waitUntil: 'load' });
  await page.click('button[data-view="network"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__fetchAt = [];
    const real = window.fetch;
    window.fetch = function (u) {
      if (String(u).includes('payload')) window.__fetchAt.push(performance.now());
      return real.apply(this, arguments);
    };
    TB.onLeave('network', () => { window.__leftAt = performance.now(); });
  });
  await page.selectOption('#sp-len', '10');
  await page.click('#sp-run');
  await page.waitForTimeout(400);           /* still measuring idle latency */

  const phaseThen = await page.evaluate(() => (document.querySelector('#sp-phase') || {}).textContent || '');
  /idle/.test(phaseThen) ? pass('confirmed still in the idle phase: "' + phaseThen + '"')
                         : fail('expected to still be measuring idle latency, phase says "' + phaseThen + '"');

  await page.click('button[data-view="home"]');
  await page.waitForTimeout(4000);
  const started = await page.evaluate(() => {
    const left = window.__leftAt;
    const after = (window.__fetchAt || []).filter((t) => t > left);
    return { after: after.length, lastGap: after.length ? Math.round(after[after.length - 1] - left) : 0 };
  });
  started.after === 0
    ? pass('the download never started on a page the operator had left')
    : fail(`${started.after} payload fetch(es) began after the leave, the last ${started.lastGap} ms later`);

  const phaseNow = await page.evaluate(() => (document.querySelector('#sp-phase') || {}).textContent || '');
  /stopped/.test(phaseNow) ? pass('and the panel says it was stopped') : fail('the panel says "' + phaseNow + '"');
}

console.log('\n5. no console errors');
errors.length ? errors.slice(0, 6).forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
