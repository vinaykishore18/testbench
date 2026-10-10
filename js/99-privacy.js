/* Testbench — privacy and data panel.

   This page is a bench tool on someone else's laptop. It asks for the
   microphone, the camera, HID and MIDI, and it keeps a few things between
   sessions. An operator who cannot find out what it kept, or get rid of it in
   one press, has to take the tool's word for it — and "trust me" is not good
   enough for a page that turns your microphone on.

   So: count everything, name it, and delete all of it on one button. No
   exceptions, no "most of it", nothing left behind under another key. The
   counts are read live rather than hard-coded, which also means this panel
   notices if a future module starts storing something and nobody updated it. */
"use strict";
(function () {
var $ = TB.$, el = TB.el, toast = TB.toast;
var box = $("#pv-stores");
if (!box) return;

/* Every key this site is allowed to own, with what it is for. Anything found
   under the tb prefix that is NOT in here gets listed as unaccounted-for
   rather than quietly ignored — that is the whole point of counting live. */
var KNOWN = {
  "tb-theme":      "Your dark / light / system choice.",
  "tb.earbuds.v1": "The earbuds reference curve and the serial numbers you have typed in."
};
var DB_NAME = "testbench-music";

function bytes(n) {
  if (n == null) return "—";
  return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : n > 1024 ? Math.round(n / 1024) + " KB" : n + " bytes";
}
function kv(k, v) {
  box.appendChild(el("dt", null, k));
  var d = el("dd"); d.appendChild(v && v.nodeType ? v : document.createTextNode(String(v)));
  box.appendChild(d);
}

function localKeys() {
  /* Every key on the origin, not only the tb-prefixed ones. The panel used to
     filter to /^tb[-.]/ and so could neither show nor delete anything stored
     under another name - a key left by an earlier version of the site was
     invisible here and survived a wipe that called itself total. Listing
     everything is what makes the count and the button agree. */
  var out = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k) out.push(k);
    }
  } catch (e) {}                 /* private window, blocked site data */
  return out;
}

function tracks() {
  return new Promise(function (res) {
    var rq, settled = false;
    function done(v) { if (!settled) { settled = true; res(v); } }
    /* A blocked open never fires any event at all, so this promise would never
       settle and every caller would wait on it forever. Cap the wait. */
    setTimeout(function () { done(null); }, 3500);
    try { rq = indexedDB.open(DB_NAME, 1); } catch (e) { done(null); return; }
    rq.onupgradeneeded = function () {
      /* Opening a database that does not exist creates it. If we got here the
         music library was never used, so throw the empty one away again rather
         than leaving a database behind as a side effect of asking about it. */
      try { rq.transaction.abort(); } catch (e) {}
    };
    rq.onerror = function () { done(null); };
    rq.onblocked = function () { done(null); };
    rq.onsuccess = function () {
      var d = rq.result;
      /* Do not hold this connection: holding it is what blocked the delete in
         the first place. Read, close, resolve. */
      var names = d.objectStoreNames;
      if (!names.contains("tracks")) { d.close(); done([]); return; }
      try {
        var st = d.transaction("tracks", "readonly").objectStore("tracks");
        var g = st.getAll();
        g.onsuccess = function () { d.close(); done(g.result || []); };
        g.onerror = function () { d.close(); done(null); };
      } catch (e) { d.close(); done(null); }
    };
  });
}

function count() {
  box.textContent = "";
  var keys = localKeys(), lsBytes = 0, serials = 0;
  keys.forEach(function (k) {
    var v = "";
    try { v = localStorage.getItem(k) || ""; } catch (e) {}
    lsBytes += k.length + v.length;
    if (k === "tb.earbuds.v1") {
      try { serials = (JSON.parse(v).serials || []).length; } catch (e) {}
    }
  });

  if (!keys.length) {
    kv("Saved settings", "Nothing. This browser has no Testbench settings stored.");
  } else {
    keys.forEach(function (k) {
      var what = KNOWN[k] || "Not accounted for — this key is not one the site is supposed to own. Worth asking about.";
      kv(k, what + (k === "tb.earbuds.v1" && serials ? "  Currently " + serials + " serial" + (serials === 1 ? "" : "s") + " logged." : ""));
    });
    kv("Settings total", bytes(lsBytes) + " of text, in this browser's local storage for this site only.");
  }

  kv("Cookies", (document.cookie || "").length ? "Something has set a cookie — that is not us, and worth looking at." : "None. The site sets none and reads none.");

  var pending = el("dd", null, "counting…");
  box.appendChild(el("dt", null, "Saved audio"));
  box.appendChild(pending);
  var stuck = setTimeout(function () {
    /* A read that never settles used to leave this line reading "counting..."
       for the rest of the session, which looks like a slow page and is
       actually a wedged storage layer. Say so instead. */
    pending.textContent = "The audio library did not answer. Another tab on this site may have it open \u2014 close the others and press Recount.";
  }, 4000);
  tracks().then(function (rows) {
    clearTimeout(stuck);
    if (rows == null) { pending.textContent = "Could not read the audio library in this browser."; return; }
    if (!rows.length) { pending.textContent = "No tracks saved. The music library is empty."; return; }
    var t = rows.reduce(function (n, r) { return n + (r.size || 0); }, 0);
    pending.textContent = rows.length + (rows.length === 1 ? " track" : " tracks") + ", " + bytes(t) +
      ", stored in this browser on this machine. MP3 files you added yourself — nothing was downloaded and nothing was uploaded.";
  });

  $("#pv-state").textContent = keys.length
    ? "Everything above is on this computer, in this browser, for this site. None of it is transmitted and none of it is readable by any other site."
    : "Nothing is stored yet.";
}

