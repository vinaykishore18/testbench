/* Testbench — SKU gate.

   A report has to be ABOUT something. Without a unit number it is a page of
   scores that could belong to any of the forty units on the trolley, and a
   file called testbench_unit_20261011.csv in an inventory folder is worse
   than no file - somebody will match it to the wrong item.

   So: the SKU is the report number, and nothing exports without one. The
   bench itself stays unlocked. You can plug a controller in and test it
   without typing anything, which is most of what happens on a bench - the
   gate is on the REPORT, not on the work.

   The prompt appears when a device is plugged in, because that is the moment
   a new unit has arrived and the moment the operator has it in their hand.
   Dismiss it and it stays dismissed for that device; it is an offer, not a
   demand. */
"use strict";
(function () {
var $ = TB.$, el = TB.el, toast = TB.toast;
var field = $("#rep-unit");
if (!field) return;

var bar = null, dismissed = Object.create(null), lastSig = "";

function sku() { return (field.value || "").trim(); }

/* ---------- the prompt ---------- */
function offer(what) {
  if (sku()) return;                 /* already working on a unit */
  if (dismissed[what]) return;
  if (bar) { bar.querySelector(".what").textContent = what; return; }

  bar = el("div", "tb-skubar");
  var ic = el("div", "ic");
  ic.appendChild(document.createTextNode("⬚"));
  bar.appendChild(ic);

  var txt = el("div", "txt");
  var b = el("b");
  b.appendChild(document.createTextNode("New device — "));
  var w = el("span", "what", what);
  b.appendChild(w);
  txt.appendChild(b);
  txt.appendChild(el("span", null, "Give it a SKU and everything you test gets recorded against that number. Skip it and the bench works exactly as normal."));
  bar.appendChild(txt);

  var form = el("div", "act");
  var inp = el("input");
  inp.type = "text";
  inp.placeholder = "SKU or lot number";
  inp.setAttribute("aria-label", "SKU for this unit");
  inp.setAttribute("autocomplete", "off");
  form.appendChild(inp);

  var go = el("button", "tb-btn pri", "Start report");
  go.onclick = function () {
    var v = (inp.value || "").trim();
    if (!v) { inp.focus(); inp.classList.add("empty"); setTimeout(function(){ inp.classList.remove("empty"); }, 600); return; }
    field.value = v;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    paintBadge();
    toast("Report started", "Everything you test from here is recorded against " + v + ". Open the Report tab to build it.", "ok");
    TB.watch("REPORT", "opened for " + v);
  };
  inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go.click(); } });
  form.appendChild(go);

  var no = el("button", "tb-btn", "Not now");
  no.onclick = function () { dismissed[what] = true; close(); };
  form.appendChild(no);
  bar.appendChild(form);

  document.body.appendChild(bar);
  /* Focus the field, but not on a touch device - raising the on-screen
     keyboard unasked covers half the screen while somebody is holding a
     controller. */
  if (!matchMedia("(hover:none)").matches) setTimeout(function () { inp.focus(); }, 60);
}

function close() { if (bar) { bar.remove(); bar = null; } }

/* ---------- the badge in the top bar ---------- */
/* So the operator can always see which unit they are recording against. A
   session that silently files results under the wrong SKU is the failure
   this whole feature exists to prevent, so the number is on screen the whole
   time rather than only on the Report page. */
function paintBadge() {
  var host = $("#statusbar");
  if (!host) return;
  var b = $("#sku-badge");
  var v = sku();
  if (!v) { if (b) b.remove(); return; }
  if (!b) {
    b = el("button", "tb-chip sku", "");
    b.id = "sku-badge";
    b.title = "The unit everything is being recorded against. Click to go to the report.";
    b.onclick = function () { TB.go("report"); setTimeout(function () { field.focus(); field.select(); }, 250); };
    host.insertBefore(b, host.firstChild);
  }
  b.textContent = "";
  b.appendChild(el("span", "tb-dot"));
  b.appendChild(document.createTextNode("Unit "));
  b.appendChild(el("b", null, v));
  b.classList.add("live");
}
field.addEventListener("input", paintBadge);
TB.onEnter("report", paintBadge);
TB.onEnter("home", paintBadge);

/* ---------- the gate ---------- */
/* Build, print, copy and both exports all go through here. */
function gate(action) {
  if (sku()) return true;
  TB.go("report");
  setTimeout(function () {
    field.focus();
    field.classList.add("empty");
    setTimeout(function () { field.classList.remove("empty"); }, 900);
  }, 220);
  toast("This report needs a unit number",
        "The SKU is the report number — without it the file cannot be matched to anything on the shelf. Type it in and press " + action + " again.", null);
  return false;
}
window.SKUGATE = { ok: gate, value: sku, set: function (v) { field.value = v; paintBadge(); } };

/* ---------- what counts as a device being plugged in ---------- */
var SEEN = Object.create(null);
function arrived(kind, name) {
  var sig = kind + ":" + name;
  if (SEEN[sig]) return;
  SEEN[sig] = true;
  if (sig === lastSig) return;
  lastSig = sig;
  offer(name);
}

window.addEventListener("gamepadconnected", function (e) {
  var id = (e.gamepad && e.gamepad.id) || "controller";
  arrived("pad", id.replace(/\s*\([^)]*\)\s*$/, "").trim().slice(0, 48) || "controller");
});
if (navigator.hid && navigator.hid.addEventListener) {
  navigator.hid.addEventListener("connect", function (e) {
    arrived("hid", (e.device && e.device.productName) || "HID device");
  });
}
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", function () {
    /* A device list change fires for a monitor waking up as well as for a
       headset being plugged in, so this one is deliberately quiet: it only
       offers once per session and never interrupts a running test. */
    if (bar || sku()) return;
    arrived("media", "audio or video device");
  });
}
if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess({ sysex: false }).then(function (a) {
    a.onstatechange = function (e) {
      if (e.port && e.port.state === "connected" && e.port.type === "input") {
        arrived("midi", e.port.name || "MIDI device");
      }
    };
  }).catch(function () {});
}

/* for the test suite */
window.SKUBAR = { offer: offer, close: close, shown: function () { return !!bar; } };
})();
