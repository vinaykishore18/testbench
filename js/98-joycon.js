/* Testbench — Joy-Cons and Pro Controllers over WebHID.
   The Gamepad API hands you a stick position normalised to -1..+1, already
   run through whatever calibration the controller is carrying. That hides the
   thing you most need to see. Talking to the controller directly gets you the
   raw 12-bit reading AND the calibration stored in its own flash — including
   whether somebody has recalibrated it to paper over drift before selling it.

   Protocol details come from the long-standing community reverse-engineering
   of the Switch HID protocol. Nothing here is an exploit: it is the same
   accessory protocol any third-party dock or adapter speaks. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp;
var verdict = TB.verdict, toast = TB.toast;

var NINTENDO = 0x057E;
var MODELS = {
  0x2006: { name: "Joy-Con (L)", side: "left" },
  0x2007: { name: "Joy-Con (R)", side: "right" },
  0x2009: { name: "Pro Controller", side: "both" },
  0x200E: { name: "Joy-Con Charging Grip", side: "both" }
};
var NEUTRAL = [0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40];
var BUZZ    = [0x74, 0xBE, 0xBD, 0x6F, 0x74, 0xBE, 0xBD, 0x6F];

var dev = null, model = null, counter = 0, pending = [], live = null, imuOn = false;

/* I could not test this against a real Joy-Con, so every step is logged.
   If something does not work, screenshot this and it tells me exactly why. */
var reportsLogged = 0;
function hex(arr, n) {
  return Array.prototype.slice.call(arr, 0, n || 16)
    .map(function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(" ");
}
function dlog(tag, txt) {
  var box = $("#jc-raw"); if (!box) return;
  var d = el("div");
  d.appendChild(el("b", null, TB.stamp() + "  " + tag));
  d.appendChild(document.createTextNode("   " + txt));
  box.insertBefore(d, box.firstChild);
  while (box.childElementCount > 120) box.lastChild.remove();
}

/* ---------------- low level ---------------- */
function nextCounter() { counter = (counter + 1) & 0x0F; return counter; }

function sendSub(sub, args, rumble) {
  if (!dev) return Promise.reject(new Error("not connected"));
  var body = [nextCounter()].concat(rumble || NEUTRAL, [sub], args || []);
  dlog("SENT", "subcommand 0x" + sub.toString(16) + "  args [" + (args || []).join(",") + "]");
  return dev.sendReport(0x01, new Uint8Array(body));
}
/* wait for the 0x21 reply that acknowledges a given subcommand */
function subcommand(sub, args, timeout) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () {
      pending = pending.filter(function (p) { return p !== entry; });
      dlog("TIMEOUT", "no reply to subcommand 0x" + sub.toString(16) + " within " + (timeout || 1500) + " ms");
      reject(new Error("no reply to subcommand 0x" + sub.toString(16)));
    }, timeout || 1500);
    var entry = { sub: sub, resolve: function (d) { clearTimeout(t); resolve(d); } };
    pending.push(entry);
    sendSub(sub, args).catch(function (e) { clearTimeout(t); reject(e); });
  });
}
/* read `len` bytes from the controller's own flash */
function readSPI(addr, len) {
  var a = [addr & 0xFF, (addr >> 8) & 0xFF, (addr >> 16) & 0xFF, (addr >> 24) & 0xFF, len];
  return subcommand(0x10, a).then(function (d) {
    var out = Array.prototype.slice.call(d, 5, 5 + len);
    dlog("FLASH", "0x" + addr.toString(16) + " (" + len + " bytes) -> " + hex(out, len));
    return out;
  });
}

/* ---------------- calibration maths ---------------- */
/* nine bytes pack six 12-bit values; the left stick lists max first, the
   right stick lists centre first. That asymmetry is in the hardware. */
