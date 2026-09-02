/* Testbench — audio: microphone metering, headset output, loopback.
   The graph is wired mic -> analyser -> muted gain -> destination on purpose:
   Chrome only pulls audio through nodes that reach the destination, so an
   analyser hanging off the end reads pure silence. That was the dead-meter bug. */
"use strict";
var AUDIO = (function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp, toast = TB.toast, verdict = TB.verdict;

var ac = null, micStream = null, micNode = null, ana = null, sink = null;
var buf = null, freqBuf = null, raf = null;
var peak = 0, floor = 1, clips = 0, frames = 0;
var rec = null, chunks = [], blobUrl = null, audioEl = new Audio();
var stepTo = TB.steps("#au-steps");

function ctx() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === "suspended") ac.resume();
  return ac;
}
function dbfs(v) { return v <= 0.00001 ? -Infinity : 20 * Math.log10(v); }
function fmtDb(v) { var d = dbfs(v); return d === -Infinity ? "-∞" : d.toFixed(1); }

/* ---------------- devices ---------------- */
function listDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  navigator.mediaDevices.enumerateDevices().then(function (ds) {
    fill($("#au-indev"), ds.filter(function (d) { return d.kind === "audioinput"; }), "Microphone");
    fill($("#cam-dev"), ds.filter(function (d) { return d.kind === "videoinput"; }), "Camera");
    var outs = ds.filter(function (d) { return d.kind === "audiooutput"; });
    if (outs.length && "setSinkId" in HTMLMediaElement.prototype) {
      fill($("#au-outdev"), outs, "Output");
    } else {
      $("#au-outwrap").style.display = "none";
    }
    if (micStream) {
      var tr = micStream.getAudioTracks()[0];
      if (tr && tr.getSettings().deviceId) $("#au-indev").value = tr.getSettings().deviceId;
    }
  }).catch(function () {});
}
function fill(sel, list, word) {
  if (!sel) return;
  var keep = sel.value;
  sel.textContent = "";
  if (!list.length) { sel.appendChild(el("option", null, "No " + word.toLowerCase() + " found")); return; }
  list.forEach(function (d, i) {
    var o = el("option", null, d.label || (word + " " + (i + 1)));
    o.value = d.deviceId; sel.appendChild(o);
  });
  if (keep) sel.value = keep;
}

/* ---------------- microphone ---------------- */
function stopMic() {
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
  if (micNode) { try { micNode.disconnect(); } catch (e) {} }
  micStream = null; micNode = null; ana = null;
  TB.chip("mic", false, "off"); TB.badge("audio", "");
  $("#au-start").textContent = "Start microphone";
  $("#au-start").classList.remove("on");
  $("#au-rec").disabled = true; $("#lb-run").disabled = true;
  $("#lb-state").textContent = "Start the microphone first";
  stepTo(1);
}
function startMic() {
  var id = $("#au-indev").value;
  var c = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } };
  if (id && id.length > 4) c.audio.deviceId = { exact: id };
  navigator.mediaDevices.getUserMedia(c).then(function (s) {
    micStream = s;
    var a = ctx();
    micNode = a.createMediaStreamSource(s);
    ana = a.createAnalyser();
    ana.fftSize = 2048;
    ana.smoothingTimeConstant = 0.55;
    buf = new Float32Array(ana.fftSize);
    freqBuf = new Uint8Array(ana.frequencyBinCount);

    /* the fix: give the graph a path to the destination, silenced */
    sink = a.createGain();
    sink.gain.value = 0;
    micNode.connect(ana);
    ana.connect(sink);
    sink.connect(a.destination);

    peak = 0; floor = 1; clips = 0; frames = 0;
    var tr = s.getAudioTracks()[0], set = tr.getSettings ? tr.getSettings() : {};
    $("#au-sr").textContent = "";
    $("#au-sr").appendChild(document.createTextNode(String(Math.round(a.sampleRate / 100) / 10)));
    $("#au-sr").appendChild(el("small", null, " kHz"));
    $("#au-ch").textContent = set.channelCount || 1;
    $("#au-start").textContent = "Stop microphone";
    $("#au-start").classList.add("on");
    $("#au-rec").disabled = false; $("#lb-run").disabled = false;
    $("#lb-state").textContent = "Ready — put the headset on the bench, not on your head";
    TB.chip("mic", true, "live"); TB.badge("audio", "live", true);
    TB.watch("MIC started", tr.label || "microphone");
    stepTo(3);
    listDevices();
    if (a.state === "suspended") a.resume();
    loop();
  }).catch(function (err) {
    toast("Microphone blocked",
      err.name === "NotAllowedError" ? "Permission was denied. Allow the microphone for this page and try again."
      : err.name === "NotFoundError" ? "No microphone was found on this machine."
      : "Could not open that microphone (" + err.name + ").", "bad");
  });
}
$("#au-start").onclick = function () { micStream ? stopMic() : startMic(); };
$("#au-indev").onchange = function () { if (micStream) { stopMic(); setTimeout(startMic, 120); } };

