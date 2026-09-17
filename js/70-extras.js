/* Testbench — webcams, touchscreens and machine information. */
"use strict";

/* ---------------- webcam ---------------- */
(function () {
var $ = TB.$, el = TB.el, toast = TB.toast;
var stream = null, v = $("#cam-video"), frames = 0, t0 = 0, timer = null;
function stop() {
  if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  stream = null; v.srcObject = null;
  $("#cam-start").disabled = false; $("#cam-stop").disabled = true; $("#cam-shot").disabled = true;
  if (timer) { clearInterval(timer); timer = null; }
  TB.chip("cam", false, "off"); TB.badge("camera", "");
}
$("#cam-start").onclick = function () {
  var id = $("#cam-dev").value;
  var c = { video: { width: { ideal: 1920 }, height: { ideal: 1080 } } };
  if (id && id.length > 4) c.video.deviceId = { exact: id };
  navigator.mediaDevices.getUserMedia(c).then(function (s) {
    stream = s; v.srcObject = s;
    var tr = s.getVideoTracks()[0], st = tr.getSettings();
    $("#cam-res").innerHTML = (st.width || "?") + "×" + (st.height || "?");
    $("#cam-name").textContent = tr.label || "Camera";
    $("#cam-start").disabled = true; $("#cam-stop").disabled = false; $("#cam-shot").disabled = false;
    TB.chip("cam", true, "live"); TB.badge("camera", "live", true);
    TB.watch("CAMERA started", tr.label || "camera");
    if (window.AUDIO && AUDIO.listDevices) AUDIO.listDevices();
    frames = 0; t0 = performance.now();
    if (v.requestVideoFrameCallback) {
      var cb = function () { frames++; if (stream) v.requestVideoFrameCallback(cb); };
      v.requestVideoFrameCallback(cb);
    }
    timer = setInterval(function () {
      var dt = (performance.now() - t0) / 1000;
      if (v.requestVideoFrameCallback) $("#cam-fps").innerHTML = (frames / dt).toFixed(1) + " <small>fps</small>";
      else $("#cam-fps").innerHTML = (st.frameRate ? st.frameRate.toFixed(0) : "—") + " <small>fps</small>";
      frames = 0; t0 = performance.now();
    }, 1000);
  }).catch(function (err) {
    toast("Camera blocked", err.name === "NotAllowedError" ? "Permission was denied for this page." : "Could not open that camera (" + err.name + ").", "bad");
  });
};
$("#cam-stop").onclick = stop;
window.addEventListener("pagehide", stop);
TB.onLeave("camera", function () { /* preview keeps running only while the page is open */ });
$("#cam-shot").onclick = function () {
  if (!stream) return;
  var c = $("#cam-canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0); c.style.display = "block";
};
})();

/* ---------------- touchscreen ---------------- */
(function () {
var $ = TB.$;
var pad = $("#tc-pad"), cv = $("#tc-canvas"), ctx = cv.getContext("2d"), active = {}, maxN = 0;
var COL = ["#3FD07E", "#35C3D4", "#F5A524", "#FF5C5C", "#B78BFF", "#7FD1FF", "#FFD166", "#8AE6C1", "#FF9AD5", "#A0E86F"];
function fit() { var d = Math.min(2, window.devicePixelRatio || 1); cv.width = pad.clientWidth * d; cv.height = pad.clientHeight * d; cv.style.width = "100%"; cv.style.height = "100%"; ctx.setTransform(d, 0, 0, d, 0, 0); }
new ResizeObserver(fit).observe(pad); fit();
function upd() {
  var n = Object.keys(active).length;
  if (n > maxN) maxN = n;
  $("#tc-now").textContent = n;
  var m = $("#tc-max"); m.textContent = maxN; m.className = "v" + (maxN >= 5 ? " pass" : "");
  TB.badge("touch", maxN ? maxN + " pt" : "", maxN >= 5);
}
pad.addEventListener("pointerdown", function (e) {
  pad.setPointerCapture(e.pointerId);
  active[e.pointerId] = { c: COL[Object.keys(active).length % COL.length] };
  $("#tc-type").textContent = e.pointerType; upd();
});
pad.addEventListener("pointermove", function (e) {
  var a = active[e.pointerId]; if (!a) return;
  var r = pad.getBoundingClientRect();
  var pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  pts.forEach(function (p) {
    ctx.fillStyle = a.c;
    ctx.beginPath(); ctx.arc(p.clientX - r.left, p.clientY - r.top, 2 + (p.pressure || 0) * 8, 0, 7); ctx.fill();
  });
  if (e.pressure) $("#tc-press").textContent = e.pressure.toFixed(2);
});
function end(e) { delete active[e.pointerId]; upd(); }
pad.addEventListener("pointerup", end); pad.addEventListener("pointercancel", end);
$("#tc-clear").onclick = function () { ctx.clearRect(0, 0, cv.width, cv.height); maxN = 0; upd(); };
upd();
})();

/* ---------------- machine information ---------------- */
(function () {
var $ = TB.$, el = TB.el;
function kv(dl, k, v) { dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, v)); }

function fill() {
  $("#sy-cores").textContent = navigator.hardwareConcurrency || "—";
  $("#sy-ram").innerHTML = navigator.deviceMemory ? navigator.deviceMemory + " <small>GB+</small>" : "—";
  var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "—";
  $("#sy-plat").textContent = plat;
  $("#sy-touch").textContent = navigator.maxTouchPoints || 0;
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(function (e) {
      $("#sy-store").innerHTML = e.quota ? (e.quota / 1073741824).toFixed(1) + " <small>GB</small>" : "—";
    }).catch(function () {});
  }
  var c = navigator.connection;
  $("#sy-net").textContent = c ? (c.effectiveType || "—") + (c.downlink ? " · " + c.downlink + " Mb/s" : "") : (navigator.onLine ? "online" : "offline");

  var dl = $("#sy-gpu"); dl.innerHTML = "";
  gpuInfo().forEach(function (row) { kv(dl, row[0], row[1]); });
  kv(dl, "User agent", navigator.userAgent);

  if (navigator.getBattery) {
    navigator.getBattery().then(function (b) {
      /* getBattery() hands back the same BatteryManager every time, so wiring
         the four listeners on each visit to this page meant n visits fired
         paint() 4n times per level change. Bind once. */
      function paint() {
        var pct = Math.round(b.level * 100);
        var bar = $("#sy-battbar");
        bar.querySelector("i").style.width = pct + "%";
        bar.querySelector("i").style.background = pct > 40 ? "var(--pass)" : pct > 15 ? "var(--warn)" : "var(--fail)";
        bar.querySelector("span").textContent = pct + "% " + (b.charging ? "· charging" : "· on battery");
        var d = $("#sy-batt"); d.innerHTML = "";
        kv(d, "Charge", pct + "%");
        kv(d, "State", b.charging ? "charging" : "discharging");
        if (b.chargingTime && isFinite(b.chargingTime)) kv(d, "Full in", Math.round(b.chargingTime / 60) + " min");
        if (b.dischargingTime && isFinite(b.dischargingTime)) kv(d, "Empty in", Math.round(b.dischargingTime / 60) + " min");
        TB.badge("system", pct + "%", pct > 40);
      }
      paint();
      if (!battBound) {
        battBound = true;
        ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"]
          .forEach(function (ev) { b.addEventListener(ev, function () { if (lastPaint) lastPaint(); }); });
      }
      lastPaint = paint;
    }).catch(noBatt);
  } else noBatt();
  function noBatt() {
    $("#sy-battbar").querySelector("span").textContent = "no battery reported";
    var d = $("#sy-batt"); d.innerHTML = "";
    kv(d, "Battery", "This browser does not expose battery information, or the machine has no battery.");
  }
}
/* Read the GPU once and keep the answer.

   Every call to getContext("webgl") creates a live context, and browsers cap
   how many a page may hold (Chrome drops the oldest past about sixteen). The
   System page used to make a fresh one on every visit and never release it, so
   after enough visits getContext returned null and the panel announced
   "WebGL is not available in this browser" on a machine where it plainly was. */
var gpuCache = null;
function gpuInfo() {
  if (gpuCache) return gpuCache;
  var rows = [];
  try {
    var cvs = document.createElement("canvas");
    var gl = cvs.getContext("webgl2") || cvs.getContext("webgl");
    if (gl) {
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      rows.push(["Graphics", dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)]);
      rows.push(["Vendor", dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)]);
      rows.push(["WebGL", gl.getParameter(gl.VERSION)]);
      rows.push(["Max texture", gl.getParameter(gl.MAX_TEXTURE_SIZE) + " px"]);
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    } else rows.push(["Graphics", "WebGL is not available in this browser"]);
  } catch (e) { rows.push(["Graphics", "could not be read"]); }
  gpuCache = rows;
  return rows;
}
var battBound = false, lastPaint = null;

TB.onEnter("system", fill);
window.addEventListener("online", function () { TB.watch("NETWORK", "back online"); });
window.addEventListener("offline", function () { TB.watch("NETWORK", "dropped"); });
fill();
})();
