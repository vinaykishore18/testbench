/* Testbench — mouse: live diagram, up to 20 buttons, double-click faults, polling rate, sensor trace. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, svgEl = TB.svgEl, clamp = TB.clamp, verdict = TB.verdict, badge = TB.badge, toast = TB.toast;

var NAMES = ["Left", "Middle", "Right", "Back", "Forward"];
var MAX = 20;
var st = fresh();
function fresh() {
  return { seen: {}, down: {}, clicks: 0, dbl: 0, minGap: null, lastUp: {}, up: 0, dn: 0, tl: 0, tr: 0,
           keys: {}, keyDown: {}, gaps: [], perBtn: {} };
}

/* ---------------- diagram ---------------- */
var shape = "five", parts = {}, cells = [], binds = {}, arming = -1;

function P(d, cls) { return svgEl("path", { d: d, "class": cls }); }
function R(x, y, w, h, r, cls) { return svgEl("rect", { x: x, y: y, width: w, height: h, rx: r, "class": cls }); }
function T(x, y, txt, cls) { var t = svgEl("text", { x: x, y: y, "class": cls || "lbl" }); t.textContent = txt; return t; }

function buildSVG() {
  var host = $("#ms-svg"); host.innerHTML = "";
  parts = {}; cells = [];
  var mmo = shape === "mmo";
  var s = svgEl("svg", { viewBox: mmo ? "-84 0 330 352" : "0 0 240 352", "class": "tb-dev", role: "img", "aria-label": "Mouse diagram" });
  s.style.maxWidth = mmo ? "460px" : "300px";

  if (mmo) {
    s.appendChild(R(-80, 110, 72, 96, 9, "plate"));
    for (var i = 0; i < 12; i++) {
      var col = i % 3, row = Math.floor(i / 3);
      var g = svgEl("g", { "class": "cell" });
      var rect = R(-74 + col * 21, 116 + row * 22, 18, 18, 4, "btn");
      g.appendChild(rect);
      g.appendChild(T(-74 + col * 21 + 9, 116 + row * 22 + 9, String(i + 1), "lbl sm"));
      (function (idx, group, rr) {
        group.addEventListener("click", function () { arm(idx); });
      })(i, g, rect);
      s.appendChild(g);
      cells.push({ g: g, rect: rect, label: g.querySelector("text"), btn: 5 + i });
    }
    var cap = T(-44, 216, "thumb pad", "lbl sm"); s.appendChild(cap);
  }

  s.appendChild(P("M120,12 C74,12 50,52 46,112 C43,152 40,240 52,284 C62,322 92,334 120,334 C148,334 178,322 188,284 C200,240 197,152 194,112 C190,52 166,12 120,12 Z", "shell"));
  parts[0] = P("M118,15 C78,17 55,55 51,114 C49,133 48,147 48,154 L118,154 Z", "btn");
  parts[2] = P("M122,15 C162,17 185,55 189,114 C191,133 192,147 192,154 L122,154 Z", "btn");
  s.appendChild(parts[0]); s.appendChild(parts[2]);
  parts[1] = R(111, 54, 18, 48, 9, "btn"); s.appendChild(parts[1]);
  s.appendChild(T(84, 92, "L", "lbl")); s.appendChild(T(156, 92, "R", "lbl"));
  s.appendChild(T(120, 122, "wheel", "lbl sm"));

  if (shape !== "std") {
    parts[4] = R(41, 112, 17, 28, 6, "btn"); s.appendChild(parts[4]);
    parts[3] = R(41, 144, 17, 28, 6, "btn"); s.appendChild(parts[3]);
    s.appendChild(T(74, 126, "fwd", "lbl sm"));
    s.appendChild(T(76, 158, "back", "lbl sm"));
  }
  s.appendChild(svgEl("path", { d: "M60,205 C80,198 160,198 180,205", "class": "tick", fill: "none" }));
  s.appendChild(T(120, 300, "sensor", "lbl sm"));
  s.appendChild(svgEl("circle", { cx: 120, cy: 268, r: 13, "class": "well" }));
  host.appendChild(s);
  paintSVG();
}
function arm(i) {
  arming = i;
  cells.forEach(function (c, idx) { c.g.classList.toggle("arm", idx === i); });
  toast("Waiting for that button", "Press thumb key " + (i + 1) + " on the mouse now. If it sends a keyboard macro it will be bound to this key.", null);
}
function paintSVG() {
  Object.keys(parts).forEach(function (k) {
    var i = parseInt(k, 10);
    parts[k].classList.toggle("on", !!st.down[i]);
    parts[k].classList.toggle("seen", !!st.seen[i]);
  });
  cells.forEach(function (c, idx) {
    var lit = !!st.down[c.btn];
    var seen = !!st.seen[c.btn];
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
    shape = b.dataset.s; buildSVG();
    $("#ms-mmonote").textContent = shape === "mmo"
      ? "Press each button and watch it light up. Thumb-pad keys on MMO mice normally send keyboard macros rather than mouse buttons — click a pad key on the diagram, then press it on the mouse, and it binds."
      : "Press each button on the mouse and watch it light up on the diagram. Anything the mouse sends as a keyboard macro is captured in the list beside this.";
  };
});

