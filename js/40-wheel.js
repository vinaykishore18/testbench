/* Testbench — wheels and pedals: steering range, pedal travel, shifters, raw axes. */
"use strict";
(function () {
var $ = TB.$, el = TB.el, clamp = TB.clamp, toast = TB.toast;
var PADS = TB.pads(), shortName = TB.shortName;

var sel = $("#wh-sel"), body = $("#wh-body"), activeIdx = null, ui = null, sig = null;   /* null, not "" — see note in tick() */
var rest = {}, steerAxis = 0, pedalAxis = { throttle: 1, brake: 2, clutch: 3 }, learning = null;

function buildSel() {
  var ks = Object.keys(PADS); sel.innerHTML = "";
  if (!ks.length) return;
  if (activeIdx == null || !PADS[activeIdx]) {
    var w = ks.filter(function (k) { return PADS[k].wheel; });
    activeIdx = w.length ? w[0] : ks[0];
  }
  ks.forEach(function (k) {
    var rec = PADS[k];
    var b = el("button", "tb-btn" + (k === activeIdx ? " on" : ""), shortName(rec) + (rec.wheel ? " ◆" : ""));
    b.title = rec.wheel ? "Detected as a wheel" : "Not detected as a wheel — select it anyway if this is your device";
    b.onclick = function () { activeIdx = k; sig = null; buildSel(); build(); };
    sel.appendChild(b);
  });
}
function pedal(name, cls) {
  var w = el("div", "tb-ped");
  var bar = el("div", "tb-pedbar " + cls), i = el("i"); bar.appendChild(i); w.appendChild(bar);
  w.appendChild(el("div", null, name));
  var v = el("div"); v.style.color = "var(--ink)"; v.textContent = "0%"; w.appendChild(v);
  var s = el("select"); s.style.cssText = "width:100%;margin-top:6px;padding:3px 4px;font-size:10px";
  w.appendChild(s);
  return { node: w, fill: i, val: v, sel: s, key: name.toLowerCase() };
}
function build() {
  var rec = PADS[activeIdx];
  body.innerHTML = "";
  if (!rec) {
    var p0 = el("div", "tb-panel accent");
    var h0 = el("h2", null, "Listening for a wheel");
    h0.style.cssText = "font-family:var(--f-display);font-size:20px;font-weight:800;margin-bottom:8px";
    p0.appendChild(h0);
    p0.appendChild(el("p", "tb-sub", "Nothing connected yet. Plug the wheel in, then turn it or press one of its buttons \u2014 browsers hide a game device from a web page until it sends its first input, so until you move it the page cannot see it."));
    body.appendChild(p0);
    ui = null; return;
  }

  var p0 = el("div", "tb-panel");
  var head = el("div"); head.style.cssText = "display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;margin-bottom:12px";
  var h = el("h2"); h.style.cssText = "font-family:var(--font-d);font-size:17px;letter-spacing:.03em";
  h.textContent = shortName(rec); head.appendChild(h);
  var meta = el("span"); meta.style.cssText = "font-family:var(--font-m);font-size:10.5px;color:var(--ink-faint);letter-spacing:.06em";
  meta.textContent = (rec.wheel ? "WHEEL DETECTED" : "GENERIC DEVICE") + " · " + rec.axes.length + " axes · " + rec.buttons.length + " buttons";
  head.appendChild(meta); p0.appendChild(head);

  var viz = el("div", "tb-wheelviz");
  var svgWrap = el("div");
  svgWrap.innerHTML = '<svg viewBox="0 0 200 200" aria-label="Steering position">' +
    '<circle cx="100" cy="100" r="90" fill="none" stroke="#28333A" stroke-width="1"/>' +
    '<g id="whrot">' +
      '<circle cx="100" cy="100" r="78" fill="none" stroke="#3A464C" stroke-width="14"/>' +
      '<rect x="94" y="14" width="12" height="26" rx="3" fill="#3FD07E"/>' +
      '<path d="M100 100 L100 26 M100 100 L36 138 M100 100 L164 138" stroke="#3A464C" stroke-width="9" stroke-linecap="round"/>' +
      '<circle cx="100" cy="100" r="20" fill="#1B2226" stroke="#3A464C" stroke-width="3"/>' +
    '</g>' +
    '<path d="M100 4 l-7 11 h14 z" fill="#35C3D4"/></svg>';
  viz.appendChild(svgWrap);

  var readout = el("div"); readout.style.cssText = "display:flex;flex-direction:column;gap:12px;min-width:230px;flex:1";
  var stats = el("div", "tb-stats");
  function stat(k) { var s = el("div", "tb-stat"); s.appendChild(el("div", "k", k)); var v = el("div", "v", "—"); s.appendChild(v); stats.appendChild(s); return v; }
  var vDeg = stat("Angle"), vSwept = stat("Swept"), vCentre = stat("Centre offset"), vLock = stat("Lock to lock");
  readout.appendChild(stats);
  var axSel = el("select");
  rec.axes.forEach(function (_, i) { var o = el("option", null, "Axis " + i); o.value = i; axSel.appendChild(o); });
  /* Clamp the variable, not just what the dropdown shows. Picking axis 5 on a
     six-axis wheel and then plugging in a three-axis one used to leave
     steerAxis at 5 while the dropdown read "Axis 2" — tick() then read an
     undefined axis, so the wheel sat dead centre at 0° and looked broken. */
  steerAxis = rec.axes.length ? Math.min(steerAxis, rec.axes.length - 1) : 0;
  axSel.value = String(steerAxis);
  axSel.onchange = function () { steerAxis = parseInt(this.value, 10); };
  var lab = el("label", "tb-lab", "Steering axis "); lab.appendChild(axSel);
  readout.appendChild(lab);
  viz.appendChild(readout);
  p0.appendChild(viz);
  p0.appendChild(el("p", "tb-note", "Turn it all the way one way, then all the way the other. “Swept” is how much of the rotation setting above the wheel actually reached — a 900° wheel that only sweeps 60% has either lost travel or is set to a smaller range in its driver."));
  body.appendChild(p0);

  var grid = el("div", "tb-grid tb-cols2");
  var p1 = el("div", "tb-panel");
  p1.appendChild(TB.ptitle("Pedals"));
  var peds = el("div", "tb-pedals");
  var T = pedal("Throttle", "thr"), B = pedal("Brake", "brk"), Cl = pedal("Clutch", "");
  [T, B, Cl].forEach(function (p) {
    rec.axes.forEach(function (_, i) { var o = el("option", null, "Axis " + i); o.value = i; p.sel.appendChild(o); });
    var o = el("option", null, "—"); o.value = "-1"; p.sel.appendChild(o);
    p.sel.value = String(pedalAxis[p.key] != null && pedalAxis[p.key] < rec.axes.length ? pedalAxis[p.key] : -1);
    p.sel.onchange = function () { pedalAxis[p.key] = parseInt(this.value, 10); };
    peds.appendChild(p.node);
  });
  p1.appendChild(peds);
  var pb = el("div", "tb-bar"); pb.style.marginTop = "12px";
  var zero = el("button", "tb-btn", "Zero pedals (feet off)");
  zero.onclick = function () { rest = {}; rec.axes.forEach(function (v, i) { rest[i] = v; }); toast("Pedals zeroed", "Now press each pedal to the floor once so full travel calibrates.", null); };
  var learn = el("button", "tb-btn", "Auto-assign: hold a pedal");
  learn.onclick = function () { startLearn(rec); };
  pb.appendChild(zero); pb.appendChild(learn);
  p1.appendChild(pb);
  var lstat = el("p", "tb-note", "Zero with your feet off, then press each pedal fully once — travel calibrates itself. Auto-assign watches for whichever axis moves while you hold a pedal.");
  p1.appendChild(lstat);
  grid.appendChild(p1);

  var p2 = el("div", "tb-panel");
  p2.appendChild(TB.ptitle("Buttons, paddles &amp; shifter"));
  var bl = el("div", "tb-btnlist"), btns = [];
  rec.buttons.forEach(function (_, i) {
    var b = el("div", "tb-gbtn"); b.appendChild(el("span", null, "B" + i));
    var v = el("em"); v.style.cssText = "font-style:normal;opacity:.7"; v.textContent = "0"; b.appendChild(v);
    bl.appendChild(b); btns.push({ node: b, val: v });
  });
  p2.appendChild(bl);
  p2.appendChild(el("p", "tb-note", "Work along the rim, both paddles, then every gear on the shifter including reverse. An H-pattern shifter reports each gear as its own button."));
  grid.appendChild(p2);
  body.appendChild(grid);

  var p3 = el("div", "tb-panel");
  p3.appendChild(TB.ptitle("Every axis, raw"));
  var axes = [];
  rec.axes.forEach(function (_, i) {
    var m = TB.meterRow("Axis " + i); p3.appendChild(m.node); axes.push(m);
  });
  p3.appendChild(el("p", "tb-note", "Load cells, handbrakes and rim dials all land here. If something moves that has no slot above, this is where you confirm it works."));
  body.appendChild(p3);

  ui = { rot: svgWrap.querySelector("#whrot"), vDeg: vDeg, vSwept: vSwept, vCentre: vCentre, vLock: vLock,
         peds: [T, B, Cl], btns: btns, axes: axes, lstat: lstat };
  if (!Object.keys(rest).length) rec.axes.forEach(function (v, i) { rest[i] = v; });
}
function startLearn(rec) {
  learning = { base: rec.axes.slice(), best: -1, delta: 0 };
  ui.lstat.textContent = "Hold a pedal down now…";
  setTimeout(function () {
    if (!learning || !ui || !ui.lstat) return;   /* wheel unplugged mid-learn */
    var d = learning; learning = null;
    if (d.best < 0 || d.delta < 0.15) { ui.lstat.textContent = "Nothing moved far enough to assign. Hold the pedal all the way down and try again."; return; }
    ui.lstat.textContent = "Axis " + d.best + " moved " + d.delta.toFixed(2) + " — set that axis in the dropdown under the pedal you were pressing.";
    toast("Axis " + d.best + " is live", "That axis moved while you held the pedal. Set it under the matching pedal.", null);
  }, 2600);
}
function tick() {
  if (TB.view() !== "wheel") return;
  /* sig starts as null rather than "". With no controllers connected the key
     list is also "", so "" !== "" was false and the page was never built at
     all — you got a blank panel with not even the "press a button" hint on it. */
  var ks = Object.keys(PADS).map(function (k) { return k + (PADS[k].active ? "!" : ""); }).join(",");
  if (ks !== sig) { sig = ks; buildSel(); build(); }
  if (!ui) return;
  var rec = PADS[activeIdx]; if (!rec) { sig = null; return; }
  if (learning) {
    rec.axes.forEach(function (v, i) {
      var d = Math.abs(v - learning.base[i]);
      if (d > learning.delta) { learning.delta = d; learning.best = i; }
    });
  }
  var range = parseFloat($("#wh-range").value) || 900;
  var a = rec.axes[steerAxis] || 0, deg = a * (range / 2);
  ui.rot.setAttribute("transform", "rotate(" + deg.toFixed(1) + " 100 100)");
  ui.vDeg.textContent = (deg > 0 ? "+" : "") + deg.toFixed(0) + "°";
  var mn = rec.axMin[steerAxis], mx = rec.axMax[steerAxis];
  if (mn != null && mx != null) {
    var swept = (mx - mn) / 2 * 100;
    ui.vSwept.textContent = swept.toFixed(0) + "%";
    ui.vSwept.className = "v " + (swept > 92 ? "pass" : swept > 60 ? "warn" : "fail");
    ui.vLock.textContent = Math.round((mx - mn) / 2 * range) + "°";
    var mid = (mx + mn) / 2;
    ui.vCentre.textContent = (mid * 100).toFixed(1) + "%";
    ui.vCentre.className = "v " + (Math.abs(mid) < 0.05 ? "pass" : Math.abs(mid) < 0.15 ? "warn" : "fail");
  }
  ui.peds.forEach(function (p) {
    var idx = pedalAxis[p.key];
    if (idx == null || idx < 0 || idx >= rec.axes.length) { p.fill.style.height = "0%"; p.val.textContent = "—"; return; }
    var v = rec.axes[idx], r = rest[idx] != null ? rest[idx] : 0;
    var far = Math.max(Math.abs((rec.axMin[idx] || 0) - r), Math.abs((rec.axMax[idx] || 0) - r), 0.5);
    var t = clamp(Math.abs(v - r) / far, 0, 1);
    p.fill.style.height = (t * 100) + "%";
    p.val.textContent = (t * 100).toFixed(0) + "%";
  });
  ui.btns.forEach(function (b, i) {
    var down = !!rec.pressed[i];
    b.node.classList.toggle("down", down);
    b.node.classList.toggle("seen", !!rec.seenBtn[i]);
    b.val.textContent = down ? "1" : "0";
  });
  ui.axes.forEach(function (m, i) {
    var v = rec.axes[i] || 0;
    m.fill.style.width = (((v + 1) / 2) * 100) + "%";
    m.val.textContent = v.toFixed(3);
  });
}
TB.onPads(tick);
TB.onEnter("wheel", function () { sig = null; tick(); });
$("#wh-reset").onclick = function () { var r = PADS[activeIdx]; if (r) { r.axMin = []; r.axMax = []; r.seenBtn = {}; rest = {}; } };
})();
