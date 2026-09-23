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

/* ---------------- GPU load ----------------

   What the picture actually is: one triangle covering the whole viewport, and
   for every pixel in it a loop of sines and cosines accumulated into an
   interference pattern, tinted red. The image means nothing. It is a way to
   give the graphics chip a large, unavoidable amount of floating-point work
   per pixel per frame, and to make a stall visible — if the maths stops, the
   picture stops, and you can see that from across the room.

   The load is adjustable because a fixed one is either too light or too heavy
   depending on the machine. 640x360 at 120 iterations is about 28 million
   sine-cosine pairs a frame, which a modern discrete card will finish without
   raising a fan; the higher levels are what make one work. The iteration count
   has to be baked into the shader source rather than passed as a uniform,
   because GLSL ES 1.0 requires loop bounds to be compile-time constants, so
   changing level recompiles the program. */
var GPU_LEVELS = {
  light:  { w: 640,  h: 360,  it: 60,  label: "640×360" },
  normal: { w: 1280, h: 720,  it: 120, label: "1280×720" },
  heavy:  { w: 1920, h: 1080, it: 220, label: "1920×1080" },
  max:    { w: 2560, h: 1440, it: 400, label: "2560×1440" }
};
var glLevel = "normal", glW = 1280, glH = 720, glIter = 120;

var VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";
function fsSource(iter) {
  return [
    "precision highp float;",
    "uniform float t;",
    "uniform vec2 r;",
    "void main(){",
    "  vec2 uv=(gl_FragCoord.xy-0.5*r)/r.y;",
    "  vec3 c=vec3(0.0);",
    "  float a=0.0;",
    "  for(int i=0;i<" + iter + ";i++){",
    "    float f=float(i);",
    "    a+=sin(uv.x*f*0.35+t)*cos(uv.y*f*0.31-t*0.7)/(f+1.0);",
    "    c+=vec3(abs(a));",
    "  }",
    /* Tone-map rather than scale by a constant. The accumulator is not linear
       in the iteration count — the later terms largely cancel each other — so a
       fixed divisor that looked right at 120 iterations blew the picture out to
       flat white at 60. x/(x+k) is bounded whatever comes in, which makes the
       image look the same at every load level. */
    "  c/=float(" + iter + ");",
    "  vec3 m=c/(c+vec3(0.5));",
    "  float g=abs(a); g=g/(g+1.0);",
    "  gl_FragColor=vec4(m.r*1.25,m.g*0.22,m.b*0.32+g*0.18,1.0);",
    "}"
  ].join("\n");
}

/* One context for the life of the page. Browsers cap how many live WebGL
   contexts a page may hold and drop the oldest past the limit, so making a
   fresh one per run is a slow way to break the test. */
function ensureGL() {
  if (gl) return true;
  var cv = $("#st-gl");
  gl = cv.getContext("webgl") || cv.getContext("experimental-webgl");
  if (!gl) return false;
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return true;
}
function compile(iter) {
  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  }
  var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, fsSource(iter));
  if (!v || !f) return false;
  var prog = gl.createProgram();
  gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl.deleteProgram(prog); return false; }
  if (glProg) gl.deleteProgram(glProg);
  glProg = prog;
  gl.useProgram(glProg);
  var loc = gl.getAttribLocation(glProg, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  uT = gl.getUniformLocation(glProg, "t");
  uR = gl.getUniformLocation(glProg, "r");
  return true;
}
var uT = null, uR = null;

function applyLevel(name) {
  var L = GPU_LEVELS[name] || GPU_LEVELS.normal;
  glLevel = name; glW = L.w; glH = L.h; glIter = L.it;
  var cv = $("#st-gl");
  cv.width = glW; cv.height = glH;
  if (gl && !compile(glIter)) { toast("Shader would not build", "Dropping the graphics load to the light setting.", "bad"); if (name !== "light") applyLevel("light"); return; }
  glInfo();
}
function glInfo(fps) {
  var n = $("#st-glinfo"); if (!n) return;
  var L = GPU_LEVELS[glLevel];
  var px = glW * glH * glIter;
  var txt = L.label + " · " + glIter + " iterations · " + (px / 1e6).toFixed(0) + "M sin-cos per frame";
  if (fps) txt += " · " + (px * fps / 1e9).toFixed(1) + "G per second";
  n.textContent = txt;
}

function startGPU() {
  if (!ensureGL()) return false;
  if (!compile(glIter)) { return false; }
  glStart = performance.now();
  var idle = $("#st-glidle"); if (idle) idle.hidden = true;
  return true;
}
function stopGPU() {
  var idle = $("#st-glidle"); if (idle) idle.hidden = false;
  if (gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
}
function drawGPU() {
  if (!gl || !glProg) return;
  gl.viewport(0, 0, glW, glH);
  gl.uniform1f(uT, (performance.now() - glStart) / 1000);
  gl.uniform2f(uR, glW, glH);
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
  g.strokeStyle = TB.paint("line-soft"); g.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(function (f) {
    g.beginPath(); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke();
  });
  g.fillStyle = TB.paint("ink-3"); g.font = "11px monospace";
  g.fillText(Math.round(maxFps) + " fps", 6, 13);
  if (samples.length < 2) return;
  g.strokeStyle = TB.paint("red"); g.lineWidth = 2; g.beginPath();
  samples.forEach(function (v, i) {
    var x = i / (samples.length - 1) * w;
    var y = h - (v / maxFps) * (h - 8) - 4;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
  g.lineTo(w, h); g.lineTo(0, h); g.closePath();
  g.fillStyle = TB.paint("red-t18"); g.fill();
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
  glInfo(fps);
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
  stopGPU();
  $("#st-run").textContent = "Start stress test";
  $("#st-run").classList.add("pri"); $("#st-run").classList.remove("danger");
  score();
  TB.watch("STRESS stopped", finished ? "run finished" : "stopped by hand");
  if (finished) toast("Stress test finished", "Check the graph — a flat line is a healthy machine.", "ok");
}
$("#st-run").onclick = function () { running ? stop(false) : start(); };
/* the graph holds its last drawing after a run, so it has to be redrawn when
   the palette changes underneath it */
TB.onTheme(function () { if (samples.length) drawGraph(); });
var glSel = $("#st-gpu");
if (glSel) glSel.onchange = function () { applyLevel(this.value); };
applyLevel(glSel ? glSel.value : "normal");
TB.onLeave("stress", function () { stop(false); });
TB.onEnter("stress", function () { drawGraph(); });
verdict($("#st-verdict"), null, [], "Pick a duration and press start. Keep this tab in front — a background tab is throttled by the browser and the numbers mean nothing.");
})();
