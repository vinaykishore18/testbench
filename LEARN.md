# Learning this codebase

You specified this tool, tested it, found four real bugs in it and deployed it.
What is missing is the middle bit: how the code actually works. This document
closes that gap.

It is written to be read **beside the code, in order**. Seven sessions, roughly
two hours each. Do the exercise in each one — reading alone will not stick.
Answer the self-check out loud, from memory, before moving on. If you cannot,
read the section again; that is the whole point of the question.

---

## The shape of it

```
index.html          845 lines   one page, every test is a hidden section inside it
css/testbench.css   565 lines   all styling, one file
js/00-core.js       367 lines   shared helpers + navigation + the gamepad loop
js/10-keyboard.js   445 lines   keyboard layouts, capture mode, typing, rollover
js/20-mouse.js      688 lines   buttons, CPS, double-click, scroll, polling, CPI
js/30-gamepad.js    335 lines   controller diagram and rest scoring
js/40-wheel.js      187 lines   steering, pedals, shifters
js/50-audio.js      361 lines   microphone metering, headset output, loopback
js/60-display.js    303 lines   monitor patterns and the automatic run
js/70-extras.js     150 lines   webcam, touchscreen, machine info
js/80-bench.js      100 lines   the home dashboard
js/90-stress.js     211 lines   CPU and GPU load test
js/95-network.js    274 lines   router soak, latency, throughput, load test
                  ─────────
                  4,831 lines
```

No React. No npm packages at runtime. No compiler. What you see in the files is
exactly what runs in the browser — which is unusual now, and is what makes this
learnable in a weekend rather than a term.

### Five decisions, and why

Interviews probe *decisions*, not syntax. Know these five and you can hold a
conversation about this project with anyone.

**1. Plain JavaScript, no framework.** A framework earns its keep when you have
complex shared state changing across many screens. This app has almost none: each
test reads a device and paints numbers. React would have added a build step, a
dependency tree to keep patched, and a layer between you and the DOM events that
this whole app is *about*. The cost would have been real and the benefit near zero.

**2. One HTML page, sections hidden and shown.** Not twelve separate pages.
Switching tests has to be instant on a bench, and a single page means the gamepad
polling loop and any running soak test survive when you move between screens.

**3. One global object, `TB`, instead of ES modules.** Real ES modules
(`import`/`export`) need either a build step or a server that sets the right MIME
type, and they break when you open the file directly from disk. Every file here is
a plain script that reads from one shared object. It is old-fashioned and it works
everywhere, including offline from a USB stick.

**4. Numbered filenames.** `00-core.js` must load before everything else because
every other file uses `TB`. Numbering makes the load order visible in the folder
listing instead of hidden in a config file. `build.py` sorts by filename, so the
numbering is load-bearing, not decoration.

**5. Everything runs in the browser, nothing is uploaded.** There is no server, no
database, no accounts. That is a privacy decision — a QA tool that phones home with
device serial numbers would be a liability — and it makes the whole thing free to
host and impossible to breach in the usual ways.

---

## Session 1 — how the page is wired together

**Read:** `index.html` (skim the structure, ignore the copy), then all of `js/00-core.js`.

### What to look for in index.html

Find the twelve `<section class="tb-view" id="view-...">` blocks. Only one has the
class `on` at a time. That is the entire navigation system — CSS shows `.tb-view.on`
and hides the rest.

### What 00-core.js does

It is one big **IIFE** — an immediately-invoked function expression:

```js
var TB = (function () {
  function $(s, r) { return (r || document).querySelector(s); }
  // ... hundreds of lines of private things ...
  return { $: $, go: go, verdict: verdict, /* ... */ };
})();
```

Everything inside those brackets is private. Only what is listed in the `return`
gets a name outside. So `TB.$` works everywhere; the internals cannot be reached or
accidentally overwritten by another file. That is the whole reason for the pattern.

Every other file opens the same way and pulls out what it needs:

```js
(function () {
  var $ = TB.$, el = TB.el, verdict = TB.verdict;
  // ...
})();
```

### The four things core owns

- **Helpers** — `$` and `$$` wrap `querySelector`, `el()` builds an element, `svgEl()`
  builds an SVG element (SVG needs a namespace, which is why it is separate).
- **Navigation** — `go(view)` swaps which section has `.on`, and runs any functions
  registered with `onEnter(view, fn)` / `onLeave(view, fn)`. That is how the monitor
  page measures refresh rate the moment you open it, and how a soak test stops when
  you leave the router page.
- **Shared UI** — `verdict()`, `meterRow()`, `toast()`, `checklist()`. Every module
  builds its readouts from these, which is why the whole app looks like one thing.
- **The gamepad loop** — covered in session 2.

### Exercise

Add a thirteenth view called "Notes" that shows a single panel with a heading.
You need three things: a `<button class="tb-nav" data-view="notes">` in the rail,
a `<section class="tb-view" id="view-notes">` in the main area, and nothing else —
core wires the click automatically. Find the line that does that wiring.

