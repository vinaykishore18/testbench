/* Testbench — the bench view: everything connected, at a glance. */
"use strict";
(function () {
var $ = TB.$, el = TB.el, verdict = TB.verdict;
var PADS = TB.pads(), shortName = TB.shortName;

var defs = [
  { v: "keyboard", t: "Keyboard", d: "Real ANSI and ISO layouts, capture mode, chatter and stuck keys.", ic: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>' },
  { v: "mouse", t: "Mouse", d: "Live diagram, up to 20 buttons, double-click faults, polling rate.", ic: '<rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 6.5v4"/>' },
  { v: "gamepad", t: "Controllers", d: "Scored on plug-in: drift, noise, stuck buttons, resting triggers.", ic: '<path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 5.4l-.8 4A2.6 2.6 0 0 1 16.6 18L15 16H9l-1.6 2a2.6 2.6 0 0 1-4.5-.6l-.8-4A4.5 4.5 0 0 1 6.5 8Z"/>' },
  { v: "joycon", t: "Joy-Cons", d: "Raw drift against factory calibration, and hidden recalibration.", ic: '<rect x="3" y="3" width="7" height="18" rx="3.5"/><rect x="14" y="3" width="7" height="18" rx="3.5"/>' },
  { v: "wheel", t: "Wheels", d: "Steering range, pedal travel, paddles and H-pattern shifters.", ic: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M4.5 17l5-3M19.5 17l-5-3"/>' },
  { v: "audio", t: "Mic &amp; headsets", d: "Level, noise floor, clipping in; channels and a sweep out.", ic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/>' },
  { v: "airpods", t: "Earbuds", d: "Driver fingerprint against a genuine pair, ear detection, dropout watch.", ic: '<path d="M8 3.5c-2.2 0-3.5 1.8-3.5 4.2S5.8 12 8 12s3.5-1.8 3.5-4.3S10.2 3.5 8 3.5Z"/><path d="M8 12v6.5a2 2 0 0 0 4 0"/>' },
  { v: "monitor", t: "Monitors", d: "Automatic 20-step run: dead pixels, bleed, banding, ghosting.", ic: '<rect x="2" y="3.5" width="20" height="14" rx="2"/><path d="M8 21h8M12 17.5V21"/>' },
  { v: "camera", t: "Webcams", d: "Live preview, true resolution, measured frame rate, still grab.", ic: '<rect x="2.5" y="6" width="14" height="12" rx="2"/><path d="M16.5 11l5-3v8l-5-3z"/>' },
  { v: "touch", t: "Touchscreens", d: "Simultaneous touch points and dead zones in the digitiser.", ic: '<path d="M9 11V5.5a1.8 1.8 0 0 1 3.6 0V11M12.6 11V9.2a1.7 1.7 0 0 1 3.4 0V13"/><path d="M16 12.5a1.7 1.7 0 0 1 3.4 0v3.2A5.8 5.8 0 0 1 13.6 21h-1.2a5 5 0 0 1-4-2l-3-4a1.7 1.7 0 0 1 2.6-2.1L9 14.5"/>' },
  { v: "network", t: "Routers", d: "Soak a router for thirty minutes and catch every dropout.", ic: '<path d="M5 12.5a10 10 0 0 1 14 0M2 9a15 15 0 0 1 20 0M8.5 16a5.5 5.5 0 0 1 7 0M12 19.5h.01"/>' },
  { v: "stress", t: "Stress test", d: "Load every core and the graphics chip, then watch for throttling.", ic: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" stroke-linejoin="round"/>' },
  { v: "system", t: "System", d: "Graphics chip, cores, memory, battery and a connection watchdog.", ic: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>' }
];
if (TB.isCoarse()) {
  $("#home-mobile").appendChild(TB.callout(
    "You are on a touch device. Touch, screen, camera and microphone tests all work here. Keyboard, mouse, controller and wheel tests need a computer with the device plugged in."));
}

var box = $("#devcards"), cards = {};
defs.forEach(function (d) {
  var c = el("button", "tb-devcard");
  var top = el("div", "top");
  top.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' + d.ic + '</svg>' + d.t + '<span class="st">ready</span>';
  c.appendChild(top);
  c.appendChild(el("p", null, d.d));
  c.onclick = function () { TB.go(d.v); };
  box.appendChild(c);
  cards[d.v] = { node: c, st: top.querySelector(".st") };
});
function set(v, live, txt) { var c = cards[v]; if (!c) return; c.node.classList.toggle("live", !!live); c.st.textContent = txt; }

var scoreBox = $("#home-pads"), lastSig = null;
function refresh() {
  var ks = Object.keys(PADS);
  var pads = ks.filter(function (k) { return !PADS[k].wheel; });
  var whs = ks.filter(function (k) { return PADS[k].wheel; });
  set("gamepad", pads.length > 0, pads.length ? pads.length + " connected" : "none");
  set("wheel", whs.length > 0, whs.length ? whs.length + " connected" : "none");
  var sig = ks.map(function (k) { return k + ":" + PADS[k].score; }).join("|");
  if (sig !== lastSig) {
    lastSig = sig;
    scoreBox.innerHTML = "";
    if (!ks.length) scoreBox.appendChild(el("p", "tb-empty", "No controller connected. Plug one in over USB or pair it, then press any button to wake it."));
    else ks.forEach(function (k) {
      var rec = PADS[k];
      var row = el("div"); row.style.cssText = "margin-bottom:14px";
      var v = el("div"); row.appendChild(v);
      verdict(v, rec.score, rec.flags.slice(0, 3), "Sampling at rest…");
      var nm = el("div");
      nm.style.cssText = "font-family:var(--font-m);font-size:10.5px;color:var(--ink-faint);margin:6px 0 0;letter-spacing:.05em";
      nm.textContent = shortName(rec).toUpperCase() + " · " + (rec.wheel ? "WHEEL" : "CONTROLLER") + " · SLOT " + rec.index;
      row.appendChild(nm);
      var b = el("button", "tb-btn", "Open full test"); b.style.marginTop = "8px";
      b.onclick = function () { TB.go(rec.wheel ? "wheel" : "gamepad"); };
      row.appendChild(b);
      scoreBox.appendChild(row);
    });
  }
}
TB.onPads(function () { if (TB.view() === "home") refresh(); });
TB.onEnter("home", function () { lastSig = null; refresh(); });

setInterval(function () {
  set("keyboard", TB.activity.keyboard, TB.activity.keyboard ? "responding" : "ready");
  set("mouse", TB.activity.mouse, TB.activity.mouse ? "responding" : "ready");
  set("audio", $("#chip-mic").classList.contains("live"), $("#chip-mic").querySelector("b").textContent);
  set("camera", $("#chip-cam").classList.contains("live"), $("#chip-cam").querySelector("b").textContent);
  set("touch", (navigator.maxTouchPoints || 0) > 0, (navigator.maxTouchPoints || 0) > 0 ? navigator.maxTouchPoints + " pt" : "none");
  set("monitor", true, window.screen.width + "×" + window.screen.height);
  set("system", true, (navigator.hardwareConcurrency || "?") + " threads");
  set("stress", false, "ready");
  set("airpods", false, "ready");
  set("joycon", false, navigator.hid ? "ready" : "needs Chrome");
  set("network", navigator.onLine, navigator.onLine ? "online" : "offline");
}, 1200);

/* bench notes */
var kvbox = $("#envinfo");
function row(k, v) { kvbox.appendChild(el("dt", null, k)); kvbox.appendChild(el("dd", null, v)); }
var ua = navigator.userAgent;
var br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Unknown";
row("Browser", br);
row("Screen", window.innerWidth + "\u00d7" + window.innerHeight + " window, " + window.screen.width + "\u00d7" + window.screen.height + " display");
row("Key hold (capture mode)", (navigator.keyboard && navigator.keyboard.lock) ? "supported" : "not in this browser");
row("Device names (USB)", navigator.hid ? "supported" : "not in this browser");
row("Gamepad API", navigator.getGamepads ? "supported" : "missing");
row("Media devices", (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? "supported" : "missing");
row("Secure context", window.isSecureContext ? "yes — mic and camera allowed" : "no — mic and camera will be blocked");
row("Pixel ratio", (window.devicePixelRatio || 1).toFixed(2) + "\u00d7");
row("Why no device names", "Browsers deliberately hide plain keyboards and mice from web pages so a site cannot fingerprint your hardware. Gaming models with their own vendor software usually do appear under \u201cRead device name\u201d.");
refresh();

/* keep the page put during tests */
window.addEventListener("dragstart", function (e) { if (TB.view() === "mouse") e.preventDefault(); });
window.addEventListener("beforeunload", function (e) { if (window.KB && KB.isLocked()) { e.preventDefault(); e.returnValue = ""; } });
})();
