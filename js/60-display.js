/* Testbench — monitors: automatic pattern run, dead pixels, bleed, banding, ghosting, refresh rate. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp, toast = TB.toast;

var stage = $("#fullstage"), hud = null, cv = null, ctx = null, anim = null;
var seq = [], seqI = 0, mode = null, auto = false, dwell = 6000, paused = false, hudEls = {};
var elapsed = 0, lastT = 0, checker = null;
var hadFs = false, watchdog = null, cursorTimer = null;

var SOLIDS = [["#000000", "Black"], ["#FFFFFF", "White"], ["#FF0000", "Red"], ["#00FF00", "Green"], ["#0000FF", "Blue"],
              ["#00FFFF", "Cyan"], ["#FF00FF", "Magenta"], ["#FFFF00", "Yellow"], ["#808080", "50% grey"], ["#C0C0C0", "75% grey"], ["#404040", "25% grey"]];
var PATTERNS = [
  ["gradient", "Grey ramp — banding"], ["nearblack", "Near black — bleed & crush"], ["nearwhite", "Near white — clipping"],
  ["grid", "1 px grid — sharpness"], ["geometry", "Geometry & overscan"], ["colorbars", "Colour bars"],
  ["uniformity", "Uniformity 50% grey"], ["inversion", "Inversion — pixel walk"], ["gamma", "Gamma 2.2 match"],
  ["ghosting", "Motion — ghosting"]
];

/* swatch buttons */
var sw = $("#mn-swatches");
SOLIDS.forEach(function (s, i) {
  var b = el("button", "tb-swatch", s[1]);
  b.style.background = s[0];
  b.style.color = (s[1] === "White" || s[1] === "75% grey" || s[1] === "Yellow" || s[1] === "Cyan" || s[1] === "Green") ? "rgba(0,0,0,.72)" : "rgba(255,255,255,.75)";
  b.onclick = function () { seq = SOLIDS.map(function (x) { return { kind: "solid", color: x[0], name: x[1] }; }); seqI = i; auto = false; open(); };
  sw.appendChild(b);
});
/* single pattern buttons */
$$("[data-pat]").forEach(function (b) {
  b.onclick = function () { seq = [{ kind: b.dataset.pat, name: b.textContent }]; seqI = 0; auto = false; open(); };
});
/* automatic runs */
function solidSteps() { return SOLIDS.map(function (x) { return { kind: "solid", color: x[0], name: x[1] }; }); }
function patSteps(list) { return list.map(function (p) { return { kind: p[0], name: p[1] }; }); }
$("#mn-runfull").onclick = function () {
  seq = solidSteps().concat(patSteps(PATTERNS));
  seqI = 0; auto = true; dwell = (parseFloat($("#mn-dwell").value) || 6) * 1000; open();
};
$("#mn-runquick").onclick = function () {
  var quick = SOLIDS.slice(0, 5).map(function (x) { return { kind: "solid", color: x[0], name: x[1] }; })
    .concat(patSteps([PATTERNS[0], PATTERNS[1], PATTERNS[9]]));
  seq = quick; seqI = 0; auto = true; dwell = (parseFloat($("#mn-dwell").value) || 6) * 1000; open();
};

function open() {
  close(true);                       /* never stack two overlays */
  stage.textContent = "";
  cv = document.createElement("canvas"); cv.className = "fill"; stage.appendChild(cv); ctx = cv.getContext("2d");
  hud = el("div", "tb-fullhud"); stage.appendChild(hud);
  stage.classList.add("on");
  paused = false; hadFs = false;
  if (stage.requestFullscreen) {
    stage.requestFullscreen().then(function () { hadFs = true; }).catch(function () {});
  }
  resize(); render();
  document.addEventListener("keydown", keys, true);
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("visibilitychange", onHidden);
  stage.addEventListener("click", onClick);
  stage.addEventListener("mousemove", showCursor);
  window.addEventListener("resize", resize);
  /* Belt and braces: if full screen ends by any route the browser does not tell
     us about, this notices within a second and takes the overlay down. Being
     stranded behind a full-screen layer with no way out is worse than any
     missed test. */
  watchdog = setInterval(function () {
    if (!stage.classList.contains("on")) return;
    if (hadFs && !document.fullscreenElement) close();
  }, 700);
  if (auto) requestAnimationFrame(step);
}
/* Pressing Escape inside full screen is swallowed by the browser to exit full
   screen — the page never sees the key. That left the overlay up with the
   taskbar showing behind it. This is the fix. */
