/* Testbench — earbuds and headphones: does it work, and is it real.
   Nothing here reads a serial number or talks to Apple. Browsers cannot.
   What it does instead is measure the drivers and watch the behaviour, and
   score that against a pair you know is genuine. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp;
var verdict = TB.verdict, toast = TB.toast;

var KEY = "tb.earbuds.v1";
var store = load();
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { profiles: [], serials: [] }; }
  catch (e) { return { profiles: [], serials: [] }; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); }
  catch (e) { toast("Could not save", "This browser is blocking local storage, so profiles will vanish on reload. Export them to a file instead.", "bad"); }
}

/* ============================================================
   ACOUSTIC FINGERPRINT
   The only automated authenticity signal a browser can honestly give.
   Counterfeits use completely different drivers and miss the tuning by
   10-20 dB in places. We measure the SHAPE of the response, not the level,
   so how loud you set it does not matter.
   ============================================================ */
var LO = 100, HI = 12000, BANDS = 32;      /* laptop mics are useless outside this */
var ac = null, micStream = null, running = false;

function ctx() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === "suspended") ac.resume();
  return ac;
}
function bandEdges() {
  var e = [];
  for (var i = 0; i <= BANDS; i++) e.push(LO * Math.pow(HI / LO, i / BANDS));
  return e;
}
var EDGES = bandEdges();

function openMic() {
  var id = $("#ap-indev").value;
  var c = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
  if (id && id.length > 4) c.audio.deviceId = { exact: id };
  return navigator.mediaDevices.getUserMedia(c).then(function (s) { micStream = s; return s; });
}
function closeMic() {
  if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
  micStream = null;
}

/* collect the loudest level reached in every band over a window */
function capture(analyser, ms, onTick) {
  return new Promise(function (resolve) {
    var bins = new Float32Array(analyser.frequencyBinCount);
    var peak = new Float32Array(BANDS).fill(-140);
    var sr = ctx().sampleRate, binHz = sr / 2 / analyser.frequencyBinCount;
    var t0 = performance.now();
    (function frame() {
      analyser.getFloatFrequencyData(bins);
      for (var b = 0; b < BANDS; b++) {
        var lo = Math.max(1, Math.floor(EDGES[b] / binHz));
        var hi = Math.min(bins.length - 1, Math.ceil(EDGES[b + 1] / binHz));
        var best = -140;
        for (var i = lo; i <= hi; i++) if (bins[i] > best) best = bins[i];
        if (best > peak[b]) peak[b] = best;
      }
      var p = (performance.now() - t0) / ms;
      if (onTick) onTick(clamp(p, 0, 1));
      if (p < 1) requestAnimationFrame(frame); else resolve(Array.prototype.slice.call(peak));
    })();
  });
}

/* level does not matter, shape does — so pull the average out */
function normalise(curve) {
  var m = curve.reduce(function (a, b) { return a + b; }, 0) / curve.length;
  return curve.map(function (v) { return v - m; });
}
function compare(a, b) {
  var diffs = a.map(function (v, i) { return Math.abs(v - b[i]); });
  var mean = diffs.reduce(function (x, y) { return x + y; }, 0) / diffs.length;
  var worst = 0, worstBand = 0;
  diffs.forEach(function (d, i) { if (d > worst) { worst = d; worstBand = i; } });
  return { mean: mean, worst: worst, worstHz: Math.round(EDGES[worstBand]), diffs: diffs };
}

function sweep(seconds) {
  var a = ctx();
  var osc = a.createOscillator(), g = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(LO * 0.8, a.currentTime);
  osc.frequency.exponentialRampToValueAtTime(HI * 1.1, a.currentTime + seconds);
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime((parseInt($("#ap-vol").value, 10) / 100) * 0.5, a.currentTime + 0.08);
  g.gain.setValueAtTime((parseInt($("#ap-vol").value, 10) / 100) * 0.5, a.currentTime + seconds - 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + seconds);
  osc.connect(g); g.connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + seconds + 0.05);
  return osc;
}

