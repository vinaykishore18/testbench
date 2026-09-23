/* The music check: a reference list, and a player for a file you own.
 *
 * The list must stay a list. No audio file ships with this site and none ever
 * should — those recordings belong to the artists and labels who made them, and
 * putting them on a public URL is distributing them. This test fails if any
 * audio file appears in the repo, so nobody can quietly add one later.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/music-check.mjs
 */
import { chromium } from 'playwright';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;
let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

console.log('1. the repository ships no music');
{
  const bad = [];
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      if (f === 'node_modules' || f === '.git') continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(mp3|m4a|aac|ogg|opus|flac|wav|wma|aiff?)$/i.test(f)) bad.push(p);
    }
  })('.');
  bad.length ? bad.forEach(b => fail('audio file in the repo: ' + b)) : pass('no audio files anywhere in the tree');
}

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
await page.click('button[data-view="audio"]');
await page.waitForTimeout(400);

console.log('\n2. ten tracks, each saying what it catches');
{
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#mu-list .tb-track')].map(li => ({
      title: li.querySelector('b').textContent,
      what: (li.querySelector('.k') || {}).textContent || '',
      why: (li.querySelector('p') || {}).textContent || ''
    })));
  rows.length === 10 ? pass('ten tracks') : fail('found ' + rows.length);
  rows.every(r => r.what && r.why.length > 40)
    ? pass('every track says what it exposes and what a fault sounds like')
    : fail('a track is missing its cue: ' + JSON.stringify(rows.find(r => !r.what || r.why.length <= 40)));
  const kinds = new Set(rows.map(r => r.what));
  kinds.size >= 8 ? pass(kinds.size + ' distinct things covered') : fail('only ' + kinds.size + ' distinct cues — the list is repeating itself');
}

console.log('\n3. the transport is visible but inert before a track is loaded');
{
  /* It used to be hidden entirely, and the panel read as having no player at
     all — the first thing anyone said about it was "there is no play button". */
  const st = await page.evaluate(() => ({
    visible: !document.querySelector('#mu-controls').hidden,
    disabled: [...document.querySelectorAll('#mu-controls button, #mu-controls input')]
      .filter(n => n.id !== 'mu-play').every(n => n.disabled),
    playEnabled: !document.querySelector('#mu-play').disabled,
    hint: document.querySelector('#mu-name').textContent
  }));
  st.visible ? pass('transport is on screen') : fail('transport hidden — nobody will find it');
  st.disabled ? pass('seek, panning and loop are inert') : fail('controls live with nothing loaded');
  st.playEnabled ? pass('Play stays usable with nothing loaded') : fail('Play was disabled, so there is no way in');
  /play/i.test(st.hint) ? pass('says what to do: "' + st.hint + '"') : fail('no hint: ' + st.hint);
}

console.log('\n4. Play works with no file at all');
{
  /* "pressing play takes me to the files" — a button called Play must play
     something, not open a dialog. */
  const names = await page.evaluate(() => [...document.querySelectorAll('[data-bench]')].map(b => b.textContent));
  names.length === 5 ? pass('five built-in patterns: ' + names.join(', ')) : fail('found ' + names.length);
  await page.click('#mu-play');
  await page.waitForTimeout(1800);
  const st = await page.evaluate(() => ({
    label: document.querySelector('#mu-play').textContent,
    lit: [...document.querySelectorAll('[data-bench].on')].map(b => b.textContent),
    meter: parseFloat(document.querySelector('#mu-l').style.width) || 0
  }));
  st.label === 'Stop' ? pass('Play started something and became Stop') : fail('button says ' + st.label);
  st.lit.length === 1 ? pass('pattern lit: ' + st.lit[0]) : fail('lit patterns: ' + JSON.stringify(st.lit));
  st.meter > 5 ? pass('meters moving at ' + st.meter.toFixed(0) + '%') : fail('meters flat at ' + st.meter);
  await page.click('#mu-play');
  await page.waitForTimeout(400);
}

console.log('\n5. every reference track links out to a search');
{
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('#mu-list .tb-track')].map(li =>
      [...li.querySelectorAll('.find a')].map(a => a.href)));
  links.length === 10 && links.every(l => l.length === 2)
    ? pass('two search links on each of the ten') : fail('links per track: ' + JSON.stringify(links.map(l => l.length)));
  links.every(l => l.every(h => /^https:\/\/(www\.youtube\.com\/results|open\.spotify\.com\/search)/.test(h)))
    ? pass('all are search URLs, not guessed track ids') : fail('a link was not a search URL');
}

console.log('\n6. a local file plays through the meters');
await page.setInputFiles('#mu-file', { name: 'bench-tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(wav()) });
await page.waitForTimeout(1400);
{
  const st = await page.evaluate(() => ({
    hidden: document.querySelector('#mu-controls').hidden,
    name: document.querySelector('#mu-name').textContent,
    play: document.querySelector('#mu-play').textContent,
    time: document.querySelector('#mu-time').textContent
  }));
  !st.hidden ? pass('controls appeared') : fail('controls stayed hidden');
  st.name === 'bench-tone.wav' ? pass('file named in the bar') : fail('name was ' + st.name);
  st.play === 'Stop' ? pass('started playing') : fail('play button says ' + st.play);
  /0:0\d \/ 0:03/.test(st.time) ? pass('clock running: ' + st.time) : fail('clock read ' + st.time);
}

console.log('\n7. left-only really silences the right cup');
await page.click('[data-mupan="-1"]');
await page.waitForTimeout(700);
{
  const [l, r] = await page.evaluate(() =>
    [document.querySelector('#mu-l').style.width, document.querySelector('#mu-r').style.width]);
  const ln = parseFloat(l) || 0, rn = parseFloat(r) || 0;
  ln > 50 ? pass('left meter at ' + l) : fail('left meter only ' + l);
  rn < 10 ? pass('right meter down at ' + r) : fail('right still at ' + r);
}

console.log('\n8. starting a test tone stops the music');
await page.click('[data-tone="both"]');
await page.waitForTimeout(400);
(await page.evaluate(() => document.querySelector('#mu-play').textContent)) === 'Play'
  ? pass('music stopped when a tone started') : fail('music kept playing under the tone');

console.log('\n9. leaving the page stops it too');
await page.click('#mu-play'); await page.waitForTimeout(300);
await page.click('button[data-view="home"]'); await page.waitForTimeout(500);
(await page.evaluate(() => document.querySelector('#mu-play').textContent)) === 'Play'
  ? pass('stopped on navigation') : fail('still playing after leaving the page');

console.log('\n10. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);

function wav() {
  const sr = 44100, n = sr * 3, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 12000);
    b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4);
  }
  return b;
}