function onFsChange() {
  if (document.fullscreenElement) { hadFs = true; return; }
  if (hadFs && stage.classList.contains("on")) close();
}
function onHidden() { if (document.hidden && stage.classList.contains("on")) close(); }
function showCursor() {
  stage.classList.add("showcursor");
  if (cursorTimer) clearTimeout(cursorTimer);
  cursorTimer = setTimeout(function () { stage.classList.remove("showcursor"); }, 2200);
}
function close(quiet) {
  stage.classList.remove("on", "showcursor");
  stage.textContent = "";
  if (anim) { cancelAnimationFrame(anim); anim = null; }
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  if (cursorTimer) { clearTimeout(cursorTimer); cursorTimer = null; }
  auto = false; mode = null; cv = null; ctx = null; hud = null; hudEls = {};
  document.removeEventListener("keydown", keys, true);
  document.removeEventListener("fullscreenchange", onFsChange);
  document.removeEventListener("visibilitychange", onHidden);
  stage.removeEventListener("click", onClick);
  stage.removeEventListener("mousemove", showCursor);
  window.removeEventListener("resize", resize);
  if (!quiet && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
}
function onClick(e) { if (e.target.closest && e.target.closest(".tb-fullhud")) return; next(); }
function keys(e) {
  if (!stage.classList.contains("on")) return;
  e.preventDefault(); e.stopPropagation();
  var k = e.key;
  if (k === "Escape") close();
  else if (k === "ArrowRight" || k === "Enter") next();
  else if (k === "ArrowLeft") { seqI = (seqI - 1 + seq.length) % seq.length; render(); }
  else if (k === " ") { paused = !paused; updateHud(); }
  else if (k && k.toLowerCase() === "h") { hud.style.display = hud.style.display === "none" ? "flex" : "none"; }
}
function next() {
  if (auto && seqI >= seq.length - 1) { close(); toast("Screen test finished", "All " + seq.length + " steps shown.", "ok"); return; }
  seqI = (seqI + 1) % seq.length; render();
}
function step() {
  if (!stage.classList.contains("on") || !auto || !ctx) return;
  requestAnimationFrame(step);
  var now = performance.now();
  if (!paused) elapsed += now - lastT;
  lastT = now;
  var p = clamp(elapsed / dwell, 0, 1);
  if (hudEls.prog) hudEls.prog.style.width = (p * 100) + "%";
  if (p >= 1) next();
}
function resize() {
  if (!cv || !ctx) return;
  var d = window.devicePixelRatio || 1;
  cv.width = Math.round(window.innerWidth * d); cv.height = Math.round(window.innerHeight * d);
  if (mode) render();
}
function updateHud() {
  if (!hud) return;
  hud.textContent = "";
  var s = seq[seqI];
  var x = el("button", "exit", "\u2715 Exit");
  x.onclick = function (ev) { ev.stopPropagation(); close(); };
  hud.appendChild(x);
  hud.appendChild(el("b", null, s.name));
  hud.appendChild(el("span", null, (seqI + 1) + " of " + seq.length));
  if (auto) {
    var p = el("span", "prog"), i = el("i"); p.appendChild(i); hud.appendChild(p); hudEls.prog = i;
    if (paused) hud.appendChild(el("span", "paused", "PAUSED"));
  }
  hud.appendChild(el("span", null, auto ? "Space pauses · → skip · ← back · H hides · Esc stops" : "Click or → next · ← back · H hides · Esc exits"));
}
function render() {
  if (!ctx) return;
  if (anim) { cancelAnimationFrame(anim); anim = null; }
  var s = seq[seqI]; mode = s.kind;
  var W = cv.width, H = cv.height;
  elapsed = 0; lastT = performance.now();
  updateHud();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (s.kind === "solid") { ctx.fillStyle = s.color; ctx.fillRect(0, 0, W, H); return; }
  if (s.kind === "uniformity") { ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, W, H); return; }
  if (s.kind === "gradient") {
    var g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, "#000"); g.addColorStop(1, "#fff");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.55);
    for (var i = 0; i < 32; i++) { var v = Math.round(i / 31 * 255); ctx.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; ctx.fillRect(i * W / 32, H * 0.58, W / 32 + 1, H * 0.42); }
    return;
  }
  if (s.kind === "nearblack" || s.kind === "nearwhite") {
    var base = s.kind === "nearblack" ? 0 : 255, dir = s.kind === "nearblack" ? 1 : -1;
    ctx.fillStyle = s.kind === "nearblack" ? "#000" : "#fff"; ctx.fillRect(0, 0, W, H);
    var steps = 6, bw = W / steps;
    for (var k = 0; k < steps; k++) {
      var v2 = base + dir * (k * 2 + 2);
      ctx.fillStyle = "rgb(" + v2 + "," + v2 + "," + v2 + ")";
      ctx.fillRect(k * bw + bw * 0.15, H * 0.3, bw * 0.7, H * 0.4);
      ctx.fillStyle = s.kind === "nearblack" ? "#555" : "#aaa";
      ctx.font = (H * 0.022) + "px monospace"; ctx.textAlign = "center";
      ctx.fillText(String(v2), k * bw + bw * 0.5, H * 0.76);
    }
    return;
  }
  if (s.kind === "grid") {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    for (var x = 0; x < W; x += 2) ctx.fillRect(x, 0, 1, H);
    ctx.fillStyle = "rgba(255,255,255,.25)";
    for (var y = 0; y < H; y += 100) ctx.fillRect(0, y, W, 1);
    return;
  }
  if (s.kind === "geometry") {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, W / 960);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, W - ctx.lineWidth * 2, H - ctx.lineWidth * 2);
    ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
    for (var gx = 0; gx <= W; gx += W / 16) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 0; gy <= H; gy += H / 9) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    ctx.strokeStyle = "#3FD07E"; ctx.lineWidth = Math.max(2, W / 1200);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) / 2 - ctx.lineWidth, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = (H * 0.03) + "px monospace"; ctx.textAlign = "center";
    ctx.fillText(window.innerWidth + " × " + window.innerHeight + " CSS px  ·  " + W + " × " + H + " device px", W / 2, H * 0.42);
    return;
  }
  if (s.kind === "colorbars") {
    var cols = ["#FFFFFF", "#FFFF00", "#00FFFF", "#00FF00", "#FF00FF", "#FF0000", "#0000FF", "#000000"];
    cols.forEach(function (c, i2) { ctx.fillStyle = c; ctx.fillRect(i2 * W / 8, 0, W / 8 + 1, H * 0.72); });
    for (var j = 0; j < 16; j++) { var v3 = Math.round(j / 15 * 255); ctx.fillStyle = "rgb(" + v3 + "," + v3 + "," + v3 + ")"; ctx.fillRect(j * W / 16, H * 0.72, W / 16 + 1, H * 0.28); }
    return;
  }
  if (s.kind === "gamma") {
    ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, W, H);
    if (!checker) {
      var oc = document.createElement("canvas"); oc.width = 2; oc.height = 2;
      var octx = oc.getContext("2d");
      octx.fillStyle = "#fff"; octx.fillRect(0, 0, 1, 1); octx.fillRect(1, 1, 1, 1);
      octx.fillStyle = "#000"; octx.fillRect(1, 0, 1, 1); octx.fillRect(0, 1, 1, 1);
      checker = ctx.createPattern(oc, "repeat");
    }
    var pw = W / 5, ph = H * 0.5, top = H * 0.25;
    [[0, 128], [1, 176], [2, 186], [3, 196], [4, 206]].forEach(function (p) {
      var x0 = p[0] * pw;
      ctx.fillStyle = checker;
      ctx.fillRect(x0, top, pw, ph);
      ctx.fillStyle = "rgb(" + p[1] + "," + p[1] + "," + p[1] + ")";
      ctx.fillRect(x0 + pw * 0.25, top + ph * 0.25, pw * 0.5, ph * 0.5);
      ctx.fillStyle = "#000"; ctx.font = (H * 0.02) + "px monospace"; ctx.textAlign = "center";
      ctx.fillText(String(p[1]), x0 + pw / 2, top + ph + H * 0.05);
    });
    ctx.fillStyle = "#000"; ctx.font = (H * 0.022) + "px monospace"; ctx.textAlign = "center";
    ctx.fillText("Step back from the screen — the patch that disappears into its checkerboard is this monitor's gamma point (186 ≈ 2.2)", W / 2, H * 0.14);
    return;
  }
  if (s.kind === "inversion") {
    /* Deliberately static. The flicker that reveals an inversion fault is produced
       by the panel itself driving alternate lines, not by the page animating them.
       Animating this at screen refresh made a full-screen strobe, which is both the
       wrong test and a seizure risk. */
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    for (var yy = 0; yy < H; yy += 2) ctx.fillRect(0, yy, W, 1);
    ctx.fillStyle = "rgba(255,45,70,.95)";
    ctx.font = (H * 0.024) + "px monospace"; ctx.textAlign = "center";
    ctx.fillText("This pattern is still. Step back — if you see it shimmer, crawl or flicker, that is a pixel inversion fault in the panel.", W / 2, H * 0.06);
    return;
  }
  if (s.kind === "ghosting") {
    var t0 = performance.now();
    (function frame() {
      if (!ctx || !stage.classList.contains("on")) { anim = null; return; }
      anim = requestAnimationFrame(frame);
      var t = (performance.now() - t0) / 1000;
      ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H);
      [[0.18, 300], [0.42, 600], [0.66, 1000], [0.88, 1600]].forEach(function (row) {
        var speed = row[1] * (W / 1920);
        var x = ((t * speed) % (W + 240)) - 120;
        ctx.fillStyle = "#fff"; ctx.fillRect(x, H * row[0], W * 0.05, H * 0.11);
        ctx.fillStyle = "#FF3B3B"; ctx.fillRect(x + W * 0.06, H * row[0], W * 0.05, H * 0.11);
        ctx.fillStyle = "#9aa"; ctx.font = (H * 0.02) + "px monospace"; ctx.textAlign = "left";
        ctx.fillText(Math.round(row[1]) + " px/s", 14, H * row[0] + H * 0.06);
      });
    })();
    return;
  }
  if (s.kind === "fixer") {
    /* Cycled at about 5 Hz, not at screen refresh. Fast enough to work a stuck
       subpixel loose, well clear of the 15-25 Hz band that provokes seizures. */
    var lastSwap = 0, f = 0;
    (function frame() {
      if (!ctx || !stage.classList.contains("on")) { anim = null; return; }
      anim = requestAnimationFrame(frame);
      var now = performance.now();
      if (now - lastSwap < 200) return;
      lastSwap = now; f++;
      ctx.fillStyle = ["#FF0000", "#00FF00", "#0000FF", "#FFFFFF", "#000000"][f % 5];
      ctx.fillRect(0, 0, W, H);
    })();
    return;
  }
}