function runMeasurement(label, onProgress) {
  if (running) return Promise.reject(new Error("busy"));
  running = true;
  var a = ctx(), analyser = a.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  var sink = a.createGain(); sink.gain.value = 0;

  return openMic().then(function (s) {
    var src = a.createMediaStreamSource(s);
    src.connect(analyser); analyser.connect(sink); sink.connect(a.destination);
    onProgress("Listening to the room…", 0);
    return capture(analyser, 1200).then(function (floor) {
      onProgress("Sweeping…", 0.15);
      sweep(6);
      return capture(analyser, 6200, function (p) { onProgress("Sweeping…", 0.15 + p * 0.85); })
        .then(function (curve) { return { curve: curve, floor: floor }; });
    });
  }).then(function (r) {
    closeMic(); running = false;
    var headroom = r.curve.map(function (v, i) { return v - r.floor[i]; });
    var quiet = headroom.filter(function (h) { return h < 10; }).length;
    return { label: label, at: Date.now(), curve: normalise(r.curve), raw: r.curve, floor: r.floor, weakBands: quiet };
  }).catch(function (e) {
    closeMic(); running = false;
    throw e;
  });
}

/* ---------------- chart ---------------- */
function draw(refCurve, testCurve) {
  var c = $("#ap-chart");
  var d = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  var g = c.getContext("2d");
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  var pad = 26, top = -30, bot = 30;
  function y(v) { return pad + (1 - (v - top) / (bot - top)) * (h - pad * 2); }
  function x(i) { return pad + (i / (BANDS - 1)) * (w - pad * 2); }

  g.strokeStyle = "#191E26"; g.lineWidth = 1;
  [-20, -10, 0, 10, 20].forEach(function (v) {
    g.beginPath(); g.moveTo(pad, y(v)); g.lineTo(w - pad, y(v)); g.stroke();
  });
  g.fillStyle = "#77828F"; g.font = "10px monospace";
  g.fillText("+20 dB", 2, y(20) + 3);
  g.fillText("0", 2, y(0) + 3);
  g.fillText("-20", 2, y(-20) + 3);
  [100, 500, 2000, 8000].forEach(function (hz) {
    var i = Math.log(hz / LO) / Math.log(HI / LO) * (BANDS - 1);
    g.fillText(hz >= 1000 ? (hz / 1000) + "k" : String(hz), x(i) - 8, h - 6);
  });
  function line(curve, colour, width) {
    if (!curve) return;
    g.strokeStyle = colour; g.lineWidth = width; g.beginPath();
    curve.forEach(function (v, i) { i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); });
    g.stroke();
  }
  line(refCurve, "#22E07B", 2.5);
  line(testCurve, "#FF2D46", 2.5);
  g.fillStyle = "#22E07B"; g.fillRect(w - 150, 10, 10, 3);
  g.fillStyle = "#AEB9C6"; g.fillText("known genuine", w - 134, 15);
  if (testCurve) { g.fillStyle = "#FF2D46"; g.fillRect(w - 150, 24, 10, 3); g.fillStyle = "#AEB9C6"; g.fillText("this pair", w - 134, 29); }
}

/* ---------------- profiles ---------------- */
function renderProfiles() {
  var box = $("#ap-profiles"), sel = $("#ap-refsel");
  box.textContent = ""; sel.textContent = "";
  if (!store.profiles.length) {
    box.appendChild(el("p", "tb-empty", "No reference yet. Put a pair you know is genuine on the mic and capture one — everything else is scored against it."));
    sel.appendChild(el("option", null, "no reference saved"));
    return;
  }
  store.profiles.forEach(function (p, i) {
    var row = el("div", "tb-gbtn");
    row.style.cssText = "display:flex;gap:10px;align-items:center;margin-bottom:6px";
    row.appendChild(el("span", null, p.label));
    var d = el("em", null, new Date(p.at).toLocaleDateString());
    d.style.cssText = "font-style:normal;opacity:.6;margin-left:auto";
    row.appendChild(d);
    var del = el("button", "tb-btn", "Remove");
    del.style.cssText = "min-height:28px;padding:4px 10px;font-size:10px";
    del.onclick = function () { store.profiles.splice(i, 1); save(); renderProfiles(); };
    row.appendChild(del);
    box.appendChild(row);
    var o = el("option", null, p.label); o.value = String(i); sel.appendChild(o);
  });
}
function currentRef() {
  var i = parseInt($("#ap-refsel").value, 10);
  return store.profiles[i] || null;
}