### Self-check

Trace what happens between clicking **Mouse** in the sidebar and the mouse page
appearing. Name every function involved, in order.

---

## Session 2 — the gamepad loop

**Read:** the gamepad section of `js/00-core.js` (from `var PADS = {}` to the end of
`poll()`), then `js/30-gamepad.js`.

### The one idea that matters

Gamepads are not evented. There is no "button pressed" event in the browser — you
have to ask, sixty times a second, what state the pad is in:

```js
function poll() {
  var list = navigator.getGamepads();
  // ... read every axis and button ...
  requestAnimationFrame(poll);
}
```

`requestAnimationFrame` schedules the function to run before the next screen repaint.
That gives roughly 60 calls a second, and the browser pauses it when the tab is
hidden — which is exactly the behaviour you want.

The Gamepad API also hands back a **snapshot**, not a live object. Every poll returns
new objects, so you cannot hold a reference and expect it to update. That is why
`poll()` copies values into `PADS[index]` each frame.

### The scoring

`beginRestSample()` starts collecting axis readings for 850 ms. `finishRestSample()`
averages them and `scorePad()` turns that into a number. The logic is: with nobody
touching it, the sticks should read zero, the triggers should read zero, and no
button should be pressed. Every deviation costs points. Read `scorePad()` line by
line — it is the most opinionated code in the project and it encodes what you told
me about what actually fails.

### Exercise

In `scorePad()`, find the threshold `mag > 0.09` that decides "small drift". Change
it to `0.02`, reload, and connect a good controller. It should now flag a pad that
is fine. Change it back. You have just learned where the product judgement lives.

### Self-check

Why can't the page just listen for a "button pressed" event? And why must a
controller send one input before the browser will admit it exists?

---

## Session 3 — events, and the bugs you found

**Read:** all of `js/20-mouse.js`. This is the longest file and the most instructive,
because you already know its bugs from the bench.

### Capture vs bubble

```js
document.addEventListener("mousedown", handler, true);
```

That third argument, `true`, means **capture phase** — the handler runs on the way
*down* the DOM tree, before the event reaches the element you actually clicked.
That is how the page sees a click on any part of itself. The default, `false`, is
the bubble phase, which runs on the way back up.

### Why clicking the diagram did nothing

Look at `onChrome(e)`. It decides whether a click is "on the page's own controls"
and should be ignored. The original version listed `#ms-svg` — the mouse diagram —
which meant the most natural place to point while testing was excluded. The fix
narrows it to real controls, plus one exception: a left-click on a thumb-pad key,
which is a binding action rather than a test.

### Why side buttons don't send button 3

`e.button` gives 0 left, 1 middle, 2 right, 3 back, 4 forward. But most Logitech and
Razer drivers never send buttons 3 and 4 — they send a *browser Back command*, which
the browser acts on before any mouse event exists. Nothing to intercept.

The fix is the history trap. Read `armNav()`. It pushes three entries onto the
browser's history and sits on the middle one. When the driver triggers Back, the
browser moves to entry 0, a `popstate` event fires, the code notices the index went
down, counts it as button 3, and jumps back to the middle. Clever, slightly rude,
and the only way to catch it.

### `e.button` vs `e.buttons`

`button` is which button caused *this* event. `buttons` is a bitmask of everything
held right now: 1 left, 2 right, 4 middle, 8 back, 16 forward. So `buttons === 3`
means left and right are both down. `heldNames()` decodes it.

### Polling rate

`pointermove` fires at most once per screen frame — about 60 a second — so counting
those told us 133 Hz for every mouse. `pointerrawupdate` fires at the true hardware
rate. Read the `hasRaw` branch.

### Exercise

Add a "7-button" shape to the diagram: a copy of the five-button case with two extra
buttons drawn on the right flank, mapped to button indices 5 and 6.

### Self-check

Explain, without looking, why a click on the mouse diagram used to register nothing,
and why pressing a side button navigated the page backwards instead of lighting up
button 3.

---

## Session 4 — drawing: canvas and SVG

**Read:** `js/60-display.js` in full, then the `padSVG()` function in `js/30-gamepad.js`.

### When each one is right

**SVG** for the controller and mouse diagrams — they are made of named parts you keep
a handle on and restyle (`btn.classList.add("on")`). Every shape is a DOM element.

**Canvas** for the monitor patterns, waveforms and graphs — thousands of pixels
changing every frame. Canvas is one element you paint into; no DOM, so it is fast.

Rule of thumb: a handful of things you interact with individually, use SVG. Lots of
pixels changing fast, use canvas.

### devicePixelRatio

