/* Testbench — Apple serial number check.

   ======================================================================
   WHAT THIS IS, AND WHAT IT IS NOT
   ======================================================================
   Apple's older serial numbers are structured. They encode the factory, the
   half of the year and the week the unit was built, and the model. So a
   serial can be checked for internal consistency without asking anybody:

     - is it a length and character set Apple actually uses?
     - do the date characters decode to a real half-year and week?
     - does that build date make sense for the model it is printed on?

   That last one is the strongest signal here. A 12-character serial that
   decodes to 2018 on a pair of AirPods Pro 2 is impossible, because AirPods
   Pro 2 did not exist until September 2022. The counterfeiter copied a serial
   format from an older product, or made one up.

   What this CANNOT do, stated plainly because the opposite claim is the one
   that gets a reseller in trouble:

     - It cannot prove a serial is genuine. A well-formed serial is trivial to
       print, and fakes do. A PASS means "nothing wrong on the face of it",
       not "this is real".
     - It cannot ask Apple. There is no public lookup API; their coverage
       checker is behind a captcha precisely to stop automated queries, and
       their terms forbid it. A scraper would also fail silently the first
       time Apple changed the page, which on a returns bench is worse than no
       check at all - it would start reporting "could not verify" for genuine
       pairs and you would have no way to tell that from a fake. So the button
       hands the serial to Apple's own page and you read the real answer.

   ======================================================================
   THE FORMATS
   ======================================================================
   11 characters (older):   FF  Y   WW   NNN   MMM
                            factory, last digit of year, week 01-53,
                            running number, 3-char model.

   12 characters (c.2010-2021):  FFF  Y  W  NNN  MMMM
                            factory, half-year letter, week-within-half
                            character, running number, 4-char model.

   10 characters (2021 onward): randomised. Apple announced in March 2021
                            that new serials would carry no manufacturing
                            information at all. Nothing to decode - but the
                            length itself is informative, because a randomised
                            serial on a 2016 product is as impossible as a
                            2016 build date on a 2022 product.

   Apple's character set leaves out the vowels and the characters that get
   misread by eye: no A, E, I, O, U, and no B, S, Z or 0 in the date
   positions. That is why an O typed for a zero is catchable.
   ====================================================================== */