/* ---------------- button chips ---------------- */
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
  $("#ms-btnseen").textContent = Object.keys(st.seen).length;
  $("#ms-clicks").textContent = st.clicks;
  var d = $("#ms-dbl"); d.textContent = st.dbl; d.className = "v" + (st.dbl ? " fail" : "");
  $("#ms-gap").textContent = st.minGap == null ? "—" : st.minGap + " ms";
  $("#ms-scroll").textContent = st.up + " / " + st.dn;
  $("#ms-tilt").textContent = st.tl + " / " + st.tr;
  paintSVG(); hist(); score();
}
function hist() {
  var box = $("#ms-hist"); if (!box) return;
  var B = 24, buckets = new Array(B).fill(0);
  st.gaps.forEach(function (g) { var b = Math.min(B - 1, Math.floor(g / 25)); buckets[b]++; });
  var max = Math.max(1, Math.max.apply(null, buckets));
  box.innerHTML = "";
  buckets.forEach(function (n, i) {
    var b = el("i"); b.style.height = (n / max * 100) + "%";
    if (i < 3) b.className = "bad";
    b.title = (i * 25) + "–" + (i * 25 + 25) + " ms: " + n;
    box.appendChild(b);
  });
}
function score() {
  if (!st.clicks && !Object.keys(st.seen).length) {
    verdict($("#ms-verdict"), null, [], "Click every button on the mouse, spin the wheel both ways, then drag on the pad.");
    badge("mouse", ""); return;
  }
  var s = 100, f = [];
  if (st.dbl) {
    var rate = st.dbl / Math.max(1, st.clicks) * 100;
    s -= Math.min(60, st.dbl * 12);
    f.push({ level: "bad", tag: "double-click", text: st.dbl + " of " + st.clicks + " clicks (" + rate.toFixed(0) + "%) re-fired inside the threshold. That is the worn micro-switch fault — one press, two clicks." });
  } else if (st.clicks > 8) {
    f.push({ level: "ok", tag: "double-click", text: "No re-fires across " + st.clicks + " clicks. Closest gap " + (st.minGap == null ? "—" : st.minGap + " ms") + "." });
  }
  var seen = Object.keys(st.seen).length;
  if (seen < 3) { s -= 15; f.push({ level: "warn", tag: "buttons", text: "Only " + seen + " button" + (seen === 1 ? "" : "s") + " tested so far." }); }
  else f.push({ level: "ok", tag: "buttons", text: seen + " mouse buttons responded" + (Object.keys(st.keys).length ? ", plus " + Object.keys(st.keys).length + " macro keys" : "") + "." });
  if (!st.up || !st.dn) { s -= 10; f.push({ level: "warn", tag: "scroll", text: "Wheel not tested both ways yet (" + st.up + " up, " + st.dn + " down)." }); }
  else f.push({ level: "ok", tag: "scroll", text: "Wheel scrolls both ways (" + st.up + " up, " + st.dn + " down)." });
  verdict($("#ms-verdict"), clamp(s, 0, 100), f);
  badge("mouse", seen + " btn", s >= 90);
}

/* ---------------- input ---------------- */
function inChrome(e) { return !!(e.target && e.target.closest && e.target.closest("#rail,.tb-status,.tb-lockbar,#ms-svg,button,select,input,label,a")); }
function press(e) {
  var b = e.button;
  if (b >= 1) e.preventDefault();
  st.seen[b] = true; st.down[b] = true;
  if (st.lastUp[b] != null) {
    var gap = e.timeStamp - st.lastUp[b];
    st.gaps.push(gap);
    if (st.minGap == null || gap < st.minGap) st.minGap = Math.round(gap);
    var th = parseFloat($("#ms-dcth").value) || 80;
    if (gap < th) { st.dbl++; logKey("BOUNCE", "button " + b + " fired again " + Math.round(gap) + " ms after release"); }
  }
  paint();
}
function release(e) {
  var b = e.button;
  if (b >= 1) e.preventDefault();
  st.down[b] = false; st.lastUp[b] = e.timeStamp; st.clicks++;
  st.perBtn[b] = (st.perBtn[b] || 0) + 1;
  paint();
}
document.addEventListener("mousedown", function (e) { if (TB.view() === "mouse" && !inChrome(e)) press(e); }, true);
document.addEventListener("mouseup", function (e) { if (TB.view() === "mouse" && !inChrome(e)) release(e); }, true);
document.addEventListener("auxclick", function (e) { if (TB.view() === "mouse") e.preventDefault(); }, true);
document.addEventListener("contextmenu", function (e) { if (TB.view() === "mouse" || TB.view() === "keyboard") e.preventDefault(); });
document.addEventListener("wheel", function (e) {
  if (TB.view() !== "mouse") return;
  if (e.deltaY < 0) st.up++; else if (e.deltaY > 0) st.dn++;
  if (e.deltaX < 0) st.tl++; else if (e.deltaX > 0) st.tr++;
  paint();
}, { passive: true });