/* ---------------- meters ---------------- */
var scope = $("#au-scope"), sctx = scope.getContext("2d");
var spec = $("#au-spec"), pctx = spec.getContext("2d");
function fit(c) {
  var d = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  c.getContext("2d").setTransform(d, 0, 0, d, 0, 0);
  return [w, h];
}
function loop() {
  raf = requestAnimationFrame(loop);
  if (!ana) return;
  ana.getFloatTimeDomainData(buf);
  var sum = 0, mx = 0;
  for (var i = 0; i < buf.length; i++) {
    var v = buf[i]; sum += v * v;
    var av = v < 0 ? -v : v;
    if (av > mx) mx = av;
    if (av >= 0.985) clips++;
  }
  var rms = Math.sqrt(sum / buf.length);
  frames++;
  if (mx > peak) peak = mx;
  if (frames > 25 && rms < floor) floor = rms;

  $("#au-lvl").textContent = fmtDb(rms) + " dB";
  var pk = $("#au-peak");
  pk.textContent = fmtDb(peak) + " dB";
  pk.className = "v " + (peak > 0.985 ? "fail" : peak > 0.08 ? "pass" : "warn");
  $("#au-floor").textContent = fmtDb(floor) + " dB";
  var cl = $("#au-clip"); cl.textContent = clips;
  cl.className = "v" + (clips > 200 ? " fail" : clips > 0 ? " warn" : "");

  var lvl = clamp((dbfs(rms) + 60) / 60, 0, 1);
  var bar = $("#au-inbar");
  bar.style.width = (lvl * 100) + "%";
  bar.className = peak > 0.985 ? "fail" : lvl > 0.12 ? "pass" : "warn";
  $("#au-inpct").textContent = (lvl * 100).toFixed(0) + "%";

  var d = fit(scope), w = d[0], h = d[1];
  sctx.clearRect(0, 0, w, h);
  sctx.strokeStyle = "#191E26"; sctx.lineWidth = 1;
  sctx.beginPath(); sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2); sctx.stroke();
  sctx.strokeStyle = peak > 0.985 ? "#FF2D46" : "#22E07B";
  sctx.lineWidth = 1.6; sctx.beginPath();
  for (var x = 0; x < w; x++) {
    var sv = buf[Math.floor(x / w * buf.length)];
    var y = h / 2 - sv * (h / 2 - 4);
    x ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
  }
  sctx.stroke();

  ana.getByteFrequencyData(freqBuf);
  var d2 = fit(spec), w2 = d2[0], h2 = d2[1];
  pctx.clearRect(0, 0, w2, h2);
  var bars = 80;
  for (var b = 0; b < bars; b++) {
    var lo = Math.floor(Math.pow(b / bars, 2) * freqBuf.length);
    var hi = Math.max(lo + 1, Math.floor(Math.pow((b + 1) / bars, 2) * freqBuf.length));
    var m = 0; for (var k = lo; k < hi; k++) if (freqBuf[k] > m) m = freqBuf[k];
    var bh = (m / 255) * (h2 - 4);
    pctx.fillStyle = m > 232 ? "#FFC53D" : "#FF2D46";
    pctx.fillRect(b * (w2 / bars) + 1, h2 - bh, (w2 / bars) - 2, bh);
  }
  if (frames % 12 === 0) micVerdict();
}
function micVerdict() {
  var f = [], s = 100;
  if (peak < 0.004) {
    verdict($("#au-verdict"), null, [], "Microphone is open but nothing is arriving — talk into it, or pick a different input above.");
    return;
  }
  if (clips > 200) { s -= 35; f.push({ level: "bad", tag: "clipping", text: clips + " clipped samples. The capsule or the gain is overloading — recordings will distort." }); }
  else if (clips > 0) { s -= 8; f.push({ level: "warn", tag: "clipping", text: clips + " clipped samples. Back the gain off or speak further away." }); }
  else f.push({ level: "ok", tag: "headroom", text: "No clipping. Peak " + fmtDb(peak) + " dB." });
  var fd = dbfs(floor);
  if (fd > -42) { s -= 22; f.push({ level: "bad", tag: "noise", text: "Noise floor sits at " + fd.toFixed(0) + " dB — audible hiss or hum even in silence." }); }
  else if (fd > -55) { s -= 8; f.push({ level: "warn", tag: "noise", text: "Noise floor " + fd.toFixed(0) + " dB. A little hissy but usable." }); }
  else f.push({ level: "ok", tag: "noise", text: "Quiet floor at " + fd.toFixed(0) + " dB." });
  if (peak < 0.06) { s -= 20; f.push({ level: "warn", tag: "level", text: "Peaks only reach " + fmtDb(peak) + " dB. Very low output — check the capsule and the cable." }); }
  else f.push({ level: "ok", tag: "level", text: "Healthy peaks at " + fmtDb(peak) + " dB." });
  verdict($("#au-verdict"), clamp(s, 0, 100), f);
}