function unpack(d) {
  return [
    d[0] | ((d[1] & 0x0F) << 8),
    (d[1] >> 4) | (d[2] << 4),
    d[3] | ((d[4] & 0x0F) << 8),
    (d[4] >> 4) | (d[5] << 4),
    d[6] | ((d[7] & 0x0F) << 8),
    (d[7] >> 4) | (d[8] << 4)
  ];
}
function decodeCal(d, isLeft) {
  var v = unpack(d);
  return isLeft
    ? { xMax: v[0], yMax: v[1], xCentre: v[2], yCentre: v[3], xMin: v[4], yMin: v[5] }
    : { xCentre: v[0], yCentre: v[1], xMin: v[2], yMin: v[3], xMax: v[4], yMax: v[5] };
}
function offCentre(raw, centre, above, below) {
  var d = raw - centre;
  if (d === 0) return 0;
  var span = d > 0 ? (above || 1) : (below || 1);
  return (d / span) * 100;
}

/* ---------------- state ---------------- */
var info = { serial: null, firmware: null, factoryL: null, factoryR: null,
             userL: null, userR: null, battery: null, charging: false };
var stick = { lx: 0, ly: 0, rx: 0, ry: 0 };
var buttons = {}, seenBtn = {}, imu = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 };
var restSamples = [], resting = false;

function onReport(e) {
  var d = new Uint8Array(e.data.buffer);
  var id = e.reportId;
  if (reportsLogged < 6) {
    reportsLogged++;
    dlog("REPORT", "id 0x" + id.toString(16) + "  len " + d.length + "  " + hex(d, 20));
  }

  if (id === 0x21 && pending.length) {
    var ack = d[12], sub = d[13];
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].sub === sub) {
        var p = pending.splice(i, 1)[0];
        p.resolve(d.slice(14));
        break;
      }
    }
  }
  if (id !== 0x30 && id !== 0x21) return;

  info.battery = (d[1] >> 4) >> 1;          /* 0..4 */
  info.charging = !!((d[1] >> 4) & 1);

  var br = d[2], bs = d[3], bl = d[4];
  buttons = {
    Y: !!(br & 0x01), X: !!(br & 0x02), B: !!(br & 0x04), A: !!(br & 0x08),
    SRr: !!(br & 0x10), SLr: !!(br & 0x20), R: !!(br & 0x40), ZR: !!(br & 0x80),
    Minus: !!(bs & 0x01), Plus: !!(bs & 0x02), RStick: !!(bs & 0x04), LStick: !!(bs & 0x08),
    Home: !!(bs & 0x10), Capture: !!(bs & 0x20),
    Down: !!(bl & 0x01), Up: !!(bl & 0x02), Right: !!(bl & 0x04), Left: !!(bl & 0x08),
    SLl: !!(bl & 0x10), SRl: !!(bl & 0x20), L: !!(bl & 0x40), ZL: !!(bl & 0x80)
  };
  Object.keys(buttons).forEach(function (k) { if (buttons[k]) seenBtn[k] = true; });

  stick.lx = d[5] | ((d[6] & 0x0F) << 8);
  stick.ly = (d[6] >> 4) | (d[7] << 4);
  stick.rx = d[8] | ((d[9] & 0x0F) << 8);
  stick.ry = (d[9] >> 4) | (d[10] << 4);

  if (d.length > 20) {
    imu.ax = int16(d, 12); imu.ay = int16(d, 14); imu.az = int16(d, 16);
    imu.gx = int16(d, 18); imu.gy = int16(d, 20); imu.gz = int16(d, 22);
  }
  if (resting) restSamples.push([stick.lx, stick.ly, stick.rx, stick.ry]);
  paint();
}
function int16(d, o) { var v = d[o] | (d[o + 1] << 8); return v > 32767 ? v - 65536 : v; }