"use strict";
(function () {
var $ = TB.$, el = TB.el, toast = TB.toast;
if (!$("#sn-check")) return;

/* Half-year codes, position 4 of a 12-character serial. */
var YEARS = {
  C: [2010, 1], D: [2010, 2], F: [2011, 1], G: [2011, 2], H: [2012, 1], J: [2012, 2],
  K: [2013, 1], L: [2013, 2], M: [2014, 1], N: [2014, 2], P: [2015, 1], Q: [2015, 2],
  R: [2016, 1], S: [2016, 2], T: [2017, 1], V: [2017, 2], W: [2018, 1], X: [2018, 2],
  Y: [2019, 1], Z: [2019, 2]
};
/* Week-within-half codes, position 5. Index 0 is week 1 of that half. */
var WEEKS = "123456789CDFGHJKLMNPQRTVWXY";

/* Factory codes seen on Apple hardware. This is a convenience, not a test:
   Apple has never published the list, it changes, and a code missing from
   here proves nothing - so an unknown code is reported as unknown and never
   as a failure. Treating a gap in our own notes as evidence against the
   hardware would be exactly the wrong way round. */
var FACTORIES = {
  C02: "Quanta, China", C07: "Quanta, China", C17: "Quanta, China",
  C1M: "Quanta, China", C2V: "Quanta, China",
  CK2: "Foxconn, China", DLX: "Foxconn, China", DNP: "Foxconn, China",
  F17: "Foxconn, China", F2: "Foxconn, China",
  FVF: "Foxconn, China", G8V: "Foxconn, China",
  H0: "Foxconn, China", H2: "Foxconn, China",
  GH: "Luxshare, China", GG: "Goertek, China", GQ: "Goertek, China",
  H4: "Inventec, China", HQ: "Inventec, China",
  W8: "Shanghai, China", YM: "Hon Hai, China",
  RM: "refurbished by Apple", RN: "replacement unit from Apple",
  FK: "Ireland", VM: "Foxconn, Czech Republic", PT: "Korea",
  SG: "Singapore", W0: "Shanghai, China"
};
function factoryName(code) {
  /* longest prefix first: a three-character code is more specific */
  if (FACTORIES[code]) return FACTORIES[code];
  if (FACTORIES[code.slice(0, 2)]) return FACTORIES[code.slice(0, 2)];
  return null;
}

function clean(raw) {
  /* Strip what a human adds and the scanner does not: spaces, hyphens, the
     "S/N:" people type out of habit. Keep the rest exactly as given, because
     a lowercase letter or a stray symbol is itself a finding. */
  return String(raw || "").replace(/^\s*s\s*\/?\s*n\s*[:.\-]?\s*/i, "").replace(/[\s\-_]/g, "");
}

/* The half-year to a human week range. A half has 26-27 weeks, so the second
   half starts at week 27. */
function decodeDate(yChar, wChar) {
  var y = YEARS[yChar];
  if (!y) return null;
  var idx = WEEKS.indexOf(wChar);
  if (idx < 0) return null;
  var week = idx + 1 + (y[1] === 2 ? 26 : 0);
  if (week > 53) return null;
  /* Approximate month from the ISO week, which is all the week number
     supports. Said as "around" on the page rather than printed as a date. */
  var month = Math.min(12, Math.max(1, Math.ceil(week / 4.345)));
  return { year: y[0], half: y[1], week: week, month: month };
}
var MONTHS = ["January","February","March","April","May","June",
              "July","August","September","October","November","December"];

function analyse(raw, modelISO) {
  var sn = clean(raw);
  var up = sn.toUpperCase();
  var f = [];                      /* findings */
  var r = { sn: up, ok: true, shape: null, built: null, factory: null, cross: null, findings: f };

  function bad(tag, text) { f.push({ level: "bad", tag: tag, text: text }); r.ok = false; }
  function warn(tag, text) { f.push({ level: "warn", tag: tag, text: text }); }
  function good(tag, text) { f.push({ level: "ok", tag: tag, text: text }); }

  if (!sn) { bad("empty", "Nothing was entered."); r.shape = "empty"; return r; }

  /* --- character set --- */
  if (/[^A-Za-z0-9]/.test(sn)) {
    bad("characters", "There are characters in there that no Apple serial contains: " +
        sn.replace(/[A-Za-z0-9]/g, "").split("").filter(function (c, i, a) { return a.indexOf(c) === i; }).join(" ") +
        ". Apple serials are letters and digits only.");
    r.shape = "invalid characters";
    return r;
  }
  if (/[a-z]/.test(sn)) {
    warn("case", "Typed in lower case. Apple prints them in capitals; read as “" + up + "”.");
  }

  /* --- length --- */
  var n = up.length;
  if (n < 8 || n > 14) {
    bad("length", n + " characters. Apple serials run from 8 to 14, and in practice are 10, 11 or 12 — this is not one.");
    r.shape = n + " characters";
    return r;
  }

  /* --- the structured formats --- */
  if (n === 12) {
    r.shape = "12-character (dated)";
    var d = decodeDate(up[3], up[4]);
    if (!d) {
      /* This is the useful failure. The 4th and 5th characters of a
         12-character serial are not free text: they come from a fixed table.
         An invented serial of the right length almost never gets both right. */
      bad("date code", "Characters 4 and 5 are “" + up[3] + up[4] +
          "”, which is not a date Apple uses. In a 12-character serial those two positions " +
          "come from a fixed table — a half-year letter then a week character. This serial " +
          "is the right length but the wrong contents, which is what an invented one looks like.");
      if (/[AEIOUBSZ0]/.test(up[3] + up[4])) {
        warn("lookalike", "Those two characters include " +
             (up[3] + up[4]).replace(/[^AEIOUBSZ0]/g, "").split("").join(" and ") +
             ", which Apple leaves out of the date positions on purpose because they get misread. " +
             "Worth checking you have not read an O for a zero, or an S for a 5.");
      }
    } else {
      r.built = d;
      good("date code", "Decodes to week " + d.week + " of " + d.year + " — around " +
           MONTHS[d.month - 1] + " " + d.year + ", from the " + (d.half === 1 ? "first" : "second") + " half.");
      var thisYear = new Date().getFullYear();
      if (d.year > thisYear) bad("date", "That build date is in the future.");
    }
    var fac = up.slice(0, 3);
    r.factory = { code: fac, name: factoryName(fac) };
    if (r.factory.name) good("factory", "Factory code " + fac + " — " + r.factory.name + ".");
    else warn("factory", "Factory code " + fac + " is not in our notes. That is not a mark against it: " +
              "Apple has never published the list and it changes. Nothing to read into either way.");
  } else if (n === 11) {
    r.shape = "11-character (older, dated)";
    var yd = up[2], wk = up.slice(3, 5);
    if (!/^[0-9]$/.test(yd) || !/^[0-9]{2}$/.test(wk)) {
      bad("date code", "In an 11-character serial, character 3 is the last digit of the year and " +
          "characters 4 and 5 are the week number — all three are digits. Here they are “" +
          yd + wk + "”, which they cannot be.");
    } else {
      var w = parseInt(wk, 10);
      if (w < 1 || w > 53) {
        bad("date code", "The week reads " + wk + ". There is no week " + w + ".");
      } else {
        /* One digit of year is ambiguous by a decade, so offer both rather
           than pick one and sound more certain than the data allows. */
        var dig = parseInt(yd, 10);
        var now = new Date().getFullYear();
        var cands = [];
        for (var yy = 2000; yy <= now; yy++) if (yy % 10 === dig) cands.push(yy);
        r.built = { week: w, candidates: cands };
        good("date code", "Week " + w + " of a year ending in " + dig +
             (cands.length ? " — so " + cands.join(" or ") + ". " +
              "The 11-character format only carries one digit of the year, so that part is genuinely ambiguous." : ""));
      }
    }
    var f2 = up.slice(0, 2);
    r.factory = { code: f2, name: factoryName(f2) };
    if (r.factory.name) good("factory", "Factory code " + f2 + " — " + r.factory.name + ".");
  } else if (n === 10) {
    r.shape = "10-character (randomised)";
    good("format", "Ten characters, which is the randomised format Apple moved to in 2021. " +
         "There is deliberately nothing encoded in it — no factory, no date, no model — so there is " +
         "nothing here to check beyond the shape. That is Apple's doing, not a shortcoming of this page.");
  } else {
    r.shape = n + "-character (unusual)";
    warn("length", n + " characters. Apple's serials are overwhelmingly 10, 11 or 12. " +
         "This length is inside the range they have used but is unusual enough to look at twice.");
  }

  /* --- cross-check against the model --- */
  /* The model comes from a fixed <select>, so a non-string or a malformed
     value is not reachable through the UI - but analyse() is also the exported
     entry point the test suite drives, and a function that throws on a wrong
     argument type is a function that will throw the first time something else
     calls it. Validate rather than trust the caller. */
  var mISO = /^\d{4}-\d{2}$/.test(String(modelISO || "")) ? String(modelISO) : "";
  if (mISO) {
    var parts = mISO.split("-");
    var mY = parseInt(parts[0], 10), mM = parseInt(parts[1], 10);
    if (!(mY >= 2000 && mY <= 2100 && mM >= 1 && mM <= 12)) mISO = "";
  }
  if (mISO) {
    var launch = MONTHS[mM - 1] + " " + mY;
    if (n === 10 && mY < 2021) {
      r.cross = "impossible";
      bad("model", "A randomised ten-character serial on a model from " + launch +
          ". Apple did not start issuing those until 2021, so a unit this old cannot carry one. " +
          "Either the model is not what it is being sold as, or the serial is not from this unit.");
    } else if (r.built && r.built.year) {
      if (r.built.year < mY || (r.built.year === mY && r.built.month < mM - 1)) {
        r.cross = "impossible";
        bad("model", "The serial says this was built around " + MONTHS[r.built.month - 1] + " " + r.built.year +
            ", but that model was not released until " + launch + ". A unit cannot be built before its own model existed. " +
            "This is the strongest thing on this page — it is a contradiction, not a judgement.");
      } else if (r.built.year > mY + 9) {
        r.cross = "odd";
        warn("model", "Built around " + r.built.year + ", nine or more years after that model was released. Possible, but check the model is right.");
      } else {
        r.cross = "consistent";
        good("model", "Built around " + MONTHS[r.built.month - 1] + " " + r.built.year +
             ", after the " + launch + " release. Consistent.");
      }
    } else if (r.built && r.built.candidates && r.built.candidates.length) {
      var possible = r.built.candidates.filter(function (y) { return y >= mY; });
      if (!possible.length) {
        r.cross = "impossible";
        bad("model", "The year digit allows " + r.built.candidates.join(" or ") +
            ", and every one of those is before that model was released in " + launch + ".");
      } else {
        r.cross = "consistent";
        good("model", "The year digit allows " + possible.join(" or ") + ", which is after the " + launch + " release.");
      }
    } else if (n === 12 || n === 11) {
      r.cross = "not checked";
    } else {
      r.cross = "nothing to check";
    }
  } else {
    r.cross = "no model picked";
  }

  f.push({ level: "ok", tag: "limits", text:
    "A serial that passes every check above is NOT proven genuine — a correctly-shaped serial is as easy to print as a wrong one. " +
    "What this rules out is an invented serial, a mistyped one, and a build date that cannot belong to the model. " +
    "For the real answer, use “Copy & open Apple's checker” and read it from Apple yourself." });

  return r;
}

/* ---------- rendering ---------- */
function render(r) {
  $("#sn-shape").textContent = r.shape || "—";
  $("#sn-shape").className = "v " + (r.ok ? "pass" : "fail");

  if (r.built && r.built.year) {
    $("#sn-built").textContent = "wk " + r.built.week + " / " + r.built.year;
    $("#sn-built").className = "v pass";
  } else if (r.built && r.built.candidates) {
    $("#sn-built").textContent = "wk " + r.built.week + " / " + r.built.candidates.join(" or ");
    $("#sn-built").className = "v pass";
  } else {
    $("#sn-built").textContent = r.shape === "10-character (randomised)" ? "not encoded" : "—";
    $("#sn-built").className = "v";
  }

  $("#sn-fac").textContent = r.factory ? (r.factory.name || r.factory.code + " (unknown)") : "—";
  $("#sn-fac").className = "v";

  var c = $("#sn-cross");
  c.textContent = r.cross || "—";
  c.className = "v " + (r.cross === "impossible" ? "fail" : r.cross === "consistent" ? "pass" : r.cross === "odd" ? "warn" : "");

  var box = $("#sn-out");
  box.textContent = "";
  var ul = el("ul", "tb-steps");
  r.findings.forEach(function (x) {
    var li = el("li", x.level === "bad" ? "bad" : x.level === "warn" ? "warn" : "ok");
    li.appendChild(el("span", "tag", x.tag));
    li.appendChild(el("span", null, x.text));
    ul.appendChild(li);
  });
  box.appendChild(ul);
}

function run() {
  var r = analyse($("#sn-in").value, $("#sn-model").value);
  render(r);

  /* Into the unit report. Like the speed test, this panel draws its own result
     and so was invisible to the report - which meant the contradiction this
     file calls the strongest thing on the page, an encoded build date that
     predates the model, could not appear in a document anyone would paste
     into a listing. That is the one finding here most worth writing down. */
  if (r.shape !== "empty") {
    var sc = r.cross === "impossible" ? 0 : r.ok ? 100 : 25;
    var f2 = r.findings.filter(function (x) { return x.tag !== "limits"; })
      .map(function (x) { return { level: x.level, tag: x.tag, text: x.text }; });
    f2.push({ level: "ok", tag: "limits",
      text: "A serial that passes this check is NOT proven genuine \u2014 a correctly-shaped serial is as easy to print as a wrong one. It rules out an invented serial, a mistyped one, and a build date that cannot belong to the model. Nothing more." });
    TB.report("airpods", "Serial check", sc, f2);
  }
  if (!r.ok) {
    toast("That serial does not hold up",
          r.cross === "impossible"
            ? "The encoded build date cannot belong to that model. That is a contradiction, not an opinion — worth stopping on."
            : "It is not a shape Apple uses. Check you have read it correctly, then treat it as a finding.", "bad");
  }
  return r;
}

$("#sn-check").onclick = run;
$("#sn-in").addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });

