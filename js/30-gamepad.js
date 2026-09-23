/* Testbench — controllers: live diagram, instant rest score, drift, triggers, rumble. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, svgEl = TB.svgEl, clamp = TB.clamp, verdict = TB.verdict, badge = TB.badge, toast = TB.toast;
var PADS = TB.pads(), shortName = TB.shortName, labelFor = TB.labelFor, glyphFor = TB.glyphFor;

/* ---------------- diagram geometry ---------------- */
/* Everything below sits inside the shell path on purpose. The sticks used to be
   placed at y=212 while the body's central edge stopped at y=192, so they hung
   outside the outline; the small buttons carried text labels that landed on the
   d-pad and the face cluster. Both are gone. Nothing here overlaps anything else. */
var GEO = {
  ps:       { ls: [158, 178], rs: [242, 178], dp: [86, 118], face: [314, 118], guide: [200, 134, 10],
              small: [[8, 128, 74], [9, 272, 74]], touch: [148, 62, 104, 54] },
  xbox:     { ls: [104, 116], rs: [250, 186], dp: [140, 190], face: [314, 118], guide: [200, 86, 15],
              small: [[8, 172, 126], [9, 236, 126], [17, 200, 142]] },
  nintendo: { ls: [104, 116], rs: [250, 186], dp: [140, 190], face: [314, 118], guide: [224, 142, 10],
              small: [[8, 172, 126], [9, 236, 126], [17, 176, 142]] },
  generic:  { ls: [104, 116], rs: [250, 186], dp: [140, 190], face: [314, 118], guide: [200, 86, 15],
              small: [[8, 172, 126], [9, 236, 126], [17, 200, 142]] }
};
var BODY = "M66,46 C26,46 12,86 10,136 C8,190 24,276 62,276 C92,276 106,250 122,236 C142,220 166,214 200,214 " +
           "C234,214 258,220 278,236 C294,250 308,276 338,276 C376,276 392,188 390,136 C388,86 374,46 334,46 " +
           "C294,46 254,58 200,58 C146,58 106,46 66,46 Z";

function R(x, y, w, h, r, cls) { return svgEl("rect", { x: x, y: y, width: w, height: h, rx: r, "class": cls }); }
function C(cx, cy, r, cls) { return svgEl("circle", { cx: cx, cy: cy, r: r, "class": cls }); }
function T(x, y, txt, cls) { var t = svgEl("text", { x: x, y: y, "class": cls || "lbl" }); t.textContent = txt; return t; }

