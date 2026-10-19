/* Testbench — MIDI controllers and keyboards.

   "MIDI" is three very different machines wearing one plug: a keyboard, a pad
   controller, and a box of knobs and faders. A page that shows an 88-key piano
   to someone testing a fader bank is worse than useless, so this page shows
   nothing until the device speaks, then reveals ONLY the controls it actually
   sends:

     notes on a melodic channel .... the keyboard
     notes on channel 10 ........... the drum pads
     control-change (knobs/faders) . a tile per control, as you touch them
     pitch bend / mod / sustain .... the wheels and pedal

   What actually fails on used gear, in the order you meet it:
     dead keys/pads   the contact has stopped closing
     weak keys/pads   it closes late, so it arrives at a low velocity while its
                      neighbours arrive at 100+. Worse than dead, because it
                      plays, and the buyer only notices a week later
     stuck notes      a Note On with no matching Note Off
     dead wheels      pitch bend that will not return to centre, a mod wheel or
                      fader with a flat spot, a knob that never reaches an end

   Web MIDI needs no driver and no permission prompt for input-only access in
   Chrome, but it does need a secure context. On http:// it simply is not there,
   which the page says plainly rather than looking broken. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp;
var verdict = TB.verdict, badge = TB.badge, toast = TB.toast, watch = TB.watch;

var LOW = 21, HIGH = 108;                 /* A0 to C8, a full 88 */
var NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var BLACK = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };
function noteName(n) { return NAMES[n % 12] + (Math.floor(n / 12) - 1); }

var access = null, keyEls = {}, padEls = {}, knobEls = {}, st = fresh(), bound = Object.create(null);
var shown = Object.create(null);
function fresh() {
  var b = function () { return Object.create(null); };
  return { on: b(), vel: b(), count: 0, notes: 0, stuck: b(),
           bend: 8192, mod: 0, cc: b(), chans: b(), sustain: false, clock: 0,
           pads: b(), padOn: b(), padMax: b(), padSeen: 0,
           ccv: b(), ccMin: b(), ccMax: b(), wheelsTouched: false };
}

/* ---------- reveal only what the device sends ---------- */
function reveal(id) {
  if (shown[id]) return;
  shown[id] = true;
  var n = $("#mi-panel-" + id);
  if (n) n.hidden = false;
  var hint = $("#mi-hint");
  if (hint) hint.hidden = true;
}

/* ---------- the keyboard ---------- */
function buildKeys() {
  var host = $("#mi-keys"); if (!host) return;
  host.textContent = ""; keyEls = {};
  var whites = [];
  for (var n = LOW; n <= HIGH; n++) if (!BLACK[n % 12]) whites.push(n);
  var unit = 100 / whites.length, wi = 0;
  for (n = LOW; n <= HIGH; n++) {
    var black = !!BLACK[n % 12];
    var k = el("div", "tb-key" + (black ? " black" : " white"));
    k.dataset.note = n;
    k.title = noteName(n) + "  (note " + n + ")";
    if (black) {
      k.style.left = (wi * unit - unit * 0.3) + "%";
      k.style.width = (unit * 0.6) + "%";
    } else {
      k.style.left = (wi * unit) + "%";
      k.style.width = unit + "%";
      if (n % 12 === 0) k.appendChild(el("span", "oct", noteName(n)));
      wi++;
    }
    host.appendChild(k);
    keyEls[n] = k;
  }
}

function paintKey(n) {
  var k = keyEls[n]; if (!k) return;
  var v = st.vel[n];
  k.classList.toggle("down", !!st.on[n]);
  k.classList.toggle("seen", v != null);
  k.classList.toggle("weak", v != null && v < 45);
  k.classList.toggle("stuck", !!st.stuck[n]);
  if (v != null) k.style.setProperty("--v", (0.25 + (v / 127) * 0.75).toFixed(3));
}

/* ---------- the pads ----------
   A pad grid is not fixed like a keyboard: a 4x4 unit and a 64-pad unit are
   both "pads". So cells are created as notes arrive, in the order the device
   sends them, which is the order the operator strikes them. */
