# Testbench by Vinay

A browser-based hardware test bench for reverse logistics. Keyboards, mice,
controllers, racing wheels, headsets and mics, monitors, webcams, touchscreens,
and a machine-info panel.

Everything runs inside the browser tab. No backend, no build step, no
dependencies, nothing uploaded anywhere.

---

## 1. What is in this folder

```
index.html            the page — markup only
css/testbench.css     all styling (black + red design system, responsive)
js/00-core.js         helpers, navigation, device identity, gamepad polling
js/10-keyboard.js     layouts, capture mode, chatter, typing test, rollover, shortcuts
js/20-mouse.js        diagram, buttons, CPS, double-click, scroll, polling, CPI, reaction
js/30-gamepad.js      controller diagram, rest scoring, sticks, triggers, rumble
js/40-wheel.js        steering range, pedals, shifters, raw axes
js/50-audio.js        microphone metering, headset output, loopback
js/60-display.js      automatic monitor run and single patterns
js/70-extras.js       webcam, touchscreen, machine info
js/80-bench.js        the home dashboard
vercel.json           security headers (CSP, HSTS, frame deny, permissions policy)
build.py              optional: bundles everything into one file
dist/                 output of build.py
```

Load order matters: `00-core.js` must load first, the rest can be in any order.
The numbering keeps that obvious.

---

## 2. Committing a change

Once the repo exists, every change follows the same three steps in GitHub Desktop:

1. Save the file you edited. GitHub Desktop picks it up straight away and lists it
   under **Changes** on the left.
2. Type a short line in the **Summary** box — it cannot be empty. Something like
   `Fix mouse polling rate` is plenty.
3. Click **Commit N files to main**, then **Push origin** in the top bar.

Vercel sees the push and redeploys within about a minute. Nothing else to do.

If the top bar says **Publish repository** instead of **Push origin**, the repo has
not reached GitHub yet — click that first, choose whether it is private, and publish.

The yellow "this file uses LF line endings" banner is normal on Windows and can be
ignored; Git is just normalising line endings.

---

## 3. Deploy to Vercel — GitHub route (recommended)

This is the route to use. Once it is set up, every change you push to GitHub
redeploys the site automatically.

**Step 1 — put the files on GitHub**

1. Go to <https://github.com/new>
2. Repository name: `testbench`. Set it to **Private** if you do not want it public.
3. Do **not** tick "Add a README" — this folder already has one.
4. Click **Create repository**.
5. On the next screen click **uploading an existing file**.
6. Drag in `index.html`, `README.md`, `build.py`, and the `css` and `js` folders.
   Dragging the folders keeps the structure, which matters — `index.html` looks
   for `css/testbench.css` and `js/00-core.js`.
7. Click **Commit changes**.

**Step 2 — connect Vercel**

1. Go to <https://vercel.com/signup> and sign up with your GitHub account.
   Signing up with GitHub means you skip the connection step later.
2. On the dashboard click **Add New → Project**.
3. Find `testbench` in the repository list and click **Import**.
   If it is not listed, click **Adjust GitHub App Permissions** and give Vercel
   access to that repository.

**Step 3 — the project settings**

For a plain static site you do not need to change anything:

| Setting | What to set |
|---|---|
| Framework Preset | **Other** |
| Root Directory | `./` (leave it) |
| Build Command | leave empty / override off |
| Output Directory | leave empty / override off |
| Install Command | leave empty |

**Step 4 — deploy**

Click **Deploy**. It takes about twenty seconds. You get a URL like
`https://testbench-abc123.vercel.app` — that is the bench, live, from anywhere.

**Step 5 — updating it later**

Edit a file on GitHub (or push a commit) and Vercel rebuilds within a minute.
Nothing else to do.

---

## 4. Deploy to Vercel — command line route

Faster if you already have Node installed and you would rather not use GitHub.

```bash
npm install -g vercel     # once
cd path/to/testbench
vercel login              # opens a browser to confirm
vercel                    # answers: scope = your account, link to existing = N,
                          # project name = testbench, directory = ./
```

The first deployment is always a production deployment. For every deployment
after that, use:

```bash
vercel --prod
```

---

## 5. Custom domain

In the Vercel dashboard: **your project → Settings → Domains → Add**. Enter the
domain, then add the DNS record Vercel shows you at your registrar. It goes live
once the DNS propagates, usually within the hour. HTTPS is issued automatically.

---

## 6. Other hosts

The site is plain static files, so any static host works:

- **GitHub Pages** — push the files, then **Settings → Pages → Deploy from a branch → main / (root)**.
- **Netlify** — drag the folder onto <https://app.netlify.com/drop>.
- **Cloudflare Pages** — **Create a project → Connect to Git**, no build command, output directory `/`.
- **An internal server** — copy the folder into the web root. It must be served
  over HTTPS or from `localhost`, otherwise the browser will block the
  microphone and camera tests.

---

## 7. Browser

Use **Chrome, Edge or Opera** on the bench machines.

| Feature | Chrome / Edge / Opera | Firefox | Safari |
|---|---|---|---|
| Keyboard capture mode (holds Windows key, Alt+Tab, Escape) | yes | partial | partial |
| USB device names | yes | no | no |
| Controllers and wheels | yes | yes | yes |
| Mic, headset, webcam | yes | yes | yes |
| Monitor patterns | yes | yes | yes |

Where a feature is unavailable the page says so in plain words and the rest of
the tests keep working.

---

## 8. Security

The site has no backend, no database, no forms and no analytics, so there is very
little to attack. What is in place anyway:

- A strict **Content Security Policy** — scripts load only from this site, styles and
  fonts only from Google Fonts, and nothing may be fetched from anywhere else. Even
  if someone injected a script tag it would not run.
- **X-Frame-Options: DENY** and `frame-ancestors 'none'` — the page cannot be embedded
  in someone else's site to trick people (clickjacking).
- **No `innerHTML` for anything a device reports.** Product names that come back from
  USB and gamepad devices are inserted as plain text, so a device with markup in its
  name cannot inject anything.
- **Permissions-Policy** limits microphone, camera, gamepad and USB access to this
  page only, and switches off geolocation and payment entirely.
- **HSTS** so browsers always use HTTPS.

These live in `vercel.json` and in the `<meta>` tag at the top of `index.html`. If you
move to a different host, copy the headers from `vercel.json` into that host's config.

---

## 9. Editing

Everything is plain HTML, CSS and JavaScript — no framework, no compiler.
Open a file, change it, reload the page.

Common edits:

- **Colours and type** — the tokens at the top of `css/testbench.css` (`:root`).
- **A new keyboard layout** — `LAYOUTS` in `js/10-keyboard.js`. Layouts are
  built from unit-grid key definitions, so a new one is a few lines.
- **Controller button names** — `LBL` in `js/00-core.js`.
- **Scoring thresholds** — `scorePad()` in `js/00-core.js` for controllers,
  `score()` in `js/20-mouse.js` for mice.
- **USB vendor names** — `VENDORS` in `js/00-core.js`.

### One-file build

If you ever need the whole thing as a single file — to email it, or to drop on a
host that only takes one page:

```bash
python3 build.py          # writes dist/testbench.html
```

That file has no external references except the web font, and works offline.
