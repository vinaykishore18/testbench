/* Testbench — boot guard.

   Loads before everything else. Its only job is to make failures visible on
   the page instead of hiding them in the console.

   Three things go wrong with a static site like this one:
     1. a script 404s (wrong path, wrong case, file never deployed)
     2. a script downloads but throws while it runs (syntax or runtime error)
     3. a script runs but a later one it depends on never arrived
   All three look identical from the outside: the HTML draws and nothing works.
   This file tells them apart and prints the answer.

   It touches nothing else. Removing the one <script> tag in index.html that
   loads it puts the site back exactly as it was. */
"use strict";
(function () {
  var seen = [];            /* every failure, in order */
  var loaded = Object.create(null);
  var box = null;

  /* ---------- the banner ---------- */
  function ensure() {
    if (box) return box;
    if (!document.body) return null;
    box = document.createElement("div");
    box.id = "tb-boot-error";
    box.setAttribute("role", "alert");
    /* In the flow, not over it. An overlay here would sit on top of the
       navigation and swallow the clicks needed to reach the broken page —
       which is exactly what it did the first time it fired. */
    box.style.cssText =
      "position:relative;max-height:46vh;overflow:auto;" +
      "background:#1A0509;border-bottom:2px solid #FF2D46;color:#FFE8EB;" +
      "font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:14px 46px 14px 16px";
    var h = document.createElement("div");
    h.style.cssText = "font-weight:700;color:#FF2D46;letter-spacing:.06em;margin-bottom:8px";
    h.textContent = "BOOT FAILURE — a script did not run";
    box.appendChild(h);
    var list = document.createElement("div");
    list.id = "tb-boot-list";
    box.appendChild(list);
    var tip = document.createElement("div");
    tip.style.cssText = "margin-top:10px;color:#C98F97";
    tip.textContent = "Scripts load in numbered order. The first line below is the one to fix — everything after it is fallout.";
    box.appendChild(tip);
    var x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", "Dismiss");
    x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:0;color:#FF2D46;" +
      "font-size:22px;line-height:1;cursor:pointer;padding:4px 8px";
    x.onclick = function () { box.remove(); box = null; };
    box.appendChild(x);
    document.body.insertBefore(box, document.body.firstChild);
    return box;
  }

  function show(kind, detail) {
    seen.push(kind + "  " + detail);
    var b = ensure();
    if (!b) { document.addEventListener("DOMContentLoaded", redraw); return; }
    redraw();
  }
  function redraw() {
    var b = ensure(); if (!b) return;
    var list = b.querySelector("#tb-boot-list");
    list.textContent = "";
    seen.forEach(function (line, i) {
      var d = document.createElement("div");
      d.style.cssText = "padding:3px 0;" + (i === 0 ? "color:#FFE8EB" : "color:#C98F97");
      d.textContent = (i === 0 ? "▶ " : "   ") + line;
      list.appendChild(d);
    });
  }

  /* ---------- catch a script that never arrived ----------
     A failed <script src> fires "error" on the element, which does not bubble,
     so this listener runs in the capture phase on window. e.target is the tag. */
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName === "SCRIPT") {
      show("NOT LOADED", short(t.src) + "   — the file is missing from the server, or the path or capitalisation is wrong");
      e.preventDefault();
      return;
    }
    if (t && t !== window && t.tagName === "LINK") {
      /* Only our own stylesheets are fatal. A Google Fonts sheet blocked by a
         proxy, an extension or a machine that is offline costs you the typeface
         and nothing else — a BOOT FAILURE for that would be crying wolf. */
      if (sameOrigin(t.href)) show("NOT LOADED", short(t.href) + "   — stylesheet missing");
      return;
    }
    /* a real thrown error: e.message / e.filename / e.lineno are set */
    if (e.message) {
      show("THREW", short(e.filename) + ":" + e.lineno + ":" + e.colno + "   " + e.message);
    }
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    show("PROMISE", (r && r.message) ? r.message : String(r));
  });

  document.addEventListener("load", function (e) {
    var t = e.target;
    if (t && t.tagName === "SCRIPT" && t.src) loaded[short(t.src)] = true;
  }, true);

  function sameOrigin(u) {
    try { return new URL(u, location.href).origin === location.origin; }
    catch (err) { return true; }
  }
  function short(u) {
    if (!u) return "(inline script)";
    try { return new URL(u, location.href).pathname.replace(/^.*\/(?=(js|css)\/)/, ""); }
    catch (err) { return String(u); }
  }

  /* ---------- after everything settles, check the roll call ---------- */
  window.addEventListener("load", function () {
    setTimeout(function () {
      var tags = document.querySelectorAll("script[src]");
      var missing = [];
      for (var i = 0; i < tags.length; i++) {
        var p = short(tags[i].src);
        if (!loaded[p]) missing.push(p);
      }
      if (missing.length && !seen.length) {
        missing.forEach(function (p) { show("NOT LOADED", p); });
      }
      if (!window.TB && !seen.length) {
        show("NOT LOADED", "js/00-core.js never defined TB — nothing else can run");
      }
      /* expose a summary so you can read it from the console in one line */
      window.TBBOOT = { failures: seen.slice(), loaded: Object.keys(loaded) };
    }, 60);
  });
})();