/* ---------------- connect ---------------- */
function connect() {
  if (!navigator.hid) {
    toast("Not supported", "This needs Chrome, Edge or Opera. Firefox and Safari have no WebHID.", "bad");
    return;
  }
  navigator.hid.requestDevice({ filters: [{ vendorId: NINTENDO }] }).then(function (list) {
    if (!list.length) return;
    return setup(list[0]);
  }).catch(function (e) { state("Could not open it — " + e.message); });
}
function setup(d) {
  dev = d; model = MODELS[d.productId] || { name: d.productName || "Nintendo controller", side: "both" };
  info = { serial: null, firmware: null, factoryL: null, factoryR: null, userL: null, userR: null, battery: null, charging: false };
  seenBtn = {};
  var open = d.opened ? Promise.resolve() : d.open();
  return open.then(function () {
    d.addEventListener("inputreport", onReport);
    reportsLogged = 0;
    dlog("OPENED", (d.productName || "?") + "  vendor 0x" + d.vendorId.toString(16) +
         "  product 0x" + d.productId.toString(16) + "  collections " + (d.collections || []).length);
    state("Connected. Waking it up…");
    /* Pro Controller over USB needs a handshake before it will talk */
    return d.sendReport(0x80, new Uint8Array([0x02])).catch(function () {})
      .then(function () { return d.sendReport(0x80, new Uint8Array([0x04])).catch(function () {}); });
  }).then(function () {
    return sendSub(0x48, [0x01]).catch(function () {});     /* vibration on */
  }).then(function () {
    return sendSub(0x40, [0x01]).catch(function () {});     /* IMU on */
  }).then(function () {
    return sendSub(0x03, [0x30]).catch(function () {});     /* full input reports */
  }).then(function () {
    return sendSub(0x30, [0x01]).catch(function () {});     /* player LED 1 */
  }).then(function () {
    state("Reading the controller's flash…");
    return readAll();
  }).then(function () {
    state("Ready — " + model.name);
    dlog("READY", "serial " + (info.serial || "none") + "  firmware " + (info.firmware || "?") +
         "  factory cal " + (info.factoryL || info.factoryR ? "read" : "FAILED") +
         "  user cal " + (info.userL || info.userR ? "present" : "none"));
    $("#jc-connect").textContent = "Disconnect";
    $("#jc-connect").classList.add("on");
    TB.badge("joycon", "live", true);
    TB.watch("JOY-CON", model.name + " connected" + (info.serial ? " (" + info.serial + ")" : ""));
    render();
    rest();
  }).catch(function (e) {
    dlog("FAILED", e.message);
    state("Connected, but it is not answering: " + e.message + ". Unpair it in Windows Bluetooth settings, pair it again, then retry. Send me the log below.");
  });
}
function readAll() {
  var jobs = [];
  jobs.push(readSPI(0x6000, 16).then(function (b) {
    if (b[0] >= 0x80) { info.serial = null; return; }
    info.serial = b.map(function (c) { return c >= 32 && c < 127 ? String.fromCharCode(c) : ""; }).join("").trim() || null;
  }).catch(function () {}));

  jobs.push(readSPI(0x603D, 18).then(function (b) {
    info.factoryL = decodeCal(b.slice(0, 9), true);
    info.factoryR = decodeCal(b.slice(9, 18), false);
  }).catch(function () {}));

  jobs.push(readSPI(0x8010, 22).then(function (b) {
    if (b[0] === 0xB2 && b[1] === 0xA1) info.userL = decodeCal(b.slice(2, 11), true);
    if (b[11] === 0xB2 && b[12] === 0xA1) info.userR = decodeCal(b.slice(13, 22), false);
  }).catch(function () {}));

  jobs.push(subcommand(0x02).then(function (d) {
    info.firmware = d[0] + "." + d[1];
  }).catch(function () {}));

  return Promise.all(jobs);
}
function disconnect() {
  if (dev) {
    try { dev.removeEventListener("inputreport", onReport); } catch (e) {}
    try { dev.close(); } catch (e) {}
  }
  dev = null; model = null; live = null;
  $("#jc-connect").textContent = "Connect a controller";
  $("#jc-connect").classList.remove("on");
  TB.badge("joycon", "");
  state("Disconnected.");
  $("#jc-body").textContent = "";
  $("#jc-body").appendChild(el("p", "tb-empty", "Pair the Joy-Con to this computer in Bluetooth settings first — hold the small round button on its rail until the lights run back and forth. A Pro Controller can go straight in by USB cable."));
  verdict($("#jc-verdict"), null, [], "Connect a controller to read its calibration.");
}
function state(t) { $("#jc-state").textContent = t; }
$("#jc-connect").onclick = function () { dev ? disconnect() : connect(); };

