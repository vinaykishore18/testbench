/* Testbench — dead pixel check.

   The simplest test on the site and the one that gets run most: fill the
   screen with one flat colour, click to go to the next, five colours, done.

   It exists alongside the twenty-one step automatic run because they are not
   the same job. The automatic run is a careful sweep for banding, bleed,
   uniformity and gamma, and it holds each field for seconds at a time. This
   is the thirty-second check you do on every monitor that comes through the
   door, where you want to drive it yourself and stop the moment you see
   something. A tool that only offers the thorough version gets skipped when
   there are forty monitors on the trolley.

   Red, green and blue first because a stuck subpixel shows against exactly
   one of them. Then white, which is where a dead pixel is most obvious as a
   black dot. Then black, which is where a stuck pixel glows and where
   backlight bleed shows up at the edges. */
"use strict";
(function () {
var $ = TB.$, el = TB.el, toast = TB.toast;
var go = $("#dp-go");
if (!go) return;

var FIELDS = [
  ["#FF0000", "Red",   "A subpixel stuck ON red, or dead green and blue, shows here."],
  ["#00FF00", "Green", "The green subpixel on its own. Most dead pixels show on this one."],
  ["#0000FF", "Blue",  "The blue subpixel. Faint dark specks here are often dust, not pixels."],
  ["#FFFFFF", "White", "A dead pixel is a black dot. This is the clearest field for finding one."],
  ["#000000", "Black", "A stuck pixel glows. Light creeping in at the corners is backlight bleed."]
];

var stage = $("#fullstage");
var idx = 0, on = false, hint = null, seen = null, hadFs = false, watchdog = null;

function paint() {
  var f = FIELDS[idx];
  stage.style.background = f[0];
  if (seen) seen[idx] = true;
  var st = $("#dp-state");
  st.textContent = f[1].toLowerCase();
  st.className = "tb-sppill";
}

function overlay() {
  /* The instructions, which disappear on the first click and never come
     back. They are needed once and are in the way after that - and this test
     is about looking closely at the screen, so a panel of text sitting on top
     of the thing you are inspecting defeats it. */
  var o = el("div", "tb-dphint");
  var h = el("b", null, "Dead pixel check");
  o.appendChild(h);
  var p1 = el("p", null, "Click anywhere, or press any key, to move to the next colour.");
  var p2 = el("p", null, "Red → Green → Blue → White → Black. Look closely at each one.");
  var p3 = el("p", "dim", "Esc or right-click to leave. This notice goes away on your first click.");
  o.appendChild(p1); o.appendChild(p2); o.appendChild(p3);
  return o;
}

function next(step) {
  idx = (idx + (step || 1) + FIELDS.length) % FIELDS.length;
  paint();
  if (hint) { hint.remove(); hint = null; }
}

function onKey(e) {
  if (!on) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") { stop(); return; }
  if (e.key === "ArrowLeft") { next(-1); return; }
  next(1);
}
function onClick(e) {
  if (!on) return;
  e.preventDefault();
  next(e.button === 2 ? 0 : 1);
}
function onCtx(e) { if (on) { e.preventDefault(); stop(); } }
function onFs() { if (on && hadFs && !document.fullscreenElement) stop(); }

function start() {
  if (on) return;
  /* The monitor page's own overlay may be up; never stack two. */
  if (stage.classList.contains("on")) { toast("Something is already full screen", "Close it first.", null); return; }
  idx = parseInt($("#dp-first").value, 10) || 0;
  seen = [false, false, false, false, false];
  on = true;
  stage.textContent = "";
  stage.classList.add("on", "dp");
  hint = overlay();
  stage.appendChild(hint);
  paint();

  if (stage.requestFullscreen) stage.requestFullscreen().then(function () { hadFs = true; }).catch(function () {});
  document.addEventListener("keydown", onKey, true);
  stage.addEventListener("click", onClick);
  stage.addEventListener("contextmenu", onCtx);
  document.addEventListener("fullscreenchange", onFs);
  /* Same belt-and-braces as the pattern overlay: if full screen ends by a
     route the browser does not tell us about, notice within a second. Being
     stranded behind a full-screen layer with no way out is worse than any
     missed test. */
  watchdog = setInterval(function () {
    if (!on) return;
    if (hadFs && !document.fullscreenElement) stop();
  }, 700);
  TB.watch("DEAD PIXEL", "check started");
}

function stop() {
  if (!on) return;
  on = false;
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  document.removeEventListener("keydown", onKey, true);
  stage.removeEventListener("click", onClick);
  stage.removeEventListener("contextmenu", onCtx);
  document.removeEventListener("fullscreenchange", onFs);
  stage.classList.remove("on", "dp");
  stage.style.background = "";
  stage.textContent = "";
  hint = null;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  hadFs = false;

  var n = seen ? seen.filter(Boolean).length : 0;
  var st = $("#dp-state");
  st.textContent = n === FIELDS.length ? "all five shown" : n + " of 5 shown";
  st.className = "tb-sppill " + (n === FIELDS.length ? "pass" : "warn");

  /* Into the unit report, and honestly: this test cannot see anything. It
     puts colours on a screen and a person decides. So it records WHAT WAS
     SHOWN, never a verdict - a row claiming the panel passed would be the
     page taking credit for a judgement it did not make. */
  TB.report("monitor", "Dead pixel check", n === FIELDS.length ? 100 : 60, [
    { level: n === FIELDS.length ? "ok" : "warn", tag: "coverage",
      text: n === FIELDS.length
        ? "All five fields were shown: red, green, blue, white and black."
        : "Only " + n + " of the five fields were shown before the check was closed." },
    { level: "ok", tag: "judgement",
      text: "This test displays colours; it does not inspect them. Whether the panel is clean is the operator's call, recorded here as having been looked at rather than as a measurement." }
  ]);
  TB.watch("DEAD PIXEL", n + " of 5 fields shown");
}

go.onclick = start;

/* D starts it without reaching for the mouse, like F and Q for the automatic
   runs. Ignored while typing so it cannot fire from a text field. */
window.addEventListener("keydown", function (e) {
  if (TB.view() !== "monitor" || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (on) return;
  var t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  if ((e.key || "").toLowerCase() === "d") { e.preventDefault(); start(); }
});

TB.onLeave("monitor", stop);
window.addEventListener("pagehide", stop);

window.DEADPIXEL = { start: start, stop: stop, fields: FIELDS, at: function () { return idx; }, running: function () { return on; } };
})();