function padSVG(fam, nbtn, naxes) {
  var g = GEO[fam] || GEO.generic;
  var s = svgEl("svg", { viewBox: "0 0 400 290", "class": "tb-dev", role: "img", "aria-label": "Controller diagram" });
  s.style.maxWidth = "560px";
  var btn = {}, labels = {}, trig = {}, knob = [];

  /* triggers + bumpers sit behind the body */
  [[6, 84, "LT"], [7, 246, "RT"]].forEach(function (t) {
    if (nbtn <= t[0]) return;
    s.appendChild(R(t[1], 2, 70, 22, 10, "well"));
    var f = R(t[1] + 3, 5, 0, 16, 7, "fill"); s.appendChild(f); trig[t[0]] = f;
    s.appendChild(T(t[1] + 35, 13, t[2], "lbl sm"));
  });
  [[4, 70, "LB"], [5, 242, "RB"]].forEach(function (t) {
    if (nbtn <= t[0]) return;
    var r = R(t[1], 26, 88, 20, 9, "btn"); s.appendChild(r); btn[t[0]] = r;
    s.appendChild(T(t[1] + 44, 36, t[2], "lbl sm"));
  });

  s.appendChild(svgEl("path", { d: BODY, "class": "shell" }));

  if (g.touch && nbtn > 17) {
    var tp = R(g.touch[0], g.touch[1], g.touch[2], g.touch[3], 8, "btn"); s.appendChild(tp); btn[17] = tp;
    s.appendChild(T(g.touch[0] + g.touch[2] / 2, g.touch[1] + g.touch[3] / 2, "touchpad", "lbl sm"));
  }

  /* d-pad */
  var dx = g.dp[0], dy = g.dp[1];
  s.appendChild(R(dx - 12, dy - 12, 24, 24, 4, "plate"));
  [[12, dx - 11, dy - 36, 22, 25, "▲"], [13, dx - 11, dy + 11, 22, 25, "▼"],
   [14, dx - 36, dy - 11, 25, 22, "◀"], [15, dx + 11, dy - 11, 25, 22, "▶"]].forEach(function (d) {
    if (nbtn <= d[0]) return;
    var r = R(d[1], d[2], d[3], d[4], 4, "btn"); s.appendChild(r); btn[d[0]] = r;
  });

  /* face buttons */
  var fx = g.face[0], fy = g.face[1], off = 34;
  [[0, fx, fy + off], [1, fx + off, fy], [2, fx - off, fy], [3, fx, fy - off]].forEach(function (f) {
    if (nbtn <= f[0]) return;
    var c = C(f[1], f[2], 17, "btn"); s.appendChild(c); btn[f[0]] = c;
    var t = T(f[1], f[2], glyphFor(fam, f[0])); s.appendChild(t); labels[f[0]] = t;
  });

  /* small buttons */
  (g.small || []).forEach(function (b) {
    if (nbtn <= b[0]) return;
    var r = R(b[1] - 10, b[2] - 7, 20, 14, 6, "btn");
    var tt = svgEl("title"); tt.textContent = labelFor(fam, b[0]); r.appendChild(tt);
    s.appendChild(r); btn[b[0]] = r;
  });

  /* guide */
  if (nbtn > 16 && g.guide) {
    var gg = C(g.guide[0], g.guide[1], g.guide[2], "btn"); s.appendChild(gg); btn[16] = gg;
  }

  /* sticks */
  [[g.ls, 10, 0, 1, "L"], [g.rs, 11, 2, 3, "R"]].forEach(function (sk) {
    if (naxes <= sk[3]) return;
    s.appendChild(C(sk[0][0], sk[0][1], 30, "well"));
    s.appendChild(C(sk[0][0], sk[0][1], 2, "tick"));
    var k = C(sk[0][0], sk[0][1], 17, "knob"); s.appendChild(k);
    var lt = T(sk[0][0], sk[0][1], sk[4], "lbl sm"); s.appendChild(lt);
    knob.push({ node: k, label: lt, cx: sk[0][0], cy: sk[0][1], ax: sk[2], ay: sk[3], press: sk[1] });
  });

  return { node: s, btn: btn, labels: labels, trig: trig, knob: knob };
}

/* ---------------- view ---------------- */
var sel = $("#gp-sel"), body = $("#gp-body"), activeIdx = null, ui = null, sig = null, userPicked = false;   /* null, not "" — see note in tick() */

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
  var ks = Object.keys(PADS); sel.textContent = "";
  if (!ks.length) return;
  /* A wireless pad usually shows up twice — the dongle and the pad — and only
     one of them ever sends anything. Land on the live one, not slot zero. */
  var liveOne = ks.filter(function (k) { return PADS[k].active; })[0];
  /* Until you choose one yourself, keep moving to whichever device is actually
     sending input. A receiver enumerates before the pad wakes up, so picking
     once at connect time would leave you staring at the silent half of the pair. */
  if (!userPicked && liveOne && (activeIdx == null || !PADS[activeIdx] || !PADS[activeIdx].active)) {
    activeIdx = liveOne;
  }
  if (activeIdx == null || !PADS[activeIdx]) activeIdx = ks[0];
  ks.forEach(function (k) {
    var rec = PADS[k];
    var b = el("button", "tb-btn" + (k === activeIdx ? " on" : ""), shortName(rec) + (rec.active ? "" : "  \u00b7 quiet"));
    b.title = rec.active ? "This device is sending input" : "This device has not sent anything yet — it may be the wireless receiver rather than the controller";
    b.onclick = function () { userPicked = true; activeIdx = k; sig = null; buildSel(); build(); };
    sel.appendChild(b);
  });
  var hint = $("#gp-selhint");
  if (hint) {
    var quiet = ks.filter(function (k) { return !PADS[k].active; }).length;
    hint.textContent = ks.length > 1
      ? ks.length + " devices are connected. Wireless controllers often list their receiver separately" +
        (quiet ? " — the one marked quiet has sent nothing, so it is probably the receiver." : ".")
      : "";
  }
}