/* ---------------- rest sampling ---------------- */
function rest() {
  restSamples = []; resting = true;
  state("Hands off — measuring the resting position…");
  setTimeout(function () {
    resting = false;
    state("Ready — " + model.name);
    paint();
  }, 1200);
}
$("#jc-rest").onclick = function () { if (dev) rest(); };

/* ---------------- rendering ---------------- */
var ui = null;
function render() {
  var box = $("#jc-body");
  box.textContent = "";
  ui = {};

  var head = el("div", "tb-panel accent");
  var h = el("h2"); h.style.cssText = "font-family:var(--f-display);font-size:19px;letter-spacing:.02em";
  h.textContent = model.name;
  head.appendChild(h);
  var kv = el("dl", "tb-kv"); kv.style.marginTop = "10px";
  function row(k, v) { kv.appendChild(el("dt", null, k)); kv.appendChild(el("dd", null, v)); }
  row("Serial number", info.serial || "not stored on this controller");
  row("Firmware", info.firmware || "unknown");
  row("Factory calibration", info.factoryL || info.factoryR ? "present" : "could not be read");
  row("User calibration", (info.userL || info.userR) ? "PRESENT — someone has recalibrated this" : "none — factory settings only");
  head.appendChild(kv);
  box.appendChild(head);

  var grid = el("div", "tb-grid tb-cols2");

  /* sticks */
  var sp = el("div", "tb-panel");
  sp.appendChild(TB.ptitle("Sticks — raw, against factory centre"));
  ui.sticks = [];
  [["Left stick", "l", info.factoryL, info.userL], ["Right stick", "r", info.factoryR, info.userR]]
    .forEach(function (s) {
      if (!s[2]) return;
      var wrap = el("div"); wrap.style.cssText = "margin-bottom:16px";
      var t = el("div", null, s[0]);
      t.style.cssText = "font-family:var(--f-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px";
      wrap.appendChild(t);
      var st = el("div", "tb-stats");
      function cell(k) { var c = el("div", "tb-stat"); c.appendChild(el("div", "k", k)); var v = el("div", "v", "—"); c.appendChild(v); st.appendChild(c); return v; }
      var vRaw = cell("Raw X, Y"), vOff = cell("Off centre"), vDrift = cell("Drift");
      wrap.appendChild(st);
      sp.appendChild(wrap);
      ui.sticks.push({ key: s[1], factory: s[2], user: s[3], raw: vRaw, off: vOff, drift: vDrift });
    });
  if (!ui.sticks.length) sp.appendChild(el("p", "tb-empty", "Calibration could not be read from this controller."));
  sp.appendChild(el("p", "tb-note", "“Off centre” is how far the stick sits from the centre point burned in at the factory, as a percentage of its full travel. The Gamepad API cannot show you this — it hands over a number that has already had calibration applied, which is exactly what hides a fault."));
  grid.appendChild(sp);

  /* calibration comparison — the bit that catches a hidden fault */
  var cp = el("div", "tb-panel");
  cp.appendChild(TB.ptitle("Factory vs user calibration"));
  ui.cal = el("div");
  cp.appendChild(ui.cal);
  cp.appendChild(el("p", "tb-note", "A drifting stick can be made to look fine by recalibrating it. The new centre gets written to the controller's flash and the drift disappears — until your buyer recalibrates and it comes straight back. If the two centres are far apart, that is what happened."));
  grid.appendChild(cp);
  box.appendChild(grid);

  /* battery + buttons + motion */
  var g2 = el("div", "tb-grid tb-cols2");
  var bp = el("div", "tb-panel");
  bp.appendChild(TB.ptitle("Battery, motion and rumble"));
  var bs = el("div", "tb-stats");
  function bcell(k) { var c = el("div", "tb-stat"); c.appendChild(el("div", "k", k)); var v = el("div", "v", "—"); c.appendChild(v); bs.appendChild(c); return v; }
  ui.batt = bcell("Battery"); ui.accel = bcell("Accelerometer"); ui.gyro = bcell("Gyroscope");
  bp.appendChild(bs);
  var bar = el("div", "tb-bar"); bar.style.marginTop = "12px";
  var rb = el("button", "tb-btn", "Rumble");
  rb.onclick = function () {
    if (!dev) return;
    dev.sendReport(0x10, new Uint8Array([nextCounter()].concat(BUZZ))).catch(function () {});
    setTimeout(function () { if (dev) dev.sendReport(0x10, new Uint8Array([nextCounter()].concat(NEUTRAL))).catch(function () {}); }, 700);
  };
  bar.appendChild(rb);
  [1, 2, 4, 8].forEach(function (mask, i) {
    var b = el("button", "tb-btn", "LED " + (i + 1));
    b.onclick = function () { sendSub(0x30, [mask]).catch(function () {}); };
    bar.appendChild(b);
  });
  bp.appendChild(bar);
  bp.appendChild(el("p", "tb-note", "Wave the controller and the motion numbers should move smoothly and settle back near zero. A gyroscope that reads a large value while the controller sits still has failed — the same fault that makes motion aiming unusable."));
  g2.appendChild(bp);

  var btp = el("div", "tb-panel");
  btp.appendChild(TB.ptitle("Buttons"));
  ui.btns = el("div", "tb-btnlist");
  btp.appendChild(ui.btns);
  btp.appendChild(el("p", "tb-note", "Press every button including SL and SR on the rail, and click the stick in. Green means it has reported at least once."));
  g2.appendChild(btp);
  box.appendChild(g2);
  paint();
}