function padCell(note) {
  if (padEls[note]) return padEls[note];
  var host = $("#mi-pads"); if (!host) return null;
  var c = el("div", "tb-pad");
  c.dataset.note = note;
  c.appendChild(el("span", "lbl", noteName(note)));
  c.appendChild(el("em"));
  host.appendChild(c);
  padEls[note] = c;
  return c;
}
function paintPad(note) {
  var c = padCell(note); if (!c) return;
  var mx = st.padMax[note];
  c.classList.toggle("down", !!st.padOn[note]);
  c.classList.toggle("seen", mx != null);
  c.classList.toggle("weak", mx != null && mx < 45);
  if (mx != null) {
    c.style.setProperty("--v", (0.2 + (mx / 127) * 0.8).toFixed(3));
    c.querySelector("em").textContent = mx;
  }
}

/* ---------- knobs and faders ----------
   One tile per CC number, created the first time that control moves, showing
   the live value and the full span it has covered so a knob that never reaches
   an end is visible. */
function knobTile(cc) {
  if (knobEls[cc]) return knobEls[cc];
  var host = $("#mi-knobs"); if (!host) return null;
  var t = el("div", "tb-knob");
  t.dataset.cc = cc;
  var top = el("div", "kt");
  top.appendChild(el("span", "cc", "CC " + cc));
  var val = el("span", "val", "0");
  top.appendChild(val);
  t.appendChild(top);
  var bar = el("div", "bar"); var fill = el("i"); bar.appendChild(fill); t.appendChild(bar);
  var span = el("div", "span", "range —");
  t.appendChild(span);
  knobEls[cc] = { node: t, val: val, fill: fill, span: span };
  host.appendChild(t);
  return knobEls[cc];
}
function paintKnob(cc) {
  var k = knobTile(cc); if (!k) return;
  var v = st.ccv[cc] || 0;
  k.val.textContent = v;
  k.fill.style.width = (v / 127 * 100) + "%";
  var lo = st.ccMin[cc], hi = st.ccMax[cc];
  k.span.textContent = "range " + lo + "–" + hi;
  var full = lo <= 2 && hi >= 125;
  k.node.classList.toggle("full", full);
  k.node.classList.toggle("partial", (hi - lo) > 10 && !full);
}

/* ---------- messages ---------- */
function onMessage(e) {
  var d = e.data; if (!d || !d.length) return;
  var status = d[0] & 0xF0, chan = (d[0] & 0x0F) + 1;
  if (d[0] === 0xF8) { st.clock++; return; }          /* clock: counted, not logged */
  st.chans[chan] = true;

  if (status === 0x90 && d[2] > 0) {
    st.count++;
    if (chan === 10) {                                /* GM drums: a pad */
      if (st.padMax[d[1]] == null) st.padSeen++;
      st.padOn[d[1]] = true;
      if (st.padMax[d[1]] == null || d[2] > st.padMax[d[1]]) st.padMax[d[1]] = d[2];
      reveal("pads"); paintPad(d[1]);
      log("PAD", noteName(d[1]) + "  vel " + d[2] + "  ch " + chan);
    } else {
      st.on[d[1]] = true;
      if (st.vel[d[1]] == null) st.notes++;
      st.vel[d[1]] = d[2];
      delete st.stuck[d[1]];
      reveal("keys"); paintKey(d[1]);
      log("NOTE ON", noteName(d[1]) + "  vel " + d[2] + "  ch " + chan);
    }
  } else if (status === 0x80 || (status === 0x90 && d[2] === 0)) {
    if (chan === 10) { st.padOn[d[1]] = false; paintPad(d[1]); log("PAD OFF", noteName(d[1]) + "  ch " + chan); }
    else { st.on[d[1]] = false; paintKey(d[1]); log("NOTE OFF", noteName(d[1]) + "  ch " + chan); }
  } else if (status === 0xE0) {
    st.bend = d[1] | (d[2] << 7);
    st.wheelsTouched = true; reveal("wheels"); paintWheels();
    st.count++;
  } else if (status === 0xB0) {
    st.count++;
    st.cc[d[1]] = d[2];
    if (d[1] === 1) { st.mod = d[2]; st.wheelsTouched = true; reveal("wheels"); paintWheels(); log("CC 1 (mod)", d[2] + "  ch " + chan); }
    else if (d[1] === 64) { st.sustain = d[2] >= 64; st.wheelsTouched = true; reveal("wheels"); paintWheels(); log("CC 64 (sustain)", d[2] + "  ch " + chan); }
    else {                                            /* a knob or a fader */
      st.ccv[d[1]] = d[2];
      if (st.ccMin[d[1]] == null || d[2] < st.ccMin[d[1]]) st.ccMin[d[1]] = d[2];
      if (st.ccMax[d[1]] == null || d[2] > st.ccMax[d[1]]) st.ccMax[d[1]] = d[2];
      reveal("knobs"); paintKnob(d[1]);
      log("CC " + d[1], d[2] + "  ch " + chan);
    }
  } else if (status === 0xD0) {
    log("AFTERTOUCH", d[1] + "  ch " + chan);
  } else if (status === 0xA0) {
    log("POLY AT", noteName(d[1]) + "  " + d[2]);
  }
  stats();
}

