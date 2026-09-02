/* Testbench — mouse: buttons, click speed, double-click faults, scroll,
   tracking and polling rate, CPI and reaction time. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, svgEl = TB.svgEl, clamp = TB.clamp;
var verdict = TB.verdict, badge = TB.badge, toast = TB.toast;

var NAMES = ["Left", "Middle", "Right", "Back", "Forward"];
var MAX = 20;
var st = fresh();
function fresh() {
  return {
    seen: {}, down: {}, clicks: 0, dbl: 0, minGap: null, lastUp: {}, gaps: [],
    up: 0, dn: 0, tl: 0, tr: 0, deltas: [],
    keys: {}, keyDown: {},
    pollPeak: 0, reports: 0
  };
}
var pane = "buttons";

/* ============================================================
   1. DIAGRAM
   ============================================================ */
var shape = "five", parts = {}, cells = [], binds = {}, arming = -1;

function P(d, cls) { return svgEl("path", { d: d, "class": cls }); }
function R(x, y, w, h, r, cls) { return svgEl("rect", { x: x, y: y, width: w, height: h, rx: r, "class": cls }); }
function T(x, y, txt, cls) { var t = svgEl("text", { x: x, y: y, "class": cls || "lbl" }); t.textContent = txt; return t; }

function buildSVG() {
  var host = $("#ms-svg"); host.textContent = "";
  parts = {}; cells = [];
  var mmo = shape === "mmo";
  var s = svgEl("svg", { viewBox: mmo ? "-96 0 346 356" : "-64 0 318 356", "class": "tb-dev", role: "img", "aria-label": "Mouse diagram" });
  s.style.maxWidth = mmo ? "480px" : "320px";

  if (mmo) {
    s.appendChild(R(-86, 104, 78, 108, 11, "plate"));
    for (var i = 0; i < 12; i++) {
      var col = i % 3, row = Math.floor(i / 3);
      var g = svgEl("g", { "class": "cell" });
      var rect = R(-79 + col * 23, 111 + row * 24, 20, 20, 5, "btn");
      g.appendChild(rect);
      g.appendChild(T(-79 + col * 23 + 10, 111 + row * 24 + 10, String(i + 1), "lbl sm"));
      (function (idx) { g.addEventListener("click", function () { arm(idx); }); })(i);
      s.appendChild(g);
      cells.push({ g: g, rect: rect, label: g.querySelector("text"), btn: 5 + i });
    }
    s.appendChild(T(-47, 224, "thumb pad", "lbl sm"));
  }

  s.appendChild(P("M120,12 C74,12 50,52 46,112 C43,152 40,240 52,284 C62,322 92,334 120,334 C148,334 178,322 188,284 C200,240 197,152 194,112 C190,52 166,12 120,12 Z", "shell"));
  parts[0] = P("M118,15 C78,17 55,55 51,114 C49,133 48,147 48,154 L118,154 Z", "btn");
  parts[2] = P("M122,15 C162,17 185,55 189,114 C191,133 192,147 192,154 L122,154 Z", "btn");
  s.appendChild(parts[0]); s.appendChild(parts[2]);
  parts[1] = R(110, 50, 20, 52, 10, "btn"); s.appendChild(parts[1]);
  s.appendChild(T(80, 100, "L", "lbl"));
  s.appendChild(T(160, 100, "R", "lbl"));
  s.appendChild(T(120, 124, "wheel", "lbl sm"));

  if (shape !== "std") {
    parts[4] = R(34, 112, 20, 30, 7, "btn"); s.appendChild(parts[4]);
    parts[3] = R(34, 146, 20, 30, 7, "btn"); s.appendChild(parts[3]);
    s.appendChild(T(44, 127, "4", "lbl sm"));
    s.appendChild(T(44, 161, "3", "lbl sm"));
    s.appendChild(T(-2, 127, "forward", "lbl sm"));
    s.appendChild(T(-2, 161, "back", "lbl sm"));
    s.appendChild(svgEl("path", { d: "M18,127 H30 M18,161 H30", "class": "tick" }));
  }
  s.appendChild(svgEl("path", { d: "M58,206 C80,198 160,198 182,206", "class": "tick" }));
  s.appendChild(svgEl("circle", { cx: 120, cy: 270, r: 14, "class": "well" }));
  s.appendChild(T(120, 302, "sensor", "lbl sm"));
  host.appendChild(s);
  paintSVG();
}
function arm(i) {
  if (!macroOn) { toast("Macro capture is off", "Turn on “Capture macro keys” first, then click a thumb key to bind it.", null); return; }
  arming = i;
  cells.forEach(function (c, idx) { c.g.classList.toggle("arm", idx === i); });
  toast("Waiting for that button", "Press thumb key " + (i + 1) + " on the mouse now.", null);
}
function paintSVG() {
  Object.keys(parts).forEach(function (k) {
    var i = parseInt(k, 10);
    parts[k].classList.toggle("on", !!st.down[i]);
    parts[k].classList.toggle("seen", !!st.seen[i]);
  });
  cells.forEach(function (c, idx) {
    var lit = !!st.down[c.btn], seen = !!st.seen[c.btn];
    Object.keys(binds).forEach(function (code) {
      if (binds[code] === idx) { if (st.keyDown[code]) lit = true; if (st.keys[code]) seen = true; }
    });
    c.rect.classList.toggle("on", lit);
    c.rect.classList.toggle("seen", seen);
    c.label.classList.toggle("on", lit);
  });
}
$$("#ms-shape button").forEach(function (b) {
  b.onclick = function () {
    $$("#ms-shape button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    shape = b.dataset.s; buildSVG(); note();
  };
});
function note() {
  $("#ms-mmonote").textContent = shape === "mmo"
    ? "Press each button and watch it light up. Thumb-pad keys on MMO mice normally send keyboard macros — turn on macro capture, click a pad key here, then press it on the mouse to bind it."
    : "Press every button on the mouse and watch it light up. Buttons 3 and 4 are the side buttons; the page holds them so the browser does not go back a page.";
}

/* ============================================================
   2. BUTTON CHIPS
   ============================================================ */
var chips = [], grid = $("#ms-grid");
for (var i = 0; i < MAX; i++) {
  var c = el("div", "tb-btnchip");
  c.appendChild(el("div", null, "BTN " + i));
  c.appendChild(el("b", null, NAMES[i] || "—"));
  grid.appendChild(c); chips.push(c);
}

function paint() {
  for (var i = 0; i < MAX; i++) {
    chips[i].classList.toggle("seen", !!st.seen[i]);
    chips[i].classList.toggle("down", !!st.down[i]);
  }
  var seen = Object.keys(st.seen).length;
  $("#ms-btnseen").textContent = seen;
  $("#ms-clicks").textContent = st.clicks;
  $("#ms-macros").textContent = Object.keys(st.keys).length;
  $("#dbl-clicks").textContent = st.clicks;
  var d = $("#dbl-count"); d.textContent = st.dbl;
  d.style.color = st.dbl ? "var(--red)" : "var(--pass)";
  $("#ms-gap").textContent = st.minGap == null ? "—" : st.minGap + " ms";
  var rate = st.clicks ? (st.dbl / st.clicks * 100) : 0;
  var rl = $("#dbl-rate");
  rl.textContent = st.clicks ? rate.toFixed(1) + "%" : "—";
  rl.className = "v " + (!st.clicks ? "" : rate > 2 ? "fail" : rate > 0 ? "warn" : "pass");
  paintSVG(); hist(); score();
}
function hist() {
  var box = $("#ms-hist"); if (!box) return;
  var B = 24, buckets = new Array(B).fill(0);
  st.gaps.forEach(function (g) { buckets[Math.min(B - 1, Math.floor(g / 25))]++; });
  var max = Math.max(1, Math.max.apply(null, buckets));
  box.textContent = "";
  buckets.forEach(function (n, i) {
    var b = el("i");
    b.style.height = (n / max * 100) + "%";
    if (i < 3) b.className = "bad";
    b.title = (i * 25) + "–" + (i * 25 + 25) + " ms: " + n;
    box.appendChild(b);
  });
}
function score() {
  var seen = Object.keys(st.seen).length;
  if (!st.clicks && !seen) {
    verdict($("#ms-verdict"), null, [], "Press every button, spin the wheel both ways, then drag on the trace pad.");
    badge("mouse", ""); return;
  }
  var s = 100, f = [];
  if (st.dbl) {
    s -= Math.min(60, st.dbl * 12);
    f.push({ level: "bad", tag: "double-click", text: st.dbl + " of " + st.clicks + " clicks re-fired inside the threshold. That is the worn micro-switch fault — one press, two clicks." });
  } else if (st.clicks > 8) {
    f.push({ level: "ok", tag: "double-click", text: "No re-fires across " + st.clicks + " clicks. Closest gap " + (st.minGap == null ? "—" : st.minGap + " ms") + "." });
  }
  if (seen < 3) { s -= 15; f.push({ level: "warn", tag: "buttons", text: "Only " + seen + " button" + (seen === 1 ? "" : "s") + " tested so far." }); }
  else f.push({ level: "ok", tag: "buttons", text: seen + " mouse buttons responded" + (Object.keys(st.keys).length ? ", plus " + Object.keys(st.keys).length + " macro keys" : "") + "." });
  if (!st.up || !st.dn) { s -= 10; f.push({ level: "warn", tag: "scroll", text: "Wheel not tested both ways yet (" + st.up + " up, " + st.dn + " down)." }); }
  else f.push({ level: "ok", tag: "scroll", text: "Wheel scrolls both ways (" + st.up + " up, " + st.dn + " down)." });
  if (st.pollPeak > 60) f.push({ level: "ok", tag: "polling", text: "Reports at about " + st.pollPeak + " Hz while moving." });
  verdict($("#ms-verdict"), clamp(s, 0, 100), f);
  badge("mouse", seen + " btn", s >= 90);
}

/* ============================================================
   3. BUTTON INPUT — global, but never on the page's own controls
   ============================================================ */
function onChrome(e) {
  var t = e.target;
  return !!(t && t.closest && t.closest("#rail,.tb-status,.tb-lockbar,#ms-svg,button,select,input,textarea,label,a,.tb-tabs,.tb-seg"));
}
function press(e) {
  var b = e.button;
  if (b >= 1) e.preventDefault();
  st.seen[b] = true; st.down[b] = true;
  if (st.lastUp[b] != null) {
    var gap = e.timeStamp - st.lastUp[b];
    if (gap < 600) st.gaps.push(gap);
    if (st.minGap == null || gap < st.minGap) st.minGap = Math.round(gap);
    var th = parseFloat($("#ms-dcth").value) || 80;
    if (gap < th) {
      st.dbl++;
      logLine("#dbl-log", "RE-FIRE", "button " + b + " fired again " + Math.round(gap) + " ms after release");
    }
  }
  paint();
}
function release(e) {
  var b = e.button;
  if (b >= 1) e.preventDefault();
  st.down[b] = false; st.lastUp[b] = e.timeStamp; st.clicks++;
  paint();
}
document.addEventListener("mousedown", function (e) { if (TB.view() === "mouse" && !onChrome(e)) press(e); }, true);
document.addEventListener("mouseup", function (e) { if (TB.view() === "mouse" && !onChrome(e)) release(e); }, true);
document.addEventListener("auxclick", function (e) { if (TB.view() === "mouse") e.preventDefault(); }, true);
document.addEventListener("contextmenu", function (e) {
  if ((TB.view() === "mouse" || TB.view() === "keyboard") && !onChrome(e)) e.preventDefault();
});

function logLine(sel, tag, txt) {
  var box = $(sel); if (!box) return;
  var d = el("div");
  d.appendChild(el("b", null, tag));
  d.appendChild(document.createTextNode(" " + txt));
  box.insertBefore(d, box.firstChild);
  while (box.childElementCount > 90) box.lastChild.remove();
}

/* ---------- macro key capture: OFF unless armed ---------- */
var macroOn = false;
var NEVER_BLOCK = /^(KeyC|KeyV|KeyX|KeyA|KeyZ|KeyY|KeyR|KeyT|KeyW|KeyN|KeyP|KeyS|KeyF|KeyL)$/;
$("#ms-armmacro").onclick = function () {
  macroOn = !macroOn;
  this.textContent = "Capture macro keys: " + (macroOn ? "on" : "off");
  this.classList.toggle("on", macroOn);
  if (macroOn) toast("Macro capture on", "Extra mouse buttons that send keystrokes will be listed. Copy and paste are still passed through to the browser.", "ok");
  else { arming = -1; cells.forEach(function (c) { c.g.classList.remove("arm"); }); }
};
window.addEventListener("keydown", function (e) {
  if (!macroOn || TB.view() !== "mouse") return;
  var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  var isEditCombo = (e.ctrlKey || e.metaKey) && NEVER_BLOCK.test(e.code);
  if (!isEditCombo && e.key !== "F5" && e.key !== "F12" && e.key !== "Tab") e.preventDefault();
  if (e.repeat) return;
  var code = e.code || ("k" + e.keyCode);
  st.keyDown[code] = true;
  if (!st.keys[code]) {
    st.keys[code] = true;
    logLine("#ms-keylog", "MACRO KEY", code + "  (key “" + (e.key || "") + "”, keyCode " + e.keyCode + ")");
  }
  if (arming >= 0) {
    binds[code] = arming;
    cells.forEach(function (c) { c.g.classList.remove("arm"); });
    toast("Bound", code + " is now thumb key " + (arming + 1) + ".", "ok");
    arming = -1;
  }
  paint();
}, true);
window.addEventListener("keyup", function (e) {
  if (TB.view() !== "mouse") return;
  st.keyDown[e.code || ("k" + e.keyCode)] = false;
  paint();
}, true);

/* ============================================================
   4. CLICK SPEED (CPS)
   ============================================================ */
(function () {
  var pad = $("#cps-pad"), running = false, t0 = 0, n = 0, best = 0, timer = null;
  function reset() {
    running = false; n = 0; if (timer) { clearInterval(timer); timer = null; }
    pad.classList.remove("armed");
    $("#cps-now").textContent = "0.0"; $("#cps-count").textContent = "0";
    $("#cps-avg").textContent = "—"; $("#cps-left").textContent = "—";
    $("#cps-state").textContent = "clicks per second";
  }
  $("#cps-reset").onclick = function () { reset(); best = 0; $("#cps-best").textContent = "—"; };
  pad.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    var dur = (parseFloat($("#cps-dur").value) || 10) * 1000;
    if (!running) {
      running = true; n = 0; t0 = performance.now();
      pad.classList.add("armed");
      $("#cps-state").textContent = "keep clicking";
      timer = setInterval(function () {
        var t = performance.now() - t0;
        var left = Math.max(0, dur - t);
        $("#cps-left").textContent = (left / 1000).toFixed(1) + "s";
        $("#cps-now").textContent = (n / (t / 1000)).toFixed(1);
        if (left <= 0) {
          clearInterval(timer); timer = null; running = false;
          pad.classList.remove("armed");
          var avg = n / (dur / 1000);
          $("#cps-avg").textContent = avg.toFixed(2);
          if (avg > best) { best = avg; $("#cps-best").textContent = best.toFixed(2); }
          $("#cps-state").textContent = "done — click to run again";
          $("#cps-left").textContent = "—";
        }
      }, 50);
    }
    n++; $("#cps-count").textContent = n;
  });
  reset();
})();