function paint() {
  if (!ui || !dev) return;

  ui.sticks.forEach(function (s) {
    var x = stick[s.key + "x"], y = stick[s.key + "y"];
    var f = s.factory;
    var ox = offCentre(x, f.xCentre, f.xMax, f.xMin);
    var oy = offCentre(y, f.yCentre, f.yMax, f.yMin);
    var mag = Math.sqrt(ox * ox + oy * oy);
    s.raw.textContent = x + ", " + y;
    s.raw.style.fontSize = "18px";
    s.off.textContent = ox.toFixed(1) + "%, " + oy.toFixed(1) + "%";
    s.off.style.fontSize = "18px";
    s.drift.textContent = mag.toFixed(1) + "%";
    s.drift.className = "v " + (mag < 2 ? "pass" : mag < 5 ? "warn" : "fail");
  });

  /* factory vs user centre */
  ui.cal.textContent = "";
  var pairs = [["Left", info.factoryL, info.userL], ["Right", info.factoryR, info.userR]];
  var maxShift = 0;
  pairs.forEach(function (p) {
    if (!p[1]) return;
    var line = el("div", "tb-gbtn");
    line.style.cssText = "display:flex;gap:10px;margin-bottom:6px";
    if (!p[2]) {
      line.appendChild(el("span", null, p[0] + " stick"));
      var okv = el("em", null, "factory only"); okv.style.cssText = "font-style:normal;margin-left:auto;color:var(--pass)";
      line.appendChild(okv);
    } else {
      var dx = Math.abs(p[2].xCentre - p[1].xCentre), dy = Math.abs(p[2].yCentre - p[1].yCentre);
      var shift = Math.sqrt(dx * dx + dy * dy);
      if (shift > maxShift) maxShift = shift;
      line.appendChild(el("span", null, p[0] + " stick"));
      var v = el("em", null, "centre moved " + Math.round(shift) + " units");
      v.style.cssText = "font-style:normal;margin-left:auto;color:" + (shift > 120 ? "var(--red)" : shift > 40 ? "var(--warn)" : "var(--ink-2)");
      line.appendChild(v);
    }
    ui.cal.appendChild(line);
  });
  if (!ui.cal.childElementCount) ui.cal.appendChild(el("p", "tb-empty", "Calibration could not be read."));

  var levels = ["empty", "critical", "low", "medium", "full"];
  ui.batt.textContent = (levels[info.battery] || "—") + (info.charging ? " (charging)" : "");
  ui.batt.style.fontSize = "17px";
  ui.batt.className = "v " + (info.battery >= 3 ? "pass" : info.battery >= 2 ? "warn" : "fail");
  ui.accel.textContent = imu.ax + ", " + imu.ay + ", " + imu.az;
  ui.accel.style.fontSize = "14px";
  ui.gyro.textContent = imu.gx + ", " + imu.gy + ", " + imu.gz;
  ui.gyro.style.fontSize = "14px";

  if (ui.btns.childElementCount === 0) {
    Object.keys(buttons).forEach(function (k) {
      var b = el("div", "tb-gbtn"); b.dataset.k = k;
      b.appendChild(el("span", null, k));
      ui.btns.appendChild(b);
    });
  }
  $$(".tb-gbtn", ui.btns).forEach(function (b) {
    var k = b.dataset.k;
    b.classList.toggle("down", !!buttons[k]);
    b.classList.toggle("seen", !!seenBtn[k]);
  });

  score(maxShift);
}

