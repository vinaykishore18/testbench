/* Security regression test.
 *
 * Every item here was a real finding from an audit, and each one is the kind of
 * thing that comes back the moment someone is in a hurry: an 'unsafe-inline'
 * added to make something work, a header dropped while editing, a document left
 * in the deploy root. This file fails the build instead.
 *
 *   node test/security.mjs          (no browser needed)
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let failures = 0;
const fail = (m) => { console.log('  FAIL  ' + m); failures++; };
const pass = (m) => console.log('  ok    ' + m);

const html = readFileSync('index.html', 'utf8');
const headers = readFileSync('_headers', 'utf8');
const vercel = readFileSync('vercel.json', 'utf8');
const metaCSP = (html.match(/Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
const hdrCSP = (headers.match(/Content-Security-Policy:\s*(.*)/) || [])[1] || '';

console.log('1. the policy never permits inline or evaluated script');
for (const [name, csp] of [['meta', metaCSP], ['_headers', hdrCSP]]) {
  const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || '';
  /unsafe-inline/.test(scriptSrc) ? fail(name + ": script-src allows 'unsafe-inline'") : pass(name + ': no inline script');
  /unsafe-eval/.test(csp) ? fail(name + ": allows 'unsafe-eval'") : pass(name + ': no eval');
  /default-src 'none'/.test(csp) ? pass(name + ": default-src 'none'") : fail(name + ': default-src is not none');
}

console.log('\n2. the directives that stop the page being framed or repointed');
for (const d of ["base-uri 'self'", "form-action 'none'", "object-src 'none'"]) {
  metaCSP.includes(d) && hdrCSP.includes(d) ? pass(d) : fail('missing from one of the two policies: ' + d);
}
/frame-ancestors 'none'/.test(hdrCSP) ? pass("frame-ancestors 'none' on the served header") : fail('no frame-ancestors in _headers');
/X-Frame-Options:\s*DENY/i.test(headers) ? pass('X-Frame-Options: DENY') : fail('no X-Frame-Options');
/X-Content-Type-Options:\s*nosniff/i.test(headers) ? pass('nosniff') : fail('no X-Content-Type-Options');
/Referrer-Policy:/i.test(headers) ? pass('Referrer-Policy set') : fail('no Referrer-Policy');

console.log('\n3. permissions are granted only for what the site actually uses');
{
  const pp = (headers.match(/Permissions-Policy:\s*(.*)/) || [])[1] || '';
  const js = readdirSync('js').map(f => readFileSync(join('js', f), 'utf8')).join('\n');
  /hid=\(self\)/.test(pp) ? pass('hid=(self) — the API the site is built on') : fail('hid not granted, but navigator.hid is used');
  /* MIDI is granted because the MIDI page uses it; if that page ever goes, deny it again */
  if (/requestMIDIAccess/.test(js)) {
    /midi=\(self\)/.test(pp) ? pass('midi=(self) — the MIDI page needs it') : fail('the MIDI page calls requestMIDIAccess but midi is not granted');
  } else {
    /midi=\(\)/.test(pp) ? pass('midi denied — never used') : fail('midi granted but never used');
  }
  if (/navigator\.usb/.test(js)) pass('usb is used, so granting it is right');
  else /usb=\(\)/.test(pp) ? pass('usb denied — never used') : fail('usb granted but navigator.usb is never called');
  /interest-cohort/.test(pp) ? fail('interest-cohort is a dead token; use browsing-topics') : pass('no dead tokens');
  for (const f of ['microphone=(self)', 'camera=(self)', 'gamepad=(self)', 'fullscreen=(self)']) {
    pp.includes(f) ? pass(f) : fail('the site needs ' + f + ' and it is not granted');
  }
  for (const f of ['serial=()', 'bluetooth=()', 'display-capture=()', 'usb=()']) {
    pp.includes(f) ? pass(f + ' denied') : fail('unused powerful feature left open: ' + f);
  }
}

console.log('\n4. the two host configs agree');
{
  const vCSP = (vercel.match(/"(default-src 'none'[^"]*)"/) || [])[1] || '';
  vCSP.replace(/frame-ancestors[^;]*/, '') === hdrCSP.replace(/frame-ancestors[^;]*/, '')
    ? pass('Cloudflare and Vercel serve the same policy') : fail('the two CSPs have drifted apart');
}