/* ---------------- capture buttons ---------------- */
function progress(msg, p) {
  $("#ap-state").textContent = msg;
  $("#ap-bar").style.width = (p * 100) + "%";
}
$("#ap-capture").onclick = function () {
  var name = ($("#ap-refname").value || "").trim();
  if (!name) { toast("Name it first", "Say which model this is — “AirPods Pro 2, sealed” for example.", null); return; }
  this.disabled = true;
  runMeasurement(name, progress).then(function (r) {
    store.profiles.push({ label: r.label, at: r.at, curve: r.curve });
    save(); renderProfiles();
    draw(r.curve, null);
    progress("Reference saved.", 1);
    toast("Reference captured", "Every pair you test from now on is scored against this one.", "ok");
    $("#ap-capture").disabled = false;
  }).catch(function (e) {
    progress("Failed — " + (e.name === "NotAllowedError" ? "microphone permission denied" : e.message), 0);
    $("#ap-capture").disabled = false;
  });
};
$("#ap-test").onclick = function () {
  var ref = currentRef();
  if (!ref) { toast("No reference", "Capture a known-genuine pair first, on the Reference tab.", "bad"); return; }
  this.disabled = true;
  runMeasurement("test", progress).then(function (r) {
    draw(ref.curve, r.curve);
    var cmp = compare(ref.curve, r.curve);
    score(cmp, r);
    progress("Done.", 1);
    $("#ap-test").disabled = false;
  }).catch(function (e) {
    progress("Failed — " + (e.name === "NotAllowedError" ? "microphone permission denied" : e.message), 0);
    $("#ap-test").disabled = false;
  });
};
function score(cmp, r) {
  var f = [], s = 100;
  $("#ap-dev").textContent = cmp.mean.toFixed(1) + " dB";
  $("#ap-dev").className = "v " + (cmp.mean < 3 ? "pass" : cmp.mean < 6 ? "warn" : "fail");
  $("#ap-worst").textContent = cmp.worst.toFixed(1) + " dB";
  $("#ap-worsthz").textContent = cmp.worstHz >= 1000 ? (cmp.worstHz / 1000).toFixed(1) + " kHz" : cmp.worstHz + " Hz";

  if (r.weakBands > BANDS * 0.3) {
    f.push({ level: "warn", tag: "noisy", text: r.weakBands + " of " + BANDS + " bands barely rose above the room noise. Move somewhere quieter, turn the volume up, or press the bud closer to the microphone — this reading is not trustworthy." });
    s -= 30;
  }
  if (cmp.mean < 3) {
    f.push({ level: "ok", tag: "response", text: "Frequency response matches the reference within " + cmp.mean.toFixed(1) + " dB on average. These drivers behave like the genuine pair." });
  } else if (cmp.mean < 6) {
    s -= 35;
    f.push({ level: "warn", tag: "response", text: "Off by " + cmp.mean.toFixed(1) + " dB on average, worst at " + $("#ap-worsthz").textContent + ". Could be placement, could be a different driver. Re-seat it and run again before you judge." });
  } else {
    s -= 70;
    f.push({ level: "bad", tag: "response", text: "Off by " + cmp.mean.toFixed(1) + " dB on average, and " + cmp.worst.toFixed(1) + " dB out at " + $("#ap-worsthz").textContent + ". That is a different driver, not a different position." });
  }
  f.push({ level: "ok", tag: "scope", text: "This compares drivers only. It cannot read a serial number, firmware or anything from Apple — no browser can. Treat it as one strong signal among several, never as proof on its own." });
  verdict($("#ap-verdict"), clamp(s, 0, 100), f);
}

/* ============================================================
   EAR DETECTION — genuine H1/H2 pauses playback when a bud comes out.
   Most counterfeits do not. We play through an <audio> element and watch
   for the pause event the operating system sends.
   ============================================================ */
