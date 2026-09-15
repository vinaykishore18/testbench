/* Testbench — routers and network. Everything here runs through whatever the
   machine is connected to, so it measures the router, the modem and the line
   together. Baseline against a router you trust, then compare. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, clamp = TB.clamp, verdict = TB.verdict, toast = TB.toast;

var PING = "assets/ping.txt";
var PAYLOAD = "assets/payload.bin";
/* Opened as a local file there is no origin to fetch from, so none of this can
   work — say so plainly rather than throwing errors at the console. */
var OFFLINE_FILE = location.protocol === "file:";
if (OFFLINE_FILE) {
  TB.onEnter("network", function () {
    var st = TB.$("#net-log");
    if (st && !st.childElementCount) {
      var d = TB.el("div");
      d.appendChild(TB.el("b", null, "NOT AVAILABLE"));
      d.appendChild(document.createTextNode("   These tests need the site properly hosted. Opened as a file on disk the browser blocks every request, so there is nothing to measure. Deploy it and this page works."));
      st.appendChild(d);
    }
  });
} else {
  /* the single-file build has no assets folder — fall back to the page itself */
  fetch(PING, { cache: "no-store" }).then(function (r) {
    if (!r.ok) throw 0;
  }).catch(function () {
    PING = location.pathname;
    PAYLOAD = location.pathname;
  });
}
var running = null, t0 = 0, timer = null;
var rtts = [], drops = 0, sent = 0, worst = 0, series = [];
var runs = [];

function nocache(u) { return u + "?t=" + Date.now() + "-" + Math.random().toString(36).slice(2); }

/* ---------------- one probe ---------------- */
function probe() {
  var start = performance.now();
  var ctl = ("AbortController" in window) ? new AbortController() : null;
  var kill = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
  return fetch(nocache(PING), { cache: "no-store", signal: ctl ? ctl.signal : undefined })
    .then(function (r) {
      clearTimeout(kill);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    })
    .then(function () { return performance.now() - start; })
    .catch(function (e) { clearTimeout(kill); throw e; });
}

/* ---------------- soak / latency ---------------- */
function tickProbe() {
  if (!running) return;
  sent++;
  probe().then(function (ms) {
    if (!running) return;
    rtts.push(ms);
    if (rtts.length > 4000) rtts.shift();
    if (ms > worst) worst = ms;
    series.push(ms);
    if (ms > 400) log("SLOW", Math.round(ms) + " ms — a spike this size is a stall, not normal latency");
    paint();
  }).catch(function (err) {
    if (!running) return;
    drops++;
    series.push(null);
    log("DROPPED", "no answer" + (err && err.name === "AbortError" ? " within 5 s" : "") + " — connection lost at this moment");
    paint();
  });
}
function log(tag, txt) {
  var box = $("#net-log"); if (!box) return;
  var d = el("div");
  d.appendChild(el("b", null, TB.stamp() + "  " + tag));
  d.appendChild(document.createTextNode("   " + txt));
  box.insertBefore(d, box.firstChild);
  while (box.childElementCount > 300) box.lastChild.remove();
}
function stats() {
  if (!rtts.length) return null;
  var sorted = rtts.slice().sort(function (a, b) { return a - b; });
  var sum = rtts.reduce(function (a, b) { return a + b; }, 0);
  var avg = sum / rtts.length;
  var jit = 0;
  for (var i = 1; i < rtts.length; i++) jit += Math.abs(rtts[i] - rtts[i - 1]);
  jit = rtts.length > 1 ? jit / (rtts.length - 1) : 0;
  return {
    min: sorted[0], avg: avg, max: sorted[sorted.length - 1],
    p95: sorted[Math.floor(sorted.length * 0.95)], jitter: jit,
    loss: sent ? drops / sent * 100 : 0
  };
}
function paint() {
  var s = stats();
  var el2 = function (id, v, cls) { var n = $(id); if (!n) return; n.textContent = v; if (cls != null) n.className = "v " + cls; };
  if (s) {
    el2("#net-rtt", Math.round(rtts[rtts.length - 1] || 0) + " ms", s.avg < 40 ? "pass" : s.avg < 120 ? "warn" : "fail");
    el2("#net-avg", Math.round(s.avg) + " ms");
    el2("#net-jit", Math.round(s.jitter) + " ms", s.jitter < 20 ? "pass" : s.jitter < 60 ? "warn" : "fail");
    el2("#net-worst", Math.round(s.max) + " ms", s.max < 300 ? "pass" : s.max < 1000 ? "warn" : "fail");
    el2("#net-loss", s.loss.toFixed(1) + "%", s.loss === 0 ? "pass" : s.loss < 1 ? "warn" : "fail");
  }
  el2("#net-drops", String(drops), drops === 0 ? "pass" : "fail");
  el2("#net-sent", String(sent));
  if (t0) {
    var secs = Math.floor((performance.now() - t0) / 1000);
    var mm = Math.floor(secs / 60), ss = secs % 60;
    $("#net-elapsed").textContent = mm + ":" + (ss < 10 ? "0" : "") + ss;
  }
  graph();
}
function graph() {
  var c = $("#net-graph"); if (!c) return;
  var d = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  var g = c.getContext("2d");
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  var view = series.slice(-240);
  var vals = view.filter(function (v) { return v != null; });
  var top = Math.max(120, Math.max.apply(null, vals.concat([120])));
  g.strokeStyle = "#191E26"; g.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(function (f) { g.beginPath(); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke(); });
  g.fillStyle = "#77828F"; g.font = "11px monospace";
  g.fillText(Math.round(top) + " ms", 6, 13);
  if (view.length < 2) return;
  var step = w / (view.length - 1);
  /* dropouts as red columns, so a router that dies is unmissable */
  view.forEach(function (v, i) {
    if (v == null) { g.fillStyle = "rgba(255,45,70,.55)"; g.fillRect(i * step - step / 2, 0, Math.max(2, step), h); }
  });
  g.strokeStyle = "#22E07B"; g.lineWidth = 2; g.beginPath();
  var started = false;
  view.forEach(function (v, i) {
    if (v == null) { started = false; return; }
    var x = i * step, y = h - (v / top) * (h - 10) - 5;
    if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
  });
  g.stroke();
}

