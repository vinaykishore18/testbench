/* Testbench — MIDI controllers and keyboards.

   What actually fails on a second-hand MIDI keyboard, in the order you meet it:

     dead keys      the contact under one note has stopped closing
     weak keys      it closes, but late, so the note arrives at a low velocity
                    while its neighbours arrive at 100+. Worse than dead, because
                    it plays, and the buyer only notices a week later
     stuck notes    a Note On with no matching Note Off
     dead wheels    pitch bend that will not return to centre, or a mod wheel
                    with a flat spot

   So the page is built around velocity rather than around "did it make a
   sound". Every key you press is kept with the velocity it reported, and the
   spread across the keyboard is what the verdict is computed from: one key
   coming in at 40 when the rest average 100 is the fault you are looking for.

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

var access = null, keyEls = {}, st = fresh(), bound = Object.create(null);
function fresh() {
  var b = function () { return Object.create(null); };
  return { on: b(), vel: b(), count: 0, notes: 0, stuck: b(),
           bend: 8192, mod: 0, cc: b(), chans: b(), sustain: false, clock: 0 };
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
  /* velocity drives the strength of the mark, so a soft key looks soft */
  if (v != null) k.style.setProperty("--v", (0.25 + (v / 127) * 0.75).toFixed(3));
}

/* ---------- messages ---------- */
function onMessage(e) {
  var d = e.data; if (!d || !d.length) return;
  var status = d[0] & 0xF0, chan = (d[0] & 0x0F) + 1;
  if (d[0] === 0xF8) { st.clock++; return; }          /* clock: counted, not logged */
  st.chans[chan] = true;

  if (status === 0x90 && d[2] > 0) {
    st.on[d[1]] = true;
    if (st.vel[d[1]] == null) st.notes++;
    st.vel[d[1]] = d[2];
    st.count++;
    delete st.stuck[d[1]];
    log("NOTE ON", noteName(d[1]) + "  vel " + d[2] + "  ch " + chan);
    paintKey(d[1]);
  } else if (status === 0x80 || (status === 0x90 && d[2] === 0)) {
    st.on[d[1]] = false;
    log("NOTE OFF", noteName(d[1]) + "  ch " + chan);
    paintKey(d[1]);
  } else if (status === 0xE0) {
    st.bend = d[1] | (d[2] << 7);
    paintWheels();
  } else if (status === 0xB0) {
    st.cc[d[1]] = d[2];
    if (d[1] === 1) { st.mod = d[2]; paintWheels(); }
    if (d[1] === 64) { st.sustain = d[2] >= 64; paintWheels(); }
    log("CC " + d[1], d[2] + "  ch " + chan);
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

function stats() {
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

  var flags = [], score = 100;
  if (!st.count) {
    verdict($("#mi-verdict"), null, [], "Play a few keys. Work up the whole keyboard, then the wheels and the sustain pedal.");
    badge("midi", ""); return;
  }
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
}

/* ---------- ports ---------- */
function bindInputs() {
  if (!access) return;
  var list = $("#mi-ports"); list.textContent = "";
  var n = 0;
  access.inputs.forEach(function (inp) {
    n++;
    if (!bound[inp.id]) { inp.onmidimessage = onMessage; bound[inp.id] = true; }
    var row = el("div", "tb-chiprow");
    var b = el("button", "go", inp.name || "MIDI in");
    b.type = "button"; b.disabled = true;
    b.title = (inp.manufacturer || "") + " · " + inp.id;
    row.appendChild(b);
    list.appendChild(row);
  });
  if (!n) list.appendChild(el("p", "tb-note", "No MIDI inputs. Plug the keyboard in over USB — class-compliant gear needs no driver — then press Connect again."));
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