function log(tag, txt) {
  var box = $("#mi-log"); if (!box) return;
  var d = el("div");
  d.appendChild(el("b", null, tag));
  d.appendChild(document.createTextNode("  " + txt));
  box.insertBefore(d, box.firstChild);
  while (box.childElementCount > 140) box.lastChild.remove();
}

function paintWheels() {
  var b = (st.bend - 8192) / 8192;                   /* -1 .. +1 */
  $("#mi-bendbar").style.width = (Math.abs(b) * 50) + "%";
  $("#mi-bendbar").style.marginLeft = (b < 0 ? 50 + b * 50 : 50) + "%";
  $("#mi-bendv").textContent = (b > 0 ? "+" : "") + (b * 100).toFixed(0) + "%";
  $("#mi-modbar").style.width = (st.mod / 127 * 100) + "%";
  $("#mi-modv").textContent = Math.round(st.mod / 127 * 100) + "%";
  var s = $("#mi-sus");
  s.textContent = st.sustain ? "DOWN" : "up";
  s.className = "v " + (st.sustain ? "pass" : "");
}

/* ---------- the verdict, chosen by what the device actually is ---------- */
function stats() {
  /* keyboard readouts */
  $("#mi-notes").textContent = st.notes;
  $("#mi-msgs").textContent = st.count;
  var vels = [], weak = [];
  Object.keys(st.vel).forEach(function (n) {
    vels.push(st.vel[n]);
    if (st.vel[n] < 45) weak.push(noteName(+n));
  });
  var avg = vels.length ? vels.reduce(function (a, b) { return a + b; }, 0) / vels.length : 0;
  $("#mi-vel").textContent = vels.length ? Math.round(avg) : "—";
  var lo = vels.length ? Math.min.apply(null, vels) : 0;
  var hi = vels.length ? Math.max.apply(null, vels) : 0;
  $("#mi-velrange").textContent = vels.length ? lo + " – " + hi : "—";
  $("#mi-chans").textContent = Object.keys(st.chans).join(", ") || "—";

  /* pad readouts */
  var pv = [];
  Object.keys(st.padMax).forEach(function (n) { pv.push(st.padMax[n]); });
  if ($("#mi-padseen")) {
    $("#mi-padseen").textContent = st.padSeen;
    $("#mi-padmin").textContent = pv.length ? Math.min.apply(null, pv) : "—";
    $("#mi-padmax").textContent = pv.length ? Math.max.apply(null, pv) : "—";
  }

  if (!st.count) {
    verdict($("#mi-verdict"), null, [], "Play a key, hit a pad, or move a knob, fader or wheel. The page shows the controls your device sends.");
    badge("midi", "");
    return;
  }

  var flags = [], score = 100;

  /* KEYBOARD — the original path, unchanged, so a keyboard grades exactly as before */
  if (st.notes > 0) {
    if (weak.length) {
      score -= Math.min(50, weak.length * 8);
      flags.push({ level: "bad", tag: "weak keys", text: weak.join(", ") + " came in under velocity 45 while the average is " + Math.round(avg) + ". The contact is closing late — it plays, so it passes a listen test, and the buyer finds it a week later." });
    }
    var stuck = Object.keys(st.stuck).map(function (n) { return noteName(+n); });
    if (stuck.length) {
      score -= 30;
      flags.push({ level: "bad", tag: "stuck", text: stuck.join(", ") + " sent a note on with no note off." });
    }
    if (st.notes < 12) {
      score -= 10;
      flags.push({ level: "warn", tag: "coverage", text: "Only " + st.notes + " distinct key" + (st.notes === 1 ? "" : "s") + " played. A dead key looks exactly like one you have not pressed." });
    } else {
      flags.push({ level: "ok", tag: "coverage", text: st.notes + " distinct keys, velocity " + lo + " to " + hi + "." });
    }
    if (hi - lo > 0 && lo > 45) flags.push({ level: "ok", tag: "velocity", text: "Every key cleared velocity 45." });
    if (Math.abs(st.bend - 8192) > 200) {
      score -= 12;
      flags.push({ level: "warn", tag: "pitch bend", text: "The bend wheel is resting off centre (" + st.bend + " of 16384). It should spring back to 8192." });
    }
    verdict($("#mi-verdict"), clamp(score, 0, 100), flags);
    badge("midi", st.notes + " keys", score >= 90);
    return;
  }

  /* PADS */
  if (st.padSeen > 0) {
    var pweak = [];
    Object.keys(st.padMax).forEach(function (n) { if (st.padMax[n] < 45) pweak.push(noteName(+n)); });
    var pmin = Math.min.apply(null, pv), pmax = Math.max.apply(null, pv);
    if (pweak.length) {
      score -= Math.min(50, pweak.length * 10);
      flags.push({ level: "bad", tag: "weak pads", text: pweak.join(", ") + " never got past a soft hit (under velocity 45). The sensor is worn — it triggers, but quietly, whatever you do." });
    } else {
      flags.push({ level: "ok", tag: "response", text: "Every pad struck reached a firm velocity (" + pmin + "–" + pmax + ")." });
    }
    flags.push({ level: st.padSeen < 4 ? "warn" : "ok", tag: "coverage", text: st.padSeen + " pad" + (st.padSeen === 1 ? "" : "s") + " hit. A pad you have not struck looks the same as a dead one, so work through all of them." });
    verdict($("#mi-verdict"), clamp(score, 0, 100), flags);
    badge("midi", st.padSeen + " pads", score >= 90);
    return;
  }

  /* KNOBS & FADERS */
  var ccs = Object.keys(st.ccv);
  if (ccs.length > 0) {
    var partial = ccs.filter(function (c) { return !(st.ccMin[c] <= 2 && st.ccMax[c] >= 125); });
    if (partial.length) {
      score -= Math.min(40, partial.length * 8);
      flags.push({ level: "warn", tag: "range", text: partial.length + " control" + (partial.length === 1 ? "" : "s") + " (CC " + partial.join(", ") + ") did not reach both 0 and 127. Sweep each one fully end to end — if it still will not, the track is worn." });
    } else {
      flags.push({ level: "ok", tag: "range", text: "Every control swept the full 0–127." });
    }
    flags.push({ level: "ok", tag: "controls", text: ccs.length + " knob/fader" + (ccs.length === 1 ? "" : "s") + " responded (CC " + ccs.join(", ") + ")." });
    verdict($("#mi-verdict"), clamp(score, 0, 100), flags);
    badge("midi", ccs.length + " CC", score >= 90);
    return;
  }

  /* WHEELS / PEDAL only */
  if (st.wheelsTouched) {
    if (Math.abs(st.bend - 8192) > 200) {
      score -= 12;
      flags.push({ level: "warn", tag: "pitch bend", text: "The bend wheel is resting off centre (" + st.bend + " of 16384). It should spring back to 8192." });
    } else {
      flags.push({ level: "ok", tag: "pitch bend", text: "Bend springs back to centre." });
    }
    flags.push({ level: "ok", tag: "controls", text: "Mod wheel and sustain responded." });
    verdict($("#mi-verdict"), clamp(score, 0, 100), flags);
    badge("midi", "wheels", score >= 90);
    return;
  }

  verdict($("#mi-verdict"), null, [], "Play a key, hit a pad, or move a knob, fader or wheel.");
}