/* ---------------- throughput ---------------- */
function throughput(seconds) {
  var bytes = 0, done = false, start = performance.now();
  $("#net-mbps").textContent = "…";
  function pull() {
    if (done) return;
    fetch(nocache(PAYLOAD), { cache: "no-store" })
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (b) {
        bytes += b.byteLength;
        var secs = (performance.now() - start) / 1000;
        $("#net-mbps").textContent = (bytes * 8 / 1e6 / secs).toFixed(1);
        if (secs < seconds) pull(); else finish();
      })
      .catch(function () { if (!done) finish(); });
  }
  function finish() {
    if (done) return;
    done = true;
    var secs = (performance.now() - start) / 1000;
    var mbps = bytes * 8 / 1e6 / secs;
    $("#net-mbps").textContent = mbps.toFixed(1);
    $("#net-mbps").className = "v " + (mbps > 40 ? "pass" : mbps > 8 ? "warn" : "fail");
    log("THROUGHPUT", (bytes / 1048576).toFixed(1) + " MB in " + secs.toFixed(1) + " s = " + mbps.toFixed(1) + " Mbps");
  }
  for (var i = 0; i < 4; i++) pull();
}

/* ---------------- concurrency / NAT table ---------------- */
function loadTest(n) {
  log("LOAD TEST", "opening " + n + " connections at once");
  $("#net-conc").textContent = "…";
  var ok = 0, fail = 0, start = performance.now(), left = n;
  for (var i = 0; i < n; i++) {
    fetch(nocache(PING), { cache: "no-store" })
      .then(function (r) { r.ok ? ok++ : fail++; })
      .catch(function () { fail++; })
      .then(function () {
        if (--left === 0) {
          var secs = (performance.now() - start) / 1000;
          $("#net-conc").textContent = ok + " / " + n;
          $("#net-conc").className = "v " + (fail === 0 ? "pass" : fail < n * 0.05 ? "warn" : "fail");
          log("LOAD TEST", ok + " of " + n + " answered in " + secs.toFixed(1) + " s" +
              (fail ? " — " + fail + " failed, the NAT table is struggling" : " — no failures"));
        }
      });
  }
}

