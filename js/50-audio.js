/* Testbench — audio: microphone metering, headset output, loopback.
   The graph is wired mic -> analyser -> muted gain -> destination on purpose:
   Chrome only pulls audio through nodes that reach the destination, so an
   analyser hanging off the end reads pure silence. That was the dead-meter bug. */
"use strict";
var AUDIO = (function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp, toast = TB.toast, verdict = TB.verdict;

var ac = null, micStream = null, micNode = null, ana = null, sink = null, recTimer = null;
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
  /* Hold the handle. Without it, stopping a clip early leaves a timer that
     fires six seconds later and cuts the NEXT recording short. */
  if (recTimer) clearTimeout(recTimer);
  recTimer = setTimeout(function () {
    recTimer = null;
    if (rec && rec.state === "recording") rec.stop();
  }, 6000);
};
$("#au-play").onclick = function () { audioEl.currentTime = 0; applySink(audioEl); audioEl.play(); };

function applySink(node) {
  var sel = $("#au-outdev");
  if (sel && sel.value && node.setSinkId) node.setSinkId(sel.value).catch(function () {});
}

/* ---------------- output tests ---------------- */
/* ---------------- tones ----------------

   Everything here is shaped by one rule: the only thing you should hear is the
   headphone. Any click, thump or seam the page itself makes is a fault you will
   go looking for in the hardware.

   Three things used to make noise of their own:
     - the gain jumped straight to full and the oscillator was cut dead, so
       every tone began and ended with a click;
     - the pink-noise buffer looped at exactly two seconds with no match across
       the seam, so it ticked once every two seconds forever;
     - the sweep was stopped by a wall clock while the sound is driven by the
       audio clock. Under load the two drift apart, and the sweep was being cut
       off before it reached the top.
   All three are dealt with below. */
var osc = null, noiseSrc = null, gain = null, panner = null, outRaf = null, sweepT = null;
var ATTACK = 0.02, RELEASE = 0.05;
var SWEEP_HINT = "Left and right tell you a dead earcup instantly. The sweep finds blown drivers and rattles — listen for a gap, a buzz or a sudden drop.";

function fadeOutAndStop(g, node, a) {
  /* Ramp the level down before stopping the source. Stopping a sine mid-cycle
     is a step discontinuity, and a step is a click. */
  try {
    var t = a.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0.0001, t + RELEASE);
  } catch (e) {}
  try { node.stop(a.currentTime + RELEASE + 0.01); } catch (e) {}
  setTimeout(function () { try { node.disconnect(); } catch (e) {} }, (RELEASE + 0.1) * 1000);
}

function stopTone(immediate) {
  if (sweepT) { clearInterval(sweepT); sweepT = null; }
  var a = ac;
  if (a && gain && !immediate) {
    if (osc) fadeOutAndStop(gain, osc, a);
    if (noiseSrc) fadeOutAndStop(gain, noiseSrc, a);
  } else {
    if (osc) { try { osc.stop(); } catch (e) {} try { osc.disconnect(); } catch (e) {} }
    if (noiseSrc) { try { noiseSrc.stop(); } catch (e) {} try { noiseSrc.disconnect(); } catch (e) {} }
  }
  osc = null; noiseSrc = null; gain = null;
  if (outRaf) { cancelAnimationFrame(outRaf); outRaf = null; }
  $("#au-outl").style.width = "0%"; $("#au-outr").style.width = "0%";
  $("#au-outlv").textContent = "0"; $("#au-outrv").textContent = "0";
}