/* ---------- ports ---------- */
/* The port name is a hint, not proof — it lets the page show the likely layout
   before the first note so an empty pad box does not greet someone who plugged
   in a pad controller. The messages themselves still decide what finally shows. */
function hintFromName(name) {
  var s = (name || "").toLowerCase();
  if (/launchpad|\bmpd\b|\bmpc\b|maschine|beatstep|pad|spd|drum/.test(s)) reveal("pads");
  if (/nanokontrol|faderport|control|mixer|bcf|bcr|xtouch|x-touch|fader/.test(s)) reveal("knobs");
  if (/key|piano|keystation|mpk|keylab|oxygen|axiom|\bkomplete\b|\bs61\b|\bs49\b|\bs88\b/.test(s)) reveal("keys");
}

function bindInputs() {
  if (!access) return;
  var list = $("#mi-ports"); list.textContent = "";
  var n = 0;
  access.inputs.forEach(function (inp) {
    n++;
    if (!bound[inp.id]) { inp.onmidimessage = onMessage; bound[inp.id] = true; }
    hintFromName(inp.name);
    var row = el("div", "tb-chiprow");
    var b = el("button", "go", inp.name || "MIDI in");
    b.type = "button"; b.disabled = true;
    b.title = (inp.manufacturer || "") + " · " + inp.id;
    row.appendChild(b);
    list.appendChild(row);
  });
  if (!n) list.appendChild(el("p", "tb-note", "No MIDI inputs. Plug the keyboard, pad or controller in over USB — class-compliant gear needs no driver — then press Connect again."));
  TB.chip("midi", n > 0, n ? String(n) : "none");
  $("#mi-state").textContent = n
    ? n + (n === 1 ? " input" : " inputs") + " listening."
    : "Connected to MIDI, but nothing is plugged in.";
}