console.log('\n5. no dangerous sinks anywhere in the source');
{
  const files = readdirSync('js').filter(f => f.endsWith('.js'));
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join('js', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\beval\s*\(|new\s+Function\s*\(|\.outerHTML\s*=|insertAdjacentHTML|document\.write\b/.test(line))
        bad.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 70));
      /* a string first argument to a timer is eval in disguise */
      if (/set(Timeout|Interval)\s*\(\s*["'`]/.test(line))
        bad.push(f + ':' + (i + 1) + '  timer called with a string');
    });
  }
  bad.length ? bad.forEach(fail) : pass('no eval, no Function(), no outerHTML, no document.write');
}

console.log('\n6. internal notes and tooling are not served');
{
  const redir = existsSync('_redirects') ? readFileSync('_redirects', 'utf8') : '';
  for (const f of ['SWITCH-RIG.md', 'build.py', 'README.md', 'LEARN.md', 'WORKFLOW.md']) {
    redir.includes('/' + f) ? pass(f + ' is blocked') : fail(f + ' would be served from the live domain');
  }
  redir.includes('/test/*') ? pass('the test suite is blocked') : fail('/test/ would be served');
  existsSync('404.html') ? pass('404 page exists for the redirects to land on') : fail('no 404.html');
}

console.log('\n7. the bundled build is not weaker than the site');
{
  execSync('python3 build.py', { stdio: 'ignore' });
  const bundle = readFileSync('dist/testbench.html', 'utf8');
  const bCSP = (bundle.match(/Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
  /script-src 'sha256-/.test(bCSP) ? pass('bundle pins its script by hash') : fail('bundle CSP: ' + bCSP.slice(0, 90));
  /script-src[^;]*unsafe-inline/.test(bCSP) ? fail("bundle still allows 'unsafe-inline'") : pass('no blanket inline script');
  /worker-src blob:/.test(bCSP) ? pass('worker-src present, so the stress test runs') : fail('bundle blocks its own worker');
  bundle.indexOf('_boot.js ----') < bundle.indexOf('00-core.js ----')
    ? pass('boot guard is inlined first') : fail('boot guard is not first in the bundle');
}

console.log('\n8. no secrets committed');
{
  const bad = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      if (['node_modules', '.git', 'dist'].includes(f)) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|html|json|py|md|txt)$/.test(f)) {
        const t = readFileSync(p, 'utf8');
        for (const re of [/AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{36}/, /sk-[A-Za-z0-9]{32,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/])
          if (re.test(t)) bad.push(p + ' matches ' + re);
      }
    }
  })('.');
  bad.length ? bad.forEach(fail) : pass('no API keys, tokens or private keys in the tree');
}

