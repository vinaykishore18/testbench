/* Testbench — command palette.

   Ctrl+K (Cmd+K on a Mac) opens a search box over the page; type two or three
   letters and press Enter to jump to a test.

   Why it is worth having on a bench rather than being a gimmick: the rail
   holds sixteen items and you are usually holding the device with one hand.
   Reaching for a mouse, finding the right row and clicking it is slower than
   "ctrl k, w h, enter" - and the alternative, sixteen single-letter
   shortcuts, would collide with the per-page keys that already exist (F and Q
   on the monitor page, S on the router page) and would fire while somebody is
   typing a serial number.

   It is also the only way to reach a page while capture mode is holding the
   keyboard, which is exactly when you cannot get to the rail.

   Everything is built with createElement and textContent. The palette shows
   text that comes from the page itself, and building it by assembling an HTML
   string is how a search box becomes an injection point. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el;

/* Built from the rail, so a page added to the nav appears here with no second
   list to keep in step. The keywords are the things somebody would actually
   type when they are not thinking about what the page is called. */
var EXTRA = {
  home: "bench overview dashboard detected devices scoreboard",
  report: "report unit sku grade condition premium excellent good fair as-is print pdf csv json export qc record listing dispute",
  keyboard: "keys keycaps chatter ghosting rollover typing wpm capture lock",
  mouse: "clicks dpi cpi scroll wheel polling jitter double click drag side buttons",
  gamepad: "controller pad xbox playstation dualsense switch pro drift stick deadzone triggers rumble",
  joycon: "nintendo switch joy con hid calibration battery drift",
  wheel: "racing steering logitech thrustmaster pedals shifter force feedback g923 g29",
  audio: "microphone mic headset headphones speakers sweep bass loopback music mp3 distortion",
  airpods: "earbuds apple airpods serial counterfeit fake fingerprint reference curve",
  midi: "keyboard piano synth notes velocity sustain pitch bend stuck note",
  monitor: "screen display dead pixel stuck pixel backlight bleed banding uniformity refresh hz",
  camera: "webcam video resolution fps frame rate snapshot",
  touch: "touchscreen multitouch digitiser pen stylus points",
  network: "router wifi speed test latency ping jitter bufferbloat dropouts soak mbps nat",
  stress: "cpu gpu load thermal throttle burn in soak fps",
  system: "machine hardware cpu ram gpu battery storage privacy delete data"
};

var items = $$("#rail .tb-nav").map(function (b) {
  /* Read the button's own text WITHOUT its badge. Each rail button carries a
     live .tb-badge - a controller count, a battery percentage - and taking
     textContent whole produced labels like "System100%" in the palette. */
  var label = Array.prototype.filter.call(b.childNodes, function (n) {
    return n.nodeType === 3 || (n.nodeType === 1 && !n.classList.contains("tb-badge"));
  }).map(function (n) { return n.textContent || ""; }).join("").replace(/\s+/g, " ").trim();
  var view = b.dataset.view;
  /* the rail groups its items under headings; carry the heading through as a
     keyword so "audio" finds the headset page even though the button says
     "Mic & Headsets" */
  var head = "";
  for (var n = b.previousElementSibling; n; n = n.previousElementSibling) {
    if (n.classList.contains("tb-railhead")) { head = n.textContent.trim(); break; }
  }
  return {
    view: view, label: label, group: head,
    hay: (view + " " + label + " " + head + " " + (EXTRA[view] || "")).toLowerCase()
  };
});

/* ---------- scoring ----------
   Matching at the START OF A WORD comes first, and this is not a refinement.
   A plain substring search had "ping" offering the Keyboard page, because the
   keyboard keywords contain "typing" - and a search box whose first answer is
   visibly wrong is one people stop using after two tries. A substring landing
   inside a longer word is almost never what somebody meant, so it still
   scores, but far below every word-boundary hit.

   Above that, matching the page's own name or its id beats matching something
   buried in the keyword list, so "mo" offers Monitors and Mouse before any
   page that merely mentions a monitor. */