/* ---------------- panel stats ---------------- */
function stats() {
  $("#mn-res").innerHTML = window.screen.width + "×" + window.screen.height + " <small>css</small>";
  $("#mn-dpr").textContent = (window.devicePixelRatio || 1).toFixed(2) + "×";
  $("#mn-depth").innerHTML = (window.screen.colorDepth || "?") + " <small>bit</small>";
  var gamut = matchMedia("(color-gamut: rec2020)").matches ? "rec2020" : matchMedia("(color-gamut: p3)").matches ? "DCI-P3" : matchMedia("(color-gamut: srgb)").matches ? "sRGB" : "—";
  $("#mn-gamut").style.fontSize = "15px"; $("#mn-gamut").textContent = gamut;
  var hdr = matchMedia("(dynamic-range: high)").matches ? "yes" : "no";
  var h = $("#mn-hdr"); h.textContent = hdr; h.className = "v " + (hdr === "yes" ? "pass" : "");
  TB.chip("scr", true, window.screen.width + "×" + window.screen.height);
  var n = 0, t0 = performance.now();
  (function f() {
    n++;
    if (performance.now() - t0 < 1000) requestAnimationFrame(f);
    else {
      var hz = Math.round(n / ((performance.now() - t0) / 1000));
      var snap = [60, 75, 90, 100, 120, 144, 165, 180, 240, 360].reduce(function (p, c) { return Math.abs(c - hz) < Math.abs(p - hz) ? c : p; });
      var use = Math.abs(snap - hz) <= 3 ? snap : hz;
      $("#mn-hz").innerHTML = use + " <small>Hz</small>";
      TB.chip("scr", true, window.screen.width + "×" + window.screen.height + " @" + use);
      TB.badge("monitor", use + "Hz", true);
    }
  })();
}
TB.onEnter("monitor", stats);
stats();
})();
