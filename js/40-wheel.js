/* Testbench — wheels and pedals.

   The whole job here is: plug it in, turn the wheel, press the pedals, press
   the buttons. So the page configures itself. The steering axis is found by
   watching which axis swings through its range in both directions; the pedals
   are found by watching which axes rest at one end and travel one way. Nothing
   to pick from a dropdown, nothing to calibrate — a tester should never have to
   think about axis numbers. The raw per-axis view is still there, folded away,
   for the rare rig with a load cell or a rim dial that has no slot of its own. */
"use strict";
(function () {
var $ = TB.$, el = TB.el, clamp = TB.clamp;
var PADS = TB.pads(), shortName = TB.shortName;

var sel = $("#wh-sel"), body = $("#wh-body"), activeIdx = null, ui = null, sig = null;
var rest = Object.create(null), steerAxis = -1, pedalMap = [];

function buildSel() {
  var ks = Object.keys(PADS); sel.innerHTML = "";
  if (!ks.length) return;
  if (activeIdx == null || !PADS[activeIdx]) {
    var w = ks.filter(function (k) { return PADS[k].wheel; });
    activeIdx = w.length ? w[0] : ks[0];
  }
  if (ks.length < 2) return;            /* one device: no need for a switcher */
  ks.forEach(function (k) {
    var rec = PADS[k];
    var b = el("button", "tb-btn" + (k === activeIdx ? " on" : ""), shortName(rec) + (rec.wheel ? " ◆" : ""));
    b.onclick = function () { activeIdx = k; reset(); sig = null; buildSel(); build(); };
    sel.appendChild(b);
  });
}

function build() {
  var rec = PADS[activeIdx];
  body.innerHTML = "";
  if (!rec) {
    var p0 = el("div", "tb-panel accent");
    var h0 = el("h2"); h0.style.cssText = "font-family:var(--f-display);font-size:20px;font-weight:800;margin-bottom:8px";
    h0.textContent = "Plug the wheel in"; p0.appendChild(h0);
    p0.appendChild(el("p", "tb-sub", "Connect the wheel over USB, then turn it or press any button. Browsers keep a game device hidden from a web page until it sends its first input — so give it a nudge and it appears."));
    body.appendChild(p0);
    ui = null; return;
  }

  /* ---- steering ---- */
  var p0 = el("div", "tb-panel accent");
  var head = el("div"); head.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;margin-bottom:12px";
  var h = el("h2", "tb-ptitle"); h.textContent = shortName(rec); head.appendChild(h);
  var meta = el("span"); meta.style.cssText = "font-family:var(--f-mono);font-size:10.5px;color:var(--ink-3);letter-spacing:.06em";
  meta.textContent = rec.wheel ? "WHEEL DETECTED" : "GAME DEVICE";
  head.appendChild(meta); p0.appendChild(head);

  var viz = el("div", "tb-wheelviz");
  var svgWrap = el("div");
  svgWrap.innerHTML = '<svg viewBox="0 0 200 200" role="img" aria-label="Steering position, drawn live from the wheel.">' +
    '<circle cx="100" cy="100" r="90" fill="none" style="stroke:var(--dev-rim)" stroke-width="1"/>' +
    '<g id="whrot">' +
      '<circle cx="100" cy="100" r="78" fill="none" style="stroke:var(--dev-spoke)" stroke-width="14"/>' +
      '<rect x="94" y="14" width="12" height="26" rx="3" style="fill:var(--pass)"/>' +
      '<path d="M100 100 L100 26 M100 100 L36 138 M100 100 L164 138" style="stroke:var(--dev-spoke)" stroke-width="9" stroke-linecap="round"/>' +
      '<circle cx="100" cy="100" r="20" style="fill:var(--dev-hub);stroke:var(--dev-spoke)" stroke-width="3"/>' +
    '</g>' +
    '<path d="M100 4 l-7 11 h14 z" style="fill:var(--dev-tip)"/></svg>';
  viz.appendChild(svgWrap);

  var readout = el("div"); readout.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:190px;flex:1;justify-content:center";
  var vDeg = el("div"); vDeg.id = "wh-deg"; vDeg.style.cssText = "font-family:var(--f-mono);font-size:clamp(34px,4vw,52px);font-weight:700;line-height:1;color:var(--cyan)"; vDeg.textContent = "0°";
  readout.appendChild(vDeg);
  var vState = el("div"); vState.style.cssText = "font-size:13px;color:var(--ink-2)"; vState.textContent = "Turn it one way, then the other.";
  readout.appendChild(vState);
  viz.appendChild(readout);
  p0.appendChild(viz);
  body.appendChild(p0);

  /* ---- pedals (auto-detected, no setup) ---- */
  var p1 = el("div", "tb-panel");
  p1.appendChild(TB.ptitle("Pedals"));
  var peds = el("div", "tb-pedals"); peds.id = "wh-peds";
  p1.appendChild(peds);
  p1.appendChild(el("p", "tb-note", "Press each pedal to the floor. The page finds the pedals on its own — each bar fills as its pedal travels and turns green at full. A pedal that will not reach the top, or jumps, is worn."));
  body.appendChild(p1);

  /* ---- buttons, paddles, shifter, d-pad ---- */
  var p2 = el("div", "tb-panel");
  p2.appendChild(TB.ptitle("Buttons, paddles &amp; shifter"));
  var fam = rec.brand.fam;
  var bl = el("div", "tb-btnlist"), btns = [];
  rec.buttons.forEach(function (_, i) {
    var b = el("div", "tb-gbtn");
    if (fam !== "generic" && i < 4) b.dataset.face = fam + i;
    var name = el("span", null, TB.labelFor(fam, i)); name.title = "Button " + i;
    b.appendChild(name);
    var v = el("em"); v.style.cssText = "font-style:normal;opacity:.7"; v.textContent = "0"; b.appendChild(v);
    bl.appendChild(b); btns.push({ node: b, val: v });
  });
  p2.appendChild(bl);
  var hatWrap = el("div", "tb-hat"), hatCells = {};
  [["up", "▲"], ["right", "▶"], ["down", "▼"], ["left", "◀"]].forEach(function (d) {
    var c = el("div", "tb-hatkey " + d[0], d[1]); hatWrap.appendChild(c); hatCells[d[0]] = c;
  });
  var hatBox = el("div", "tb-hatbox"); hatBox.appendChild(hatWrap); hatBox.appendChild(el("div", "tb-hatlab", "D-pad"));
  p2.appendChild(hatBox);
  p2.appendChild(el("p", "tb-note", "Work along the rim, both paddles, then every gear on the shifter including reverse. An H-pattern shifter reports each gear as its own button. The D-pad is read from the hat axis, so it lights above."));
  body.appendChild(p2);

  /* ---- advanced: raw axes ---- */
  var p3 = el("details", "tb-panel tb-adv");
  var sum = el("summary", "tb-advsum");
  sum.appendChild(el("span", "tb-advtitle", "Advanced · every axis, raw"));
  sum.appendChild(el("span", "tb-advhint", "only if something moves that has no slot above"));
  p3.appendChild(sum);
  var axwrap = el("div", "tb-advbody"); var axes = [];
  rec.axes.forEach(function (_, i) { var m = TB.meterRow("Axis " + i); axwrap.appendChild(m.node); axes.push(m); });
  axwrap.appendChild(el("p", "tb-note", "Load cells, handbrakes and rim dials all land here."));
  p3.appendChild(axwrap);
  body.appendChild(p3);

  ui = { rot: svgWrap.querySelector("#whrot"), vDeg: vDeg, vState: vState,
         peds: peds, pedEls: Object.create(null), btns: btns, axes: axes, hat: hatCells };
}

/* ---- auto-detection ----
   Steering: the axis that has swung furthest AND sits centred (a pedal rests at
   one end and only ever goes one way; a wheel is centred and goes both ways).
   Pedals: every OTHER axis that rests near an end. Both are decided from the
   min/max the device has reported so far, so they settle within a second of the
   operator turning the wheel and stamping the pedals once. */
function detect(rec) {
  var bestSpan = 0.5, best = -1;
  for (var i = 0; i < rec.axes.length; i++) {
    var mn = rec.axMin[i], mx = rec.axMax[i];
    if (mn == null || mx == null) continue;
    var span = mx - mn, mid = Math.abs((mx + mn) / 2);
    if (span > bestSpan && mid < 0.45) { bestSpan = span; best = i; }
  }
  if (best >= 0) steerAxis = best;

  /* pedals: non-steer axes resting near an extreme (|rest| > 0.45) */
  var peds = [];
  for (var j = 0; j < rec.axes.length; j++) {
    if (j === steerAxis) continue;
    if (rec.axMax[j] != null && rec.axMax[j] > 1.05) continue;   /* a hat, not a pedal */
    var r = rest[j];
    if (r == null) continue;
    if (Math.abs(r) > 0.45) peds.push(j);
  }
  pedalMap = peds;
}

var PED_NAMES = ["Throttle", "Brake", "Clutch"];
function pedalBar(axis, label, cls) {
  if (ui.pedEls[axis]) return ui.pedEls[axis];
  var w = el("div", "tb-ped");
  var bar = el("div", "tb-pedbar " + (cls || "")); var fill = el("i"); bar.appendChild(fill); w.appendChild(bar);
  w.appendChild(el("div", null, label));
  var v = el("div"); v.style.color = "var(--ink)"; v.textContent = "0%"; w.appendChild(v);
  ui.peds.appendChild(w);
  ui.pedEls[axis] = { node: w, fill: fill, val: v };
  return ui.pedEls[axis];
}

function reset() {
  rest = Object.create(null); steerAxis = -1; pedalMap = [];
  var r = PADS[activeIdx];
  if (r) { r.axMin = []; r.axMax = []; r.seenBtn = Object.create(null); }
}

function tick() {
  if (TB.view() !== "wheel") return;
  var ks = Object.keys(PADS).map(function (k) { return k + (PADS[k].active ? "!" : ""); }).join(",");
  if (ks !== sig) { sig = ks; buildSel(); build(); }
  if (!ui) return;
  var rec = PADS[activeIdx]; if (!rec) { sig = null; return; }

  /* capture rest the first time we see each axis */
  rec.axes.forEach(function (v, i) { if (rest[i] == null) rest[i] = v; });
  detect(rec);

  /* steering */
  var range = parseFloat($("#wh-range").value) || 900;
  var a = steerAxis >= 0 ? (rec.axes[steerAxis] || 0) : 0;
  var deg = a * (range / 2);
  ui.rot.setAttribute("transform", "rotate(" + deg.toFixed(1) + " 100 100)");
  ui.vDeg.textContent = (deg > 0 ? "+" : "") + deg.toFixed(0) + "°";
  if (steerAxis >= 0) {
    var mn = rec.axMin[steerAxis], mx = rec.axMax[steerAxis];
    if (mn != null && mx != null && (mx - mn) > 1.7) ui.vState.textContent = "Full lock both ways — steering is good.";
    else if (mn != null && mx != null && (mx - mn) > 0.3) ui.vState.textContent = "Keep turning, all the way each way.";
  } else {
    ui.vState.textContent = "Turn the wheel to find the steering axis.";
  }

  /* pedals */
  pedalMap.forEach(function (axis, n) {
    var label = PED_NAMES[n] || ("Pedal " + (n + 1));
    var cls = n === 0 ? "thr" : n === 1 ? "brk" : "";
    var p = pedalBar(axis, label, cls);
    var r = rest[axis] != null ? rest[axis] : 0;
    var far = Math.max(Math.abs((rec.axMin[axis] == null ? -1 : rec.axMin[axis]) - r),
                       Math.abs((rec.axMax[axis] == null ? 1 : rec.axMax[axis]) - r), 0.5);
    var t = clamp(Math.abs((rec.axes[axis] || 0) - r) / far, 0, 1);
    p.fill.style.height = (t * 100) + "%";
    p.fill.classList.toggle("full", t > 0.92);
    p.val.textContent = (t * 100).toFixed(0) + "%";
  });
  /* if no pedals detected yet, say so once */
  if (!pedalMap.length && ui.peds && !ui.peds.childElementCount) {
    ui.peds.textContent = "";
    var hint = el("p", "tb-note"); hint.style.margin = "0";
    hint.textContent = "Press a pedal to the floor and it appears here.";
    ui.peds.appendChild(hint); ui.pedHint = true;
  } else if (pedalMap.length && ui.pedHint) {
    /* remove the hint once a real pedal bar is about to render */
    if (ui.peds.firstChild && ui.peds.firstChild.classList && ui.peds.firstChild.classList.contains("tb-note")) ui.peds.firstChild.remove();
    ui.pedHint = false;
  }

  /* buttons */
  ui.btns.forEach(function (b, i) {
    var down = !!rec.pressed[i];
    b.node.classList.toggle("down", down);
    b.node.classList.toggle("seen", !!rec.seenBtn[i]);
    b.val.textContent = down ? "1" : "0";
  });

  /* hat / d-pad */
  var hatAxis = -1;
  for (var hi = 0; hi < rec.axes.length; hi++) {
    if (rec.axMax[hi] != null && rec.axMax[hi] > 1.05) { hatAxis = hi; break; }
  }
  var dirs = { up: false, right: false, down: false, left: false };
  if (hatAxis >= 0) {
    var hv = rec.axes[hatAxis];
    if (hv <= 1.02) {
      var pos = Math.round((hv + 1) * 3.5);
      if (pos === 7 || pos === 0 || pos === 1) dirs.up = true;
      if (pos >= 1 && pos <= 3) dirs.right = true;
      if (pos >= 3 && pos <= 5) dirs.down = true;
      if (pos >= 5 && pos <= 7) dirs.left = true;
    }
  }
  Object.keys(ui.hat).forEach(function (d) {
    ui.hat[d].classList.toggle("on", dirs[d]);
    if (dirs[d]) ui.hat[d].classList.add("seen");
  });

  /* advanced raw axes */
  ui.axes.forEach(function (m, i) {
    var v = rec.axes[i] || 0;
    m.fill.style.width = (((v + 1) / 2) * 100) + "%";
    m.val.textContent = v.toFixed(3);
  });
}

TB.onPads(tick);
TB.onEnter("wheel", function () { sig = null; tick(); });
TB.wheelState = function () {
  var rec = PADS[activeIdx];
  return { steerAxis: steerAxis, pedals: pedalMap.slice(),
           deg: ui ? ui.vDeg.textContent : "", pedEls: ui ? Object.keys(ui.pedEls).length : 0 };
};
$("#wh-reset").onclick = function () { reset(); build(); };
})();