/* ============================================================
   5. DOUBLE-CLICK PAD
   ============================================================ */
$("#dbl-reset").onclick = function () {
  st.dbl = 0; st.gaps = []; st.minGap = null; st.clicks = 0; st.lastUp = {};
  $("#dbl-log").textContent = ""; paint();
};

/* ============================================================
   6. SCROLL WHEEL
   ============================================================ */
(function () {
  var pad = $("#scroll-pad");
  function upd() {
    $("#scroll-up").textContent = st.up;
    $("#scroll-dn").textContent = st.dn;
    $("#ms-tilt").textContent = st.tl + " / " + st.tr;
    if (st.deltas.length > 2) {
      var abs = st.deltas.map(Math.abs);
      var mode = {}, bestV = 0, bestN = 0;
      abs.forEach(function (v) { var k = v.toFixed(0); mode[k] = (mode[k] || 0) + 1; if (mode[k] > bestN) { bestN = mode[k]; bestV = v; } });
      $("#scroll-step").textContent = bestV.toFixed(0);
      var same = abs.filter(function (v) { return Math.abs(v - bestV) < 1; }).length;
      var pct = same / abs.length * 100;
      var c = $("#scroll-cons");
      c.textContent = pct.toFixed(0) + "%";
      c.className = "v " + (pct > 92 ? "pass" : pct > 75 ? "warn" : "fail");
    }
    paint();
  }
  function onWheel(e) {
    e.preventDefault();
    if (e.deltaY < 0) st.up++; else if (e.deltaY > 0) st.dn++;
    if (e.deltaX < 0) st.tl++; else if (e.deltaX > 0) st.tr++;
    if (e.deltaY) {
      st.deltas.push(e.deltaY);
      if (st.deltas.length > 120) st.deltas.shift();
      $("#scroll-last").textContent = (e.deltaY > 0 ? "+" : "") + e.deltaY.toFixed(0);
      logLine("#scroll-log", e.deltaY < 0 ? "UP  " : "DOWN", "deltaY " + e.deltaY.toFixed(1) + "   mode " + e.deltaMode);
    }
    upd();
  }
  pad.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("wheel", function (e) {
    if (TB.view() !== "mouse" || pane === "scroll") return;
    if (e.deltaY < 0) st.up++; else if (e.deltaY > 0) st.dn++;
    if (e.deltaX < 0) st.tl++; else if (e.deltaX > 0) st.tr++;
    paint();
  }, { passive: true });
  $("#scroll-reset").onclick = function () {
    st.up = st.dn = st.tl = st.tr = 0; st.deltas = [];
    $("#scroll-log").textContent = ""; $("#scroll-last").textContent = "0";
    $("#scroll-step").textContent = "—"; $("#scroll-cons").textContent = "—";
    upd();
  };
  upd();
})();