/* ---------------- record and play back ---------------- */
$("#au-rec").onclick = function () {
  if (!micStream) return;
  if (rec && rec.state === "recording") { rec.stop(); return; }
  chunks = [];
  try { rec = new MediaRecorder(micStream); }
  catch (e) { toast("Recording unavailable", "This browser will not record from that device.", "bad"); return; }
  rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
  rec.onstop = function () {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    audioEl.src = blobUrl;
    $("#au-play").disabled = false;
    $("#au-rec").textContent = "Record 6 s";
    toast("Recorded", "Play it back through the headset you are testing — that catches faults a meter will not.", "ok");
  };
  rec.start();
  $("#au-rec").textContent = "Recording… stop";
  setTimeout(function () { if (rec && rec.state === "recording") rec.stop(); }, 6000);
};
$("#au-play").onclick = function () { audioEl.currentTime = 0; applySink(audioEl); audioEl.play(); };

function applySink(node) {
  var sel = $("#au-outdev");
  if (sel && sel.value && node.setSinkId) node.setSinkId(sel.value).catch(function () {});
}

/* ---------------- output tests ---------------- */
var osc = null, noiseSrc = null, gain = null, panner = null, outRaf = null, sweepT = null;
function stopTone() {
  if (sweepT) { clearInterval(sweepT); sweepT = null; }
  if (osc) { try { osc.stop(); } catch (e) {} try { osc.disconnect(); } catch (e) {} osc = null; }
  if (noiseSrc) { try { noiseSrc.stop(); } catch (e) {} try { noiseSrc.disconnect(); } catch (e) {} noiseSrc = null; }
  if (outRaf) { cancelAnimationFrame(outRaf); outRaf = null; }
  $("#au-outl").style.width = "0%"; $("#au-outr").style.width = "0%";
  $("#au-outlv").textContent = "0"; $("#au-outrv").textContent = "0";
}
function pinkNoise(a) {
  var len = a.sampleRate * 2, b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
  var b0 = 0, b1 = 0, b2 = 0;
  for (var i = 0; i < len; i++) {
    var w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
  }
  var src = a.createBufferSource(); src.buffer = b; src.loop = true; return src;
}
function tone(mode) {
  stopTone();
  if (mode === "stop") return;
  var a = ctx();
  gain = a.createGain();
  gain.gain.value = (parseInt($("#au-vol").value, 10) / 100) * 0.3;
  panner = a.createStereoPanner ? a.createStereoPanner() : null;

  var src;
  if (mode === "noise") { src = pinkNoise(a); noiseSrc = src; }
  else { src = a.createOscillator(); src.type = "sine"; src.frequency.value = 440; osc = src; }

  var splitter = a.createChannelSplitter(2);
  var aL = a.createAnalyser(), aR = a.createAnalyser();
  aL.fftSize = 512; aR.fftSize = 512;

  src.connect(gain);
  var tail = gain;
  if (panner) { gain.connect(panner); tail = panner; }
  tail.connect(a.destination);
  tail.connect(splitter);
  splitter.connect(aL, 0); splitter.connect(aR, 1);

  if (panner) panner.pan.value = mode === "left" ? -1 : mode === "right" ? 1 : 0;
  var t0 = performance.now();

  if (osc) {
    if (mode === "sweep") osc.frequency.value = 20;
    if (mode === "bass") osc.frequency.value = 30;
    osc.start();
    if (mode === "sweep") {
      osc.frequency.exponentialRampToValueAtTime(20000, a.currentTime + 14);
      sweepT = setInterval(function () {
        var fr = osc ? osc.frequency.value : 0;
        $("#au-sweeplbl").textContent = "Sweeping — " + (fr < 1000 ? Math.round(fr) + " Hz" : (fr / 1000).toFixed(1) + " kHz") + ". Listen for a gap, a buzz or a rattle.";
        if (performance.now() - t0 > 14500) { stopTone(); $("#au-sweeplbl").textContent = "Sweep finished."; }
      }, 120);
    }
    if (mode === "bass") {
      osc.frequency.exponentialRampToValueAtTime(120, a.currentTime + 8);
      sweepT = setInterval(function () { if (performance.now() - t0 > 8500) stopTone(); }, 200);
    }
  } else {
    src.start();
    sweepT = setInterval(function () { if (performance.now() - t0 > 12000) stopTone(); }, 300);
  }
  if (mode === "pan" && panner) {
    panner.pan.setValueAtTime(-1, a.currentTime);
    panner.pan.linearRampToValueAtTime(1, a.currentTime + 5);
    sweepT = setInterval(function () { if (performance.now() - t0 > 5400) stopTone(); }, 150);
  }

  var bl = new Uint8Array(aL.frequencyBinCount), br = new Uint8Array(aR.frequencyBinCount);
  (function m() {
    outRaf = requestAnimationFrame(m);
    aL.getByteFrequencyData(bl); aR.getByteFrequencyData(br);
    function pk(arr) { var x = 0; for (var i = 0; i < arr.length; i++) if (arr[i] > x) x = arr[i]; return x / 255; }
    var l = pk(bl), r = pk(br);
    $("#au-outl").style.width = (l * 100) + "%"; $("#au-outr").style.width = (r * 100) + "%";
    $("#au-outl").className = l > 0.02 ? "pass" : "";
    $("#au-outr").className = r > 0.02 ? "pass" : "";
    $("#au-outlv").textContent = (l * 100).toFixed(0) + "%";
    $("#au-outrv").textContent = (r * 100).toFixed(0) + "%";
  })();
}
$$("[data-tone]").forEach(function (b) { b.onclick = function () { tone(b.dataset.tone); }; });
$("#au-vol").oninput = function () { if (gain) gain.gain.value = (parseInt(this.value, 10) / 100) * 0.3; };

