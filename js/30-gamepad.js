/* Testbench — controllers: live diagram, instant rest score, drift, triggers, rumble. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, svgEl = TB.svgEl, clamp = TB.clamp, verdict = TB.verdict, badge = TB.badge, toast = TB.toast;
var PADS = TB.pads(), shortName = TB.shortName, labelFor = TB.labelFor, glyphFor = TB.glyphFor;

/* ---------------- diagram geometry ---------------- */
var GEO = {
  ps:       { ls: [148, 212], rs: [252, 212], dp: [100, 150], face: [300, 150], guide: [200, 168, 11],
              small: [[8, 130, 100, "Create"], [9, 270, 100, "Options"]], touch: [150, 86, 100, 52] },
  xbox:     { ls: [110, 140], rs: [250, 216], dp: [150, 216], face: [300, 140], guide: [200, 100, 15],
              small: [[8, 168, 146, "View"], [9, 232, 146, "Menu"], [17, 200, 176, "Share"]] },
  nintendo: { ls: [110, 140], rs: [250, 216], dp: [150, 216], face: [300, 140], guide: [222, 176, 11],
              small: [[8, 168, 146, "−"], [9, 232, 146, "+"], [17, 178, 176, "Capt"]] },
  generic:  { ls: [110, 140], rs: [250, 216], dp: [150, 216], face: [300, 140], guide: [200, 100, 15],
              small: [[8, 168, 146, "B8"], [9, 232, 146, "B9"], [17, 200, 176, "B17"]] }
};
var BODY = "M62,62 C22,62 10,102 8,152 C6,202 22,266 57,266 C82,266 94,244 112,219 C127,199 147,192 200,192 " +
           "C253,192 273,199 288,219 C306,244 318,266 343,266 C378,266 394,204 392,152 C390,102 378,62 338,62 " +
           "C298,62 258,74 200,74 C142,74 102,62 62,62 Z";

function R(x, y, w, h, r, cls) { return svgEl("rect", { x: x, y: y, width: w, height: h, rx: r, "class": cls }); }
function C(cx, cy, r, cls) { return svgEl("circle", { cx: cx, cy: cy, r: r, "class": cls }); }
function T(x, y, txt, cls) { var t = svgEl("text", { x: x, y: y, "class": cls || "lbl" }); t.textContent = txt; return t; }