function connect() {
  if (!navigator.requestMIDIAccess) {
    $("#mi-state").textContent = "This browser has no Web MIDI. Chrome, Edge and Opera have it; Safari and Firefox do not. It also needs https — on a plain http page the API is absent even in Chrome.";
    toast("No Web MIDI here", "Use Chrome or Edge over https.", "bad");
    return;
  }
  $("#mi-state").textContent = "Asking for MIDI access…";
  navigator.requestMIDIAccess({ sysex: false }).then(function (a) {
    access = a;
    a.onstatechange = function (e) {
      watch("MIDI", (e.port && e.port.name ? e.port.name : "port") + " " + (e.port ? e.port.state : ""));
      bindInputs();
    };
    bindInputs();
    $("#mi-connect").textContent = "Reconnect";
  }, function (err) {
    $("#mi-state").textContent = "MIDI access was refused (" + (err && err.name ? err.name : "error") + ").";
    toast("MIDI refused", "The browser would not grant access.", "bad");
  });
}

/* ---------- wiring ---------- */
buildKeys();
paintWheels();
stats();
$("#mi-connect").onclick = connect;
$("#mi-reset").onclick = function () {
  st = fresh();
  Object.keys(keyEls).forEach(function (n) {
    keyEls[n].className = keyEls[n].className.replace(/\s*(down|seen|weak|stuck)/g, "");
  });
  if ($("#mi-pads")) $("#mi-pads").textContent = "";
  if ($("#mi-knobs")) $("#mi-knobs").textContent = "";
  padEls = {}; knobEls = {};
  $("#mi-log").textContent = "";
  paintWheels(); stats();
};
/* A note held for this long with no note off is not being held by a finger. */
setInterval(function () {
  if (TB.view() !== "midi") return;
  var now = Date.now(), dirty = false;
  Object.keys(st.on).forEach(function (n) {
    if (!st.on[n]) return;
    st.stuckAt = st.stuckAt || Object.create(null);
    if (!st.stuckAt[n]) st.stuckAt[n] = now;
    else if (now - st.stuckAt[n] > 6000 && !st.stuck[n]) { st.stuck[n] = true; dirty = true; paintKey(+n); }
  });
  Object.keys(st.stuckAt || {}).forEach(function (n) { if (!st.on[n]) delete st.stuckAt[n]; });
  if (dirty) stats();
}, 1000);

TB.onEnter("midi", function () { if (!access) connect(); });
TB.midiState = function () { return st; };
})();