function wipe() {
  /* Clear EVERY key on this origin, not only the tb-prefixed ones.

     The panel's button says "Delete everything stored on this machine", and
     the first version deleted only keys matching /^tb[-.]/. A key left behind
     by an earlier version of this site, or by something typed into a console,
     survived a wipe that announced itself as total. This origin belongs to
     nothing but Testbench, so there is no third party's data to be careful
     of - and a claim of "everything" has to be true or it should not be made. */
  var removed = [];
  try {
    for (var i = localStorage.length - 1; i >= 0; i--) removed.push(localStorage.key(i));
    localStorage.clear();
  } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}

  /* The audio module holds an open connection to the music database for the
     life of the tab. An open connection BLOCKS deleteDatabase, and a blocked
     delete never settles - and while it sits there pending, every later
     indexedDB.open on this origin hangs behind it. Measured: the panel
     reported "every saved track is gone", the database was still listed, the
     track was still playable, and the panel's own recount was stuck on
     "counting..." for the rest of the session.

     So: ask the audio module to let go first, then delete, and treat blocked
     as the failure it is rather than reporting it as success. */
  if (window.MUSICDB && window.MUSICDB.close) {
    try { window.MUSICDB.close(); } catch (e) {}
  }

  var dbJob = new Promise(function (res) {
    var rq, settled = false;
    function done(how) { if (!settled) { settled = true; res(how); } }
    try { rq = indexedDB.deleteDatabase(DB_NAME); } catch (e) { done("error"); return; }
    rq.onsuccess = function () { done("ok"); };
    rq.onerror = function () { done("error"); };
    rq.onblocked = function () {
      /* Another TAB on this origin is holding the database. Nothing this page
         can do about that one, and saying so is the only honest option. */
      done("blocked");
    };
    setTimeout(function () { done("blocked"); }, 3000);
  });

  return dbJob.then(function (how) {
    /* Verify rather than assume. The whole value of this panel is that it can
       be checked, so it checks itself: read the store back and report what is
       actually left. */
    return tracks().then(function (rows) {
      var left = rows && rows.length ? rows.length : 0;
      count();
      if (how === "ok" && !left) {
        toast("Everything deleted",
          "Settings, the earbuds log and every saved track are gone from this machine. " +
          removed.length + " stored item" + (removed.length === 1 ? "" : "s") + " removed.", "ok");
        $("#pv-state").textContent = "Deleted, and checked afterwards \u2014 nothing is left. Reload the page so the rest of the site forgets it too.";
      } else if (how === "blocked") {
        toast("Could not finish \u2014 another tab has it open",
          "Settings and the earbuds log are gone. The saved audio could not be deleted because another tab on this site still has the database open. " +
          "Close the other tabs and press the button again.", "bad");
        $("#pv-state").textContent = "Settings cleared. The audio library was NOT deleted \u2014 another tab is holding it open. Close the other tabs and try again.";
      } else {
        toast("Partly done",
          "Settings and the earbuds log are gone. The audio library reported an error and " +
          (left ? left + " track" + (left === 1 ? "" : "s") + " may still be stored." : "may not have been deleted."), "bad");
        $("#pv-state").textContent = "Settings cleared. The audio library could not be confirmed deleted \u2014 reload and check this panel again.";
      }
      return how;
    });
  });
}

/* Two presses, through the shared guard so a double-click cannot do both.
   This throws away the earbuds reference curve, which takes a sealed
   known-good pair and a quiet room to rebuild - not something to lose to one
   stray click from the faulty mouse currently on the bench. */
TB.arm($("#pv-wipe"), "Delete everything stored on this machine",
  "Press again to delete everything", function () {
    var b = $("#pv-wipe");
    b.disabled = true;
    wipe().then(function () { b.disabled = false; });
  });

$("#pv-refresh").onclick = count;
TB.onEnter("system", count);
})();
