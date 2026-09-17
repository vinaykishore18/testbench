/* Testbench — stress test: load every CPU core and the GPU, watch the frame rate.
   Throttling shows up as a frame rate that steps down after a minute or so. */
"use strict";
(function () {
var $ = TB.$, el = TB.el, clamp = TB.clamp, verdict = TB.verdict, toast = TB.toast;

var running = false, workers = [], ops = 0, t0 = 0, raf = null, timer = null;
var samples = [], frames = 0, lastFrame = 0, worstStall = 0, durMs = 60000, lastTick = 0;
var gl = null, glProg = null, glStart = 0;

/* ---------------- CPU load ---------------- */
var WORKER_SRC = [
  "var n=0;",
  "function burn(){",
  "  var x=0;",
  "  for(var i=0;i<400000;i++){ x+=Math.sqrt(i)*Math.sin(i)+Math.log(i+1); }",
  "  n++;",
  "  if(x===Infinity) postMessage(-1);",
  "  setTimeout(burn,0);",
  "}",
  "setInterval(function(){ postMessage(n); n=0; },500);",
  "burn();"
].join("\n");

function startCPU() {
  var url;
  try { url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })); }
  catch (e) { return 0; }
  var n = Math.max(1, navigator.hardwareConcurrency || 4);
  for (var i = 0; i < n; i++) {
    try {
      var w = new Worker(url);
      w.onmessage = function (ev) { if (ev.data > 0) ops += ev.data; };
      workers.push(w);
    } catch (e) { break; }
  }
  URL.revokeObjectURL(url);
  return workers.length;
}
function stopCPU() {
  workers.forEach(function (w) { try { w.terminate(); } catch (e) {} });
  workers = [];
}

/* ---------------- GPU load ---------------- */
var VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";
var FS = [
  "precision highp float;",
  "uniform float t;",
  "uniform vec2 r;",
  "void main(){",
  "  vec2 uv=(gl_FragCoord.xy-0.5*r)/r.y;",
  "  vec3 c=vec3(0.0);",
  "  float a=0.0;",
  "  for(int i=0;i<120;i++){",
  "    float f=float(i);",
  "    a+=sin(uv.x*f*0.35+t)*cos(uv.y*f*0.31-t*0.7)/(f+1.0);",
  "    c+=vec3(abs(a))*0.012;",
  "  }",
  "  gl_FragColor=vec4(c.r*1.4,c.g*0.25,c.b*0.35+abs(a)*0.2,1.0);",
  "}"
].join("\n");

