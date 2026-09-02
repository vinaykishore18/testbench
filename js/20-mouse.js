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
  var bare = function () { return Object.create(null); };
  return {
    seen: bare(), down: bare(), clicks: 0, dbl: 0, minGap: null, lastUp: bare(), gaps: [],
    up: 0, dn: 0, tl: 0, tr: 0, deltas: [],
    keys: bare(), keyDown: bare(),
    pollPeak: 0, reports: 0
  };
}
var pane = "buttons";

/* ============================================================
   1. DIAGRAM
   ============================================================ */
var shape = "five", parts = {}, cells = [], binds = Object.create(null), arming = -1;

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
  if (!t || !t.closest) return false;
  /* the page's own controls never count as a mouse test */
  if (t.closest("#rail,.tb-status,.tb-lockbar,.tb-tabs,.tb-seg")) return true;
  if (t.closest("button,select,input,textarea,label,a")) return true;
  /* clicking a thumb-pad key on the diagram binds it — every other click counts,
     including clicks anywhere on the diagram itself */
  if (e.button === 0 && t.closest(".cell")) return true;
  return false;
}
var BITS = [[1, "Left"], [2, "Right"], [4, "Middle"], [8, "Back"], [16, "Forward"]];
function heldNames(mask) {
  var out = [];
  BITS.forEach(function (b) { if (mask & b[0]) out.push(b[1]); });
  return out.length ? out.join(" + ") : "none";
}
function showHeld(e) {
  var h = $("#ms-heldnow"); if (h) h.textContent = heldNames(e.buttons || 0);
}
function press(e) {
  var b = e.button;
  if (b >= 1) e.preventDefault();
  showHeld(e);
  var le = $("#ms-lastev"); if (le) le.textContent = "down " + b;
  raw("mousedown", "button " + b + "  buttons " + e.buttons + "  (" + (NAMES[b] || "extra " + b) + ")");
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
  showHeld(e);
  var le2 = $("#ms-lastev"); if (le2) le2.textContent = "up " + b;
  raw("mouseup", "button " + b + "  buttons " + e.buttons);
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
   3b. RAW EVENT MONITOR — nothing hides from this
   ============================================================ */
var rawOn = true;
function raw(type, detail) {
  if (!rawOn) return;
  var box = $("#raw-log"); if (!box) return;
  if (/^key/.test(type) && !$("#raw-keys").checked) return;
  if (/move|rawupdate/.test(type) && !$("#raw-move").checked) return;
  var d = el("div");
  d.appendChild(el("b", null, TB.stamp() + "  " + type));
  d.appendChild(document.createTextNode("   " + detail));
  box.insertBefore(d, box.firstChild);
  while (box.childElementCount > 300) box.lastChild.remove();
}
$("#raw-clear").onclick = function () { $("#raw-log").textContent = ""; };
$("#raw-pause").onclick = function () {
  rawOn = !rawOn;
  this.textContent = rawOn ? "Recording" : "Paused";
  this.classList.toggle("on", rawOn);
};
document.addEventListener("wheel", function (e) {
  if (TB.view() === "mouse") raw("wheel", "deltaY " + e.deltaY.toFixed(1) + "  deltaX " + e.deltaX.toFixed(1) + "  mode " + e.deltaMode);
}, { passive: true });
document.addEventListener("auxclick", function (e) { if (TB.view() === "mouse") raw("auxclick", "button " + e.button); }, true);
document.addEventListener("contextmenu", function (e) { if (TB.view() === "mouse") raw("contextmenu", "right button"); }, true);
window.addEventListener("keydown", function (e) {
  if (TB.view() !== "mouse" || e.repeat) return;
  raw("keydown", "code " + (e.code || "?") + "  key “" + (e.key || "") + "”  keyCode " + e.keyCode +
      (e.altKey ? "  ALT" : "") + (e.ctrlKey ? "  CTRL" : "") + (e.shiftKey ? "  SHIFT" : ""));
}, true);

/* Some mice never send button 3 and 4. Their driver sends a browser Back or
   Forward command instead, which the browser acts on before the page sees a
   mouse event at all. These two catch that: a history buffer that notices the
   navigation and puts the page back, and the Alt+Arrow shortcut some drivers
   send instead. Either way the side button registers and is marked tested. */
function registerVirtual(btn, why) {
  st.seen[btn] = true; st.down[btn] = true;
  st.clicks++;
  var le = $("#ms-lastev"); if (le) le.textContent = why;
  raw("NAVIGATION", why + "  —  counted as button " + btn + " (side button via driver)");
  paint();
  setTimeout(function () { st.down[btn] = false; paint(); }, 160);
}
var navArmed = false, navBusy = false, navOK = true;
function armNav() {
  if (navArmed || !navOK) return;
  try {
    history.replaceState({ tb: 0 }, "");
    history.pushState({ tb: 1 }, "");
    history.pushState({ tb: 2 }, "");
    navBusy = true;
    history.go(-1);
    setTimeout(function () { navBusy = false; }, 120);
    navArmed = true;
  } catch (err) { navOK = false; }
}
function disarmNav() { navArmed = false; }
window.addEventListener("popstate", function (e) {
  if (!navArmed || navBusy) return;
  var i = (e.state && typeof e.state.tb === "number") ? e.state.tb : 1;
  if (i < 1) registerVirtual(3, "browser BACK");
  else if (i > 1) registerVirtual(4, "browser FORWARD");
  else return;
  navBusy = true;
  try { history.go(1 - i); } catch (err) {}
  setTimeout(function () { navBusy = false; }, 120);
});
window.addEventListener("keydown", function (e) {
  if (TB.view() !== "mouse" || e.repeat || !e.altKey) return;
  if (e.code === "ArrowLeft") { e.preventDefault(); registerVirtual(3, "Alt+Left from driver"); }
  if (e.code === "ArrowRight") { e.preventDefault(); registerVirtual(4, "Alt+Right from driver"); }
}, true);
$("#ms-navtrap").onclick = function () {
  if (navArmed) { disarmNav(); this.textContent = "Hold back/forward: off"; this.classList.remove("on"); }
  else { armNav(); this.textContent = navArmed ? "Hold back/forward: on" : "Not supported here"; this.classList.toggle("on", navArmed); }
};
TB.onEnter("mouse", armNav);
TB.onLeave("mouse", disarmNav);

/* ============================================================
   3c. DRAG AND HOLD
   ============================================================ */
(function () {
  var pad = $("#drag-pad"), zones = [], hitCount = 0, dragging = false, t0 = 0;
  var drops = 0, runs = 0, best = 0;
  function build() {
    pad.textContent = "";
    zones = [];
    for (var i = 0; i < 6; i++) {
      var z = el("div");
      z.style.cssText = "position:absolute;width:16%;height:26%;border:2px dashed var(--line);border-radius:8px;" +
        "display:grid;place-items:center;font-family:var(--f-mono);font-size:13px;color:var(--ink-3);";
      z.style.left = (4 + (i % 3) * 32) + "%";
      z.style.top = (i < 3 ? 14 : 58) + "%";
      z.textContent = String(i + 1);
      pad.appendChild(z);
      zones.push({ node: z, hit: false });
    }
    hitCount = 0; upd();
  }
  function upd() {
    $("#drag-hit").textContent = "";
    $("#drag-hit").appendChild(document.createTextNode(String(hitCount)));
    $("#drag-hit").appendChild(el("small", null, " / 6"));
    $("#drag-hold").textContent = best ? Math.round(best) + " ms" : "—";
    var dd = $("#drag-drop"); dd.textContent = drops; dd.className = "v" + (drops ? " fail" : "");
    $("#drag-done").textContent = runs;
  }
  function reset(soft) {
    zones.forEach(function (z) {
      z.hit = false;
      z.node.style.borderColor = "var(--line)";
      z.node.style.background = "";
      z.node.style.color = "var(--ink-3)";
    });
    hitCount = 0;
    if (!soft) { drops = 0; runs = 0; best = 0; $("#drag-log").textContent = ""; }
    upd();
  }
  pad.addEventListener("pointerdown", function (e) {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    dragging = true; t0 = performance.now(); reset(true);
    logD("START", "button held down");
  });
  pad.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var r = pad.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    zones.forEach(function (z, i) {
      if (z.hit) return;
      var b = z.node.getBoundingClientRect();
      if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) {
        z.hit = true; hitCount++;
        z.node.style.borderColor = "var(--pass)";
        z.node.style.background = "rgba(34,224,123,.16)";
        z.node.style.color = "var(--pass)";
        upd();
      }
    });
  });
  function end(e) {
    if (!dragging) return;
    dragging = false;
    var held = performance.now() - t0;
    if (held > best) best = held;
    if (hitCount >= 6) { runs++; logD("PASS", "all six in one hold, " + Math.round(held) + " ms"); }
    else { drops++; logD("DROPPED", "let go after " + hitCount + " of 6, " + Math.round(held) + " ms"); }
    upd();
  }
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
  function logD(tag, txt) { logLine("#drag-log", tag, txt); }
  $("#drag-reset").onclick = function () { reset(false); };
  build();
})();

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
  document.addEventListener("mousemove", function (e) { if (TB.view() === "mouse") showHeld(e); }, true);
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
