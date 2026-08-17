// Phase B of world-model-plan.md — adds `bloc` and `market_index` to
// world-model.json's Country nodes (plus market_index overrides on the handful of
// Hub nodes where the city clearly differs from its country average).
//
//   node src/add_geo_attributes.js            # patch world-model.json in place
//   node src/add_geo_attributes.js --dry-run  # report what would change
//
// Idempotent: re-running overwrites the same fields with the same values, and
// reports anything in the file that this script has no entry for — which is how
// newly added countries (Singapore, Japan, Australia, Canada, UAE) will surface
// as warnings rather than silently getting no bloc.
//
// PROVENANCE: `bloc` is a fact about the world. `market_index` is NOT measured
// here — the values below are coarse judgements about relative market depth and
// compensation, normalised to United States = 1.00. They are stamped with
// market_index_basis so they can't be mistaken for sourced data, following the
// file's existing *_basis convention (size_basis, intake_estimate_basis).
"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");

const FILE = paths.data("world-model.json");
const DRY = process.argv.includes("--dry-run");

// bloc: grouped by the frictions that actually govern moving — shared language,
// legal/qualification tradition, and visa regime — NOT by geography.
const BLOC = {
  "United States": "ANGLO",
  "United Kingdom": "ANGLO",
  // Ireland is a judgement call: English-language, common-law, and in the
  // Common Travel Area with the UK (so UK<->IE mobility is close to domestic),
  // but in the EU visa regime rather than sharing one with the US. Placed in
  // ANGLO on the strength of language + CTA. Flip to EUR to test the other read.
  "Ireland": "ANGLO",

  "Germany": "EUR", "France": "EUR", "Switzerland": "EUR", "Netherlands": "EUR",
  "Spain": "EUR", "Italy": "EUR", "Sweden": "EUR", "Denmark": "EUR",
  "Norway": "EUR", "Finland": "EUR", "Luxembourg": "EUR",

  "India": "INDIA",
  "China": "GTCHINA",

  "Brazil": "LATAM", "Mexico": "LATAM", "Colombia": "LATAM",
  "Chile": "LATAM", "Peru": "LATAM", "Argentina": "LATAM",

  // Present so the five planned additions slot in without editing this script.
  "Canada": "ANGLO", "Australia": "ANGLO",
  "Japan": "EASIA",
  // Singapore: Anglophone common-law financial centre, Greater China commercial
  // ties, physically East Asia. EASIA is the least-committed of the three; this
  // is exactly the assignment world-model-plan.md flags as worth testing.
  "Singapore": "EASIA",
  "United Arab Emirates": "MENA",
};

// market_index: relative market depth / compensation level, United States = 1.00.
// Coarse and assumption-based — see the provenance note above.
const MARKET_INDEX = {
  "United States": 1.00,
  "United Kingdom": 0.80,
  "Switzerland": 0.85,
  "Luxembourg": 0.70,
  "Germany": 0.65, "France": 0.65, "Netherlands": 0.62,
  "Ireland": 0.60, "Norway": 0.58,
  "Sweden": 0.55, "Denmark": 0.55, "Finland": 0.50,
  "Spain": 0.45, "Italy": 0.45,
  "China": 0.45,
  "Brazil": 0.30, "Mexico": 0.28, "Chile": 0.28,
  "India": 0.22, "Colombia": 0.22, "Peru": 0.20, "Argentina": 0.18,

  // For the planned additions.
  "Canada": 0.62, "Australia": 0.60, "Japan": 0.60,
  "Singapore": 0.78, "United Arab Emirates": 0.65,
};

// Cities that materially outrank (or lag) their country average. Applied to Hub
// nodes; a hub with no override inherits its country's value at load time.
const HUB_OVERRIDE = {
  "New York": 1.00,
  "San Francisco Bay Area": 0.95,
  "Other US metro": 0.75,
  "London": 0.85,
  "Other UK location": 0.55,
  "Zurich": 0.90, "Geneva": 0.85,
  "Frankfurt": 0.70, "Paris": 0.70,
  "Mumbai": 0.28, "Other India": 0.16,
  "Shanghai": 0.52, "Beijing": 0.50, "Other China": 0.32,
  "São Paulo": 0.34,
  // planned additions
  "Singapore": 0.78, "Tokyo": 0.62, "Sydney": 0.60, "Toronto": 0.62, "Dubai": 0.68,
};

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const countries = doc.nodes.filter((n) => n.node_type === "Country");
const hubs = doc.nodes.filter((n) => n.node_type === "Hub");

const BASIS = "assumption - relative market depth/compensation, US=1.00, not sourced";
let patchedC = 0, patchedH = 0;
const missingBloc = [], missingIndex = [];

for (const c of countries) {
  if (BLOC[c.label]) { c.bloc = BLOC[c.label]; patchedC++; } else missingBloc.push(c.label);
  if (MARKET_INDEX[c.label] != null) {
    c.market_index = MARKET_INDEX[c.label];
    c.market_index_basis = BASIS;
  } else missingIndex.push(c.label);
}
for (const h of hubs) {
  if (HUB_OVERRIDE[h.label] != null) {
    h.market_index = HUB_OVERRIDE[h.label];
    h.market_index_basis = BASIS + " (city-level override)";
    patchedH++;
  }
}

console.log(`countries: ${countries.length}, patched with bloc: ${patchedC}`);
console.log(`hubs: ${hubs.length}, patched with market_index override: ${patchedH}`);
if (missingBloc.length) console.log(`\nWARNING - no bloc mapping for: ${missingBloc.join(", ")}`);
if (missingIndex.length) console.log(`WARNING - no market_index for: ${missingIndex.join(", ")}`);

const unusedBloc = Object.keys(BLOC).filter((k) => !countries.find((c) => c.label === k));
if (unusedBloc.length) console.log(`\n(entries staged for countries not yet in the file: ${unusedBloc.join(", ")})`);

const blocCount = {};
countries.forEach((c) => { if (c.bloc) blocCount[c.bloc] = (blocCount[c.bloc] || 0) + 1; });
console.log(`\nbloc distribution: ${JSON.stringify(blocCount)}`);

if (DRY) { console.log("\n--dry-run: world-model.json NOT written"); process.exit(0); }
fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + "\n");
console.log(`\nwrote ${FILE}`);