function padSVG(fam, nbtn, naxes) {
  var g = GEO[fam] || GEO.generic;
  var s = svgEl("svg", { viewBox: "0 0 400 300", "class": "tb-dev", role: "img", "aria-label": "Controller diagram" });
  s.style.maxWidth = "540px";
  var btn = {}, labels = {}, trig = {}, knob = [];

  /* triggers + bumpers sit behind the body */
  [[6, 84, "LT"], [7, 248, "RT"]].forEach(function (t) {
    if (nbtn <= t[0]) return;
    s.appendChild(R(t[1], 10, 68, 24, 10, "well"));
    var f = R(t[1] + 3, 13, 0, 18, 7, "fill"); s.appendChild(f); trig[t[0]] = f;
    s.appendChild(T(t[1] + 34, 22, t[2], "lbl sm"));
  });
  [[4, 70, "LB"], [5, 244, "RB"]].forEach(function (t) {
    if (nbtn <= t[0]) return;
    var r = R(t[1], 40, 86, 20, 9, "btn"); s.appendChild(r); btn[t[0]] = r;
    s.appendChild(T(t[1] + 43, 50, t[2], "lbl sm"));
  });

  s.appendChild(svgEl("path", { d: BODY, "class": "shell" }));

  if (g.touch && nbtn > 17) {
    var tp = R(g.touch[0], g.touch[1], g.touch[2], g.touch[3], 8, "btn"); s.appendChild(tp); btn[17] = tp;
    s.appendChild(T(g.touch[0] + g.touch[2] / 2, g.touch[1] + g.touch[3] / 2, "touchpad", "lbl sm"));
  }

  /* d-pad */
  var dx = g.dp[0], dy = g.dp[1];
  s.appendChild(R(dx - 12, dy - 12, 24, 24, 3, "plate"));
  [[12, dx - 11, dy - 36, 22, 25, "▲"], [13, dx - 11, dy + 11, 22, 25, "▼"],
   [14, dx - 36, dy - 11, 25, 22, "◀"], [15, dx + 11, dy - 11, 25, 22, "▶"]].forEach(function (d) {
    if (nbtn <= d[0]) return;
    var r = R(d[1], d[2], d[3], d[4], 4, "btn"); s.appendChild(r); btn[d[0]] = r;
  });

  /* face buttons */
  var fx = g.face[0], fy = g.face[1], off = 33;
  [[0, fx, fy + off], [1, fx + off, fy], [2, fx - off, fy], [3, fx, fy - off]].forEach(function (f) {
    if (nbtn <= f[0]) return;
    var c = C(f[1], f[2], 17, "btn"); s.appendChild(c); btn[f[0]] = c;
    var t = T(f[1], f[2], glyphFor(fam, f[0])); s.appendChild(t); labels[f[0]] = t;
  });

  /* small buttons */
  (g.small || []).forEach(function (b) {
    if (nbtn <= b[0]) return;
    var r = R(b[1] - 10, b[2] - 7, 20, 14, 6, "btn"); s.appendChild(r); btn[b[0]] = r;
    s.appendChild(T(b[1], b[2] + 17, b[3], "lbl sm"));
  });

  /* guide */
  if (nbtn > 16 && g.guide) {
    var gg = C(g.guide[0], g.guide[1], g.guide[2], "btn"); s.appendChild(gg); btn[16] = gg;
  }

  /* sticks */
  [[g.ls, 10, 0, 1, "L"], [g.rs, 11, 2, 3, "R"]].forEach(function (sk) {
    if (naxes <= sk[3]) return;
    s.appendChild(C(sk[0][0], sk[0][1], 32, "well"));
    s.appendChild(C(sk[0][0], sk[0][1], 2, "tick"));
    var k = C(sk[0][0], sk[0][1], 18, "knob"); s.appendChild(k);
    var lt = T(sk[0][0], sk[0][1], sk[4], "lbl sm"); s.appendChild(lt);
    knob.push({ node: k, label: lt, cx: sk[0][0], cy: sk[0][1], ax: sk[2], ay: sk[3], press: sk[1] });
  });

  return { node: s, btn: btn, labels: labels, trig: trig, knob: knob };
}

/* ---------------- view ---------------- */
var sel = $("#gp-sel"), body = $("#gp-body"), activeIdx = null, ui = null, sig = "";

function stickBlock(name) {
  var w = el("div");
  var t = el("div");
  t.style.cssText = "font-family:var(--font-m);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:7px";
  t.textContent = name; w.appendChild(t);
  var s = el("div", "tb-stick"), c = el("canvas"); s.appendChild(c); w.appendChild(s);
  var r = el("div");
  r.style.cssText = "font-family:var(--font-m);font-size:11px;color:var(--ink-dim);margin-top:7px;font-variant-numeric:tabular-nums";
  w.appendChild(r);
  return { node: w, canvas: c, read: r, trace: new Array(72).fill(0), ret: 0, wasOut: false, outAt: 0 };
}

function buildSel() {
  var ks = Object.keys(PADS); sel.innerHTML = "";
  if (!ks.length) return;
  if (activeIdx == null || !PADS[activeIdx]) activeIdx = ks[0];
  ks.forEach(function (k) {
    var rec = PADS[k], b = el("button", "tb-btn" + (k === activeIdx ? " on" : ""), shortName(rec));
    b.onclick = function () { activeIdx = k; sig = ""; buildSel(); build(); };
    sel.appendChild(b);
  });
}