(function () {
  var au = new Audio(), armed = false, fired = false;
  /* two seconds of quiet tone, generated so there is no asset to load */
  function toneUrl() {
    var sr = 8000, secs = 30, n = sr * secs, buf = new Uint8Array(44 + n * 2);
    var dv = new DataView(buf.buffer);
    function str(o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, "data"); dv.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin(i / sr * 440 * 6.283) * 6000, true);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  au.src = toneUrl(); au.loop = true;
  au.addEventListener("pause", function () {
    if (!armed || fired) return;
    fired = true;
    $("#ap-ear").textContent = "Paused — genuine behaviour";
    $("#ap-ear").className = "v pass";
    $("#ap-earstate").textContent = "The bud told the computer it had been removed. That is the infrared wear sensor working, which most counterfeits do not have.";
    toast("Ear detection works", "Playback paused when you took the bud out — that is real H1/H2 behaviour.", "ok");
  });
  $("#ap-earrun").onclick = function () {
    fired = false; armed = true;
    au.currentTime = 0;
    au.play().then(function () {
      $("#ap-ear").textContent = "waiting…";
      $("#ap-ear").className = "v";
      $("#ap-earstate").textContent = "Playing. Now take ONE bud out of your ear and wait three seconds.";
      setTimeout(function () {
        if (!fired) {
          $("#ap-ear").textContent = "No pause";
          $("#ap-ear").className = "v fail";
          $("#ap-earstate").textContent = "Playback kept going with the bud out. Either wear detection is off in settings, or there is no working sensor — which is the usual answer on a counterfeit.";
        }
        armed = false; au.pause();
      }, 9000);
    }).catch(function () {
      $("#ap-earstate").textContent = "Could not start playback — click the page once and try again.";
    });
  };
  $("#ap-earstop").onclick = function () { armed = false; au.pause(); };
})();

/* ============================================================
   DROPOUT SOAK — one bud dying after fifteen minutes is the most common
   fault on used earbuds. If they disconnect, the device list changes.
   ============================================================ */
(function () {
  var t0 = 0, timer = null, watching = false, seen = "";
  function names() {
    return navigator.mediaDevices.enumerateDevices().then(function (ds) {
      return ds.filter(function (d) { return d.kind === "audiooutput"; })
               .map(function (d) { return d.label; }).join("|");
    });
  }
  $("#ap-soakrun").onclick = function () {
    if (watching) { stop("stopped by hand"); return; }
    names().then(function (n) {
      seen = n; watching = true; t0 = performance.now();
      $("#ap-soakrun").textContent = "Stop";
      $("#ap-soakrun").classList.add("danger");
      $("#ap-soakstate").textContent = "Watching. Play music through them and leave it running.";
      timer = setInterval(check, 4000);
    });
  };
  function check() {
    names().then(function (n) {
      var mins = ((performance.now() - t0) / 60000);
      $("#ap-soaktime").textContent = mins.toFixed(1);
      if (n !== seen) {
        TB.watch("EARBUDS", "audio device list changed at " + mins.toFixed(1) + " min");
        $("#ap-soakstate").textContent = "The audio device list changed at " + mins.toFixed(1) + " minutes — something connected or dropped out. Check both buds.";
        $("#ap-soaktime").className = "v fail";
        seen = n;
      }
    });
  }
  function stop(why) {
    watching = false;
    if (timer) { clearInterval(timer); timer = null; }
    $("#ap-soakrun").textContent = "Start dropout watch";
    $("#ap-soakrun").classList.remove("danger");
    $("#ap-soakstate").textContent = why;
  }
  TB.onLeave("airpods", function () { if (watching) stop("stopped — you left the page"); });
})();

/* ============================================================
   SERIAL LOG — you still read it off the case by eye, but a serial you
   have seen before is close to proof. Fakes reuse them in batches.
   ============================================================ */