$("#sn-apple").onclick = function () {
  var sn = clean($("#sn-in").value).toUpperCase();
  if (!sn) { toast("Nothing to look up", "Type the serial in first.", null); return; }
  var done = function () {
    toast("Serial copied",
          "Apple's coverage page is opening in a new tab — paste it there. We cannot query Apple for you: their checker is behind a captcha specifically to block that, and their terms forbid it. Reading it yourself takes two seconds and is the only answer that counts.", "ok");
  };
  /* Clipboard first, then open the tab. If the copy fails the serial is still
     shown on screen to type by hand, so the flow never dead-ends. */
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(sn).then(done).catch(function () {
      toast("Could not copy", "The browser blocked the clipboard. The serial is " + sn + " — type it in by hand.", null);
    });
  } else {
    toast("Clipboard not available", "The serial is " + sn + " — type it in by hand.", null);
  }
  window.open("https://checkcoverage.apple.com/", "_blank", "noopener,noreferrer");
};

/* Typing a serial into the log below should fill this in too, so the operator
   never types the same thing twice. */
var logIn = $("#ap-sn");
if (logIn) {
  logIn.addEventListener("change", function () {
    if (!$("#sn-in").value) $("#sn-in").value = logIn.value;
  });
}

/* Expose the analyser so the test suite can drive it with a table of serials
   rather than typing into the box fifty times. */
window.SERIALCHECK = { analyse: analyse, clean: clean };
})();