console.log('\n8b. the bundle is not a stale copy of an older site');
{
  /* dist/testbench.html is generated from the same sources, so it has to be
     regenerated when they change. A stale bundle is how an old policy, a
     removed claim or a string we deliberately took out quietly comes back -
     it happened in this repo: the bundle still carried the Google Fonts CSP
     and an eBay trading name hours after both were removed from the site. */
  const distPath = 'dist/testbench.html';
  if (!existsSync(distPath)) {
    pass('no bundle in the tree, so nothing to go stale');
  } else {
    const bundle = readFileSync(distPath, 'utf8');
    const bundleTime = statSync(distPath).mtimeMs;
    const sources = ['index.html', 'css/testbench.css',
      ...readdirSync('js').map((f) => join('js', f))];
    const newer = sources.filter((f) => statSync(f).mtimeMs > bundleTime + 1000);
    newer.length === 0 ? pass('the bundle is newer than every source it is built from')
      : fail(`the bundle is older than ${newer.length} source file(s) - run build.py (${newer.slice(0, 3).join(', ')})`);

    /* And the specific regressions a stale bundle brings back. */
    /googleapis|gstatic/.test(bundle)
      ? fail('the bundle still references Google Fonts, which the site no longer uses')
      : pass('the bundle has no third-party origins either');
    const distCSP = (bundle.match(/Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
    /unsafe-inline/.test((distCSP.match(/script-src([^;]*)/) || [])[1] || '')
      ? fail("the bundle's script-src allows 'unsafe-inline'") : pass('the bundle still pins its script by hash');
  }
}

console.log('\n8c. there is no server, and nothing can quietly add one');
{
  /* The whole security story is "there is no server to attack", so that has
     to stay true by inspection rather than by memory. An api/ directory or a
     functions block in vercel.json would turn this into a deployment with
     running code on it, and the honest answer to any IT department would
     change without anybody noticing. */
  existsSync('api') ? fail('there is an api/ directory — this is no longer a static site') : pass('no api/ directory');
  const vj = JSON.parse(vercel);
  !vj.functions ? pass('no serverless functions declared') : fail('vercel.json declares functions: ' + JSON.stringify(Object.keys(vj.functions)));
  vj.buildCommand === null ? pass('build command explicitly none') : fail('a build command is set: ' + JSON.stringify(vj.buildCommand));
  vj.installCommand === null ? pass('install command explicitly none') : fail('an install command is set: ' + JSON.stringify(vj.installCommand));

  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  /* Playwright is a test-time tool. Listed under dependencies it is a
     production dependency, which invites the host to install it on deploy -
     tens of megabytes of browser automation shipped alongside a site that
     runs no code on a server. */
  !pkg.dependencies || Object.keys(pkg.dependencies).length === 0
    ? pass('no runtime dependencies') : fail('runtime dependencies declared: ' + Object.keys(pkg.dependencies).join(', '));
  pkg.devDependencies && pkg.devDependencies.playwright
    ? pass('Playwright is a devDependency, where it belongs') : fail('Playwright is not listed as a devDependency');
  pkg.private === true ? pass('marked private, so it can never be published to npm by accident') : fail('package.json is not marked private');
}

console.log('\n9. the site stays out of search engines and crawlers');
{
  /* This is one of the few protections on a static site that genuinely works,
     and it works in three places that have to agree. A header added to
     vercel.json but not _headers means the protection vanishes the day the
     site moves host, which is exactly the sort of silent regression this file
     exists to catch. */
  const robots = existsSync('robots.txt') ? readFileSync('robots.txt', 'utf8') : '';
  robots ? pass('robots.txt exists') : fail('there is no robots.txt');
  /User-agent:\s*\*[\s\S]*?Disallow:\s*\//.test(robots)
    ? pass('it disallows everything for every crawler') : fail('robots.txt does not disallow the whole site');
  for (const bot of ['GPTBot', 'ClaudeBot', 'CCBot', 'Bytespider', 'PerplexityBot', 'Google-Extended']) {
    robots.includes(bot) ? pass(bot + ' named explicitly') : fail(bot + ' is not named — several of these treat a wildcard as advisory');
  }
  /Sitemap:/i.test(robots) ? fail('a sitemap is published, which exists to help crawlers find pages') : pass('no sitemap');

  /* _headers is "Key: value" on one line; vercel.json splits the key and the
     value across two JSON properties, so they need reading differently. */
  const hdrRobots = (headers.match(/X-Robots-Tag:\s*(.*)/) || [])[1] || '';
  hdrRobots ? pass('_headers: X-Robots-Tag set') : fail('_headers: no X-Robots-Tag, so that host would allow indexing');
  /noindex/.test(hdrRobots) ? pass('_headers: it says noindex') : fail('_headers: X-Robots-Tag says ' + JSON.stringify(hdrRobots));

  const vj = JSON.parse(vercel);
  const vRobots = ((vj.headers || []).flatMap((h) => h.headers || [])
    .find((h) => h.key === 'X-Robots-Tag') || {}).value || '';
  vRobots ? pass('vercel.json: X-Robots-Tag set') : fail('vercel.json: no X-Robots-Tag, so this host would allow indexing');
  /noindex/.test(vRobots) ? pass('vercel.json: it says noindex') : fail('vercel.json: X-Robots-Tag says ' + JSON.stringify(vRobots));
  vRobots === hdrRobots ? pass('both hosts send the same instruction')
    : fail('the two hosts disagree, so moving host would change whether the site is indexed');
  /<meta name="robots"[^>]*noindex/.test(html)
    ? pass('the page carries a noindex meta for when it is served without headers')
    : fail('no noindex meta in the document');

  /* A description meta exists only to furnish a search result. Telling
     crawlers to stay away and then writing them a summary is incoherent. */
  /<meta name="description"/.test(html)
    ? fail('there is still a description meta, which only exists to feed a search result')
    : pass('no description meta — nothing written for a search result');
}

console.log(failures ? '\n' + failures + ' FAILED' : '\nall checks passed');
process.exit(failures ? 1 : 0);