function startGPU() {
  var cv = $("#st-gl");
  cv.width = 640; cv.height = 360;
  gl = cv.getContext("webgl") || cv.getContext("experimental-webgl");
  if (!gl) return false;
  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
    return s;
  }
  var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
  if (!v || !f) { gl = null; return false; }
  glProg = gl.createProgram();
  gl.attachShader(glProg, v); gl.attachShader(glProg, f); gl.linkProgram(glProg);
  if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) { gl = null; return false; }
  gl.useProgram(glProg);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(glProg, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  glStart = performance.now();
  return true;
}
function drawGPU() {
  if (!gl) return;
  gl.viewport(0, 0, 640, 360);
  gl.uniform1f(gl.getUniformLocation(glProg, "t"), (performance.now() - glStart) / 1000);
  gl.uniform2f(gl.getUniformLocation(glProg, "r"), 640, 360);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* ---------------- graph ---------------- */
function drawGraph() {
  var c = $("#st-graph");
  var d = Math.min(2, window.devicePixelRatio || 1);
  var w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  var g = c.getContext("2d");
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  var maxFps = Math.max(60, Math.max.apply(null, samples.concat([60])));
  g.strokeStyle = "#191E26"; g.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(function (f) {
    g.beginPath(); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke();
  });
  g.fillStyle = "#77828F"; g.font = "11px monospace";
  g.fillText(Math.round(maxFps) + " fps", 6, 13);
  if (samples.length < 2) return;
  g.strokeStyle = "#FF2D46"; g.lineWidth = 2; g.beginPath();
  samples.forEach(function (v, i) {
    var x = i / (samples.length - 1) * w;
    var y = h - (v / maxFps) * (h - 8) - 4;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
  g.lineTo(w, h); g.lineTo(0, h); g.closePath();
  g.fillStyle = "rgba(255,45,70,.12)"; g.fill();
}

/* ---------------- run ---------------- */
function tick() {
  if (!running) return;
  raf = requestAnimationFrame(tick);
  var now = performance.now();
  if (lastFrame) {
    var dt = now - lastFrame;
    if (dt > worstStall) worstStall = dt;
  }
  lastFrame = now;
  frames++;
  drawGPU();
}
function second() {
  if (!running) return;
  var elapsed = (performance.now() - t0) / 1000;
  $("#st-time").textContent = "";
  $("#st-time").appendChild(document.createTextNode(String(Math.floor(elapsed))));
  $("#st-time").appendChild(el("small", null, "s"));
  /* setInterval is starved by the very load this test creates, so a tick can
     land 1.3 s late. Counting frames per tick then reports 78 "fps" on a locked
     60 Hz machine — and that drift is indistinguishable from the thermal
     throttling this test exists to detect. Divide by the time that actually
     passed. */
  var tickNow = performance.now();
  var dt = (tickNow - lastTick) / 1000;
  lastTick = tickNow;
  var fps = dt > 0.05 ? Math.round(frames / dt) : frames;
  frames = 0;
  samples.push(fps);
  if (samples.length > 600) samples.shift();
  $("#st-fps").textContent = fps;
  $("#st-fps").className = "v " + (fps >= 50 ? "pass" : fps >= 25 ? "warn" : "fail");
  var first = samples.slice(0, 5);
  if (first.length) {
    var f0 = first.reduce(function (a, b) { return a + b; }, 0) / first.length;
    $("#st-drop").textContent = Math.round(f0) + " → " + fps;
  }
  $("#st-ops").textContent = ops ? (ops / 1000).toFixed(0) + "k" : "—";
  $("#st-stall").textContent = Math.round(worstStall) + " ms";
  $("#st-stall").className = "v " + (worstStall > 500 ? "fail" : worstStall > 150 ? "warn" : "pass");
  drawGraph();
  if (elapsed * 1000 >= durMs) stop(true);
}
function score() {
  if (samples.length < 8) { verdict($("#st-verdict"), null, [], "Run for at least ten seconds to get a reading."); return; }
  var head = samples.slice(0, 5), tail = samples.slice(-5);
  var avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
  var h = avg(head), t = avg(tail), drop = h > 0 ? (h - t) / h * 100 : 0;
  var s = 100, f = [];
  if (drop > 40) { s -= 45; f.push({ level: "bad", tag: "throttle", text: "Frame rate fell " + drop.toFixed(0) + "% from " + Math.round(h) + " to " + Math.round(t) + ". That is heavy throttling — dried thermal paste, blocked vents or a fan that is not spinning." }); }
  else if (drop > 15) { s -= 20; f.push({ level: "warn", tag: "throttle", text: "Frame rate eased off " + drop.toFixed(0) + "% under sustained load. Some throttling, common on thin laptops but worth a clean." }); }
  else f.push({ level: "ok", tag: "sustained", text: "Frame rate held steady for the whole run (" + Math.round(h) + " → " + Math.round(t) + "). Cooling is coping." });
  if (worstStall > 500) { s -= 30; f.push({ level: "bad", tag: "stall", text: "Longest stall was " + Math.round(worstStall) + " ms. Freezes that long under load point at power delivery, memory or the graphics chip." }); }
  else if (worstStall > 150) { s -= 10; f.push({ level: "warn", tag: "stall", text: "Longest stall " + Math.round(worstStall) + " ms." }); }
  else f.push({ level: "ok", tag: "smooth", text: "No stall longer than " + Math.round(worstStall) + " ms." });
  if (workers.length) f.push({ level: "ok", tag: "cpu", text: workers.length + " worker threads ran to completion with " + (ops / 1000).toFixed(0) + "k units of work." });
  verdict($("#st-verdict"), clamp(s, 0, 100), f);
  TB.badge("stress", Math.round(clamp(s, 0, 100)) + "", s >= 90);
}
function start() {
  if (running) return;
  running = true;
  samples = []; frames = 0; ops = 0; worstStall = 0; lastFrame = 0; lastTick = performance.now();
  durMs = (parseFloat($("#st-dur").value) || 60) * 1000;
  var mode = $("#st-mode").value;
  t0 = performance.now();
  var n = 0;
  if (mode !== "gpu") n = startCPU();
  $("#st-workers").textContent = n;
  if (mode !== "cpu") { if (!startGPU()) toast("No WebGL", "The graphics chip could not be loaded here — running the CPU part only.", "bad"); }
  $("#st-run").textContent = "Stop";
  $("#st-run").classList.remove("pri"); $("#st-run").classList.add("danger");
  TB.watch("STRESS started", mode + " for " + (durMs / 1000) + "s");
  raf = requestAnimationFrame(tick);
  timer = setInterval(second, 1000);
}
function stop(finished) {
  if (!running) return;
  running = false;
  stopCPU();
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  if (timer) { clearInterval(timer); timer = null; }
  gl = null;
  $("#st-run").textContent = "Start stress test";
  $("#st-run").classList.add("pri"); $("#st-run").classList.remove("danger");
  score();
  TB.watch("STRESS stopped", finished ? "run finished" : "stopped by hand");
  if (finished) toast("Stress test finished", "Check the graph — a flat line is a healthy machine.", "ok");
}
$("#st-run").onclick = function () { running ? stop(false) : start(); };
TB.onLeave("stress", function () { stop(false); });
TB.onEnter("stress", function () { drawGraph(); });
verdict($("#st-verdict"), null, [], "Pick a duration and press start. Keep this tab in front — a background tab is throttled by the browser and the numbers mean nothing.");
})();
