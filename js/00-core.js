/* Testbench — core: helpers, navigation, device identity, gamepad polling.
   Everything runs locally in the browser. Nothing is sent anywhere. */
"use strict";
var TB = (function () {

  /* ---------- tiny helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function stamp() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()); }

  /* ---------- toasts ---------- */
  function toast(title, body, kind, action) {
    var box = $("#toasts");
    var t = el("div", "tb-toast" + (kind ? " " + kind : ""));
    t.appendChild(el("b", null, title));
    t.appendChild(el("div", null, body));
    if (action) { var b = el("button", null, action.label); b.onclick = function () { action.fn(); t.remove(); }; t.appendChild(b); }
    box.appendChild(t);
    /* Cap the stack. Measured: 40 button presses left 31 toasts on screen at
       once, covering the panel they were describing until they aged out. A
       notice that hides the thing it is about is worse than no notice, and the
       oldest one is always the least relevant - so the oldest goes. */
    while (box.childElementCount > 4) box.firstElementChild.remove();
    setTimeout(function () { t.style.transition = "opacity .4s"; t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 420); }, action ? 9000 : 5200);
  }

  /* ---------- shared UI pieces ---------- */
  function ptitle(html) { var h = el("h2", "tb-ptitle"); h.innerHTML = html + '<span class="tb-rule"></span>'; return h; }
  function meterRow(label) {
    var row = el("div", "tb-meterrow");
    row.appendChild(el("span", "lbl", label));
    var m = el("span", "tb-meter"), i = el("i"); m.appendChild(i); row.appendChild(m);
    var v = el("span", "val", "0%"); row.appendChild(v);
    return { node: row, fill: i, val: v };
  }
  /* ---------- one place that decides what a result means ----------
     Called by verdict() and by the modules that draw their own result panel,
     so a score means the same thing everywhere and the report cannot disagree
     with the page it came from.

     Two bugs this closes. It used to classify on the RAW score and print the
     ROUNDED one, so 69.9 rendered as "Faulty (70/100)" on a page whose own
     rule is that 70 means check it - which reads as a broken tool to anyone
     holding the printout. And it ignored the flags entirely, so a result
     could score 97 and carry a flag reading "Connection dropped 40 times.
     This router is faulty." while the headline said Passes. A flag marked bad
     now caps the call, because a module that raises one is telling us
     something the number did not. */
  function classify(score, flags) {
    var n = Math.round(Number(score));
    if (!isFinite(n)) n = 0;                  /* NaN, Infinity: treat as a fail */
    n = Math.max(0, Math.min(100, n));
    var worst = "ok";
    (flags || []).forEach(function (f) {
      /* Anything that is not explicitly ok or warn counts as bad. Guessing in
         the lenient direction is how a level nobody recognised - "critical",
         "fail" - would get printed as merely marginal. */
      var lv = f && f.level === "ok" ? "ok" : (f && f.level === "warn") ? "warn" : "bad";
      if (lv === "bad") worst = "bad";
      else if (lv === "warn" && worst === "ok") worst = "warn";
    });
    var byScore = n >= 90 ? "ok" : n >= 70 ? "warn" : "bad";
    var rank = { ok: 0, warn: 1, bad: 2 };
    var kind = rank[worst] > rank[byScore] ? worst : byScore;
    return { n: n, kind: kind, word: kind === "ok" ? "Passes" : kind === "warn" ? "Check it" : "Faulty" };
  }

  function verdict(node, score, flags, idleMsg) {
    flags = flags || [];
    if (score == null) {
      /* idle: rebuild only when the idle message itself changes */
      if (node._vkind === "idle" && node._vidle === (idleMsg || "")) return;
      node.innerHTML = "";
      var v0 = el("div", "tb-verdict idle");
      v0.appendChild(el("div", "score", "\u2014"));
      var t0 = el("div", "txt"); t0.appendChild(el("b", null, "Waiting")); t0.appendChild(el("span", null, idleMsg || "No data yet."));
      v0.appendChild(t0); node.appendChild(v0);
      node._vkind = "idle"; node._vidle = (idleMsg || "");
      return;
    }
    var c = classify(score, flags);
    var kind = c.kind, word = c.word;
    var bad = flags.filter(function (f) { return f.level !== "ok"; }).length;
    var summary = bad ? bad + " thing" + (bad > 1 ? "s" : "") + " to look at" : "Nothing flagged.";

    /* The live pages — the microphone, the sticks — call this several times a
       second, with the numbers inside the flag text moving every time. If the
       verdict is still the same KIND with the same number of flags, nothing
       about its shape has changed, so the existing nodes are updated in place:
       no innerHTML churn, no re-run of the entrance animation. Rebuilding the
       pill at 12 fps is exactly what read on screen as the "pass" light
       blinking. The pill is only torn down and rebuilt when the kind changes
       or a flag appears or disappears — a genuinely new result. */
    var built = node._vnodes;
    var sameShape = built && node._vkind === kind && built.flags.length === flags.length;

    if (sameShape) {
      if (built.score.textContent !== String(c.n)) built.score.textContent = String(c.n);
      if (built.word.textContent !== word) built.word.textContent = word;
      if (built.summary.textContent !== summary) built.summary.textContent = summary;
      flags.forEach(function (f, i) {
        var row = built.flags[i];
        if (row.li.className !== f.level) row.li.className = f.level;
        if (row.tag.textContent !== f.tag) row.tag.textContent = f.tag;
        if (row.text.textContent !== f.text) row.text.textContent = f.text;
      });
      record(node, c.n, kind, word, flags);
      return;
    }

    /* shape changed (or first result): build it fresh */
    var kindChanged = node._vkind !== undefined && node._vkind !== "idle" && node._vkind !== kind;
    var firstLand = node._vkind === undefined || node._vkind === "idle";
    node.innerHTML = "";
    var v = el("div", "tb-verdict " + kind);
    var scoreEl = el("div", "score", String(c.n));
    v.appendChild(scoreEl);
    var t = el("div", "txt");
    var wordEl = el("b", null, word); t.appendChild(wordEl);
    var sumEl = el("span", null, summary); t.appendChild(sumEl);
    v.appendChild(t); node.appendChild(v);
    var ul = el("ul", "tb-flags");
    var flagNodes = flags.map(function (f) {
      var li = el("li", f.level);
      var tag = el("span", "tag", f.tag); li.appendChild(tag);
      var tx = el("span", null, f.text); li.appendChild(tx);
      ul.appendChild(li);
      return { li: li, tag: tag, text: tx };
    });
    node.appendChild(ul);
    node._vnodes = { score: scoreEl, word: wordEl, summary: sumEl, flags: flagNodes };

    /* The landing settle and the single pass-sweep mark a NEW result, so they
       fire when the result first lands or changes kind — never on a refresh of
       a result that is still saying the same thing. */
    if (firstLand || kindChanged) {
      v.classList.add("tb-landed");
      if (kind === "ok") {
        var panel = node.closest ? node.closest(".tb-panel") : null;
        if (panel) {
          panel.classList.remove("tb-swept");
          void panel.offsetWidth;   /* restart the sweep if the same panel passes twice */
          panel.classList.add("tb-swept");
          setTimeout(function () { panel.classList.remove("tb-swept"); }, 900);
        }
      }
    }
    node._vkind = kind; node._vidle = null;

    /* Record it. Every scored verdict in the app comes through this function,
       so this is the one place that can collect a session's results without
       each module having to remember to report in - and a report built from
       something modules opt into is a report that silently omits whatever
       was added last. */
    record(node, c.n, kind, word, flags);
  }

  /* ---------- session results ----------
     Keyed by the view and the panel, so re-running a test replaces its result
     rather than appending a second one. A QC report that lists a unit as both
     failed and passed because it was tested twice is worse than no report. */
  var results = Object.create(null), resultOrder = [];
  function panelTitle(node) {
    var panel = node.closest ? node.closest(".tb-panel") : null;
    var h = panel && panel.querySelector(".tb-ptitle");
    if (h) return h.textContent.replace(/\s+/g, " ").trim();
    var sec = node.closest ? node.closest(".tb-view") : null;
    var h1 = sec && sec.querySelector("h1");
    return h1 ? h1.textContent.trim() : "Result";
  }
  function record(node, score, kind, word, flags) {
    /* Take the view from the node's OWN section, not from whichever page the
       operator happens to be looking at now. A module that finishes a
       measurement a moment after you navigate away used to file its result
       under the new page - which produced a report listing Routers as a
       result AND under "not tested" in the same document. */
    var sec = node.closest ? node.closest(".tb-view") : null;
    var view = (sec && sec.id && sec.id.indexOf("view-") === 0) ? sec.id.slice(5) : currentView;
    var key = view + "::" + (node.id || panelTitle(node));
    if (!results[key]) resultOrder.push(key);
    results[key] = {
      view: view,
      panel: panelTitle(node),
      score: Math.round(score),
      kind: kind,                 /* ok | warn | bad */
      word: word,                 /* Passes | Check it | Faulty */
      at: Date.now(),
      flags: (flags || []).map(function (f) { return { level: f.level, tag: f.tag, text: f.text }; })
    };
  }
  /* For a module that renders its own result panel instead of calling
     verdict(). The speed test and the serial check both do - their results do
     not fit the standard score-plus-flags block - and because they were not
     going through verdict(), neither reached the report. Measured: a 3.1 Mbps
     result with a red "below what one HD video call wants" row on screen, and
     a report that printed "OVERALL: PASSES / Routers - Passes (100/100)".
     Worse than a missing row, because the soak check HAD registered, so
     Routers was claimed as a pass rather than listed as untested.

     Same classification path as verdict(), so the two cannot drift. */
  function report(view, panel, score, flags) {
    var c = classify(score, flags);
    var key = view + "::" + panel;
    if (!results[key]) resultOrder.push(key);
    results[key] = {
      view: view, panel: panel, score: c.n, kind: c.kind, word: c.word,
      at: Date.now(),
      flags: (flags || []).map(function (f) { return { level: f.level, tag: f.tag, text: f.text }; })
    };
  }

  function sessionResults() {
    return resultOrder.map(function (k) { return results[k]; }).filter(Boolean);
  }
  function clearResults() { results = Object.create(null); resultOrder = []; }

  /* ---------- two-press confirmation, in one place ----------
     There were four copies of this pattern in the app and every one had the
     same hole: a plain double-click armed and fired it in a single gesture.
     Measured at 25 ms between the two clicks, which destroyed the earbuds
     reference curve - a thing the code's own comment says needs a sealed
     known-good pair and a quiet room to rebuild.

     On any tool that would be bad. On this one it is worse: the Mouse page
     exists to detect double-click chatter, so the operator is deliberately
     holding mice that emit exactly this pattern. A press too soon after
     arming is not a decision, so it is refused and the button says why. */
  var ARM_GAP = 400;        /* below this, a second press is the same gesture */
  var ARM_HOLD = 5000;      /* and it forgets if the decision never comes */
  function arm(btn, idleText, armedText, fire) {
    var at = 0, timer = null;
    function disarm() {
      if (timer) { clearTimeout(timer); timer = null; }
      at = 0;
      btn.textContent = idleText;
      btn.classList.remove("on");
    }
    btn.onclick = function () {
      if (!at) {
        at = Date.now();
        timer = setTimeout(disarm, ARM_HOLD);
        btn.textContent = typeof armedText === "function" ? armedText() : armedText;
        btn.classList.add("on");
        return;
      }
      if (Date.now() - at < ARM_GAP) {
        btn.textContent = "Not that fast \u2014 press again";
        return;
      }
      disarm();
      fire();
    };
    return { disarm: disarm };
  }

  function checklist(items) {
    var ul = el("ul", "tb-check");
    var map = {};
    items.forEach(function (it) {
      var li = el("li"); li.appendChild(el("b")); li.appendChild(el("span", null, it.label));
      ul.appendChild(li); map[it.key] = li;
    });
    return { node: ul, set: function (key, done) { if (map[key]) map[key].classList.toggle("done", !!done); } };
  }

  /* ---------- theme ----------

     Dark is the ground state, light is warm paper, and "System" follows the
     operating system by stamping nothing on the root element — which leaves
     the prefers-color-scheme media query in the stylesheet as the only thing
     deciding. An explicit choice stamps data-theme and wins over the OS in
     both directions.

     Adding a theme is one CSS block and one line here: write
     :root[data-theme="amber"]{ …tokens… } and call
     TB.addTheme("amber","Amber"). Nothing else needs to know about it.

     Canvases cannot use var(), so anything drawn with 2D or WebGL asks paint()
     for the resolved value and redraws on a theme change. */
  var THEMES = [
    { id: "system", label: "System" },
    { id: "dark", label: "Dark" },
    { id: "light", label: "Light" }
  ];
  var KEY = "tb-theme", themeFns = [], swatch = Object.create(null), current = "system";

  function paint(name) {
    if (swatch[name] !== undefined) return swatch[name];
    var v = "";
    try { v = getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim(); }
    catch (e) {}
    swatch[name] = v || "#888";
    return swatch[name];
  }
  function repaint() {
    swatch = Object.create(null);
    themeFns.forEach(function (f) { try { f(current); } catch (e) {} });
  }
  function setTheme(id, quiet) {
    if (!THEMES.some(function (t) { return t.id === id; })) id = "system";
    current = id;
    if (id === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    $$("#themepick button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.theme === id));
    });
    repaint();
    if (!quiet) watch("THEME", id);
  }
  function addTheme(id, label) {
    if (THEMES.some(function (t) { return t.id === id; })) return;
    THEMES.push({ id: id, label: label || id });
    buildPicker();
  }
  function buildPicker() {
    var host = $("#themepick"); if (!host) return;
    host.textContent = "";
    THEMES.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.theme = t.id;
      b.textContent = t.label;
      b.title = t.id === "system" ? "Follow the operating system" : t.label + " theme";
      b.setAttribute("aria-pressed", String(t.id === current));
      b.onclick = function () { setTheme(t.id); };
      host.appendChild(b);
    });
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    current = saved || "dark";   /* calm dark is the default look; System/Light still available in the top bar */
    buildPicker();
    setTheme(current, true);
    /* follow the OS while the choice is "System" */
    try {
      var mq = matchMedia("(prefers-color-scheme: light)");
      var onOS = function () { if (current === "system") repaint(); };
      if (mq.addEventListener) mq.addEventListener("change", onOS);
      else if (mq.addListener) mq.addListener(onOS);
    } catch (e) {}
  }

  /* ---------- navigation ---------- */
  var currentView = "home", enterFns = {}, leaveFns = {};
  function go(view) {
    if (view === currentView) return;
    if (leaveFns[currentView]) leaveFns[currentView].forEach(function (f) { try { f(); } catch (e) {} });
    currentView = view;
    $$(".tb-view").forEach(function (s) { s.classList.toggle("on", s.id === "view-" + view); });
    $$("#rail .tb-nav").forEach(function (b) { b.setAttribute("aria-current", String(b.dataset.view === view)); });
    $("#main").scrollTop = 0;
    /* Address bar first, then the view's own setup. A module's onEnter may push
       history entries of its own (the mouse page's back/forward trap does), and
       if the hash were still on the previous view at that moment, stepping back
       through those entries would fire a hashchange and bounce you straight back
       to the page you just left. */
    writeHash(view);
    /* Park the ambient colour field somewhere slightly different for each
       page. It is static while you work - a permanently drifting backdrop
       measured at ten frames a second cheaper to hold still, and this app
       reads a controller on every frame - so the only time it moves is the
       moment the page already is. Derived from the view name so a page
       always looks the same, rather than wandering at random. */
    try {
      var h = 0;
      for (var ci = 0; ci < view.length; ci++) h = (h * 31 + view.charCodeAt(ci)) | 0;
      var ax = ((h % 9) - 4) * 1.4, ay = (((h >> 4) % 9) - 4) * 1.1;
      var as = 1 + (((h >> 8) % 5) - 2) * 0.012;
      var d = document.documentElement.style;
      d.setProperty("--aura-x", ax.toFixed(2) + "vmax");
      d.setProperty("--aura-y", ay.toFixed(2) + "vmax");
      d.setProperty("--aura-s", as.toFixed(3));
    } catch (e) {}
    if (enterFns[view]) enterFns[view].forEach(function (f) { try { f(); } catch (e) {} });
  }
  function onEnter(v, f) { (enterFns[v] = enterFns[v] || []).push(f); }

  /* Put the current test in the address bar so a refresh lands you back where
     you were instead of at the Bench, and so a page can be bookmarked.
     replaceState rather than pushState: it keeps history.state intact, which the
     mouse page relies on for its back/forward button trap, and it stops the
     browser's back button turning into a tour of every tab you clicked. */
  var viewIds = null;
  function knownView(v) {
    if (!viewIds) viewIds = $$(".tb-view").map(function (s) { return s.id.replace(/^view-/, ""); });
    return viewIds.indexOf(v) !== -1;
  }
  function hashView() { return (location.hash || "").replace(/^#\/?/, ""); }
  function writeHash(v) { try { history.replaceState(history.state, "", "#" + v); } catch (e) {} }
  window.addEventListener("hashchange", function () {
    var v = hashView();
    if (v && knownView(v) && v !== currentView) go(v);
  });
  /* on load, after every module has registered its onEnter handlers */
  window.addEventListener("load", function () {
    var v = hashView();
    if (v && knownView(v) && v !== currentView) go(v);
    else writeHash(currentView);
  });
  function onLeave(v, f) { (leaveFns[v] = leaveFns[v] || []).push(f); }
  function view() { return currentView; }
  function badge(v, txt, on) { var b = $("#badge-" + v); if (!b) return; b.textContent = txt || ""; b.classList.toggle("on", !!on); }
  function chip(id, live, val) {
    var c = $("#chip-" + id); if (!c) return;
    /* Pop only on the transition INTO live, not on every value update. The pad
       chip's value changes sixty times a second while a stick is moving, and
       a chip that pulsed on each of those would be unreadable. */
    var wasLive = c.classList.contains("live");
    c.classList.toggle("live", live === true);
    c.classList.toggle("warn", live === "warn");
    c.querySelector("b").textContent = val;
    if (live === true && !wasLive) {
      c.classList.remove("popped");
      void c.offsetWidth;
      c.classList.add("popped");
      setTimeout(function () { c.classList.remove("popped"); }, 450);
    }
  }

  /* ---------- device identity over USB (WebHID) ---------- */
  var VENDORS = {
    0x046d: "Logitech", 0x1532: "Razer", 0x1b1c: "Corsair", 0x1038: "SteelSeries", 0x0951: "HyperX / Kingston",
    0x03f0: "HP", 0x413c: "Dell", 0x045e: "Microsoft", 0x054c: "Sony", 0x057e: "Nintendo", 0x2dc8: "8BitDo",
    0x0b05: "ASUS", 0x1e7d: "ROCCAT", 0x04d9: "Holtek", 0x258a: "Sino Wealth", 0x3434: "Keychron", 0x05ac: "Apple",
    0x320f: "Evision", 0x0c45: "Microdia", 0x1c4f: "SiGma Micro", 0x17ef: "Lenovo", 0x04f2: "Chicony",
    0x28de: "Valve", 0x044f: "Thrustmaster", 0x0eb7: "Fanatec", 0x24c6: "PowerA", 0x0e6f: "PDP", 0x146b: "Nacon",
    0x20d6: "PowerA", 0x2563: "ShanWan", 0x0d8c: "C-Media", 0x1235: "Focusrite", 0x2ea8: "Glorious",
    0x0079: "DragonRise", 0x1997: "Redragon", 0x3554: "Compx / Pulsar", 0x361d: "Lamzu", 0x36e2: "VXE",
    0x373b: "Attack Shark", 0x3151: "Keydous", 0x342d: "Ajazz", 0x1ea7: "Sharkoon", 0x2516: "Cooler Master",
    0x09da: "A4Tech", 0x0458: "KYE / Genius", 0x062a: "MosArt", 0x248a: "Maxxter", 0x30fa: "Trust"
  };
  function hex4(n) { var s = n.toString(16); while (s.length < 4) s = "0" + s; return "0x" + s; }
  var hidTargets = [], hidGranted = [];
  function hidMount(sel, hint) { hidTargets.push({ sel: sel, hint: hint }); hidDraw(); }
  function hidDraw() {
    hidTargets.forEach(function (t) {
      var box = document.querySelector(t.sel); if (!box) return;
      box.innerHTML = "";
      var btn = el("button", "tb-btn", "Read device name");
      btn.onclick = hidRequest; box.appendChild(btn);
      if (!navigator.hid) { box.appendChild(el("span", null, "Device names need Chrome, Edge or Opera. Every test still works without them.")); return; }
      if (!hidGranted.length) { box.appendChild(el("span", null, t.hint)); return; }
      hidGranted.forEach(function (d) {
        var s = el("span", "name");
        s.appendChild(el("b", null, d.productName || "Unnamed device"));
        var vn = VENDORS[d.vendorId];
        s.appendChild(document.createTextNode((vn ? " \u00b7 " + vn : "") + " \u00b7 " + hex4(d.vendorId) + ":" + hex4(d.productId)));
        box.appendChild(s);
      });
      var clr = el("button", "tb-btn", "Clear"); clr.onclick = function () { hidGranted = []; hidDraw(); };
      box.appendChild(clr);
    });
  }
  function hidRefresh() {
    if (!navigator.hid) { hidDraw(); return; }
    navigator.hid.getDevices().then(function (d) { hidGranted = d || []; hidDraw(); }).catch(hidDraw);
  }
  function hidRequest() {
    if (!navigator.hid) { toast("Not supported", "Device names need Chrome, Edge or Opera.", "bad"); return; }
    navigator.hid.requestDevice({ filters: [] }).then(function (d) {
      if (d && d.length) toast("Device read", (d[0].productName || "Device") + " identified.", "ok");
      else toast("Nothing picked", "Plain keyboards and mice are hidden by the browser for security. Gaming and programmable models normally appear in that list.", null);
      hidRefresh();
    }).catch(function () {});
  }
  if (navigator.hid) {
    navigator.hid.addEventListener("connect", function (e) { watch("HID connected", e.device.productName || "unnamed device"); hidRefresh(); });
    navigator.hid.addEventListener("disconnect", function (e) { watch("HID DISCONNECTED", e.device.productName || "unnamed device"); hidRefresh(); });
  }
  hidRefresh();

  /* ---------- connection watchdog ---------- */
  var watchLog = [];
  function watch(tag, text) {
    watchLog.unshift({ t: stamp(), tag: tag, text: text });
    if (watchLog.length > 200) watchLog.pop();
    var box = $("#sy-watch"); if (!box) return;
    var d = el("div");
    d.appendChild(el("b", null, watchLog[0].t + "  " + tag));
    d.appendChild(document.createTextNode("  " + text));
    box.insertBefore(d, box.firstChild);
    while (box.childElementCount > 200) box.lastChild.remove();
  }

  /* ---------- gamepad core ---------- */
  /* Object.create(null) rather than {}: PADS is keyed by gp.index, and with a
     plain object a pad reporting index "__proto__" would write through to
     Object.prototype and corrupt every object on the page. The index comes from
     the browser so this is defence in depth, not a live bug - but a
     null-prototype map costs nothing and Object.keys still works on it. */
  var PADS = Object.create(null), padListeners = [];
  function onPads(fn) { padListeners.push(fn); }
  function pads() { return PADS; }

  function brandOf(id) {
    var s = (id || "").toLowerCase();
    if (/8bitdo|2dc8/.test(s)) return { b: "8BitDo", fam: "nintendo" };
    if (/scuf/.test(s)) return { b: "Scuf", fam: "xbox" };
    if (/dualsense|dualshock|playstation|ps5|ps4|ps3|054c|0ce6|09cc|05c4/.test(s)) return { b: "PlayStation", fam: "ps" };
    if (/xbox|045e|xinput|02ea|0b12|0b13|02e0/.test(s)) return { b: "Xbox", fam: "xbox" };
    if (/nintendo|switch|joy-?con|pro controller|057e/.test(s)) return { b: "Nintendo", fam: "nintendo" };
    if (/razer|1532/.test(s)) return { b: "Razer", fam: "xbox" };
    if (/powera|24c6|20d6/.test(s)) return { b: "PowerA", fam: "xbox" };
    if (/nacon|146b/.test(s)) return { b: "Nacon", fam: "ps" };
    if (/logitech|046d/.test(s)) return { b: "Logitech", fam: "generic" };
    if (/thrustmaster|044f/.test(s)) return { b: "Thrustmaster", fam: "generic" };
    if (/fanatec|0eb7/.test(s)) return { b: "Fanatec", fam: "generic" };
    return { b: "Generic", fam: "generic" };
  }
  var LBL = {
    ps: ["Cross", "Circle", "Square", "Triangle", "L1", "R1", "L2", "R2", "Create", "Options", "L3", "R3", "D-Up", "D-Down", "D-Left", "D-Right", "PS", "Touchpad"],
    xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "D-Up", "D-Down", "D-Left", "D-Right", "Guide", "Share"],
    nintendo: ["B", "A", "Y", "X", "L", "R", "ZL", "ZR", "Minus", "Plus", "L3", "R3", "D-Up", "D-Down", "D-Left", "D-Right", "Home", "Capture"],
    generic: ["B0", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B14", "B15", "B16", "B17"]
  };
  var GLYPH = { ps: ["✕", "○", "□", "△"], xbox: ["A", "B", "X", "Y"], nintendo: ["B", "A", "Y", "X"], generic: ["0", "1", "2", "3"] };
  function labelFor(fam, i) { var a = LBL[fam] || LBL.generic; return a[i] || ("B" + i); }
  function glyphFor(fam, i) { return (GLYPH[fam] || GLYPH.generic)[i] || String(i); }

  var WHEEL_RE = /wheel|g25|g27|g29|g920|g923|driving force|momo|t150|t248|t300|t500|t818|tmx|tx racing|thrustmaster|fanatec|clubsport|csl|podium|simucube|moza|simagic|cammus|pro racing/i;
  function looksLikeWheel(gp) {
    /* Only the name decides. The old rule was "non-standard mapping with a few
       axes and buttons", which swallowed leverless pads, fight sticks, arcade
       sticks and flight sticks and filed them all under Wheels. Anything the
       name does not catch can still be picked by hand on the Wheels page. */
    return WHEEL_RE.test(gp.id || "");
  }
  function shortName(rec) {
    var id = (rec.id || "").replace(/\((?:STANDARD )?GAMEPAD[^)]*\)/i, "").replace(/\((?:Vendor|Product):[^)]*\)/ig, "").trim();
    id = id.replace(/\s{2,}/g, " ").replace(/[-–—]\s*$/, "").trim();
    return id || rec.brand.b;
  }
  function padRecord(gp) {
    return {
      index: gp.index, id: gp.id, mapping: gp.mapping,
      brand: brandOf(gp.id), wheel: looksLikeWheel(gp),
      axes: [], buttons: [], pressed: [],
      seenBtn: {}, axMin: [], axMax: [],
      btnMin: [], btnMax: [],
      rest: null, sampling: null, score: null, flags: [],
      returnErr: 0, resolution: {}, seenAxis: {}, active: false,
      standard: gp.mapping === "standard"
    };
  }
  /* Resting measurement.

     A browser hides a gamepad until you press something, so the pad appears at
     the exact instant a button is down — and the old sampler started counting
     right then, took the highest value each button reached, and duly reported
     "Held down with no one touching it: A" and docked twenty points. The test
     was failing pads for the press that made them visible.

     So there are two phases now. settle: wait until nothing is pressed and no
     axis is being moved, for a continuous stretch. measure: take the reading,
     and throw it away and go back to settling if anything is touched. If the
     pad never goes quiet — a genuinely stuck button, which is worth knowing —
     it gives up after eight seconds and says so in the verdict. */
  var SETTLE_MS = 450, MEASURE_MS = 850, PATIENCE_MS = 8000;
  var BTN_QUIET = 0.08;   /* above this a button counts as held */
  var AXIS_MOVE = 0.08;   /* per-poll change above this means a hand is on it */

  function beginRestSample(rec) {
    rec.sampling = { phase: "settle", t0: performance.now(), quietSince: 0,
                     samples: [], btn: [], prev: null, gaveUp: false };
    rec.score = null; rec.flags = []; rec.restGaveUp = false;
  }
  function padIsQuiet(rec, s) {
    for (var i = 0; i < rec.buttons.length; i++) if (rec.buttons[i] > BTN_QUIET) return false;
    if (s.prev) {
      for (var a = 0; a < rec.axes.length && a < s.prev.length; a++) {
        if (Math.abs(rec.axes[a] - s.prev[a]) > AXIS_MOVE) return false;
      }
    }
    return true;
  }
  function stepRestSample(rec) {
    var s = rec.sampling, now = performance.now();
    var quiet = padIsQuiet(rec, s);
    s.prev = rec.axes.slice();

    if (s.phase === "settle") {
      if (!quiet) s.quietSince = 0;
      else if (!s.quietSince) s.quietSince = now;
      if (s.quietSince && now - s.quietSince >= SETTLE_MS) { s.phase = "measure"; s.t0 = now; }
      else if (now - s.t0 > PATIENCE_MS) { s.phase = "measure"; s.t0 = now; s.gaveUp = true; }
      return;
    }
    /* something was touched mid-reading — discard it and wait again */
    if (!quiet && !s.gaveUp) {
      s.phase = "settle"; s.quietSince = 0; s.samples = []; s.btn = []; s.t0 = now;
      return;
    }
    s.samples.push(rec.axes.slice());
    if (!s.btn.length) s.btn = rec.buttons.slice();
    else rec.buttons.forEach(function (v, bi) { if (v > s.btn[bi]) s.btn[bi] = v; });
    if (now - s.t0 > MEASURE_MS) { rec.restGaveUp = s.gaveUp; finishRestSample(rec); }
  }
  function finishRestSample(rec) {
    var s = rec.sampling; rec.sampling = null;
    if (!s || !s.samples.length) return;
    var n = s.samples[0].length, mins = [], maxs = [], sums = [];
    for (var a = 0; a < n; a++) { mins[a] = 99; maxs[a] = -99; sums[a] = 0; }
    s.samples.forEach(function (row) {
      for (var a = 0; a < n; a++) { var v = row[a]; if (v < mins[a]) mins[a] = v; if (v > maxs[a]) maxs[a] = v; sums[a] += v; }
    });
    rec.rest = { means: sums.map(function (x) { return x / s.samples.length; }), noise: maxs.map(function (m, i) { return m - mins[i]; }), btn: s.btn.slice() };
    scorePad(rec);
  }
  function scorePad(rec) {
    var r = rec.rest; if (!r) { rec.score = null; return; }
    var flags = [], score = 100, fam = rec.brand.fam;
    [[0, 1, "Left stick"], [2, 3, "Right stick"]].forEach(function (p) {
      if (r.means.length <= p[1]) return;
      var dx = r.means[p[0]], dy = r.means[p[1]], mag = Math.sqrt(dx * dx + dy * dy);
      var nz = Math.max(r.noise[p[0]], r.noise[p[1]]);
      if (mag > 0.22) { score -= 32; flags.push({ level: "bad", tag: "drift", text: p[2] + " is pushed " + (mag * 100).toFixed(0) + "% off centre with nothing touching it. That is hard drift — it will walk in game." }); }
      else if (mag > 0.09) { score -= 14; flags.push({ level: "warn", tag: "drift", text: p[2] + " rests " + (mag * 100).toFixed(0) + "% off centre. Small drift, usually still playable but worth noting." }); }
      else if (mag > 0.035) { score -= 4; flags.push({ level: "warn", tag: "drift", text: p[2] + " is " + (mag * 100).toFixed(1) + "% off centre — within normal wear." }); }
      else flags.push({ level: "ok", tag: "drift", text: p[2] + " sits dead centre (" + (mag * 100).toFixed(1) + "%)." });
      if (nz > 0.06) { score -= 10; flags.push({ level: "warn", tag: "noise", text: p[2] + " jitters ±" + (nz * 50).toFixed(1) + "% at rest. Noisy potentiometer." }); }
    });
    if (fam !== "generic" || rec.mapping === "standard") {
      [[6, "Left trigger"], [7, "Right trigger"]].forEach(function (t) {
        var v = r.btn[t[0]]; if (v == null) return;
        if (v > 0.25) { score -= 18; flags.push({ level: "bad", tag: "trigger", text: t[1] + " is reading " + (v * 100).toFixed(0) + "% with nothing pressing it." }); }
        else if (v > 0.06) { score -= 6; flags.push({ level: "warn", tag: "trigger", text: t[1] + " rests at " + (v * 100).toFixed(0) + "% instead of zero." }); }
      });
    }
    var stuck = [];
    r.btn.forEach(function (v, i) { if (i !== 6 && i !== 7 && v > 0.5) stuck.push(labelFor(fam, i)); });
    if (stuck.length) {
      score -= 20;
      flags.push({ level: "bad", tag: "stuck",
        text: rec.restGaveUp
          ? "Held down for eight seconds straight without being touched: " + stuck.join(", ") + ". Either it is stuck, or something was resting on the pad."
          : "Held down with no one touching it: " + stuck.join(", ") + "." });
    }
    if (!flags.some(function (f) { return f.level !== "ok"; })) flags.push({ level: "ok", tag: "rest", text: "Triggers at zero, no buttons stuck, sticks quiet." });
    flags.push({ level: "ok", tag: "reported", text: rec.buttons.length + " buttons and " + rec.axes.length + " axes, mapping “" + rec.mapping + "”." });
    rec.score = clamp(score, 0, 100); rec.flags = flags;
  }
  function announce(rec) {
    watch(rec.wheel ? "WHEEL connected" : "PAD connected", shortName(rec) + " (slot " + rec.index + ")");
    setTimeout(function () {
      var s = rec.score;
      toast((rec.wheel ? "Wheel" : "Controller") + " connected",
        shortName(rec) + (s != null ? " — scored " + Math.round(s) + "/100 at rest" : ""),
        s == null ? null : (s >= 90 ? "ok" : (s >= 70 ? null : "bad")),
        { label: "Open " + (rec.wheel ? "wheel" : "controller") + " test", fn: function () { go(rec.wheel ? "wheel" : "gamepad"); } });
    }, 950);
  }

  function poll() {
    var list = navigator.getGamepads ? navigator.getGamepads() : [], live = {};
    for (var i = 0; i < list.length; i++) {
      var gp = list[i]; if (!gp) continue;
      live[gp.index] = true;
      var rec = PADS[gp.index];
      if (!rec) { rec = PADS[gp.index] = padRecord(gp); beginRestSample(rec); announce(rec); }
      rec.axes = Array.prototype.slice.call(gp.axes);
      rec.buttons = Array.prototype.map.call(gp.buttons, function (b) { return b.value; });
      rec.pressed = Array.prototype.map.call(gp.buttons, function (b) { return b.pressed; });
      rec.raw = gp;
      for (var a = 0; a < rec.axes.length; a++) {
        var v = rec.axes[a];
        if (rec.axMin[a] == null || v < rec.axMin[a]) rec.axMin[a] = v;
        if (rec.axMax[a] == null || v > rec.axMax[a]) rec.axMax[a] = v;
        (rec.resolution[a] = rec.resolution[a] || {})[v.toFixed(3)] = 1;
      }
      for (var b2 = 0; b2 < rec.buttons.length; b2++) {
        var bv = rec.buttons[b2];
        if (rec.btnMin[b2] == null || bv < rec.btnMin[b2]) rec.btnMin[b2] = bv;
        if (rec.btnMax[b2] == null || bv > rec.btnMax[b2]) rec.btnMax[b2] = bv;
        if (rec.pressed[b2]) { rec.seenBtn[b2] = true; rec.active = true; }
      }
      /* Wireless pads often appear twice — once as the dongle, once as the pad
         itself — and only one of them ever sends anything. Remember which. */
      for (var a2 = 0; a2 < rec.axes.length; a2++) {
        if ((rec.axMax[a2] - rec.axMin[a2]) > 0.25) { rec.seenAxis[a2] = true; rec.active = true; }
      }
      if (rec.sampling) stepRestSample(rec);
    }
    Object.keys(PADS).forEach(function (k) {
      if (!live[k]) { watch(PADS[k].wheel ? "WHEEL DISCONNECTED" : "PAD DISCONNECTED", shortName(PADS[k])); delete PADS[k]; }
    });
    var n = Object.keys(PADS).length;
    var wheels = Object.keys(PADS).filter(function (k) { return PADS[k].wheel; });
    chip("pad", n > 0, String(n));
    chip("wheel", wheels.length > 0, wheels.length ? PADS[wheels[0]].brand.b : "—");
    badge("gamepad", n ? String(n) : "", n > 0);
    badge("wheel", wheels.length ? String(wheels.length) : "", wheels.length > 0);
    padListeners.forEach(function (f) { try { f(); } catch (e) {} });
  }

  /* poll() only reads — scheduling lives in loop(). Keeping them apart means
     calling poll() from an event handler cannot start a second animation loop
     running alongside the first.

     The rAF is scheduled BEFORE poll() runs, and poll() is wrapped. Written the
     other way round, a single throw inside poll - one unexpected pad shape, one
     listener that blew up - ended the animation loop permanently, and polling
     silently fell back to the 400 ms safety interval: 2.5 Hz instead of 60,
     which reads as "this controller feels laggy" and is very hard to trace. */
  var pollFails = 0;
  function loop() {
    requestAnimationFrame(loop);
    try { poll(); } catch (e) {
      if (++pollFails === 1) watch("POLL ERROR", (e && e.message) || "a controller read threw; polling continues");
    }
  }
  requestAnimationFrame(loop);

  /* The loop above runs on requestAnimationFrame, which the browser slows right
     down whenever this tab is not the one in front. These catch a controller the
     moment the browser admits it exists, and keep the status chip honest while
     the loop is throttled. */
  window.addEventListener("gamepadconnected", function (e) {
    watch("PAD", "browser reported " + (e.gamepad && e.gamepad.id ? e.gamepad.id : "a controller"));
    poll();
  });
  window.addEventListener("gamepaddisconnected", function () { poll(); });
  setInterval(function () { if (!document.hidden) poll(); }, 400);

  /* ---------- rail, clock, theme ---------- */
  $$("#rail .tb-nav").forEach(function (b) { b.onclick = function () { go(b.dataset.view); }; });
  /* Any other control carrying data-view (the Bench "open the report" button,
     the top-bar Report button) navigates too, so the report is reachable from
     wherever you are without duplicating the rail. */
  $$("[data-view]").forEach(function (b) {
    if (b.closest("#rail")) return;
    b.addEventListener("click", function () { go(b.dataset.view); });
  });
  initTheme();
  (function () { var c = $("#clock"); function tick() { c.textContent = stamp(); } tick(); setInterval(tick, 1000); })();

  /* ---------- environment ---------- */
  function isCoarse() { return window.matchMedia && matchMedia("(pointer: coarse)").matches; }
  function isNarrow() { return window.innerWidth < 820; }
  function isMobile() { return isCoarse() && isNarrow(); }

  function callout(text) {
    var d = el("div", "tb-callout");
    var i = svgEl("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8" });
    i.appendChild(svgEl("path", { d: "M12 9v5M12 17.5h.01M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z", "stroke-linecap": "round", "stroke-linejoin": "round" }));
    d.appendChild(i);
    d.appendChild(el("span", null, text));
    return d;
  }

  /* ---------- tab strips ---------- */
  function tabs(stripSel, paneAttr, onChange) {
    var strip = $(stripSel); if (!strip) return;
    var btns = $$("button", strip);
    function show(name, fromClick) {
      /* ---- switching a tab must not move the page ----------------------
         Panes are shown and hidden, so the document height changes the
         instant one is swapped. Two things went wrong because of that.

         If the new pane is shorter than the scroll position, the browser
         clamps the scroll and the page appears to lurch upward. And if you
         had scrolled down inside a long pane, the tab strip you just clicked
         was often left somewhere off-screen, so the click seemed to do
         nothing until you scrolled back up to look.

         Both are fixed by deciding where the view should be rather than
         letting the clamp decide: if the strip is already on screen, hold the
         scroll exactly where it was; if it is not, bring it just under the
         sticky header. Only on a real click - a programmatic show() during
         page setup must not scroll anything. */
      var main = $("#main");
      var keep = null;
      if (fromClick && main) {
        var sr = strip.getBoundingClientRect();
        var mr = main.getBoundingClientRect();
        keep = (sr.top >= mr.top && sr.bottom <= mr.bottom) ? main.scrollTop : null;
      }

      btns.forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.t === name)); });
      $$("[" + paneAttr + "]").forEach(function (p) { p.hidden = p.getAttribute(paneAttr) !== name; });
      if (onChange) onChange(name);

      if (fromClick && main) {
        if (keep != null) {
          /* The strip was visible, so the operator's eye is already in the
             right place. Put the scroll back where the clamp may have moved
             it from.

             Restoring can fail, and that is the original bug rather than an
             edge case: a shorter pane makes the document shorter, so the
             maximum scroll drops and the position simply does not exist any
             more. When that happens, holding the scroll number is impossible
             but holding the STRIP steady is not - so pin the strip to the top
             instead. What the operator cares about is that the control they
             just clicked did not move, not what scrollTop happens to be. */
          main.scrollTop = keep;
          if (Math.abs(main.scrollTop - keep) > 1) {
            var t2 = strip.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
            main.scrollTop = Math.max(0, t2 - 12);
          }
        } else {
          var top = strip.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
          main.scrollTop = Math.max(0, top - 12);
        }
      }
    }
    btns.forEach(function (b) { b.onclick = function () { show(b.dataset.t, true); }; });
    return show;
  }

  /* ---------- step strips ---------- */
  function steps(sel) {
    var box = $(sel);
    return function (n) {
      if (!box) return;
      $$("li", box).forEach(function (li, i) {
        li.classList.toggle("on", i + 1 === n);
        li.classList.toggle("done", i + 1 < n);
      });
    };
  }

  /* ---------- device activity (what browsers will not name for us) ---------- */
  var activity = { keyboard: false, mouse: false, touch: false };
  window.addEventListener("keydown", function () { activity.keyboard = true; }, { capture: true, passive: true });
  window.addEventListener("mousemove", function () { activity.mouse = true; }, { capture: true, passive: true, once: true });
  window.addEventListener("mousedown", function () { activity.mouse = true; }, { capture: true, passive: true });
  window.addEventListener("touchstart", function () { activity.touch = true; }, { capture: true, passive: true });

  return {
    $: $, $$: $$, el: el, svgEl: svgEl, clamp: clamp, esc: esc, stamp: stamp,
    isMobile: isMobile, isCoarse: isCoarse, isNarrow: isNarrow,
    callout: callout, tabs: tabs, steps: steps, activity: activity,
    toast: toast, verdict: verdict, ptitle: ptitle, meterRow: meterRow, checklist: checklist, arm: arm,
    go: go, onEnter: onEnter, onLeave: onLeave, view: view, badge: badge, chip: chip,
    hidMount: hidMount, watch: watch,
    results: sessionResults, clearResults: clearResults, report: report, classify: classify,
    watchLog: function () { return watchLog.slice(); },
    pads: pads, onPads: onPads, shortName: shortName, labelFor: labelFor, glyphFor: glyphFor,
    beginRestSample: beginRestSample,
    paint: paint, onTheme: function (f) { themeFns.push(f); }, setTheme: setTheme,
    theme: function () { return current; }, addTheme: addTheme,
    restPhase: function (rec) { return rec && rec.sampling ? rec.sampling.phase : null; }
  };
})();