function score(maxShift) {
  var f = [], s = 100;
  var worst = 0;
  ui.sticks.forEach(function (st) {
    var v = parseFloat(st.drift.textContent);
    if (v > worst) worst = v;
  });
  if (resting) { verdict($("#jc-verdict"), null, [], "Measuring the resting position — hands off."); return; }

  if (worst > 10) { s -= 55; f.push({ level: "bad", tag: "drift", text: "A stick sits " + worst.toFixed(1) + "% off its factory centre with nothing touching it. That is hard drift — it will walk on its own in game." }); }
  else if (worst > 5) { s -= 30; f.push({ level: "warn", tag: "drift", text: "A stick rests " + worst.toFixed(1) + "% off factory centre. Noticeable, and it gets worse with use." }); }
  else if (worst > 2) { s -= 10; f.push({ level: "warn", tag: "drift", text: worst.toFixed(1) + "% off factory centre — early wear, still sellable." }); }
  else f.push({ level: "ok", tag: "drift", text: "Sticks sit within " + worst.toFixed(1) + "% of the centre set at the factory." });

  if (maxShift > 120) {
    s -= 35;
    f.push({ level: "bad", tag: "recalibrated", text: "The stored centre has been moved " + Math.round(maxShift) + " units away from the factory one. Somebody recalibrated this to hide drift. Reset the calibration on a Switch and measure it again before you sell it." });
  } else if (maxShift > 40) {
    s -= 10;
    f.push({ level: "warn", tag: "recalibrated", text: "The centre has been nudged " + Math.round(maxShift) + " units from factory. Mild, but it has been recalibrated at some point." });
  } else if (info.userL || info.userR) {
    f.push({ level: "ok", tag: "recalibrated", text: "User calibration exists but sits close to the factory values — nothing is being hidden." });
  } else {
    f.push({ level: "ok", tag: "factory", text: "No user calibration written. What you are reading is the factory state." });
  }

  if (info.battery != null && info.battery <= 1) { s -= 10; f.push({ level: "warn", tag: "battery", text: "Battery is nearly flat. Charge it before judging how long it holds." }); }
  var pressed = Object.keys(seenBtn).length, total = Object.keys(buttons).length;
  if (total && pressed < total) f.push({ level: "warn", tag: "untested", text: (total - pressed) + " buttons have not been pressed yet. A dead button looks exactly like an untested one." });
  else if (total) f.push({ level: "ok", tag: "buttons", text: "Every button reported in." });
  if (info.serial) f.push({ level: "ok", tag: "serial", text: "Serial " + info.serial + " read from the controller's own flash." });

  verdict($("#jc-verdict"), clamp(s, 0, 100), f);
}

if (navigator.hid) {
  navigator.hid.addEventListener("disconnect", function (e) {
    if (dev && e.device === dev) { TB.watch("JOY-CON", "disconnected"); disconnect(); }
  });
}
TB.onLeave("joycon", function () { /* leave it connected so a soak keeps running */ });
disconnect();
})();