/* ---------------- run control ---------------- */
function start(kind, ms) {
  if (running) return;
  running = kind; t0 = performance.now();
  rtts = []; drops = 0; sent = 0; worst = 0; series = [];
  $("#net-run").textContent = "Stop";
  $("#net-run").classList.remove("pri"); $("#net-run").classList.add("danger");
  log("START", (kind === "soak" ? "soak" : "quick check") + " on “" + label() + "” for " + Math.round(ms / 1000) + " s");
  TB.badge("network", "live", true);
  timer = setInterval(tickProbe, 1000);
  tickProbe();
  window.setTimeout(function () { if (running) stop(true); }, ms);
}
function stop(finished) {
  if (!running) return;
  var s = stats();
  clearInterval(timer); timer = null;
  var dur = (performance.now() - t0) / 1000;
  running = null;
  $("#net-run").textContent = "Start soak test";
  $("#net-run").classList.add("pri"); $("#net-run").classList.remove("danger");
  TB.badge("network", "");
  if (s) {
    runs.push({ label: label(), secs: Math.round(dur), avg: s.avg, jitter: s.jitter, drops: drops, loss: s.loss, mbps: $("#net-mbps").textContent });
    renderRuns();
  }
  score();
  log("STOP", finished ? "run finished" : "stopped by hand");
  if (finished) toast("Run finished", drops ? drops + " dropout(s) — that router is not stable." : "No dropouts. That one holds a connection.", drops ? "bad" : "ok");
}
function label() { return ($("#net-label").value || "unlabelled").slice(0, 40); }
function renderRuns() {
  var box = $("#net-runs");
  box.textContent = "";
  if (!runs.length) { box.appendChild(el("p", "tb-empty", "Finished runs appear here so you can compare bands and ports side by side.")); return; }
  var head = el("div", "tb-meterrow");
  box.appendChild(head);
  runs.forEach(function (r) {
    var row = el("div", "tb-gbtn");
    row.style.cssText = "display:grid;grid-template-columns:1.4fr repeat(4,1fr);gap:8px;margin-bottom:5px";
    [r.label, Math.round(r.avg) + " ms", Math.round(r.jitter) + " ms jit",
     r.drops + " drop" + (r.drops === 1 ? "" : "s"), r.secs + " s"].forEach(function (v, i) {
      var c = el("span", null, v);
      if (i === 3 && r.drops) c.style.color = "var(--red)";
      if (i === 3 && !r.drops) c.style.color = "var(--pass)";
      row.appendChild(c);
    });
    box.appendChild(row);
  });
}
function score() {
  var s = stats();
  if (!s) { verdict($("#net-verdict"), null, [], "Run a check to see how the router behaves."); return; }
  var sc = 100, f = [];
  if (drops > 0) {
    sc -= Math.min(60, 20 + drops * 8);
    f.push({ level: "bad", tag: "dropouts", text: drops + " dropout" + (drops === 1 ? "" : "s") + " in " + sent + " probes (" + s.loss.toFixed(1) + "%). A router that loses the connection on a bench will lose it in a house. Check the log for when they happened." });
  } else {
    f.push({ level: "ok", tag: "stable", text: "No dropouts across " + sent + " probes. The connection held the whole way through." });
  }
  if (s.jitter > 60) { sc -= 25; f.push({ level: "bad", tag: "jitter", text: "Latency wobbles by " + Math.round(s.jitter) + " ms between probes. Calls and games will stutter on this." }); }
  else if (s.jitter > 20) { sc -= 10; f.push({ level: "warn", tag: "jitter", text: "Jitter " + Math.round(s.jitter) + " ms — a little unsettled." }); }
  else f.push({ level: "ok", tag: "jitter", text: "Steady, " + Math.round(s.jitter) + " ms of jitter." });
  if (s.max > 1000) { sc -= 20; f.push({ level: "warn", tag: "stall", text: "Worst single response took " + Math.round(s.max) + " ms. Something froze briefly." }); }
  f.push({ level: "ok", tag: "latency", text: "Average " + Math.round(s.avg) + " ms, best " + Math.round(s.min) + " ms, 95% under " + Math.round(s.p95) + " ms." });
  f.push({ level: "ok", tag: "scope", text: "This measures the router, the modem and the line together. Compare against a router you know is good before you fail one on these numbers." });
  verdict($("#net-verdict"), clamp(sc, 0, 100), f);
}

/* ---------------- wiring ---------------- */
function fileGuard() {
  if (OFFLINE_FILE) { toast("Not available from a file", "The router tests need the site hosted. Everything else on this page works from disk.", null); return true; }
  return false;
}
$("#net-run").onclick = function () {
  if (fileGuard()) return;
  if (running) { stop(false); return; }
  start("soak", (parseFloat($("#net-dur").value) || 300) * 1000);
};
$("#net-quick").onclick = function () { if (fileGuard()) return; if (!running) start("quick", 30000); };
$("#net-speed").onclick = function () { if (fileGuard()) return; throughput(8); };
$("#net-load").onclick = function () { if (fileGuard()) return; loadTest(parseInt($("#net-conc-n").value, 10) || 120); };
$("#net-clear").onclick = function () { runs = []; renderRuns(); $("#net-log").textContent = ""; };

window.addEventListener("online", function () { log("LINK", "back online"); });
window.addEventListener("offline", function () { log("LINK", "offline — the machine lost the network entirely"); drops++; paint(); });

function envInfo() {
  var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var dl = $("#net-env"); dl.textContent = "";
  function kv(k, v) { dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, v)); }
  kv("Reported by the browser", c ? (c.effectiveType || "unknown") + (c.downlink ? " · about " + c.downlink + " Mb/s" : "") + (c.rtt ? " · " + c.rtt + " ms" : "") : "this browser does not report connection details");
  kv("Online now", navigator.onLine ? "yes" : "no");
  kv("Page served over", location.protocol.replace(":", ""));
  kv("What this cannot see", "Wi-Fi names, signal strength, which band you are on, the router's admin page or its firmware. No browser can reach any of that — connect the test machine to the port or band you want to check and label the run instead.");
}
TB.onEnter("network", function () { envInfo(); graph(); });
TB.onLeave("network", function () { if (running) stop(false); });
renderRuns();
score();
envInfo();
})();
