/* Testbench — guided bench run.

   The problem this solves is physical, not technical. Testing a mouse means
   holding it in one hand while the other hand clicks between nine tabs, and
   every switch is a moment where you put the device down. Across twenty units
   a week that is the single biggest waste of time on the bench.

   So: one sequence per device, on screen, that advances by itself the moment a
   step is satisfied. You hold the unit and work through it.

   It reads progress from the readouts the pages already show rather than from
   their internals. Those numbers are the source of truth the operator is
   looking at anyway, and reading them keeps this file from reaching into nine
   other modules and coupling itself to all of them. If a readout ever lies,
   the bench run lies in exactly the same way the screen does, which is the
   behaviour you want. */
"use strict";
(function () {
var $ = TB.$, el = TB.el;

/* ---------- reading progress off the page ---------- */
function num(sel) {
  var n = $(sel); if (!n) return 0;
  var v = parseFloat((n.textContent || "").replace(/[^0-9.\-]/g, ""));
  return isFinite(v) ? v : 0;
}
function clickTab(strip, name) {
  var b = $(strip + ' [data-t="' + name + '"]');
  if (b && b.getAttribute("aria-selected") !== "true") b.click();
}
function firstPad() {
  var p = TB.pads(), k = Object.keys(p);
  for (var i = 0; i < k.length; i++) if (p[k[i]].active) return p[k[i]];
  return k.length ? p[k[0]] : null;
}
function axisRange(rec, i) {
  if (!rec || rec.axMax[i] == null) return 0;
  return rec.axMax[i] - rec.axMin[i];
}

/* ---------- the flows ----------

   read()  an ever-rising counter, or an absolute figure when abs is set
   need    finish when the counter reaches this
   settle  finish when the counter stops rising for this many ms (and >= min).
           Used where the target depends on the device: a three-button mouse
           and a twelve-button MMO both finish the buttons step correctly. */
var FLOWS = {
  mouse: {
    strip: "#ms-tabs",
    label: "Mouse",
    steps: [
      { tab: "buttons", title: "Press every button on the mouse",
        hint: "Left, right, wheel click, both side buttons. Remapped side buttons count too.",
        read: function () { return num("#ms-btnseen") + num("#ms-macros"); },
        abs: true, settle: 2600, min: 3, unit: "buttons" },

      { tab: "scroll", title: "Spin the wheel both ways",
        hint: "Five clicks up, five down. Feel for a notch that slips or skips.",
        read: function () { return Math.min(num("#scroll-up"), num("#scroll-dn")); },
        abs: true, need: 5, unit: "clicks each way" },

      { tab: "dbl", title: "Click left thirty times, steadily",
        hint: "This is the fault that kills most returned mice — one press registering as two.",
        read: function () { return num("#dbl-clicks"); }, need: 30, unit: "clicks" },

      { tab: "track", title: "Move the mouse around the pad",
        hint: "Wide circles, then slow straight lines. Watch for the trace jumping or stalling.",
        read: function () { return num("#ms-poll"); }, abs: true, need: 100, unit: "Hz peak" },

      { tab: "drag", title: "Hold left and drag through all six boxes",
        hint: "One hold, all six. A worn switch lets go halfway.",
        read: function () { return num("#drag-done"); }, need: 1, unit: "clean runs" }
    ]
  },

  gamepad: {
    strip: null,
    label: "Controller",
    steps: [
      { title: "Put the controller down and let go",
        hint: "It reads the resting position — stick drift, stuck buttons, triggers off zero.",
        read: function () { var r = firstPad(); return r && r.score != null ? 1 : 0; },
        abs: true, need: 1, unit: "" },

      { title: "Press every button once",
        hint: "Face buttons, bumpers, d-pad, stick clicks, Start and Select.",
        read: function () { var r = firstPad(); return r ? Object.keys(r.seenBtn).length : 0; },
        abs: true, settle: 2600, min: 4, unit: "buttons" },

      { title: "Roll both sticks to the edge, all the way round",
        hint: "Full circles. Short travel on one axis shows up here and nowhere else.",
        read: function () {
          var r = firstPad(); if (!r) return 0;
          var n = 0;
          for (var i = 0; i < r.axes.length && i < 4; i++) if (axisRange(r, i) > 1.2) n++;
          return n;
        },
        abs: true, need: 4, unit: "axes at full travel",
        skip: function () { var r = firstPad(); return !r || !r.standard || r.axes.length < 4; } },

      { title: "Squeeze both triggers all the way",
        hint: "Slowly. A trigger that jumps from nothing to full has a dead pot.",
        read: function () {
          var r = firstPad(); if (!r) return 0;
          return (r.btnMax[6] > 0.8 ? 1 : 0) + (r.btnMax[7] > 0.8 ? 1 : 0);
        },
        abs: true, need: 2, unit: "triggers",
        skip: function () { var r = firstPad(); return !r || !r.standard; } }
    ]
  },

  keyboard: {
    strip: "#kb-tabs",
    label: "Keyboard",
    steps: [
      { tab: "map", title: "Press every key on the board",
        hint: "Work along each row. The run ends when you stop finding new keys.",
        read: function () { return num("#kb-tested"); },
        abs: true, settle: 3200, min: 20, unit: "keys" },

      { tab: "map", title: "Hold six keys down at once",
        hint: "Checks rollover. Cheap membranes stop at two or three.",
        read: function () { return num("#kb-nkro"); }, abs: true, need: 6, unit: "held at once" }
    ]
  },

  audio: {
    strip: "#au-tabs",
    label: "Headset",
    steps: [
      { title: "Press Left, then Right", manual: true,
        hint: "One cup at a time. A dead earcup is obvious the moment you switch." },
      { title: "Press Sweep and listen all the way through",
        hint: "Twenty hertz to twenty kilohertz. Listen for a gap, a buzz or a sudden drop.",
        read: function () { return /finished/i.test(($("#au-sweeplbl") || {}).textContent || "") ? 1 : 0; },
        abs: true, need: 1, unit: "" },
      { title: "Press Bass and listen for rattle", manual: true,
        hint: "Thirty to a hundred and twenty hertz. A loose driver buzzes here." }
    ]
  }
};

/* ---------- state ---------- */
var run = null, bar = null, tick = null;

function stepsFor(flow) {
  return flow.steps.filter(function (s) { return !(s.skip && s.skip()); });
}

function start(view) {
  var flow = FLOWS[view];
  if (!flow) { TB.toast("No guided run here yet", "The bench run covers Mouse, Controllers, Keyboard and Mic & Headsets.", null); return; }
  stop(true);
  run = { view: view, flow: flow, steps: stepsFor(flow), i: 0, base: 0, peak: 0, peakAt: 0, passing: false };
  if (!run.steps.length) { run = null; TB.toast("Nothing to run", "No step in this flow applies to the device that is connected.", null); return; }
  build();
  enter();
  tick = setInterval(poll, 180);
}

function stop(quiet) {
  if (tick) { clearInterval(tick); tick = null; }
  if (bar) { bar.remove(); bar = null; }
  var wasRunning = !!run;
  run = null;
  if (wasRunning && !quiet) TB.toast("Bench run ended", "", null);
  var b = $("#run-start"); if (b) { b.textContent = "Run bench"; b.classList.remove("on"); }
}

function enter() {
  var s = run.steps[run.i];
  if (s.tab && run.flow.strip) clickTab(run.flow.strip, s.tab);
  run.base = (s.abs || !s.read) ? 0 : s.read();
  run.peak = value();
  run.peakAt = performance.now();
  run.passing = false;
  paint();
}

function value() {
  var s = run.steps[run.i];
  if (!s.read) return 0;
  return Math.max(0, s.read() - run.base);
}
function target() {
  var s = run.steps[run.i];
  return s.need != null ? s.need : (s.min != null ? s.min : 1);
}

function poll() {
  if (!run) return;
  if (TB.view() !== run.view) { stop(true); return; }
  var s = run.steps[run.i];
  if (s.manual) { paint(); return; }

  var v = value(), now = performance.now();
  if (v > run.peak) { run.peak = v; run.peakAt = now; }

  var done = s.need != null
    ? v >= s.need
    : (v >= (s.min || 1) && now - run.peakAt > s.settle);

  paint();
  if (done && !run.passing) {
    run.passing = true;
    flash();
    setTimeout(next, 750);
  }
}

function next() {
  if (!run) return;
  if (run.i >= run.steps.length - 1) { finish(); return; }
  run.i++;
  enter();
}
function finish() {
  var label = run.flow.label;
  stop(true);
  TB.toast(label + " run complete", "Every step in the sequence passed. The verdict panels on each tab have the detail.", "ok");
}

/* ---------- the bar ---------- */
function build() {
  bar = el("div", "tb-run");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Bench run");

  var dots = el("div", "tb-run-dots");
  var body = el("div", "tb-run-body");
  var kick = el("div", "tb-run-kick");
  var title = el("div", "tb-run-title");
  var hint = el("div", "tb-run-hint");
  body.appendChild(kick); body.appendChild(title); body.appendChild(hint);

  var meterWrap = el("div", "tb-run-meter");
  var meterFill = el("i");
  meterWrap.appendChild(meterFill);
  var count = el("div", "tb-run-count");

  var acts = el("div", "tb-run-acts");
  var bNext = el("button", "tb-btn pri", "Next");
  var bSkip = el("button", "tb-btn", "Skip");
  var bStop = el("button", "tb-btn", "End run");
  bNext.type = bSkip.type = bStop.type = "button";
  bNext.onclick = function () { flash(); setTimeout(next, 220); };
  bSkip.onclick = next;
  bStop.onclick = function () { stop(); };
  acts.appendChild(bNext); acts.appendChild(bSkip); acts.appendChild(bStop);

  bar.appendChild(dots); bar.appendChild(body);
  bar.appendChild(meterWrap); bar.appendChild(count); bar.appendChild(acts);
  $("#main").appendChild(bar);
  bar.ui = { dots: dots, kick: kick, title: title, hint: hint, fill: meterFill, count: count, next: bNext };

  var b = $("#run-start"); if (b) { b.textContent = "End run"; b.classList.add("on"); }
}

function paint() {
  if (!bar || !run) return;
  var u = bar.ui, s = run.steps[run.i];

  if (u.dots.childElementCount !== run.steps.length) {
    u.dots.textContent = "";
    run.steps.forEach(function () { u.dots.appendChild(el("i")); });
  }
  Array.prototype.forEach.call(u.dots.children, function (d, i) {
    d.className = i < run.i ? "done" : i === run.i ? "now" : "";
  });

  u.kick.textContent = run.flow.label + " · step " + (run.i + 1) + " of " + run.steps.length;
  if (u.title.textContent !== s.title) u.title.textContent = s.title;
  if (u.hint.textContent !== (s.hint || "")) u.hint.textContent = s.hint || "";

  if (s.manual) {
    u.fill.style.width = "0%";
    u.count.textContent = "press Next when done";
    u.next.hidden = false;
  } else {
    var v = value(), t = target();
    u.fill.style.width = Math.min(100, v / t * 100) + "%";
    u.count.textContent = Math.round(v) + (s.need != null ? " / " + t : "") + (s.unit ? " " + s.unit : "");
    u.next.hidden = true;
  }
}

function flash() {
  if (!bar) return;
  bar.classList.add("pass");
  setTimeout(function () { if (bar) bar.classList.remove("pass"); }, 700);
}

/* ---------- wiring ---------- */
var startBtn = $("#run-start");
if (startBtn) startBtn.onclick = function () { run ? stop() : start(TB.view()); };

/* Escape ends the run — except on the Keyboard page, where Escape is a key
   under test and swallowing it would fail the very thing being checked. */
window.addEventListener("keydown", function (e) {
  if (!run || e.key !== "Escape" || TB.view() === "keyboard") return;
  e.preventDefault(); stop();
});

TB.run = { start: start, stop: stop, flows: Object.keys(FLOWS) };
})();