function pinkNoise(a) {
  /* Four seconds, with the last 80 ms crossfaded into the first 80 ms so the
     loop point is continuous. Without that the seam is a step, and a step
     repeating every loop is the faint tick people hear and blame on the cans. */
  var xf = Math.round(a.sampleRate * 0.08);
  var len = Math.round(a.sampleRate * 4) + xf;
  var raw = new Float32Array(len);
  var b0 = 0, b1 = 0, b2 = 0;
  for (var i = 0; i < len; i++) {
    var w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    raw[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
  }
  var outLen = len - xf;
  var b = a.createBuffer(1, outLen, a.sampleRate), d = b.getChannelData(0);
  for (var j = 0; j < outLen; j++) d[j] = raw[j];
  for (var k = 0; k < xf; k++) {
    var t = k / xf;                       /* equal-power crossfade */
    d[k] = d[k] * Math.sqrt(t) + raw[outLen + k] * Math.sqrt(1 - t);
  }
  var src = a.createBufferSource(); src.buffer = b; src.loop = true; return src;
}

function level() { return (parseInt($("#au-vol").value, 10) / 100) * 0.3; }

function tone(mode) {
  stopTone();
  if (mode === "stop") return;
  var a = ctx();
  /* Schedule against the audio clock, and only after the context is awake.
     A suspended context has a frozen currentTime, and anything scheduled
     against a frozen clock plays late or not at all. */
  var go = function () { build(mode, a); };
  if (a.state === "suspended" && a.resume) { a.resume().then(go, go); } else go();
}

function build(mode, a) {
  var t0 = a.currentTime + 0.03;          /* a beat of headroom to schedule into */
  gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(level(), t0 + ATTACK);
  panner = a.createStereoPanner ? a.createStereoPanner() : null;

  var src, dur;
  if (mode === "noise") { src = pinkNoise(a); noiseSrc = src; dur = 12; }
  else { src = a.createOscillator(); src.type = "sine"; osc = src; dur = 12; }

  var splitter = a.createChannelSplitter(2);
  var aL = a.createAnalyser(), aR = a.createAnalyser();
  aL.fftSize = 512; aR.fftSize = 512;

  src.connect(gain);
  var tail = gain;
  if (panner) { gain.connect(panner); tail = panner; }
  tail.connect(a.destination);
  tail.connect(splitter);
  splitter.connect(aL, 0); splitter.connect(aR, 1);

  if (panner) panner.pan.setValueAtTime(mode === "left" ? -1 : mode === "right" ? 1 : 0, t0);
  /* the running frequency readout belongs to the sweep and nothing else */
  if (mode !== "sweep") $("#au-sweeplbl").textContent = SWEEP_HINT;

  var lo = 20, hi = 20000;
  if (osc) {
    /* Anchor the start value with setValueAtTime. A ramp with no preceding
       event interpolates from whatever the parameter happens to hold, which is
       how a sweep meant to start at 20 Hz can begin at the 440 Hz default. */
    if (mode === "sweep") {
      dur = 14;
      osc.frequency.setValueAtTime(lo, t0);
      osc.frequency.exponentialRampToValueAtTime(hi, t0 + dur);
    } else if (mode === "bass") {
      lo = 30; hi = 120; dur = 8;
      osc.frequency.setValueAtTime(lo, t0);
      osc.frequency.exponentialRampToValueAtTime(hi, t0 + dur);
    } else {
      osc.frequency.setValueAtTime(440, t0);
    }
    osc.start(t0);
  } else {
    src.start(t0);
  }

  if (mode === "pan" && panner) {
    dur = 5;
    panner.pan.setValueAtTime(-1, t0);
    panner.pan.linearRampToValueAtTime(1, t0 + dur);
  }

  var endAt = t0 + dur;
  sweepT = setInterval(function () {
    var left = endAt - a.currentTime;
    if (mode === "sweep") {
      var el2 = Math.max(0, Math.min(dur, dur - left));
      var fr = lo * Math.pow(hi / lo, el2 / dur);
      $("#au-sweeplbl").textContent = left <= 0 ? "Sweep finished."
        : "Sweeping — " + (fr < 1000 ? Math.round(fr) + " Hz" : (fr / 1000).toFixed(1) + " kHz") +
          ". Listen for a gap, a buzz or a rattle.";
    }
    if (left <= 0) stopTone();
  }, 100);

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
$("#au-vol").oninput = function () {
  /* Glide, do not jump. Writing .value on every input event steps the gain once
     per pixel of travel, and a staircase of steps is zipper noise. */
  if (gain && ac) { try { gain.gain.setTargetAtTime(level(), ac.currentTime, 0.02); } catch (e) { gain.gain.value = level(); } }
};

/* ---------------- music check ----------------

   Tones find a dead driver. Music finds everything else, and finds it fast,
   because a person who knows a track hears something wrong in about three
   seconds without being able to say why. That is worth more on a bench than
   any meter.

   The tracks are a reference list, not files. This page ships no music and
   never will: those recordings belong to the people who made them, and putting
   them on a public site would be distributing them. The list says which track
   exposes which fault; play it from wherever you already listen.

   A file you own is different, and that is what the player is for. Drop it in
   and it runs through the same graph as the test tones, so you get the meters
   and the left/right isolation as well as the sound. It never leaves the
   machine — the browser reads it straight off the disk. */
var TRACKS = [
  { t: "Animals", a: "Martin Garrix", k: "Sub-bass and kick weight",
    w: "The drop is built on a low synth kick. A healthy driver gives a round thump you feel in the cup; one that is blown or has come unglued turns the same note into a papery rattle." },
  { t: "Blinding Lights", a: "The Weeknd", k: "Balance, top to bottom",
    w: "Synth bass, bright leads and a clear vocal all at once. If the treble is harsh or the bass swamps the voice, this is where a headset shows it." },
  { t: "Believer", a: "Imagine Dragons", k: "Transients and midrange punch",
    w: "Hard percussive stabs with space around them. A damaged driver smears the hit into a thud instead of a snap." },
  { t: "bad guy", a: "Billie Eilish", k: "Deep bass in an empty mix",
    w: "So sparse that any buzz is completely naked. Small drivers reproduce almost none of the low line — that is the size of the headphone, not a fault." },
  { t: "Bohemian Rhapsody", a: "Queen", k: "Dynamic range and layering",
    w: "Goes from a single voice to a wall of them. Quiet passages should stay clean and loud ones should not collapse into mush." },
  { t: "Hotel California (Hell Freezes Over)", a: "Eagles", k: "Detail and depth",
    w: "Live acoustic recording where strings, percussion and crowd sit at different distances. On a faulty cup the image flattens into one plane." },
  { t: "Money", a: "Pink Floyd", k: "Stereo imaging",
    w: "The intro loop walks deliberately around your head. The fastest way to catch a channel wired backwards or one side running weak." },
  { t: "Chandelier", a: "Sia", k: "Sibilance and treble strain",
    w: "A pushed vocal sitting right at the edge. Harshness or a hiss riding the S sounds points at a strained or torn diaphragm." },
  { t: "Why So Serious?", a: "Hans Zimmer", k: "Sustained sub-bass",
    w: "Holds a very low note for far longer than music normally does. If a driver is going to buzz, it buzzes here." },
  { t: "Royals", a: "Lorde", k: "Clean low end and placement",
    w: "Almost nothing in the mix to hide behind. Snaps should be tight and dead centre; the bass should be deep with no overhang after it stops." }
];

(function () {
  var audioEl2 = new Audio();
  audioEl2.preload = "metadata";
  var srcNode = null, mGain = null, mPan = null, mRaf = null, objURL = null;
  var listEl = $("#mu-list"), drop = $("#mu-drop");
  if (!listEl || !drop) return;

  /* ---------- the reference list ---------- */
  TRACKS.forEach(function (tr, i) {
    var li = el("li", "tb-track");
    li.appendChild(el("span", "n", String(i + 1).padStart(2, "0")));
    var body = el("div", "body");
    var head = el("div", "head");
    head.appendChild(el("b", null, tr.t));
    head.appendChild(el("span", "by", tr.a));
    body.appendChild(head);
    body.appendChild(el("span", "k", tr.k));
    body.appendChild(el("p", null, tr.w));
    li.appendChild(body);
    listEl.appendChild(li);
  });

  /* ---------- the player ---------- */
  function graph() {
    var a = ctx();
    if (!srcNode) {
      /* createMediaElementSource may only be called once for an element, so the
         graph is built on first play and kept for the life of the page. */
      srcNode = a.createMediaElementSource(audioEl2);
      mGain = a.createGain();
      mPan = a.createStereoPanner ? a.createStereoPanner() : null;
      var split = a.createChannelSplitter(2);
      var aL = a.createAnalyser(), aR = a.createAnalyser();
      aL.fftSize = 512; aR.fftSize = 512;
      srcNode.connect(mGain);
      var tail = mGain;
      if (mPan) { mGain.connect(mPan); tail = mPan; }
      tail.connect(a.destination);
      tail.connect(split);
      split.connect(aL, 0); split.connect(aR, 1);
      meter(aL, aR);
    }
    mGain.gain.value = level() * 2.6;   /* music is mastered far below a test tone */
    return a;
  }
  function meter(aL, aR) {
    var bl = new Uint8Array(aL.frequencyBinCount), br = new Uint8Array(aR.frequencyBinCount);
    (function m() {
      mRaf = requestAnimationFrame(m);
      if (audioEl2.paused) { bar("#mu-l", 0); bar("#mu-r", 0); return; }
      aL.getByteFrequencyData(bl); aR.getByteFrequencyData(br);
      function pk(x) { var v = 0; for (var i = 0; i < x.length; i++) if (x[i] > v) v = x[i]; return v / 255; }
      bar("#mu-l", pk(bl)); bar("#mu-r", pk(br));
    })();
  }
  function bar(sel, v) {
    var n = $(sel); if (!n) return;
    n.style.width = (v * 100) + "%";
    n.className = v > 0.02 ? "pass" : "";
  }

  function load(file) {
    if (!file) return;
    if (objURL) URL.revokeObjectURL(objURL);
    objURL = URL.createObjectURL(file);
    audioEl2.src = objURL;
    $("#mu-name").textContent = file.name;
    $("#mu-controls").hidden = false;
    drop.classList.add("loaded");
    stopTone();
    graph();
    audioEl2.play().then(paintPlay, function () { paintPlay(); });
  }
  function paintPlay() {
    $("#mu-play").textContent = audioEl2.paused ? "Play" : "Pause";
    $("#mu-play").classList.toggle("on", !audioEl2.paused);
  }
  audioEl2.addEventListener("play", paintPlay);
  audioEl2.addEventListener("pause", paintPlay);
  audioEl2.addEventListener("ended", paintPlay);
  audioEl2.addEventListener("timeupdate", function () {
    if (!audioEl2.duration) return;
    $("#mu-seek").value = String(audioEl2.currentTime / audioEl2.duration * 1000);
    $("#mu-time").textContent = clock(audioEl2.currentTime) + " / " + clock(audioEl2.duration);
  });
  function clock(s) {
    if (!isFinite(s)) return "0:00";
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  $("#mu-pick").onclick = function () { $("#mu-file").click(); };
  $("#mu-file").onchange = function () { load(this.files && this.files[0]); };
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault(); drop.classList.remove("over");
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^audio\//.test(f.type || "")) load(f);
    else toast("Not an audio file", "Drop an MP3, FLAC, WAV or M4A.", "bad");
  });

  $("#mu-play").onclick = function () {
    if (!audioEl2.src) { $("#mu-file").click(); return; }
    if (audioEl2.paused) { stopTone(); graph(); audioEl2.play().catch(function () {}); }
    else audioEl2.pause();
  };
  $("#mu-seek").oninput = function () {
    if (audioEl2.duration) audioEl2.currentTime = this.value / 1000 * audioEl2.duration;
  };
  $("#mu-loop").onclick = function () {
    audioEl2.loop = !audioEl2.loop;
    this.classList.toggle("on", audioEl2.loop);
    this.textContent = "Loop: " + (audioEl2.loop ? "on" : "off");
  };
  $$("[data-mupan]").forEach(function (b) {
    b.onclick = function () {
      var v = parseFloat(b.dataset.mupan);
      $$("[data-mupan]").forEach(function (x) { x.classList.toggle("on", x === b); });
      if (mPan) mPan.pan.setTargetAtTime(v, ac ? ac.currentTime : 0, 0.02);
      else toast("No channel split here", "This browser cannot pan, so both cups play together.", null);
    };
  });

  function stopMusic() {
    audioEl2.pause();
    if (mRaf) { cancelAnimationFrame(mRaf); mRaf = null; }
    bar("#mu-l", 0); bar("#mu-r", 0);
  }
  TB.onLeave("audio", stopMusic);
  window.addEventListener("pagehide", stopMusic);
  /* a test tone and a track should never fight each other */
  $$("[data-tone]").forEach(function (b) { b.addEventListener("click", function () { audioEl2.pause(); }); });
})();

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
TB.onLeave("audio", function () {
  stopTone();
  /* Leaving the page must release the microphone. Otherwise the OS recording
     light stays on for the rest of the session and the analyser keeps running
     an FFT every frame, which quietly skews the Stress test's fps figure. */
  if (micStream) stopMic();
  if (recTimer) { clearTimeout(recTimer); recTimer = null; }
});
/* never leave a microphone open on a machine that is walking out the door */
window.addEventListener("pagehide", function () { stopTone(true); if (micStream) stopMic(); });
return { listDevices: listDevices };
})();