function escapeRe(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function score(it, q) {
  var hay = it.hay;
  var s = -1;

  var m = new RegExp("(^|[^a-z0-9])" + escapeRe(q)).exec(hay);
  if (m) {
    var at = m.index + m[1].length;
    s = 200 - Math.min(at, 120);            /* earlier in the haystack wins */
  } else if (hay.indexOf(q) >= 0) {
    s = 30 - Math.min(hay.indexOf(q), 25);  /* mid-word: last resort */
  } else {
    /* initials, so "mh" finds "Mic & Headsets" */
    /* Initials from the WORDS, skipping punctuation, so "Mic & Headsets"
       gives "mh" and not "m&h" - which is what the comment promised and the
       first version did not deliver. */
    var initials = it.label.split(/[^A-Za-z0-9]+/).filter(Boolean)
      .map(function (w) { return w[0]; }).join("").toLowerCase();
    if (initials.indexOf(q) === 0) return 60;
    return -1;
  }

  if (it.view.indexOf(q) === 0) s += 120;
  if (it.label.toLowerCase().indexOf(q) === 0) s += 90;
  return s;
}

/* The ranked list, exposed so the palette and its test rank identically. A
   test that reimplements the ranking is testing the test. */
function search(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return items.slice();
  return items.map(function (it) { return { it: it, s: score(it, q) }; })
    .filter(function (x) { return x.s >= 0; })
    .sort(function (a, b) { return b.s - a.s; })
    .map(function (x) { return x.it; });
}

var wrap = null, input = null, list = null, sel = 0, shown = [];

function close() {
  if (!wrap) return;
  wrap.remove(); wrap = null; input = null; list = null;
  /* Hand focus back where it was, so closing the palette does not dump the
     caret at the top of the document. */
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
}
var lastFocus = null;

function render() {
  var q = (input.value || "").trim().toLowerCase();
  shown = search(q).slice(0, 9);
  if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
  list.textContent = "";
  if (!shown.length) {
    list.appendChild(el("div", "tb-pal-none", "Nothing matches “" + q + "”"));
    return;
  }
  shown.forEach(function (it, i) {
    var row = el("div", "tb-pal-row" + (i === sel ? " on" : ""));
    row.appendChild(el("b", null, it.label));
    if (it.group) row.appendChild(el("span", null, it.group));
    row.addEventListener("mousedown", function (e) { e.preventDefault(); go(it); });
    row.addEventListener("mousemove", function () { if (sel !== i) { sel = i; render(); } });
    list.appendChild(row);
  });
}

function go(it) {
  close();
  TB.go(it.view);
}

function open() {
  if (wrap) { close(); return; }
  lastFocus = document.activeElement;
  wrap = el("div", "tb-pal");
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", "Jump to a test");
  var card = el("div", "tb-pal-card");
  input = el("input");
  input.type = "text";
  input.setAttribute("placeholder", "Jump to a test…");
  input.setAttribute("aria-label", "Jump to a test");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  card.appendChild(input);
  list = el("div", "tb-pal-list");
  card.appendChild(list);
  var hint = el("div", "tb-pal-hint");
  hint.appendChild(el("span", null, "↑↓ to move"));
  hint.appendChild(el("span", null, "Enter to open"));
  hint.appendChild(el("span", null, "Esc to close"));
  card.appendChild(hint);
  wrap.appendChild(card);
  wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);

  sel = 0;
  render();
  input.focus();

  input.addEventListener("input", function () { sel = 0; render(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(); return; }
    if (e.key === "Enter") { e.preventDefault(); if (shown[sel]) go(shown[sel]); return; }
    /* Tab must not escape the palette while it is open. */
    if (e.key === "Tab") e.preventDefault();
  });
}

/* Capture phase, so it works even while the keyboard page is holding every
   key - that is the one moment you most need another way out, and the one
   moment the rail is unreachable. */
window.addEventListener("keydown", function (e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    e.stopPropagation();
    open();
  }
}, true);

window.PALETTE = { open: open, close: close, items: items, search: search };
})();
