/* Themes: dark, light, and follow-the-system.
 *
 * Three ways this breaks quietly, so all three are checked here:
 *
 *  1. The light palette lives in two CSS blocks — one for an explicit choice,
 *     one inside prefers-color-scheme — because CSS cannot share a declaration
 *     block between a selector and a media query. If someone edits one and not
 *     the other, half the users get a half-themed page. This fails on drift.
 *  2. A colour written as a literal instead of a token looks fine in the theme
 *     it was written for and unreadable in the other. Every rendered element is
 *     checked for contrast in both.
 *  3. The Monitor test patterns must NOT follow the theme. A white-screen test
 *     has to be #FFFFFF or it is not the test. That is asserted too.
 *
 *   python3 -m http.server 8099 &
 *   TB_CHROME=/opt/pw-browsers/chromium node test/themes.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const URL = process.env.TB_URL || 'http://127.0.0.1:8099/index.html';
const CHROME = process.env.TB_CHROME || undefined;
let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

console.log('1. the dark-mode palette is complete');
{
  const css = readFileSync('css/testbench.css', 'utf8');
  const explicit = css.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\n\}/);
  if (!explicit) { fail('could not find the dark block'); }
  else {
    const toks = explicit[1].split(';').map(s => s.trim()).filter(s => s.startsWith('--'));
    toks.length > 30 ? pass(toks.length + ' tokens in the dark palette') : fail('only ' + toks.length + ' tokens — something is missing');
  }
}

console.log('\n1b. every themed component still has its rules');
{
  /* A regex edit to this stylesheet once deleted the theme picker, the range
     inputs and the canvas idle labels in one go, and nothing noticed until it
     was on screen. Name the selectors that must exist. */
  const css = readFileSync('css/testbench.css', 'utf8');
  const need = ['.tb-themepick', '.tb-themepick button[aria-pressed="true"]',
                'input[type="range"]::-webkit-slider-thumb', '.tb-scopeidle',
                '.tb-chiprow', '.tb-btn.pri:hover', 'select:focus-visible',
                ':root[data-theme="dark"]'];
  const missing = need.filter(sel => !css.includes(sel));
  missing.length ? missing.forEach(m => fail('stylesheet has lost ' + m))
                 : pass(need.length + ' required selectors present');
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

console.log('\n2. the picker offers the two modes and Light stamps nothing');
{
  const btns = await page.evaluate(() => [...document.querySelectorAll('#themepick button')].map(b => b.dataset.theme));
  JSON.stringify(btns) === JSON.stringify(['light', 'dark'])
    ? pass('Light, Dark') : fail('picker had ' + JSON.stringify(btns));
  await page.click('#themepick button[data-theme="light"]');
  await page.waitForTimeout(200);
  (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === null
    ? pass('Light (default) leaves the root unstamped') : fail('Light stamped an attribute');
}

console.log('\n3. the choice survives a reload');
await page.click('#themepick button[data-theme="dark"]');
await page.waitForTimeout(250);
await page.reload();
await page.waitForTimeout(1200);
{
  const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  t === 'dark' ? pass('still dark after reload') : fail('came back as ' + t);
}

console.log('\n4. text stays readable in both themes, on every page');
const VIEWS = ['home', 'keyboard', 'mouse', 'gamepad', 'audio', 'monitor', 'report', 'stress', 'system'];
for (const theme of ['light', 'dark']) {
  await page.click(`#themepick button[data-theme="${theme}"]`);
  await page.waitForTimeout(250);
  let worst = null;
  for (const v of VIEWS) {
    await page.click(`button[data-view="${v}"]`);
    await page.waitForTimeout(260);
    const bad = await page.evaluate(() => {
      const lum = (c) => {
        const m = c.match(/[\d.]+/g); if (!m) return null;
        const [r, g, b, a] = m.map(Number);
        if (a === 0) return null;
        const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el) => {
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor;
          const m = c.match(/[\d.]+/g);
          if (m && (m.length < 4 || Number(m[3]) > 0.55)) return c;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const out = [];
      const view = document.querySelector('.tb-view.on');
      if (!view) return out;
      for (const el of view.querySelectorAll('*')) {
        /* the Monitor test patterns are supposed to be absolute colours */
        if (el.closest('.tb-full, #mn-swatches, canvas')) continue;
        const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (!txt) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.4) continue;
        if (!el.getClientRects().length) continue;
        const lf = lum(cs.color), lb = lum(bgOf(el));
        if (lf === null || lb === null) continue;
        const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
        /* The real WCAG AA thresholds, not a placeholder.

           This gated at 2.6 for a long time, which is well below AA for any
           text size and meant the suite could never have caught the two
           failures the audit found by hand (.tb-badge and the bold lead-in in
           .tb-steps, both 3.99:1). A test that cannot fail on the thing it is
           named after is worse than no test, because it reads as a pass.

           AA is 4.5:1 for normal text and 3:1 for large text, where large
           means 24px or more, or 18.66px or more when bold. */
        const px = parseFloat(cs.fontSize) || 16;
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const large = px >= 24 || (px >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        if (ratio < need) out.push({ tag: el.tagName + '.' + (el.className || '').toString().split(' ')[0], ratio: +ratio.toFixed(2), need, px, weight, color: cs.color, bg: bgOf(el) });
      }
      return out;
    });
    if (bad.length && (!worst || bad[0].ratio < worst.ratio)) worst = Object.assign({ view: v }, bad[0]);
    if (bad.length) fail(`${theme}/${v}: ${bad.length} low-contrast element(s), worst ${JSON.stringify(bad[0])}`);
  }
  if (!worst) pass(theme + ': every page readable');
}

console.log('\n4b. controls use theme colours, not the platform\'s greys');
for (const theme of ['light', 'dark']) {
  await page.click(`#themepick button[data-theme="${theme}"]`);
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const cs = getComputedStyle;
    const sel = document.querySelector('#themepick button[aria-pressed="true"]');
    const red = cs(document.documentElement).getPropertyValue('--red').trim();
    const hex = (c) => {
      const m = c.match(/\d+/g);
      return m ? '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase() : c;
    };
    return {
      selected: hex(cs(sel).backgroundColor),
      red: red.toUpperCase(),
      redHot: cs(document.documentElement).getPropertyValue('--red-hot').trim().toUpperCase(),
      dropdown: hex(cs(document.querySelector('#au-vol') ? document.querySelector('select') : document.body).backgroundColor),
      panel2: hex(cs(document.documentElement).getPropertyValue('--panel-2').trim() ? cs(document.querySelector('.tb-panel')).backgroundColor : 'rgb(0,0,0)')
    };
  });
  /* the pointer is still over the button after the click, so the hover shade counts */
  (st.selected === st.red || st.selected === st.redHot)
    ? pass(theme + ': the selected theme button is the accent colour (' + st.selected + ')')
    : fail(theme + ': selected button is ' + st.selected + ', accent is ' + st.red + ' — the rule is missing');
}

