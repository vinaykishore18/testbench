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
import { readdirSync, statSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

var MP3 = null;   /* var, so the fixture cache exists before the first call */

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

console.log('\n2. the transport is visible but inert before a track is loaded');
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

console.log('\n3. Play works with no file at all');
{
  /* "pressing play takes me to the files" — a button called Play must play
     something, not open a dialog. */
  const names = await page.evaluate(() => [...document.querySelectorAll('#mu-rack [data-bench] .go')].map(b => b.textContent));
  names.length === 5 ? pass('five built-in patterns: ' + names.join(', ')) : fail('found ' + names.length);
  await page.click('#mu-play');
  await page.waitForTimeout(1800);
  const st = await page.evaluate(() => ({
    label: document.querySelector('#mu-play').textContent,
    lit: [...document.querySelectorAll('#mu-rack [data-bench].on .go')].map(b => b.textContent),
    meter: parseFloat(document.querySelector('#mu-l').style.width) || 0,
    meterR: parseFloat(document.querySelector('#mu-r').style.width) || 0
  }));
  st.label === 'Stop' ? pass('Play started something and became Stop') : fail('button says ' + st.label);
  st.lit.length === 1 ? pass('pattern lit: ' + st.lit[0]) : fail('lit patterns: ' + JSON.stringify(st.lit));
  st.meter > 5 ? pass('meters moving at ' + st.meter.toFixed(0) + '%') : fail('meters flat at ' + st.meter);
  /* A mono oscillator through a channel splitter leaves the right output
     silent, which looked exactly like a half-dead player. */
  st.meterR > 5 ? pass('both channels registering') : fail('right channel flat at ' + st.meterR + ' — the bus went mono again');
  await page.click('#mu-play');
  await page.waitForTimeout(400);
}

console.log('\n4. a track added once is still there after a reload');
{
  /* The whole point: "can we just play the tracks in the site". You add your
     own copies once and they live in this browser from then on. */
  await page.setInputFiles('#mu-file', [{ name: 'Animals.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from(wav()) }]);
  await page.waitForTimeout(1100);
  await page.setInputFiles('#mu-file', [{ name: 'Money.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from(wav()) }]);
  await page.waitForTimeout(1100);
  const before = await page.evaluate(() => [...document.querySelectorAll('.tb-chiprow[data-saved] .go')].map(b => b.textContent));
  JSON.stringify(before) === JSON.stringify(['Animals', 'Money'])
    ? pass('both saved: ' + before.join(', ')) : fail('library held ' + JSON.stringify(before));

  await page.reload();
  await page.waitForTimeout(1400);
  await page.click('button[data-view="audio"]');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => [...document.querySelectorAll('.tb-chiprow[data-saved] .go')].map(b => b.textContent));
  JSON.stringify(after) === JSON.stringify(before)
    ? pass('survived a full reload') : fail('after reload the library held ' + JSON.stringify(after));

  await page.click('.tb-chiprow[data-saved] .go');
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({
    name: document.querySelector('#mu-name').textContent,
    label: document.querySelector('#mu-play').textContent,
    lit: document.querySelectorAll('.tb-chiprow[data-saved].on').length,
    meter: parseFloat(document.querySelector('#mu-l').style.width) || 0,
    meterR: parseFloat(document.querySelector('#mu-r').style.width) || 0
  }));
  st.name === 'Animals' ? pass('one click played it straight from storage') : fail('played ' + st.name);
  st.label === 'Stop' && st.lit === 1 ? pass('chip marked as playing') : fail('label ' + st.label + ', lit ' + st.lit);
  st.meter > 5 ? pass('meters moving at ' + st.meter.toFixed(0) + '%') : fail('meters flat');

  await page.click('.tb-chiprow[data-saved] .kill');
  await page.waitForTimeout(700);
  const left = await page.evaluate(() => [...document.querySelectorAll('.tb-chiprow[data-saved] .go')].map(b => b.textContent));
  JSON.stringify(left) === JSON.stringify(['Money']) ? pass('removing one leaves the rest') : fail('left with ' + JSON.stringify(left));
}

console.log('\n5. a local file plays through the meters');
await page.setInputFiles('#mu-file', { name: 'bench-tone.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from(wav()) });
await page.waitForTimeout(1400);
{
  const st = await page.evaluate(() => ({
    hidden: document.querySelector('#mu-controls').hidden,
    name: document.querySelector('#mu-name').textContent,
    play: document.querySelector('#mu-play').textContent,
    time: document.querySelector('#mu-time').textContent
  }));
  !st.hidden ? pass('controls appeared') : fail('controls stayed hidden');
  /* the extension is dropped — it is a track name in the bar, not a filename */
  st.name === 'bench-tone' ? pass('track named in the bar') : fail('name was ' + st.name);
  st.play === 'Stop' ? pass('started playing') : fail('play button says ' + st.play);
  /0:0\d \/ 0:03/.test(st.time) ? pass('clock running: ' + st.time) : fail('clock read ' + st.time);
}

console.log('\n6. left-only really silences the right cup');
await page.click('[data-mupan="-1"]');
/* Wait for the pan to SETTLE rather than for a fixed 700 ms. The pan is an
   audio-rate ramp, and on a loaded machine it had not finished when the
   reading was taken - the right meter was caught mid-sweep at 25% and the
   suite failed, while the same check passed three times in a row on its own.
   Poll until the value stops moving, with a ceiling so a genuinely stuck
   meter still fails instead of hanging. */
{
  const read = () => page.evaluate(() =>
    [document.querySelector('#mu-l').style.width, document.querySelector('#mu-r').style.width]);
  let prev = null, stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    await page.waitForTimeout(100);
    const now = (await read()).join('|');
    stable = now === prev ? stable + 1 : 0;
    prev = now;
  }
  const [l, r] = await read();
  const ln = parseFloat(l) || 0, rn = parseFloat(r) || 0;
  ln > 50 ? pass('left meter at ' + l) : fail('left meter only ' + l);
  rn < 10 ? pass('right meter down at ' + r) : fail('right still at ' + r);
}

console.log('\n7. starting a test tone stops the music');
await page.click('[data-tone="both"]');
await page.waitForTimeout(400);
(await page.evaluate(() => document.querySelector('#mu-play').textContent)) === 'Play'
  ? pass('music stopped when a tone started') : fail('music kept playing under the tone');

console.log('\n8. leaving the page stops it too');
await page.click('#mu-play'); await page.waitForTimeout(300);
await page.click('button[data-view="home"]'); await page.waitForTimeout(500);
(await page.evaluate(() => document.querySelector('#mu-play').textContent)) === 'Play'
  ? pass('stopped on navigation') : fail('still playing after leaving the page');

console.log('\n9. only real MP3s get in');
{
  const before = await page.evaluate(() => document.querySelectorAll('.tb-chiprow[data-saved]').length);
  /* right name, wrong contents — a zip renamed to .mp3 */
  await page.setInputFiles('#mu-file', [{ name: 'Trojan.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from(notAudio()) }]);
  await page.waitForTimeout(900);
  let after = await page.evaluate(() => document.querySelectorAll('.tb-chiprow[data-saved]').length);
  after === before ? pass('a renamed file was refused on its contents') : fail('a non-MP3 was accepted');
  let toast = await page.evaluate(() => (document.querySelector('#toasts') || {}).textContent || '');
  /* The refusal has to say what the file really is, not just that it is wrong.
     "It is really a zip archive" is the message an operator can act on. */
  /is really a zip/.test(toast) ? pass('said what it really was: ' + toast.match(/[^.]*is really[^.]*/)[0].trim())
    : fail('no explanation: ' + toast.slice(0, 160));

  /* a genuine wav, honestly named — still refused, because the rule is MP3 */
  await page.setInputFiles('#mu-file', [{ name: 'Tone.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(9000, 1) }]);
  await page.waitForTimeout(700);
  after = await page.evaluate(() => document.querySelectorAll('.tb-chiprow[data-saved]').length);
  after === before ? pass('a .wav was refused') : fail('a .wav got in');
  toast = await page.evaluate(() => (document.querySelector('#toasts') || {}).textContent || '');
  /Only \.mp3/.test(toast) ? pass('named the rule') : fail('no rule given: ' + toast.slice(0, 120));

  /* ---- the actual bypass the audit found ----
     The old validator accepted any file whose first three bytes were "ID3".
     So a zip with those three characters stapled on the front went into the
     library and sat there as a track. Same for a Windows executable. This is
     the regression test for that, and it is the reason the validator now
     parses the frame headers after the tag instead of stopping at the tag. */
  await page.evaluate(() => { const t = document.querySelector('#toasts'); if (t) t.textContent = ''; });
  await page.setInputFiles('#mu-file', [{ name: 'RejectedTrojan.mp3', mimeType: 'audio/mpeg',
    buffer: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(7, 0),
                           Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(40000, 0x41)]) }]);
  await page.waitForTimeout(1200);
  after = await page.evaluate(() => document.querySelectorAll('.tb-chiprow[data-saved]').length);
  after === before ? pass('an "ID3" prefix no longer gets a zip past the check') : fail('the ID3 prefix bypass is back — a zip was stored');
  toast = await page.evaluate(() => (document.querySelector('#toasts') || {}).textContent || '');
  /no MPEG audio frames/.test(toast) ? pass('said why: no MPEG frames after the tag')
    : fail('wrong reason given: ' + toast.slice(0, 160));

  /* And a Windows executable with the same three letters on the front. */
  await page.evaluate(() => { const t = document.querySelector('#toasts'); if (t) t.textContent = ''; });
  await page.setInputFiles('#mu-file', [{ name: 'Setup.mp3', mimeType: 'audio/mpeg',
    buffer: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(7, 0),
                           Buffer.from('MZ'), Buffer.alloc(40000, 0x90)]) }]);
  await page.waitForTimeout(1200);
  after = await page.evaluate(() => document.querySelectorAll('.tb-chiprow[data-saved]').length);
  after === before ? pass('an executable behind an ID3 tag was refused') : fail('an executable was stored in the library');

  /* ---- and the check must not have become so strict it refuses real audio ----
     A validator that rejects everything passes every test above and is
     useless, so prove a genuinely encoded MP3 still loads. */
  await page.setInputFiles('#mu-file', [{ name: 'RealTone.mp3', mimeType: 'audio/mpeg', buffer: wav() }]);
  await page.waitForTimeout(1400);
  after = await page.evaluate(() => document.querySelectorAll('.tb-chiprow[data-saved]').length);
  after === before + 1 ? pass('a real encoded MP3 still gets in') : fail('the validator now refuses real MP3s too (' + before + ' -> ' + after + ')');
}

console.log('\n10. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);

/* A real, decodable MP3, encoded at test time.
   It is never committed: test/security.mjs fails the build if any audio file
   appears in the tree, and that rule is there to keep music out of the repo.
   Generating the fixture keeps both things true. */
function wav() {
  if (MP3) return MP3;
  const dir = mkdtempSync(join(tmpdir(), 'tb-'));
  const out = join(dir, 'tone.mp3');
  execFileSync('ffmpeg', ['-v', 'quiet', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                          '-ac', '2', '-b:a', '128k', out]);
  MP3 = readFileSync(out);
  return MP3;
}
function notAudio() {
  /* a zip wearing an .mp3 name */
  return Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(4000, 0x41)]);
}
