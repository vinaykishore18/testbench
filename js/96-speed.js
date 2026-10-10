/* Testbench — speed test.

   Three measurements, one run:

     1. IDLE LATENCY     how fast the line answers with nothing going on.
     2. DOWNLOAD         steady-state throughput, with the ramp-up discarded.
     3. LOADED LATENCY   how fast it answers WHILE the download is running.

   The third one is the point of this page and most speed tests do not show it.
   A line can measure 200 Mbps and still be unusable for a video call, because
   the moment traffic starts, the router buffers so much that every packet
   queues behind the download. That is bufferbloat, and it is the single most
   common cause of "the internet is fine but Teams keeps dropping" — the
   complaint that brings a router back to the counter. Idle latency 14 ms,
   loaded latency 600 ms, is a router you reject even though its download
   number looks excellent.

   What this cannot do, stated here rather than implied:
     - It cannot measure UPLOAD. There is no server in this project to send
       data to, and no amount of cleverness makes a static host accept it.
     - It cannot isolate the router. It measures the router, the modem, the
       line and this machine's own Wi-Fi as one chain.
     - It cannot exceed the shop's internet connection, so it will never
       prove a router is capable of gigabit. It is for catching the opposite.

   Every byte is counted and shown. Everything registers with the router
   page's abort leash, so leaving the page stops it dead. */
