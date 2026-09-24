/* MIDI, driven by a simulated keyboard.
 *
 * The fault worth catching on a used MIDI keyboard is not the silent key — that
 * one is obvious — it is the key that plays *quietly*. The contact closes late,
 * the note arrives at velocity 38 while its neighbours arrive near 100, and it
 * survives every quick listen test anyone does at a desk. So the simulated
 * keyboard here has exactly that: one weak key among healthy ones.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/midi.mjs
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

/* Web MIDI is absent on http:// even in Chrome, so the page can never be tested
   against the real API here. This is the same shape: a port map that delivers
   MIDIMessageEvents with a .data array. */
await page.addInitScript(() => {
  const input = { id: 'sim-1', name: 'Simulated 61-key', manufacturer: 'Testbench', state: 'connected', onmidimessage: null };
  const inputs = new Map([['sim-1', input]]);
  inputs.forEach = Map.prototype.forEach.bind(inputs);
  navigator.requestMIDIAccess = () => Promise.resolve({ inputs, outputs: new Map(), onstatechange: null });
  window.__midi = (bytes) => {
    if (input.onmidimessage) input.onmidimessage({ data: Uint8Array.from(bytes) });
  };
  window.__note = (n, vel) => { window.__midi([0x90, n, vel]); window.__midi([0x80, n, 0]); };
});

await page.goto(URL);
await page.waitForTimeout(1400);
await page.click('button[data-view="midi"]');
await page.waitForTimeout(700);

const stat = (id) => page.textContent('#' + id);

console.log('1. the page connects and lists the input');
{
  const state = await stat('mi-state');
  /listening/i.test(state) ? pass(state.trim()) : fail('state reads: ' + state);
  const ports = await page.textContent('#mi-ports');
  /Simulated 61-key/.test(ports) ? pass('input named') : fail('input not listed: ' + ports);
  const chip = await page.textContent('#chip-midi');
  /1/.test(chip) ? pass('status chip: ' + chip.trim()) : fail('chip reads ' + chip);
}

console.log('2. an 88-key keyboard is drawn');
{
  const n = await page.evaluate(() => document.querySelectorAll('#mi-keys .tb-key').length);
  n === 88 ? pass('88 keys') : fail(n + ' keys drawn');
  const white = await page.evaluate(() => document.querySelectorAll('#mi-keys .tb-key.white').length);
  white === 52 ? pass('52 white, 36 black') : fail(white + ' white keys');
}

console.log('\n3. played keys light, and the weak one is singled out');
{
  /* a healthy octave, then one key that closes late */
  await page.evaluate(() => {
    for (const n of [60, 62, 64, 65, 67, 69, 71, 72]) window.__note(n, 100 + (n % 5));
    window.__note(61, 38);                       /* the weak key */
  });
  await page.waitForTimeout(300);
  const seen = await page.evaluate(() => document.querySelectorAll('#mi-keys .tb-key.seen').length);
  seen === 9 ? pass('nine keys marked as played') : fail(seen + ' marked');
  const weak = await page.evaluate(() =>
    [...document.querySelectorAll('#mi-keys .tb-key.weak')].map(k => k.dataset.note));
  JSON.stringify(weak) === '["61"]' ? pass('only the weak key flagged: note 61') : fail('weak keys: ' + JSON.stringify(weak));
  (await stat('mi-notes')) === '9' ? pass('distinct key count') : fail('count reads ' + await stat('mi-notes'));
}

console.log('\n4. the verdict names it and says why it matters');
{
  const v = await page.textContent('#mi-verdict');
  /C#4/.test(v) ? pass('named by note, not number') : fail('verdict: ' + v.replace(/\s+/g, ' ').slice(0, 160));
  /velocity 45/.test(v) ? pass('explains the threshold') : fail('no threshold given');
  /week later/.test(v) ? pass('says why a weak key matters') : fail('no consequence given');
}

console.log('\n5. pitch bend, mod wheel and sustain');
{
  await page.evaluate(() => {
    window.__midi([0xE0, 0x00, 0x00]);      /* bend hard down */
    window.__midi([0xB0, 1, 127]);          /* mod wheel up   */
    window.__midi([0xB0, 64, 127]);         /* sustain down   */
  });
  await page.waitForTimeout(250);
  (await stat('mi-bendv')) === '-100%' ? pass('bend reads -100%') : fail('bend reads ' + await stat('mi-bendv'));
  (await stat('mi-modv')) === '100%' ? pass('mod wheel reads 100%') : fail('mod reads ' + await stat('mi-modv'));
  (await stat('mi-sus')).trim() === 'DOWN' ? pass('sustain down') : fail('sustain reads ' + await stat('mi-sus'));
  const v = await page.textContent('#mi-verdict');
  /resting off centre/.test(v) ? pass('a bend left off centre is reported') : fail('off-centre bend not flagged');
}

console.log('\n6. a note with no note-off is caught as stuck');
{
  await page.evaluate(() => window.__midi([0x90, 55, 100]));
  await page.waitForTimeout(400);
  const down = await page.evaluate(() => document.querySelectorAll('#mi-keys .tb-key.down').length);
  down === 1 ? pass('held key shown down') : fail(down + ' keys down');
  await page.evaluate(() => window.__midi([0x80, 55, 0]));
  await page.waitForTimeout(250);
  (await page.evaluate(() => document.querySelectorAll('#mi-keys .tb-key.down').length)) === 0
    ? pass('released') : fail('key stayed down after note off');
}

console.log('\n7. clock messages do not flood the log');
{
  await page.evaluate(() => { for (let i = 0; i < 200; i++) window.__midi([0xF8]); });
  await page.waitForTimeout(250);
  const lines = await page.evaluate(() => document.querySelectorAll('#mi-log div').length);
  lines < 60 ? pass(lines + ' log lines — clock filtered out') : fail(lines + ' lines, the clock is being logged');
}

console.log('\n8. Clear resets everything');
{
  await page.click('#mi-reset');
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => ({
    notes: document.querySelector('#mi-notes').textContent,
    seen: document.querySelectorAll('#mi-keys .tb-key.seen, #mi-keys .tb-key.weak').length,
    log: document.querySelectorAll('#mi-log div').length
  }));
  st.notes === '0' && st.seen === 0 && st.log === 0 ? pass('cleared') : fail('after clear: ' + JSON.stringify(st));
}

console.log('\n9. no console errors');
errors.length ? errors.forEach(fail) : pass('clean');

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