function build() {
  var rec = PADS[activeIdx];
  body.innerHTML = "";
  if (!rec) {
    body.appendChild(el("p", "tb-empty", "Connect a controller and press any button on it. USB is the most reliable; Bluetooth works too."));
    ui = null; badge("gamepad", ""); return;
  }
  var fam = rec.brand.fam;

  var pv = el("div", "tb-panel");
  var head = el("div");
  head.style.cssText = "display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;margin-bottom:11px";
  var h = el("h2"); h.style.cssText = "font-family:var(--font-d);font-size:17px;letter-spacing:.03em";
  h.textContent = shortName(rec); head.appendChild(h);
  var meta = el("span");
  meta.style.cssText = "font-family:var(--font-m);font-size:10.5px;color:var(--ink-faint);letter-spacing:.06em";
  meta.textContent = rec.brand.b.toUpperCase() + " · slot " + rec.index + " · " + rec.buttons.length + " buttons · " + rec.axes.length + " axes · mapping “" + rec.mapping + "”";
  head.appendChild(meta);
  pv.appendChild(head);
  var vnode = el("div"); pv.appendChild(vnode);
  var idbar = el("div", "tb-idbar"); idbar.id = "gp-id"; pv.appendChild(idbar);
  body.appendChild(pv);

  /* diagram */
  var pd = el("div", "tb-panel");
  pd.appendChild(TB.ptitle("The controller"));
  var dia = padSVG(fam, rec.buttons.length, rec.axes.length);
  pd.appendChild(dia.node);
  var cl = TB.checklist(rec.buttons.map(function (_, i) { return { key: i, label: labelFor(fam, i) }; }));
  pd.appendChild(cl.node);
  pd.appendChild(el("p", "tb-note", "Press every control on the pad and watch it light up here. The list underneath turns green as each one reports in — anything still grey at the end is either untested or dead."));
  body.appendChild(pd);

  var grid = el("div", "tb-grid tb-cols2");
  var p1 = el("div", "tb-panel");
  p1.appendChild(TB.ptitle("Sticks — drift, range and return"));
  var sticks = el("div"); sticks.style.cssText = "display:flex;gap:20px;flex-wrap:wrap";
  var L = stickBlock("Left stick"), Rt = stickBlock("Right stick");
  sticks.appendChild(L.node); if (rec.axes.length >= 4) sticks.appendChild(Rt.node);
  p1.appendChild(sticks);
  var sstat = el("div", "tb-stats"); sstat.style.marginTop = "12px";
  function stat(k) { var s = el("div", "tb-stat"); s.appendChild(el("div", "k", k)); var v = el("div", "v", "—"); s.appendChild(v); sstat.appendChild(s); return v; }
  var vRetL = stat("Left return error"), vRetR = stat("Right return error"), vRes = stat("Analog steps");
  p1.appendChild(sstat);
  p1.appendChild(el("p", "tb-note", "Roll each stick slowly around the rim — the cyan outline is the furthest it reached at every angle, so a flat spot or a short side shows up as a dent. Return error is how far off centre the stick settles after you let go; anything over about 5% will drift in game."));
  grid.appendChild(p1);

  var p2 = el("div", "tb-panel");
  p2.appendChild(TB.ptitle("Triggers, shoulders &amp; rumble"));
  var trigs = [];
  [[6, "LT / L2"], [7, "RT / R2"], [4, "LB / L1"], [5, "RB / R1"]].forEach(function (t) {
    if (rec.buttons.length > t[0]) { var m = TB.meterRow(t[1]); m.idx = t[0]; p2.appendChild(m.node); trigs.push(m); }
  });
  var tstat = el("div", "tb-stats"); tstat.style.marginTop = "12px";
  function tstatCell(k) { var s = el("div", "tb-stat"); s.appendChild(el("div", "k", k)); var v = el("div", "v", "—"); s.appendChild(v); tstat.appendChild(s); return v; }
  var vLT = tstatCell("LT travel"), vRT = tstatCell("RT travel");
  p2.appendChild(tstat);
  var rb = el("div", "tb-bar"); rb.style.marginTop = "12px";
  [["Both motors", 1, 1], ["Strong only", 1, 0], ["Weak only", 0, 1]].forEach(function (r) {
    var b = el("button", "tb-btn", r[0]);
    b.onclick = function () { rumble(PADS[activeIdx], r[1], r[2]); };
    rb.appendChild(b);
  });
  p2.appendChild(rb);
  var rn = el("p", "tb-note", ""); p2.appendChild(rn);
  grid.appendChild(p2);
  body.appendChild(grid);

  var p4 = el("div", "tb-panel");
  p4.appendChild(TB.ptitle("Raw axes and buttons"));
  var axes = [];
  rec.axes.forEach(function (_, i) { var m = TB.meterRow("Axis " + i); m.idx = i; p4.appendChild(m.node); axes.push(m); });
  var bl = el("div", "tb-btnlist"); bl.style.marginTop = "12px";
  var btns = [];
  rec.buttons.forEach(function (_, i) {
    var b = el("div", "tb-gbtn");
    b.appendChild(el("span", null, labelFor(fam, i)));
    var v = el("em"); v.style.cssText = "font-style:normal;opacity:.75"; v.textContent = "0"; b.appendChild(v);
    bl.appendChild(b); btns.push({ node: b, val: v });
  });
  p4.appendChild(bl);
  body.appendChild(p4);

  ui = { rec: rec, vnode: vnode, dia: dia, cl: cl, L: L, R: Rt, trigs: trigs, btns: btns, axes: axes,
         vRetL: vRetL, vRetR: vRetR, vRes: vRes, vLT: vLT, vRT: vRT, lastScore: undefined };
  rn.textContent = (rec.raw && rec.raw.vibrationActuator)
    ? "Rumble runs for 700 ms. Listen for one motor being weaker or silent."
    : "This controller does not expose rumble to the browser. Over Bluetooth most PlayStation and Xbox pads do not — plug it in over USB and try again.";
  TB.hidMount("#gp-id", "Press this to read the pad's USB product name. Most controllers show up; a few Bluetooth ones do not.");
}
function rumble(rec, strong, weak) {
  var a = rec && rec.raw && rec.raw.vibrationActuator; if (!a) return;
  try { a.playEffect("dual-rumble", { startDelay: 0, duration: 700, strongMagnitude: strong, weakMagnitude: weak }); } catch (e) {}
}