"use strict";
(function () {
var $ = TB.$, el = TB.el, toast = TB.toast;
var runBtn = $("#sp-run");
if (!runBtn || !window.NETGUARD) return;
var G = window.NETGUARD;

var PROBES_IDLE = 14;          /* enough for a median that is not luck */
var RAMP_MS = 1500;            /* TCP slow-start and CDN warm-up live here */
var running = false, ctl = null;
/* One leave handler for the module, not one per run. Registering it inside the
   run meant every speed test added another, and after ten runs leaving the
   page fired ten handlers - the same class of leak as the mouse page's history
   entries. cancel() is swapped out by each run instead. */
var cancel = null;
var series = [];               /* [{t, mbps, rtt}] for the graph */

/* ---------- small statistics, kept honest ---------- */
function median(a) {
  if (!a.length) return null;
  var b = a.slice().sort(function (x, y) { return x - y; });
  var m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function jitter(a) {
  /* Mean absolute difference between CONSECUTIVE samples, which is what
     jitter means. Standard deviation is a different thing and reads lower on
     a line that alternates fast, slow, fast, slow — exactly the behaviour
     that ruins a call. */
  if (a.length < 2) return null;
  var t = 0;
  for (var i = 1; i < a.length; i++) t += Math.abs(a[i] - a[i - 1]);
  return t / (a.length - 1);
}
function nice(n) {
  return n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB"
       : n >= 1048576 ? (n / 1048576).toFixed(0) + " MB"
       : Math.round(n / 1024) + " KB";
}
/* Set a big readout and flag that it moved. A number that changes four times
   a second with no visual cue is easy to read as a frozen one, and the first
   thing anyone does with a frozen tool is press the button again. */
function setBig(sel, txt) {
  var n = $(sel); if (!n) return;
  if (n.textContent === String(txt)) return;
  n.textContent = txt;
  n.classList.remove("ticked");
  void n.offsetWidth;
  n.classList.add("ticked");
}

function phase(txt, cls) {
  var p = $("#sp-phase");
  p.textContent = txt;
  p.className = "tb-sppill" + (cls ? " " + cls : "");
}

/* ---------- one latency probe ---------- */
function probe() {
  var t0 = performance.now();
  var c = G.leash();
  var kill = setTimeout(function () { if (c) try { c.abort(); } catch (e) {} }, 4000);
  return fetch(G.nocache(G.ping()), { cache: "no-store", signal: c ? c.signal : undefined })
    .then(function (r) {
      clearTimeout(kill);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .then(function () { return performance.now() - t0; })
    .catch(function (e) { clearTimeout(kill); return null; });   /* null = lost */
}

/* Probe repeatedly until told to stop, collecting into `into`. Used for both
   the idle pass and the under-load pass — same code, so the two numbers are
   measured the same way and are genuinely comparable. */
function probeLoop(into, stop, gap) {
  return new Promise(function (res) {
    (function tick() {
      if (stop()) { res(); return; }
      probe().then(function (ms) {
        into.push(ms);
        if (ms != null) {
          $("#sp-ping") && null;
        }
        setTimeout(tick, gap);
      });
    })();
  });
}

/* ---------- the download ---------- */
/* Counts bytes as they arrive rather than waiting for whole responses, so the
   live readout moves smoothly and a slow line is not reported as zero for
   several seconds and then as a jump. */
function stream(onBytes, stop) {
  function one() {
    if (stop()) return Promise.resolve();
    return fetch(G.nocache(G.payload()), { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (!r.body || !r.body.getReader) {
          /* No streaming body in this browser — fall back to whole responses.
             Less smooth, same total. */
          return r.arrayBuffer().then(function (b) { onBytes(b.byteLength); });
        }
        var rd = r.body.getReader();
        return (function pump() {
          return rd.read().then(function (x) {
            if (x.done) return;
            onBytes(x.value.byteLength);
            if (stop()) { try { rd.cancel(); } catch (e) {} return; }
            return pump();
          });
        })();
      })
      .then(function () { return one(); })
      .catch(function () { /* aborted or refused; the run ends on its own clock */ });
  }
  return one();
}

/* ---------- the graph ---------- */
function paint() {
  var c = $("#sp-graph"); if (!c) return;
  var d = Math.min(2, window.devicePixelRatio || 1);
  var w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  var g = c.getContext("2d");
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);

  var css = getComputedStyle(document.documentElement);
  var line = (css.getPropertyValue("--line-soft") || "#333").trim();
  var ink = (css.getPropertyValue("--ink-3") || "#888").trim();
  var pass = (css.getPropertyValue("--pass") || "#22E07B").trim();
  var warn = (css.getPropertyValue("--warn") || "#F5A524").trim();

  g.strokeStyle = line; g.lineWidth = 1;
  for (var i = 1; i < 4; i++) {
    var y = h * i / 4;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  if (series.length < 2) {
    g.fillStyle = ink; g.font = "12px ui-monospace, monospace"; g.textAlign = "center";
    g.fillText("press Run speed test", w / 2, h / 2);
    return;
  }

  var topM = Math.max.apply(null, series.map(function (s) { return s.mbps || 0; })) * 1.15 || 1;
  var rtts = series.map(function (s) { return s.rtt || 0; });
  var topR = Math.max(Math.max.apply(null, rtts) * 1.2, 50);
  var step = w / (series.length - 1);

  /* throughput, filled */
  g.beginPath();
  g.moveTo(0, h);
  series.forEach(function (s, i) { g.lineTo(i * step, h - (s.mbps / topM) * (h - 8) - 4); });
  g.lineTo(w, h); g.closePath();
  g.fillStyle = pass + "22"; g.fill();
  g.beginPath();
  series.forEach(function (s, i) {
    var x = i * step, y = h - (s.mbps / topM) * (h - 8) - 4;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.strokeStyle = pass; g.lineWidth = 2; g.stroke();

  /* response time, dashed, on its own scale */
  g.setLineDash([4, 4]);
  g.beginPath();
  var started = false;
  series.forEach(function (s, i) {
    if (s.rtt == null) { started = false; return; }
    var x = i * step, y = h - (s.rtt / topR) * (h - 8) - 4;
    started ? g.lineTo(x, y) : g.moveTo(x, y);
    started = true;
  });
  g.strokeStyle = warn; g.lineWidth = 1.6; g.stroke();
  g.setLineDash([]);

  g.fillStyle = ink; g.font = "10px ui-monospace, monospace"; g.textAlign = "left";
  g.fillText(topM.toFixed(0) + " Mbps", 6, 12);
  g.textAlign = "right";
  g.fillText(Math.round(topR) + " ms", w - 6, 12);
}
window.addEventListener("resize", function () { if ($("#sp-graph")) paint(); });
TB.onEnter("network", paint);
TB.onTheme && TB.onTheme(paint);

/* ---------- the verdict ---------- */
/* Grades bufferbloat the way the Bufferbloat project does: by how far latency
   climbs under load, not by the absolute number, because a satellite link
   starts at 600 ms and is still usable while a fibre line that climbs from 10
   to 300 ms is not. */
function grade(idle, loaded) {
  if (idle == null || loaded == null) return null;
  var d = loaded - idle;
  if (d < 5) return { g: "A+", cls: "pass", t: "barely moves under load" };
  if (d < 30) return { g: "A", cls: "pass", t: "holds up well under load" };
  if (d < 60) return { g: "B", cls: "pass", t: "slight queueing under load" };
  if (d < 200) return { g: "C", cls: "warn", t: "noticeable queueing — calls will wobble during a download" };
  if (d < 400) return { g: "D", cls: "warn", t: "heavy queueing — calls will break up during a download" };
  return { g: "F", cls: "fail", t: "the line is unusable for calls while anything is downloading" };
}

function verdict(r) {
  var box = $("#sp-verdict");
  box.textContent = "";
  var ul = el("ul", "tb-steps");
  function row(cls, tag, text) {
    var li = el("li", cls);
    li.appendChild(el("span", "tag", tag));
    li.appendChild(el("span", null, text));
    ul.appendChild(li);
  }

  /* Download, framed against what the shop actually needs it for rather than
     against a number nobody can place. */
  if (r.mbps == null) {
    row("bad", "download", "No throughput was measured at all. Either the line is down or something is blocking this site.");
  } else if (r.mbps >= 100) {
    row("ok", "download", r.mbps.toFixed(1) + " Mbps steady. Comfortable for anything — several 4K streams, big downloads, a full bench of machines updating at once.");
  } else if (r.mbps >= 25) {
    row("ok", "download", r.mbps.toFixed(1) + " Mbps steady. Fine for 4K on one screen, video calls and normal work.");
  } else if (r.mbps >= 8) {
    row("warn", "download", r.mbps.toFixed(1) + " Mbps steady. Enough for HD streaming and calls, but it will feel slow with more than one machine working.");
  } else {
    row("bad", "download", r.mbps.toFixed(1) + " Mbps steady. That is below what one HD video call wants. If the line is meant to be faster than this, the router or the cabling is the suspect.");
  }

  if (r.idle != null) {
    var lat = r.idle < 20 ? ["ok", "Good — nothing to complain about."]
            : r.idle < 60 ? ["ok", "Normal for a home or shop connection."]
            : r.idle < 150 ? ["warn", "High. Calls and games will feel laggy even with nothing else running."]
            : ["bad", "Very high. Something is wrong, or this is a mobile or satellite link."];
    row(lat[0], "latency", Math.round(r.idle) + " ms to answer when idle. " + lat[1]);
  }

  if (r.grade) {
    row(r.grade.cls === "pass" ? "ok" : r.grade.cls === "warn" ? "warn" : "bad", "under load",
        "Response time went from " + Math.round(r.idle) + " ms idle to " + Math.round(r.loaded) +
        " ms while downloading — grade " + r.grade.g + ", " + r.grade.t + "." +
        (r.grade.cls !== "pass" ? " This is a router fault far more often than a line fault, and it is exactly what people mean when they say the internet “drops” during a download." : ""));
  }

  if (r.loss > 0) {
    row(r.loss > 2 ? "bad" : "warn", "loss",
        r.loss + " of " + r.sent + " probes got no answer. On a wired connection even one is a finding; on Wi-Fi, more than a couple means move closer or change band.");
  } else {
    row("ok", "loss", "Every probe came back. No packet loss.");
  }

  if (r.jit != null) {
    row(r.jit < 10 ? "ok" : r.jit < 30 ? "warn" : "bad", "jitter",
        r.jit.toFixed(1) + " ms of variation between consecutive probes. " +
        (r.jit < 10 ? "Steady." : "Uneven — this is what makes voices sound choppy even when the average looks fine."));
  }

  row("ok", "scope", "Measured against this site, so the figure is capped by the shop's internet and by this machine's Wi-Fi — it cannot prove a router does gigabit. Upload is not measured and cannot be: there is no server here to send data to. " + nice(r.bytes) + " was pulled in total.");

  box.appendChild(ul);

  /* Into the unit report.

     This panel draws its own result rather than calling TB.verdict, and that
     meant nothing it measured reached the report - a 3.1 Mbps line with a red
     row on screen produced "Routers - Passes (100/100)" in the printout,
     because the soak check had registered and this had not. The page whose own
     header calls loaded latency "the point of this page" contributed nothing
     to the QC record.

     The score is built from what actually matters for a router: the
     bufferbloat gap first, because that is the fault that brings them back,
     then throughput, then loss. */
  var sc = 100, f2 = [];
  if (r.grade) {
    var pen = { "A+": 0, "A": 0, "B": 8, "C": 30, "D": 55, "F": 75 }[r.grade.g];
    sc -= (pen == null ? 0 : pen);
    f2.push({ level: r.grade.cls === "pass" ? "ok" : r.grade.cls === "warn" ? "warn" : "bad",
              tag: "under load",
              text: "Response time " + Math.round(r.idle) + " ms idle \u2192 " + Math.round(r.loaded) +
                    " ms while downloading. Grade " + r.grade.g + " \u2014 " + r.grade.t + "." });
  }
  if (r.mbps != null) {
    if (r.mbps < 8) { sc -= 45; f2.push({ level: "bad", tag: "download", text: r.mbps.toFixed(1) + " Mbps steady \u2014 below what one HD video call wants." }); }
    else if (r.mbps < 25) { sc -= 15; f2.push({ level: "warn", tag: "download", text: r.mbps.toFixed(1) + " Mbps steady \u2014 workable, slow with more than one machine." }); }
    else f2.push({ level: "ok", tag: "download", text: r.mbps.toFixed(1) + " Mbps steady." });
  } else {
    sc -= 60; f2.push({ level: "bad", tag: "download", text: "No throughput was measured at all." });
  }
  if (r.loss > 0) {
    sc -= Math.min(40, r.loss * 12);
    f2.push({ level: r.loss > 2 ? "bad" : "warn", tag: "loss", text: r.loss + " of " + r.sent + " probes got no answer." });
  }
  if (r.idle != null && r.idle >= 150) { sc -= 20; f2.push({ level: "warn", tag: "latency", text: Math.round(r.idle) + " ms to answer when idle \u2014 very high." }); }
  f2.push({ level: "ok", tag: "scope", text: "Download only. Upload cannot be measured without a server, and the figure is capped by the line and this machine's Wi-Fi \u2014 it cannot prove a router does gigabit." });
  TB.report("network", "Speed test", Math.max(0, sc), f2);
}

/* ---------- the run ---------- */
function run() {
  if (running) return;
  if (G.offline()) {
    toast("Not available from a file", "The speed test needs the site hosted. Everything else on this page works from disk.", null);
    return;
  }
  if (!G.heavy("speed")) {
    toast("Something else is running", "Wait for the load test to finish, or stop it first.", null);
    return;
  }
  running = true;
  ctl = G.leash();
  $("#sp-panel").classList.add("tb-working");
  series = [];
  var secs = parseFloat($("#sp-len").value) || 10;
  ["#sp-now", "#sp-ping", "#sp-loaded", "#sp-grade", "#sp-mbps", "#sp-peak", "#sp-bytes", "#sp-jit", "#sp-loss", "#sp-streams"]
    .forEach(function (id) { var n = $(id); if (n) { n.textContent = "…"; n.className = n.className.replace(/\s*(pass|warn|fail)\b/g, ""); } });
  $("#sp-verdict").textContent = "";

  var idleRtts = [], loadRtts = [], stop = false;
  var bytes = 0, peak = 0, streams = 0;
  var ticker = null, loadMeter = null;

  /* Armed BEFORE the first phase, not when the download starts.

     This was the download's own teardown, assigned inside startDownload, and
     the hole it left was real: leaving the page during the idle-latency pass
     found `cancel` still null (or still pointing at the previous run), so
     nothing stopped THIS run - and the idle pass then went on to call
     startDownload and open streams on a page the operator had already left.
     Measured three payload fetches starting up to 829 ms after the leave
     handler ran, which is the exact fault this whole leash exists to prevent,
     reintroduced by me in a different place.

     One teardown, armed for the whole run, is the shape that cannot have that
     hole. */
  cancel = function () {
    stop = true;
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (loadMeter) { clearInterval(loadMeter); loadMeter = null; }
    if (ctl) try { ctl.abort(); } catch (e) {}
    running = false;
    $("#sp-panel").classList.remove("tb-working");
    phase("stopped — you left the page");
    G.heavyDone();
  };

  /* ---- phase 1: idle latency ---- */
  phase("measuring idle latency", "warn");
  G.log("SPEED", "idle latency, " + PROBES_IDLE + " probes");

  var n = 0;
  (function idlePass() {
    /* Stopped means stopped. This used to read `n >= PROBES_IDLE || stop` and
       then call startDownload either way, so cancelling the run during the
       idle pass started the download instead of ending it. */
    if (stop) return;
    if (n >= PROBES_IDLE) { startDownload(); return; }
    n++;
    probe().then(function (ms) {
      if (stop) return;
      idleRtts.push(ms);
      var good = idleRtts.filter(function (x) { return x != null; });
      var med = median(good);
      if (med != null) setBig("#sp-ping", Math.round(med));
      series.push({ t: performance.now(), mbps: 0, rtt: ms });
      paint();
      setTimeout(idlePass, 90);
    });
  })();

  /* ---- phase 2: download, with latency measured underneath it ---- */
  function startDownload() {
    if (stop) return;
    var good = idleRtts.filter(function (x) { return x != null; });
    var idleMed = median(good);
    $("#sp-ping").textContent = idleMed == null ? "—" : Math.round(idleMed);
    $("#sp-jit").textContent = good.length > 1 ? jitter(good).toFixed(1) + " ms" : "—";

    phase("downloading", "warn");
    G.log("SPEED", "download for " + secs + " s");

    var t0 = performance.now(), rampBytes = 0, rampDone = false;
    var lastTick = t0, lastBytes = 0;

    function onBytes(b) { bytes += b; }

    /* Start with three streams and add more while throughput is still
       climbing. One stream under-reads a fast line because a single TCP
       connection cannot fill it; eight streams on a slow line just makes them
       fight each other. Ramping finds the number that suits the link. */
    var want = 3, lastMbps = 0;
    function addStream() {
      streams++;
      $("#sp-streams").textContent = streams;
      stream(onBytes, function () { return stop; });
    }
    for (var i = 0; i < want; i++) addStream();

    ticker = setInterval(function () {
      var now = performance.now();
      var dt = (now - lastTick) / 1000;
      if (dt <= 0) return;
      var inst = (bytes - lastBytes) * 8 / 1e6 / dt;
      lastTick = now; lastBytes = bytes;

      if (!rampDone && now - t0 >= RAMP_MS) { rampDone = true; rampBytes = bytes; }
      if (inst > peak) { peak = inst; $("#sp-peak").textContent = peak.toFixed(1); }
      setBig("#sp-now", inst.toFixed(1));
      $("#sp-bytes").textContent = nice(bytes);

      var rtt = loadRtts.length ? loadRtts[loadRtts.length - 1] : null;
      series.push({ t: now, mbps: inst, rtt: rtt });
      if (series.length > 400) series.shift();
      paint();

      /* still climbing and room to grow? add a stream */
      if (streams < 8 && inst > lastMbps * 1.15) addStream();
      lastMbps = inst;

      if (now - t0 >= secs * 1000) finish(t0, rampBytes, idleMed);
    }, 250);

    /* latency under load, measured with exactly the same probe as the idle
       pass so the two numbers mean the same thing */
    probeLoop(loadRtts, function () { return stop; }, 150).then(function () {});
    loadMeter = setInterval(function () {
      var g2 = loadRtts.filter(function (x) { return x != null; });
      var m = median(g2);
      if (m != null) setBig("#sp-loaded", Math.round(m));
    }, 400);

    function finish(t0, rampBytes, idleMed) {
      if (stop) return;
      stop = true;
      clearInterval(ticker); ticker = null;
      clearInterval(loadMeter); loadMeter = null;
      if (ctl) try { ctl.abort(); } catch (e) {}

      var now = performance.now();
      var steadySecs = (now - t0 - RAMP_MS) / 1000;
      var steadyBytes = bytes - rampBytes;
      /* Drop the ramp-up. TCP slow-start and the CDN's first-byte latency make
         the opening second or so unrepresentatively slow, and including it
         understates a fast line by a long way. If the run was too short to
         have a steady window, use the whole thing and say nothing clever. */
      var mbps = (steadySecs > 0.5 && steadyBytes > 0)
        ? steadyBytes * 8 / 1e6 / steadySecs
        : (bytes * 8 / 1e6 / ((now - t0) / 1000));

      var goodLoad = loadRtts.filter(function (x) { return x != null; });
      var loadedMed = median(goodLoad);
      var allProbes = idleRtts.concat(loadRtts);
      var lost = allProbes.filter(function (x) { return x == null; }).length;
      var g = grade(idleMed, loadedMed);

      $("#sp-mbps").innerHTML = mbps.toFixed(1) + " <small>Mbps</small>";
      $("#sp-now").textContent = mbps.toFixed(1);
      $("#sp-peak").textContent = peak.toFixed(1);
      $("#sp-bytes").textContent = nice(bytes);
      $("#sp-loaded").textContent = loadedMed == null ? "—" : Math.round(loadedMed);
      $("#sp-loss").textContent = lost + " / " + allProbes.length;
      $("#sp-loss").className = "v " + (lost === 0 ? "pass" : lost > 2 ? "fail" : "warn");
      $("#sp-streams").textContent = streams;
      if (g) {
        $("#sp-grade").textContent = g.g;
        $("#sp-grade").className = g.cls;
      }
      /* keep the soak page's run table working — it reads this readout */
      var nm = $("#net-mbps"); if (nm) nm.innerHTML = mbps.toFixed(1) + " <small>Mbps</small>";

      verdict({ mbps: mbps, peak: peak, bytes: bytes, idle: idleMed, loaded: loadedMed,
                jit: goodLoad.length > 1 ? jitter(idleRtts.filter(function (x) { return x != null; })) : null,
                loss: lost, sent: allProbes.length, grade: g });

      G.log("SPEED", mbps.toFixed(1) + " Mbps steady, " + nice(bytes) + " pulled, " +
            (idleMed == null ? "?" : Math.round(idleMed)) + " ms idle → " +
            (loadedMed == null ? "?" : Math.round(loadedMed)) + " ms loaded" + (g ? " (grade " + g.g + ")" : ""));

      $("#sp-panel").classList.remove("tb-working");
      phase(g ? "done — grade " + g.g : "done", g ? g.cls : "pass");
      running = false;
      cancel = null;        /* finished cleanly; nothing left to tear down */
      G.heavyDone();
      toast("Speed test finished",
            mbps.toFixed(1) + " Mbps down, " + (idleMed == null ? "?" : Math.round(idleMed)) + " ms idle" +
            (g && g.cls !== "pass" ? " — but response time climbs to " + Math.round(loadedMed) + " ms under load, grade " + g.g + "." : "."),
            g && g.cls === "fail" ? "bad" : "ok");
    }

  }
}

runBtn.onclick = run;

TB.onLeave("network", function () { if (running && cancel) cancel(); });
window.addEventListener("pagehide", function () { if (running && cancel) cancel(); });

/* S starts it without reaching for the mouse, same as F and Q on the monitor
   page. Ignored while typing, so labelling a run cannot fire a speed test. */
window.addEventListener("keydown", function (e) {
  if (TB.view() !== "network" || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  var t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  if ((e.key || "").toLowerCase() === "s") { e.preventDefault(); run(); }
});

paint();
})();