function build() {
  var rec = PADS[activeIdx];
  body.innerHTML = "";
  if (!rec) {
    body.appendChild(waitingPanel());
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

  /* diagram — only when the controller reports a standard layout */
  var pd = el("div", "tb-panel");
  var dia = null;
  if (rec.standard) {
    pd.appendChild(TB.ptitle("The controller"));
    dia = padSVG(fam, rec.buttons.length, rec.axes.length);
    pd.appendChild(dia.node);
  } else {
    pd.appendChild(TB.ptitle("Every control, as reported"));
    pd.appendChild(el("p", "tb-sub",
      "This controller reports a non-standard layout \u2014 " + rec.buttons.length + " buttons and " +
      rec.axes.length + " axes that do not map onto a normal gamepad. Leverless pads, fight sticks, " +
      "flight sticks and arcade sticks all do this. Drawing a picture of an Xbox pad here would be a lie, " +
      "so you get the raw numbers instead: press everything and watch every entry below turn green."));
  }
  var cl = TB.checklist(rec.buttons.map(function (_, i) { return { key: i, label: labelFor(fam, i) }; }));
  pd.appendChild(cl.node);
  pd.appendChild(el("p", "tb-note", rec.standard
    ? "Press every control on the pad and watch it light up here. The list underneath turns green as each one reports in \u2014 anything still grey at the end is either untested or dead."
    : "Every button this controller has is listed above, however many there are. Work along the whole thing until nothing is grey."));
  body.appendChild(pd);

  var grid = el("div", "tb-grid tb-cols2");
  var p1 = el("div", "tb-panel");
  p1.appendChild(TB.ptitle("Sticks — drift, range and return"));
  var sticks = el("div"); sticks.style.cssText = "display:flex;gap:20px;flex-wrap:wrap";
  var L = stickBlock("Left stick"), Rt = stickBlock("Right stick");
  if (rec.standard) {
    sticks.appendChild(L.node);
    if (rec.axes.length >= 4) sticks.appendChild(Rt.node);
  } else {
    sticks.appendChild(el("p", "tb-empty",
      "No stick drawing for a non-standard controller \u2014 axes 0 and 1 are not necessarily a stick on this device. Every axis is listed further down with its own bar."));
  }
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
  /* These names only mean anything on a standard pad. On a leverless or arcade
     controller button 6 is not a trigger, so labelling it "LT" would be a lie —
     those devices get their analog values in the button list instead. */
  if (rec.standard) {
    [[6, "LT / L2"], [7, "RT / R2"], [4, "LB / L1"], [5, "RB / R1"]].forEach(function (t) {
      if (rec.buttons.length > t[0]) { var m = TB.meterRow(t[1]); m.idx = t[0]; p2.appendChild(m.node); trigs.push(m); }
    });
  } else {
    p2.appendChild(el("p", "tb-empty", "No trigger readouts \u2014 this controller does not use the standard layout, so there is no way to know which of its buttons are triggers. Analog values for every button are in the list below."));
  }
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
  p4.appendChild(el("p", "tb-note", "An axis label turns green once that axis has actually moved, so you can work through all " + rec.axes.length + " of them and see which ones are dead. Triggers usually rest at -1.000 and a hat switch can report values outside -1 to +1 \u2014 both are normal."));
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
}

/* The blank page people saw used to be this, and it never rendered. It is the
   most important screen on the page: nobody can be expected to know that a
   browser hides a controller until the controller sends something. */
function waitingPanel() {
  var p = el("div", "tb-panel accent");
  var top = el("div");
  top.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:6px";
  var dot = el("span", "tb-dot");
  dot.style.cssText = "background:var(--red);box-shadow:0 0 0 4px var(--red-glow);animation:tb-pulse 1.4s ease-in-out infinite";
  top.appendChild(dot);
  var h = el("h2", null, "Listening for a controller");
  h.style.cssText = "font-family:var(--f-display);font-size:20px;font-weight:800";
  top.appendChild(h);
  p.appendChild(top);

  var lead = el("p", "tb-sub", "Nothing is connected yet. This page is checking several times a second, so the moment one appears it shows up here on its own.");
  p.appendChild(lead);

  var ol = el("ol", "tb-steps");
  [["1", "Plug it in by USB, or pair it over Bluetooth"],
   ["2", "Press any button on the controller — A, or a trigger"],
   ["3", "Leave it flat on the bench for a second while it scores itself"]]
    .forEach(function (st, i) {
      var li = el("li"); if (i === 1) li.className = "on";
      li.appendChild(el("b", null, st[0]));
      li.appendChild(el("span", null, st[1]));
      ol.appendChild(li);
    });
  p.appendChild(ol);

  var flags = el("ul", "tb-flags");
  [["warn", "press a button", "Browsers hide a controller from a web page until it sends its first input. That is a deliberate browser rule, not a fault with the pad and not a fault here \u2014 until you press something, the page genuinely cannot see it."],
   ["ok", "xbox by usb", "Plug in, press A, and it appears straight away."],
   ["ok", "bluetooth", "Pair it in Windows settings first, then press a button. Pairing alone is not enough."],
   ["warn", "this tab", "Keep this tab in front while you press the button. A background tab is slowed down by the browser and may miss it."]]
    .forEach(function (f) {
      var li = el("li", f[0]);
      li.appendChild(el("span", "tag", f[1]));
      li.appendChild(el("span", null, f[2]));
      flags.appendChild(li);
    });
  p.appendChild(flags);
  return p;
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
  g.strokeStyle = TB.paint("dev-rim"); g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, R2, 0, 7); g.stroke();
  g.beginPath(); g.arc(cx, cy, R2 * 0.5, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(cx - R2, cy); g.lineTo(cx + R2, cy); g.moveTo(cx, cy - R2); g.lineTo(cx, cy + R2); g.stroke();
  g.strokeStyle = TB.paint("dev-tip"); g.lineWidth = 1.4; g.beginPath();
  for (var i = 0; i < blk.trace.length; i++) {
    var a = (i / blk.trace.length) * Math.PI * 2 - Math.PI, r = blk.trace[i] * R2;
    var px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath(); g.stroke();
  g.fillStyle = TB.paint("pass-t16"); g.beginPath(); g.arc(cx, cy, R2 * 0.08, 0, 7); g.fill();
  var ddx = cx + x * R2, ddy = cy + y * R2;
  g.fillStyle = pressed ? TB.paint("warn") : TB.paint("pass");
  g.beginPath(); g.arc(ddx, ddy, 6, 0, 7); g.fill();
  g.strokeStyle = TB.paint("pass-l40"); g.beginPath(); g.moveTo(cx, cy); g.lineTo(ddx, ddy); g.stroke();
  blk.read.textContent = "X " + x.toFixed(3) + "   Y " + y.toFixed(3) + "   mag " + (mag * 100).toFixed(1) + "%";

  /* return-to-centre */
  var now = performance.now();
  if (mag > 0.5) { blk.wasOut = true; blk.outAt = now; }
  else if (blk.wasOut && now - blk.outAt > 350) { blk.wasOut = false; if (mag > blk.ret) blk.ret = mag; }
}

function tick() {
  if (TB.view() !== "gamepad") return;
  /* sig starts as null rather than "". With no controllers connected the key
     list is also "", so "" !== "" was false and the page was never built at
     all — you got a blank panel with not even the "press a button" hint on it. */
  var keys = Object.keys(PADS);
  if (!keys.length) userPicked = false;
  /* the signature carries each device's liveness, so the page rebuilds the
     moment a quiet device starts talking */
  var ks = keys.map(function (k) { return k + (PADS[k].active ? "!" : ""); }).join(",");
  if (ks !== sig) { sig = ks; buildSel(); build(); }
  if (!ui) return;
  var rec = PADS[activeIdx]; if (!rec) { sig = null; return; }
  ui.rec = rec;
  /* The phase is part of the signature, not just the score: while the pad is
     settling the score stays null, and without this the panel would never
     update from "let go" to "reading". */
  var vsig = String(rec.score) + "|" + TB.restPhase(rec);
  if (vsig !== ui.lastScore) {
    ui.lastScore = vsig;
    verdict(ui.vnode, rec.score, rec.flags,
      TB.restPhase(rec) === "settle"
        ? "Let go of the controller — waiting for it to sit still."
        : "Reading it at rest…");
    badge("gamepad", rec.score != null ? String(Math.round(rec.score)) : "", rec.score >= 90);
  }
  /* diagram */
  var d = ui.dia;
  if (d) Object.keys(d.btn).forEach(function (k) {
    var i = parseInt(k, 10), down = !!rec.pressed[i];
    d.btn[k].classList.toggle("on", down);
    d.btn[k].classList.toggle("seen", !!rec.seenBtn[i]);
    if (d.labels[k]) d.labels[k].classList.toggle("on", down);
  });
  if (d) Object.keys(d.trig).forEach(function (k) {
    var v = rec.buttons[parseInt(k, 10)] || 0;
    d.trig[k].setAttribute("width", (62 * clamp(v, 0, 1)).toFixed(1));
  });
  if (d) d.knob.forEach(function (kn) {
    var x = rec.axes[kn.ax] || 0, y = rec.axes[kn.ay] || 0;
    kn.node.setAttribute("cx", (kn.cx + x * 12).toFixed(1));
    kn.node.setAttribute("cy", (kn.cy + y * 12).toFixed(1));
    kn.label.setAttribute("x", (kn.cx + x * 12).toFixed(1));
    kn.label.setAttribute("y", (kn.cy + y * 12).toFixed(1));
    var pressed = !!rec.pressed[kn.press];
    kn.node.classList.toggle("on", pressed);
    kn.label.classList.toggle("on", pressed);
  });
  rec.buttons.forEach(function (_, i) { ui.cl.set(i, !!rec.seenBtn[i]); });

  if (rec.standard) {
    drawStick(ui.L, rec.axes[0] || 0, rec.axes[1] || 0, rec.pressed[10]);
    if (rec.axes.length >= 4) drawStick(ui.R, rec.axes[2] || 0, rec.axes[3] || 0, rec.pressed[11]);
  }
  /* drawStick, which is what moves .ret, only runs for standard pads. A
     leverless or arcade stick was being handed a green "0.0%" for a figure the
     panel had just finished saying it could not measure. */
  if (rec.standard) {
    ui.vRetL.textContent = (ui.L.ret * 100).toFixed(1) + "%";
    ui.vRetL.className = "v " + (ui.L.ret > 0.09 ? "fail" : ui.L.ret > 0.05 ? "warn" : "pass");
    ui.vRetR.textContent = (ui.R.ret * 100).toFixed(1) + "%";
    ui.vRetR.className = "v " + (ui.R.ret > 0.09 ? "fail" : ui.R.ret > 0.05 ? "warn" : "pass");
  } else {
    ui.vRetL.textContent = "n/a"; ui.vRetL.className = "v";
    ui.vRetR.textContent = "n/a"; ui.vRetR.className = "v";
  }
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
  if (rec.standard) { travel(6, ui.vLT); travel(7, ui.vRT); }

  ui.btns.forEach(function (b, i) {
    var v = rec.buttons[i] || 0, down = !!rec.pressed[i];
    b.node.classList.toggle("down", down);
    b.node.classList.toggle("seen", !!rec.seenBtn[i]);
    b.val.textContent = v > 0 && v < 1 ? v.toFixed(2) : (down ? "1" : "0");
  });
  ui.axes.forEach(function (m, i) {
    var v = rec.axes[i] || 0;
    m.fill.style.width = (clamp((v + 1) / 2, 0, 1) * 100) + "%";
    m.val.textContent = v.toFixed(3);
    var moved = !!rec.seenAxis[i];
    m.node.classList.toggle("seen", moved);
    m.fill.className = moved ? "pass" : "";
  });
}
TB.onPads(tick);
TB.onEnter("gamepad", function () { sig = null; tick(); });
$("#gp-rescore").onclick = function () {
  var r = PADS[activeIdx];
  if (r) { TB.beginRestSample(r); if (ui) ui.lastScore = undefined; toast("Re-scoring", "Let go of the controller. It reads once everything is still.", null); }
};
/* Mounted once, at module level. TB.hidMount only appends, and build() runs on
   every signature change, every visit to the page and every device-picker
   click — calling it from in there stacked a duplicate identity box per
   rebuild, forever. */
TB.hidMount("#gp-id", "Press this to read the pad's USB product name. Most controllers show up; a few Bluetooth ones do not.");

$("#gp-clear").onclick = function () {
  var r = PADS[activeIdx];
  if (r) { r.seenBtn = {}; r.btnMin = []; r.btnMax = []; r.resolution = {}; }
  if (ui) { ui.L.trace.fill(0); ui.R.trace.fill(0); ui.L.ret = 0; ui.R.ret = 0; }
};
})();