```js
cv.width = Math.round(pad.clientWidth * dpr);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

A canvas has two sizes: the CSS box on screen, and the pixel buffer behind it. On a
high-DPI laptop one CSS pixel is two real pixels, so a buffer sized in CSS pixels
renders blurry. You size the buffer in real pixels and then scale the drawing
context so your code can still think in CSS pixels.

### The fullscreen bug you photographed

The overlay is `position: fixed` at `z-index: 80` — a layer over the whole page. It
was hidden by removing a class in the Escape handler. But pressing Escape inside
fullscreen is swallowed by the browser to exit fullscreen; the page never sees the
key. Fullscreen ended, the class stayed, and the overlay was stranded over the
desktop.

The fix is `onFsChange()` — listen for fullscreen ending by *any* route and take the
overlay down with it — plus a visible Exit button, a restored cursor, and a watchdog.
The lesson generalises: **never make one input the only way out of a modal state.**

### Exercise

Add a new pattern called `checkerboard` that fills the screen with 32-pixel squares.
Add it to the `PATTERNS` list and add a button in `index.html`.

### Self-check

Why is the canvas backing store a different size from the box it occupies on screen,
and what breaks if you skip `setTransform`?

---

## Session 5 — audio and the Web Audio graph

**Read:** all of `js/50-audio.js`.

### It is a signal chain

Web Audio is nodes connected into a graph, like patch cables:

```js
micNode.connect(ana);      // microphone  -> analyser
ana.connect(sink);         // analyser    -> gain (set to 0)
sink.connect(a.destination); // gain      -> speakers
```

### Why the meter read minus infinity

The original code stopped at `micNode.connect(ana)`. Chrome only pulls audio through
nodes that have a path to the destination — an analyser dangling off the end is never
fed, so it measured pure silence. The muted gain node exists solely to complete the
circuit without making a sound. It is the single most instructive bug in this
codebase: the code looked correct and did nothing.

### dBFS

`fmtDb()` converts amplitude to decibels: `20 * log10(v)`. Zero dB is the loudest a
digital signal can be, so every real value is negative. Silence is `-∞` because
log of zero is undefined — hence the guard.

### Exercise

Change the loopback tone from 1 kHz to 440 Hz. You must change it in two places —
find both. That tells you something about the design.

### Self-check

Draw the audio graph from microphone to on-screen meter, naming every node. Then
explain why removing the gain node breaks it.

---

## Session 6 — async, and the network module

**Read:** `js/95-network.js`, then `js/90-stress.js`.

### Promises

`fetch()` does not return data. It returns a **promise** — an object that will hold a
result later. `.then()` says "when it arrives, do this"; `.catch()` says "if it fails,
do this instead". A failed fetch on the router page is not an error to hide: it *is*
the measurement — that is a dropout.

### AbortController

```js
var ctl = new AbortController();
setTimeout(function () { ctl.abort(); }, 5000);
fetch(url, { signal: ctl.signal })
```

Without this a request could hang for thirty seconds and the soak test would miss the
dropout entirely. Five seconds with no answer counts as lost.

### Cache-busting

`nocache()` appends a random query string. Without it the browser serves the second
request from memory in 0 ms and you measure nothing. `payload.bin` is **random bytes**
on purpose — compressible data would be gzipped in transit and the throughput number
would be a lie.

### Workers

The stress test runs its CPU load in Web Workers — separate threads. On the main
thread a busy loop would freeze the page, including the frame-rate counter you are
trying to read. Workers cannot touch the DOM, so they `postMessage` their progress
back.

### Exercise

Change the soak probe from once a second to twice a second, and make sure the graph
and the elapsed timer still read correctly. Two things need changing.

### Self-check

What does a red column on the latency graph mean, and trace exactly how it gets
drawn — from the failed request to the pixels.

---

## Session 7 — the parts that are not JavaScript

**Read:** the top 60 lines of `css/testbench.css`, the `<head>` of `index.html`,
`vercel.json`, `_headers`.

- **Design tokens.** Every colour is a CSS custom property in `:root`. Change
  `--red` once and the whole site changes. That is why there is not a single hex
  code buried in the modules.
- **Responsive.** `clamp(min, preferred, max)` sizes type fluidly without media
  queries. Media queries handle the layout changes — the sidebar becoming a
  scrolling strip under 980px.
- **Security headers.** The Content-Security-Policy says scripts may only load from
  this site and nothing may be fetched from anywhere else. Read it as a sentence.
  `vercel.json` and `_headers` are the same rules in two hosts' formats.
- **The pipeline.** Commit → push → the host rebuilds → live in a minute. There is
  no build step; the "build" is copying files.

---

## When you are through it

You will be able to answer, without notes:

- Why plain JavaScript instead of React, in one sentence
- How a click on the sidebar becomes a visible page
- Why gamepads are polled and audio is not
- Why the microphone read silence and how a muted gain node fixed it
- Why a side button navigates backwards instead of registering
- The difference between canvas and SVG and when you reach for each
- What a Content-Security-Policy does

That is a genuine working knowledge of a 4,800-line front-end application. At that
point the honest claim is not "built with AI assistance" as a caveat — it is that you
own, understand and maintain it, and used AI to get there faster. Those are different
sentences and you will have earned the second one.

**The test that matters:** open a file, break something on purpose, and fix it without
help. Do that three times and the doubt goes away by itself.