(function () {
  function render() {
    var box = $("#ap-serials");
    box.textContent = "";
    if (!store.serials.length) {
      box.appendChild(el("p", "tb-empty", "Nothing logged yet. Every serial you enter is kept on this machine so repeats stand out."));
      return;
    }
    store.serials.slice().reverse().slice(0, 60).forEach(function (s) {
      var row = el("div", "tb-gbtn");
      row.style.cssText = "display:flex;gap:10px;margin-bottom:5px";
      row.appendChild(el("span", null, s.sn));
      var d = el("em", null, (s.note || "") + "  " + new Date(s.at).toLocaleDateString());
      d.style.cssText = "font-style:normal;opacity:.6;margin-left:auto";
      row.appendChild(d);
      box.appendChild(row);
    });
  }
  $("#ap-snadd").onclick = function () {
    var sn = ($("#ap-sn").value || "").trim().toUpperCase();
    if (sn.length < 6) { toast("Too short", "That does not look like a serial.", null); return; }
    var dupe = store.serials.filter(function (s) { return s.sn === sn; });
    if (dupe.length) {
      $("#ap-snresult").textContent = "SEEN BEFORE — " + dupe.length + " time(s), first on " + new Date(dupe[0].at).toLocaleDateString();
      $("#ap-snresult").className = "v fail";
      toast("Duplicate serial", "You have logged this exact serial before. Genuine serials are unique — counterfeits reuse them in batches.", "bad");
    } else {
      $("#ap-snresult").textContent = "New — not seen before";
      $("#ap-snresult").className = "v pass";
    }
    store.serials.push({ sn: sn, at: Date.now(), note: ($("#ap-snnote").value || "").trim().slice(0, 30) });
    save(); render();
    $("#ap-sn").value = "";
  };
  $("#ap-sncount") && ( $("#ap-sncount").textContent = store.serials.length );
  render();
  window.__apRenderSerials = render;
})();

/* ============================================================
   EXPORT / IMPORT so every bench machine shares the same reference
   ============================================================ */
$("#ap-export").onclick = function () {
  var json = JSON.stringify(store, null, 2);
  $("#ap-json").value = json;
  try {
    var url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    var a = el("a"); a.href = url; a.download = "testbench-earbuds.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  } catch (e) {
    toast("Copy it instead", "The download was blocked, so the data is in the box below — copy it across by hand.", null);
  }
};
$("#ap-import").onclick = function () {
  try {
    var incoming = JSON.parse($("#ap-json").value);
    if (!incoming || !incoming.profiles) throw new Error("not a testbench export");
    store.profiles = store.profiles.concat(incoming.profiles || []);
    store.serials = store.serials.concat(incoming.serials || []);
    save(); renderProfiles();
    if (window.__apRenderSerials) window.__apRenderSerials();
    toast("Imported", incoming.profiles.length + " profile(s) and " + (incoming.serials || []).length + " serial(s) added.", "ok");
  } catch (e) {
    toast("Could not read that", "Paste the whole file, from the first { to the last }.", "bad");
  }
};

/* ---------------- devices ---------------- */
function listDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  navigator.mediaDevices.enumerateDevices().then(function (ds) {
    var ins = ds.filter(function (d) { return d.kind === "audioinput"; });
    var sel = $("#ap-indev"), keep = sel.value;
    sel.textContent = "";
    if (!ins.length) { sel.appendChild(el("option", null, "allow the microphone to list devices")); return; }
    ins.forEach(function (d, i) {
      var o = el("option", null, d.label || ("Microphone " + (i + 1)));
      o.value = d.deviceId; sel.appendChild(o);
    });
    if (keep) sel.value = keep;
    /* pick something that is NOT the earbuds — see the note in the page */
    if (!keep) {
      var builtin = ins.filter(function (d) { return !/airpod|buds|headset|hands-?free/i.test(d.label || ""); })[0];
      if (builtin) sel.value = builtin.deviceId;
    }
  }).catch(function () {});
}
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", listDevices);
}

TB.tabs("#ap-tabs", "data-appane");
TB.onEnter("airpods", function () { listDevices(); draw(currentRef() ? currentRef().curve : null, null); });
renderProfiles();
listDevices();
verdict($("#ap-verdict"), null, [], "Capture a reference from a genuine pair, then test a suspect pair against it.");
draw(null, null);
})();