function drawStick(blk, x, y, pressed) {
  var c = blk.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
  var w = c.clientWidth || 180, h = c.clientHeight || 180;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
  var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  var cx = w / 2, cy = h / 2, R2 = Math.min(w, h) / 2 - 6;
  var ang = Math.atan2(y, x), mag = Math.min(1, Math.sqrt(x * x + y * y));
  var bi = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * blk.trace.length) % blk.trace.length;
  if (mag > blk.trace[bi]) blk.trace[bi] = mag;
  g.strokeStyle = "#28333A"; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, R2, 0, 7); g.stroke();
  g.beginPath(); g.arc(cx, cy, R2 * 0.5, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(cx - R2, cy); g.lineTo(cx + R2, cy); g.moveTo(cx, cy - R2); g.lineTo(cx, cy + R2); g.stroke();
  g.strokeStyle = "rgba(53,195,212,.85)"; g.lineWidth = 1.4; g.beginPath();
  for (var i = 0; i < blk.trace.length; i++) {
    var a = (i / blk.trace.length) * Math.PI * 2 - Math.PI, r = blk.trace[i] * R2;
    var px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath(); g.stroke();
  g.fillStyle = "rgba(63,208,126,.16)"; g.beginPath(); g.arc(cx, cy, R2 * 0.08, 0, 7); g.fill();
  var ddx = cx + x * R2, ddy = cy + y * R2;
  g.fillStyle = pressed ? "#F5A524" : "#3FD07E";
  g.beginPath(); g.arc(ddx, ddy, 6, 0, 7); g.fill();
  g.strokeStyle = "rgba(63,208,126,.35)"; g.beginPath(); g.moveTo(cx, cy); g.lineTo(ddx, ddy); g.stroke();
  blk.read.textContent = "X " + x.toFixed(3) + "   Y " + y.toFixed(3) + "   mag " + (mag * 100).toFixed(1) + "%";

  /* return-to-centre */
  var now = performance.now();
  if (mag > 0.5) { blk.wasOut = true; blk.outAt = now; }
  else if (blk.wasOut && now - blk.outAt > 350) { blk.wasOut = false; if (mag > blk.ret) blk.ret = mag; }
}

function tick() {
  if (TB.view() !== "gamepad") return;
  var ks = Object.keys(PADS).join(",");
  if (ks !== sig) { sig = ks; buildSel(); build(); }
  if (!ui) return;
  var rec = PADS[activeIdx]; if (!rec) { sig = ""; return; }
  ui.rec = rec;
  if (rec.score !== ui.lastScore) {
    ui.lastScore = rec.score;
    verdict(ui.vnode, rec.score, rec.flags, "Sampling at rest…");
    badge("gamepad", rec.score != null ? String(Math.round(rec.score)) : "", rec.score >= 90);
  }
  /* diagram */
  var d = ui.dia;
  Object.keys(d.btn).forEach(function (k) {
    var i = parseInt(k, 10), down = !!rec.pressed[i];
    d.btn[k].classList.toggle("on", down);
    d.btn[k].classList.toggle("seen", !!rec.seenBtn[i]);
    if (d.labels[k]) d.labels[k].classList.toggle("on", down);
  });
  Object.keys(d.trig).forEach(function (k) {
    var v = rec.buttons[parseInt(k, 10)] || 0;
    d.trig[k].setAttribute("width", (62 * clamp(v, 0, 1)).toFixed(1));
  });
  d.knob.forEach(function (kn) {
    var x = rec.axes[kn.ax] || 0, y = rec.axes[kn.ay] || 0;
    kn.node.setAttribute("cx", (kn.cx + x * 13).toFixed(1));
    kn.node.setAttribute("cy", (kn.cy + y * 13).toFixed(1));
    kn.label.setAttribute("x", (kn.cx + x * 13).toFixed(1));
    kn.label.setAttribute("y", (kn.cy + y * 13).toFixed(1));
    var pressed = !!rec.pressed[kn.press];
    kn.node.classList.toggle("on", pressed);
    kn.label.classList.toggle("on", pressed);
  });
  rec.buttons.forEach(function (_, i) { ui.cl.set(i, !!rec.seenBtn[i]); });

  drawStick(ui.L, rec.axes[0] || 0, rec.axes[1] || 0, rec.pressed[10]);
  if (rec.axes.length >= 4) drawStick(ui.R, rec.axes[2] || 0, rec.axes[3] || 0, rec.pressed[11]);
  ui.vRetL.textContent = (ui.L.ret * 100).toFixed(1) + "%";
  ui.vRetL.className = "v " + (ui.L.ret > 0.09 ? "fail" : ui.L.ret > 0.05 ? "warn" : "pass");
  ui.vRetR.textContent = (ui.R.ret * 100).toFixed(1) + "%";
  ui.vRetR.className = "v " + (ui.R.ret > 0.09 ? "fail" : ui.R.ret > 0.05 ? "warn" : "pass");
  var steps = rec.resolution[0] ? Object.keys(rec.resolution[0]).length : 0;
  ui.vRes.textContent = steps ? String(steps) : "—";

  ui.trigs.forEach(function (m) {
    var v = rec.buttons[m.idx] || 0;
    m.fill.style.width = (v * 100) + "%";
    m.fill.className = v > 0.02 && v < 0.98 ? "warn" : (v >= 0.98 ? "pass" : "");
    m.val.textContent = (v * 100).toFixed(0) + "%";
  });
  function travel(i, node) {
    if (rec.btnMax[i] == null) { node.textContent = "—"; return; }
    var t = (rec.btnMax[i] - rec.btnMin[i]) * 100;
    node.textContent = t.toFixed(0) + "%";
    node.className = "v " + (t > 95 ? "pass" : t > 40 ? "warn" : "");
  }
  travel(6, ui.vLT); travel(7, ui.vRT);

  ui.btns.forEach(function (b, i) {
    var v = rec.buttons[i] || 0, down = !!rec.pressed[i];
    b.node.classList.toggle("down", down);
    b.node.classList.toggle("seen", !!rec.seenBtn[i]);
    b.val.textContent = v > 0 && v < 1 ? v.toFixed(2) : (down ? "1" : "0");
  });
  ui.axes.forEach(function (m, i) {
    var v = rec.axes[i] || 0;
    m.fill.style.width = (((v + 1) / 2) * 100) + "%";
    m.val.textContent = v.toFixed(3);
  });
}
TB.onPads(tick);
TB.onEnter("gamepad", function () { sig = ""; tick(); });
$("#gp-rescore").onclick = function () {
  var r = PADS[activeIdx];
  if (r) { TB.beginRestSample(r); if (ui) ui.lastScore = undefined; toast("Re-scoring", "Hands off the controller for one second.", null); }
};
$("#gp-clear").onclick = function () {
  var r = PADS[activeIdx];
  if (r) { r.seenBtn = {}; r.btnMin = []; r.btnMax = []; r.resolution = {}; }
  if (ui) { ui.L.trace.fill(0); ui.R.trace.fill(0); ui.L.ret = 0; ui.R.ret = 0; }
};
})();