function logKey(tag, txt) {
  var box = $("#ms-keylog"), d = el("div");
  d.appendChild(el("b", null, tag)); d.appendChild(document.createTextNode(" " + txt));
  box.insertBefore(d, box.firstChild);
  while (box.childElementCount > 80) box.lastChild.remove();
}
window.addEventListener("keydown", function (e) {
  if (TB.view() !== "mouse") return;
  var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "SELECT")) return;
  e.preventDefault();
  if (e.repeat) return;
  var code = e.code || ("k" + e.keyCode);
  st.keyDown[code] = true;
  if (!st.keys[code]) { st.keys[code] = true; logKey("MACRO KEY", code + "  (key “" + (e.key || "") + "”, keyCode " + e.keyCode + ")"); }
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
  var code = e.code || ("k" + e.keyCode);
  st.keyDown[code] = false; paint();
}, true);

/* ---------------- sensor pad, polling, CPI ---------------- */
var pad = $("#ms-pad"), cv = $("#ms-canvas"), ctx = cv.getContext("2d");
var times = [], drawing = false, last = null, dpr = Math.min(2, window.devicePixelRatio || 1);
function resize() { cv.width = pad.clientWidth * dpr; cv.height = pad.clientHeight * dpr; cv.style.width = "100%"; cv.style.height = "100%"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
new ResizeObserver(resize).observe(pad); resize();
pad.addEventListener("pointerdown", function (e) { drawing = true; last = null; pad.setPointerCapture(e.pointerId); });
window.addEventListener("pointerup", function () { drawing = false; last = null; });
pad.addEventListener("pointermove", function (e) {
  var r = pad.getBoundingClientRect();
  var pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  pts.forEach(function (p) {
    times.push(p.timeStamp); if (times.length > 90) times.shift();
    if (drawing) {
      var px = p.clientX - r.left, py = p.clientY - r.top;
      if (last) { ctx.strokeStyle = "#35C3D4"; ctx.lineWidth = 1.6; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(px, py); ctx.stroke(); }
      last = [px, py];
    }
  });
  if (times.length > 25) {
    var gaps = []; for (var i = 1; i < times.length; i++) { var g = times[i] - times[i - 1]; if (g > 0.05 && g < 60) gaps.push(g); }
    if (gaps.length > 10) {
      gaps.sort(function (a, b) { return a - b; });
      var med = gaps[Math.floor(gaps.length / 2)], hz = Math.round(1000 / med);
      var snap = [125, 250, 500, 1000, 2000, 4000, 8000].reduce(function (p, c) { return Math.abs(c - hz) < Math.abs(p - hz) ? c : p; });
      var near = Math.abs(snap - hz) / snap < 0.22;
      $("#ms-poll").innerHTML = hz + ' <small>Hz' + (near ? " ≈" + snap : "") + "</small>";
    }
  }
});
$("#ms-clear").onclick = function () { ctx.clearRect(0, 0, cv.width, cv.height); };
$("#ms-reset").onclick = function () {
  st = fresh(); binds = {}; arming = -1;
  $("#ms-keylog").innerHTML = ""; ctx.clearRect(0, 0, cv.width, cv.height);
  $("#ms-poll").textContent = "—"; buildSVG(); paint();
};
$("#ms-lock").onclick = function () {
  if (document.pointerLockElement === pad) document.exitPointerLock();
  else if (pad.requestPointerLock) pad.requestPointerLock();
};
document.addEventListener("pointerlockchange", function () {
  var on = document.pointerLockElement === pad;
  $("#ms-lock").classList.toggle("on", on);
  $("#ms-lock").textContent = on ? "Raw mode on — press Esc" : "Raw mode (pointer lock)";
});
var rawX = 0, rawY = 0, counts = 0;
document.addEventListener("mousemove", function (e) {
  if (document.pointerLockElement !== pad) return;
  counts += Math.abs(e.movementX);
  rawX = clamp(rawX + e.movementX, 0, pad.clientWidth); rawY = clamp(rawY + e.movementY, 0, pad.clientHeight);
  ctx.fillStyle = "rgba(63,208,126,.9)"; ctx.fillRect(rawX - 1, rawY - 1, 2, 2);
  var cpiOut = $("#ms-cpi");
  if (cpiOut) {
    var cm = parseFloat($("#ms-cpidist").value) || 0;
    cpiOut.textContent = cm > 0 ? Math.round(counts / (cm / 2.54)) + " cpi" : Math.round(counts) + " counts";
  }
}, true);
var cpiReset = $("#ms-cpireset"); if (cpiReset) cpiReset.onclick = function () { counts = 0; rawX = 0; rawY = 0; };

buildSVG();
paint();
})();