/* ============================================================
   7. TRACKING + POLLING RATE
   ============================================================ */
(function () {
  var pad = $("#ms-pad"), cv = $("#ms-canvas"), ctx = cv.getContext("2d");
  var drawing = false, last = null, dpr = Math.min(2, window.devicePixelRatio || 1);
  var times = [], peak = 0;

  function resize() {
    cv.width = Math.max(1, pad.clientWidth * dpr); cv.height = Math.max(1, pad.clientHeight * dpr);
    cv.style.width = "100%"; cv.style.height = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(pad); resize();

  pad.addEventListener("pointerdown", function (e) { drawing = true; last = null; pad.setPointerCapture(e.pointerId); });
  window.addEventListener("pointerup", function () { drawing = false; last = null; });

  function record(ts) { times.push(ts); }
  function drawTo(x, y) {
    if (last) {
      ctx.strokeStyle = "#22E07B"; ctx.lineWidth = 1.8; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(x, y); ctx.stroke();
    }
    last = [x, y];
  }
  function handle(e) {
    var r = pad.getBoundingClientRect();
    var pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (var i = 0; i < pts.length; i++) {
      record(pts[i].timeStamp);
      if (drawing) drawTo(pts[i].clientX - r.left, pts[i].clientY - r.top);
    }
  }
  var hasRaw = "onpointerrawupdate" in window;
  if (hasRaw) pad.addEventListener("pointerrawupdate", handle);
  pad.addEventListener("pointermove", function (e) { if (!hasRaw) handle(e); else if (drawing) { var r = pad.getBoundingClientRect(); drawTo(e.clientX - r.left, e.clientY - r.top); } });

  setInterval(function () {
    var now = performance.now();
    while (times.length && now - times[0] > 1000) times.shift();
    var hz = times.length;
    st.reports = hz;
    $("#ms-reports").textContent = hz;
    if (hz > 40 && hz > peak) {
      peak = hz; st.pollPeak = peak;
      $("#ms-poll").textContent = "";
      $("#ms-poll").appendChild(document.createTextNode(String(peak)));
      var sm = el("small", null, " Hz"); $("#ms-poll").appendChild(sm);
      var snap = [125, 250, 500, 1000, 2000, 4000, 8000].reduce(function (p, c) { return Math.abs(c - peak) < Math.abs(p - peak) ? c : p; });
      $("#ms-pollsnap").textContent = Math.abs(snap - peak) / snap < 0.25 ? snap + " Hz" : "non-standard";
    }
    var pct = clamp(hz / 1000 * 100, 0, 100);
    $("#ms-pollbar").style.width = pct + "%";
    $("#ms-pollbar").className = hz > 400 ? "pass" : hz > 100 ? "warn" : "";
    $("#ms-pollpct").textContent = hz;
  }, 250);

  $("#ms-clear").onclick = function () { ctx.clearRect(0, 0, cv.width, cv.height); last = null; };
})();

/* ============================================================
   8. DPI / CPI
   ============================================================ */
(function () {
  var counts = 0, locked = false;
  var host = $("#ms-pad");
  $("#dpi-start").onclick = function () {
    counts = 0; $("#dpi-counts").textContent = "0";
    if (host.requestPointerLock) host.requestPointerLock();
    toast("Measuring", "Swipe the mouse one straight pass, then press Escape and type the distance.", null);
  };
  document.addEventListener("pointerlockchange", function () {
    locked = document.pointerLockElement === host;
    $("#dpi-start").classList.toggle("on", locked);
    $("#dpi-start").textContent = locked ? "Measuring — press Esc when done" : "Start measuring";
  });
  document.addEventListener("mousemove", function (e) {
    if (!locked) return;
    counts += Math.sqrt(e.movementX * e.movementX + e.movementY * e.movementY);
    $("#dpi-counts").textContent = Math.round(counts);
    calc();
  }, true);
  function calc() {
    var cm = parseFloat($("#ms-cpidist").value) || 0;
    if (cm > 0 && counts > 0) {
      var cpi = Math.round(counts / (cm / 2.54));
      $("#ms-cpi").textContent = cpi;
      var snap = [400, 800, 1000, 1200, 1600, 2000, 2400, 3200, 4000, 6400, 8000, 12000, 16000, 20000, 26000]
        .reduce(function (p, c) { return Math.abs(c - cpi) < Math.abs(p - cpi) ? c : p; });
      $("#dpi-snap").textContent = Math.abs(snap - cpi) / snap < 0.15 ? snap + " CPI" : "non-standard";
    } else { $("#ms-cpi").textContent = "—"; $("#dpi-snap").textContent = "—"; }
  }
  $("#ms-cpidist").addEventListener("input", calc);
  $("#ms-cpireset").onclick = function () { counts = 0; $("#dpi-counts").textContent = "0"; calc(); };
})();

/* ============================================================
   9. REACTION TIME
   ============================================================ */
(function () {
  var pad = $("#rt-pad"), state = "idle", t0 = 0, timer = null, times = [];
  function set(cap, big, sub, colour) {
    $("#rt-cap").textContent = cap; $("#rt-big").textContent = big; $("#rt-sub").textContent = sub;
    pad.style.borderColor = colour || "";
    pad.style.background = colour ? "rgba(34,224,123,.1)" : "";
  }
  function reset() {
    state = "idle"; if (timer) { clearTimeout(timer); timer = null; }
    set("Click to start", "—", "wait for green, then click", "");
  }
  pad.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (state === "idle") {
      state = "waiting";
      set("Wait…", "•", "click the moment it turns green", "");
      timer = setTimeout(function () {
        state = "go"; t0 = performance.now();
        set("NOW", "CLICK", "", "var(--pass)");
      }, 1200 + Math.random() * 2800);
    } else if (state === "waiting") {
      clearTimeout(timer); timer = null; state = "idle";
      set("Too early", "—", "click to try again", "");
    } else if (state === "go") {
      var ms = Math.round(performance.now() - t0);
      times.push(ms); state = "idle";
      set("Click to go again", ms + " ms", "", "");
      $("#rt-last").textContent = "";
      $("#rt-last").appendChild(document.createTextNode(String(ms)));
      $("#rt-last").appendChild(el("small", null, " ms"));
      var best = Math.min.apply(null, times), avg = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
      $("#rt-best").textContent = best + " ms";
      $("#rt-avg").textContent = Math.round(avg) + " ms";
      $("#rt-n").textContent = times.length;
    }
  });
  $("#rt-reset").onclick = function () { times = []; $("#rt-best").textContent = "—"; $("#rt-avg").textContent = "—"; $("#rt-last").textContent = "—"; $("#rt-n").textContent = "0"; reset(); };
  reset();
})();

/* ============================================================
   10. WIRING
   ============================================================ */
TB.tabs("#ms-tabs", "data-mspane", function (name) { pane = name; });
TB.hidMount("#ms-id", "Press this to read the mouse's USB product name. Browsers hide ordinary mice for security; gaming models with their own software usually appear.");

if (TB.isCoarse()) {
  $("#ms-mobile").appendChild(TB.callout("This page is built for a real mouse. On a phone or tablet the click-speed and reaction tests still work with your finger, but buttons, scroll, polling and CPI need a mouse plugged into a computer."));
}

buildSVG(); note(); paint();
})();
