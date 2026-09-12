// Checks site/index.html — the landing page build_pages.js generates.
//
//   node src/test/test_landing_links.js
//
// Two things, both cheap and both easy to break:
//
//   1. Every href resolves to a file that was actually published. The report list is
//      generated from what existed at build time precisely so a missing report is left
//      out rather than linked as a 404, and that only holds if nothing else drifts.
//   2. No unfilled template markers survived. A `<!--__PAGES__-->` left in the output is
//      a blank front page that still returns HTTP 200, which nothing downstream notices.
//
// Runs against the assembled site/, so build_pages.js has to have run first.
"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("../paths.js");

const SITE = path.join(paths.ROOT, "site");
const INDEX = path.join(SITE, "index.html");

let failed = 0;
const fail = (msg) => { console.error("FAIL: " + msg); failed++; };

if (!fs.existsSync(INDEX)) {
  console.error(`[test_landing_links] no site/index.html — run: node src/build_pages.js`);
  process.exit(1);
}
const html = fs.readFileSync(INDEX, "utf8");

// Unfilled markers.
const markers = html.match(/<!--__[A-Z_]+__-->/g);
if (markers) fail("template markers were never filled: " + [...new Set(markers)].join(", "));

// Local hrefs only: an external link is not this test's business, and there are none
// today. Fragment-only and absolute URLs are skipped rather than reported.
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
  .filter((h) => !/^(https?:|mailto:|#)/.test(h));
if (!hrefs.length) fail("the landing page links to nothing at all");

hrefs.forEach((h) => {
  const target = path.join(SITE, h.split("#")[0]);
  if (!fs.existsSync(target)) fail(`href="${h}" does not exist in site/`);
});

// The simulator is the one entry that is never optional — every report links into it,
// so a landing page without it means build_pages.js published something incoherent.
if (!hrefs.includes("simulator.html")) fail('no link to simulator.html');

// Whatever WAS published must be reachable from somewhere in the published site. Usually
// that means index.html; a report's own "notes on this set" page is the one exception —
// build_pages.js publishes it alongside its report (see manifest.notesPage) but it is
// linked FROM the report, not from the landing page, and that link is written by the
// report's own script from its embedded DATA blob (`"notesHref":"..."`) rather than as a
// literal href="" in the markup, so it has to be read out the same way here.
const notesHrefs = new Set();
const otherPages = fs.readdirSync(SITE).filter((f) => f.endsWith(".html") && f !== "index.html");
otherPages.forEach((f) => {
  const m = /"notesHref":"([^"]*)"/.exec(fs.readFileSync(path.join(SITE, f), "utf8"));
  if (m && m[1]) notesHrefs.add(m[1]);
});
notesHrefs.forEach((h) => {
  if (!fs.existsSync(path.join(SITE, h))) fail(`a report's notesHref="${h}" does not exist in site/`);
});
// Catches a report (or a notes page for one that no longer exists) copied into site/ but
// dropped from the landing list / no longer referenced, which is invisible to the href
// check above.
otherPages.forEach((f) => {
  if (!hrefs.includes(f) && !notesHrefs.has(f)) {
    fail(`site/${f} was published but is not linked from index.html or referenced as a report's notes page`);
  }
});

if (failed) {
  console.error(`\n[test_landing_links] ${failed} problem(s) in site/index.html`);
  process.exit(1);
}
console.log(`OK: landing page — ${hrefs.length} link(s), all resolve: ${hrefs.join(", ")}`);