/* ---------------- loopback ---------------- */
$("#lb-run").onclick = function () {
  if (!ana) return;
  var a = ctx();
  var o = a.createOscillator(), g = a.createGain();
  o.type = "sine"; o.frequency.value = 1000;
  g.gain.value = (parseInt($("#au-vol").value, 10) / 100) * 0.3;
  o.connect(g); g.connect(a.destination); o.start();
  $("#lb-state").textContent = "Playing a 1 kHz tone and listening…";
  $("#lb-result").textContent = "listening";
  var best = 0, t0 = performance.now();
  var iv = setInterval(function () {
    ana.getByteFrequencyData(freqBuf);
    var binHz = a.sampleRate / 2 / freqBuf.length;
    var lo = Math.floor(850 / binHz), hi = Math.ceil(1150 / binHz);
    var m = 0; for (var i = lo; i <= hi && i < freqBuf.length; i++) if (freqBuf[i] > m) m = freqBuf[i];
    if (m > best) best = m;
    if (performance.now() - t0 > 5000) {
      clearInterval(iv);
      try { o.stop(); o.disconnect(); } catch (e) {}
      var pct = Math.round(best / 255 * 100);
      $("#lb-level").textContent = pct + "%";
      var r = $("#lb-result");
      if (best > 120) { r.textContent = "Both halves work"; r.className = "v pass"; }
      else if (best > 40) { r.textContent = "Faint — check fit"; r.className = "v warn"; }
      else { r.textContent = "Nothing came back"; r.className = "v fail"; }
      $("#lb-state").textContent = best > 120
        ? "The microphone heard the tone the earcups played — headset and cable are good."
        : "Turn the volume up, hold the microphone near an earcup and run it again. If it still fails, one half of the headset is dead.";
    }
  }, 100);
};

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", function () {
    TB.watch("AUDIO DEVICES", "list changed");
    listDevices();
  });
}
$("#au-outdev").onchange = function () { applySink(audioEl); };
listDevices();
stepTo(1);
verdict($("#au-verdict"), null, [], "Start the microphone to see level, noise floor and clipping.");
TB.onLeave("audio", function () { stopTone(); });
return { listDevices: listDevices };
})();
