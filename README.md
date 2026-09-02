# Testbench

A browser-based hardware test bench for reverse logistics. Keyboards, mice,
controllers, racing wheels, headsets and mics, monitors, webcams, touchscreens,
and a machine-info panel.

Everything runs inside the browser tab. No backend, no build step, no
dependencies, nothing uploaded anywhere.

---

## 1. What is in this folder

```
index.html            the page — markup only
css/testbench.css     all styling
js/00-core.js         helpers, navigation, device identity, gamepad polling
js/10-keyboard.js     layouts, capture mode, chatter and stuck-key detection
js/20-mouse.js        diagram, buttons, double-click faults, polling, sensor
js/30-gamepad.js      controller diagram, rest scoring, sticks, triggers, rumble
js/40-wheel.js        steering range, pedals, shifters, raw axes
js/50-audio.js        microphone metering and headset output tests
js/60-display.js      automatic monitor run and single patterns
js/70-extras.js       webcam, touchscreen, machine info
js/80-bench.js        the home dashboard
build.py              optional: bundles everything into one file
dist/                 output of build.py
```

Load order matters: `00-core.js` must load first, the rest can be in any order.
The numbering keeps that obvious.

---

## 2. Deploy to Vercel — GitHub route (recommended)

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

## 3. Deploy to Vercel — command line route

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

## 4. Custom domain

In the Vercel dashboard: **your project → Settings → Domains → Add**. Enter the
domain, then add the DNS record Vercel shows you at your registrar. It goes live
once the DNS propagates, usually within the hour. HTTPS is issued automatically.

---

## 5. Other hosts

The site is plain static files, so any static host works:

- **GitHub Pages** — push the files, then **Settings → Pages → Deploy from a branch → main / (root)**.
- **Netlify** — drag the folder onto <https://app.netlify.com/drop>.
- **Cloudflare Pages** — **Create a project → Connect to Git**, no build command, output directory `/`.
- **An internal server** — copy the folder into the web root. It must be served
  over HTTPS or from `localhost`, otherwise the browser will block the
  microphone and camera tests.

---

## 6. Browser

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

## 7. Editing

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