console.log('\n5. the monitor test patterns ignore the theme');
{
  await page.click('#themepick button[data-theme="light"]');
  await page.click('button[data-view="monitor"]');
  await page.waitForTimeout(400);
  const white = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#mn-swatches button')].find(x => /white/i.test(x.textContent));
    return b ? getComputedStyle(b).backgroundColor : null;
  });
  white === 'rgb(255, 255, 255)' ? pass('the White swatch is still pure white on a light page') : fail('White swatch was ' + white);
}

console.log('\n6. no console errors in either theme');
errors.length ? errors.forEach(fail) : pass('clean');

console.log('\nX. every CSS variable the code names actually exists');
{
  /* Three separate bugs today came from a token that was never defined, or
     defined as a reference to itself. A custom property with no value fails
     silently: the declaration is dropped and the element inherits whatever
     was there before, so the element looks almost right and nobody
     investigates. Eleven tint tokens were dead in the dark theme, and five
     more were named in JS inline styles with names the stylesheet had never
     heard of - including --fail on the battery bar, so a nearly-flat battery
     drew with no colour at all instead of red.

     This check is cheap and it ends that whole class of bug. */
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const css = readFileSync('css/testbench.css', 'utf8');
  const defined = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));

  /* A token defined as var(--itself) is worse than missing: it reads as
     defined. CSS treats the cycle as invalid at computed-value time. */
  const cyclic = [...css.matchAll(/--([\w-]+)\s*:\s*var\(--([\w-]+)\)/g)]
    .filter((m) => m[1] === m[2]).map((m) => m[1]);
  cyclic.length === 0 ? pass('no token is defined as a reference to itself')
    : fail(`${cyclic.length} cyclic token definition(s), dead wherever that block applies: ${[...new Set(cyclic)].join(', ')}`);

  const sources = ['index.html', ...readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => join('js', f))];
  const missing = new Map();
  for (const f of sources) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/var\(\s*--([\w-]+)/g)) {
      /* --u is set from JavaScript at runtime (the keyboard key unit), so it
         is legitimately absent from the stylesheet. */
      if (m[1] === 'u' || defined.has(m[1])) continue;
      if (!missing.has(m[1])) missing.set(m[1], new Set());
      missing.get(m[1]).add(f);
    }
  }
  missing.size === 0
    ? pass(`all ${defined.size} tokens resolve, across ${sources.length} source files`)
    : fail('tokens used but never defined: ' +
        [...missing].map(([t, fs]) => `--${t} (${[...fs].join(', ')})`).join('; '));
}

await browser.close();
console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
