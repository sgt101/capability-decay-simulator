// Generates the gamma_above variant of the ACL capability trio: the same three Dell'Acqua
// scenarios, with the AI's learning penalty applied to people ABOVE its level as well as
// below, at the central Stromberg value.
//
//   node src/generate_acl_gabove_experiments.js
//
// WHY. The ACL set offers gamma_above on a round ladder — 1.1, 1.0, 0.9, 0.8, 0.7 — and the
// reported trio (acl.2/7/12) sits at 1.0, where the AI does not touch the learning of
// anyone above it at all. That is an assumption, not a finding. gamma_above and gamma_below
// are the SAME kind of quantity in the same units — engine.js multiplies the learning delta
// by one or the other depending on which side of the AI the person sits — so the principled
// symmetric choice is to set gamma_above to a MEASURED penalty rather than to a round
// number. This set uses the central Stromberg figure, -18.87%, i.e. 0.8113.
//
// 0.8 is already on the ladder (acl.4/9/14) and is only 1.1 points away, so this set is not
// about the size of the number. It is about the number being the same measurement, so the
// comparison against gamma_above = 1.0 is "the penalty applies to everyone" against "the
// penalty applies only below", with nothing else moving.
//
// WHY IT CLONES RATHER THAN REBUILDS. Every config here is the corresponding
// data/experiments-acl/acl.N.json with ONE field changed. Re-deriving them from
// generate_acl_experiments.js's own constants would mean a second copy of BASE_FIXED, the
// axes and the world-model block, which would differ from the original the first time
// either changed. Cloning makes that impossible: if the ACL set moves, this set moves with
// it, and the diff between a pair of configs is guaranteed to be the one field.
//
// WHY A SEPARATE DIRECTORY. generate_acl_experiments.js numbers its configs variant-major
// (3 variants x 5 gamma_above) and DELETES any acl.N.json not in its own manifest. Adding a
// sixth gamma_above there would renumber acl.6 upward and silently invalidate every
// results/acl.N directory and every report built from them; writing acl.16-18 into that
// directory would get them deleted on its next run. Neither is recoverable quietly, so this
// set lives in its own directory and keeps the SAME config numbers as the originals it
// clones, which is what makes the correspondence readable: acl.7 here is acl.7 there with
// gamma_above changed.
"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");

// The central Stromberg learning penalty, as the multiplier the engine stores. Derived from
// the manifest rather than written as 0.8113, so it cannot disagree with the value the rows
// of the figure are built from.
const SRC_DIR = paths.data("experiments-acl");
const SRC_MANIFEST = paths.data("experiments.acl.manifest.json");
const OUT_DIR = paths.data("experiments-acl-gabove");
const OUT_MANIFEST = paths.data("experiments.acl-gabove.manifest.json");

// The three capability variants at gamma_above 1.0 — the trio the trajectory figure reports.
const CLONE = [2, 7, 12];

if (!fs.existsSync(SRC_MANIFEST)) {
  console.error(`[generate_acl_gabove] no ${path.relative(paths.ROOT, SRC_MANIFEST)} — generate the ACL set first:`);
  console.error(`  node src/generate_acl_experiments.js`);
  process.exit(1);
}
const srcManifest = JSON.parse(fs.readFileSync(SRC_MANIFEST, "utf8"));

// The MIDDLE of the three stated penalties, by position in the manifest's own list, not by
// picking the number out by hand. Three values, so the median is the central one.
const stated = srcManifest.stromberg.statedPercent;
const asGamma = srcManifest.stromberg.asGammaBelow;
if (stated.length !== 3 || asGamma.length !== 3) {
  console.error(`[generate_acl_gabove] expected 3 Stromberg values, found ${stated.length} —`);
  console.error(`  this set is defined as "gamma_above at the CENTRAL penalty", which needs an odd count.`);
  process.exit(1);
}
const order = stated.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);   // least severe first
const centralIdx = order[1][1];
const GAMMA_ABOVE = asGamma[centralIdx];
const STATED = stated[centralIdx];

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];

CLONE.forEach((n) => {
  const srcPath = path.join(SRC_DIR, `acl.${n}.json`);
  if (!fs.existsSync(srcPath)) {
    console.error(`[generate_acl_gabove] no ${path.relative(paths.ROOT, srcPath)} — generate the ACL set first:`);
    console.error(`  node src/generate_acl_experiments.js`);
    process.exit(1);
  }
  const src = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const srcEntry = srcManifest.experiments.find((e) => e.n === n);
  if (!srcEntry) {
    console.error(`[generate_acl_gabove] acl.${n} is not in the ACL manifest — CLONE is out of date.`);
    process.exit(1);
  }
  // Asserted, not assumed: this set only means anything as a contrast against gamma_above
  // 1.0. Cloning a config that was already dampened above would produce a figure whose
  // caption is wrong in a way nothing else would catch.
  if (src.fixed.aiDampeningAbove !== 1) {
    console.error(`[generate_acl_gabove] acl.${n} has aiDampeningAbove ${src.fixed.aiDampeningAbove},`
      + ` expected 1 — CLONE should list the gamma_above +0.0 trio.`);
    process.exit(1);
  }

  const out = JSON.parse(JSON.stringify(src));
  out.fixed.aiDampeningAbove = GAMMA_ABOVE;
  const label = `${srcEntry.label.split(" · ")[0]} · γ_above ${GAMMA_ABOVE}`
    + ` (Stromberg central ${STATED}%)`;
  fs.writeFileSync(path.join(OUT_DIR, `acl.${n}.json`), JSON.stringify(out, null, 2) + "\n");
  manifest.push({
    n, file: `data/experiments-acl-gabove/acl.${n}.json`,
    clonedFrom: `data/experiments-acl/acl.${n}.json`,
    x: srcEntry.x, y: srcEntry.y, label, variant: srcEntry.variant,
    gammaAbove: +(GAMMA_ABOVE - 1).toFixed(6),
    aiDampeningAbove: GAMMA_ABOVE,
    xValues: srcEntry.xValues, yValues: srcEntry.yValues, runs: srcEntry.runs,
  });
});

// The same shape the ACL manifest has, so anything that reads one can read the other —
// build_valuation_trajectory_report.js takes labels and the Stromberg values from here.
fs.writeFileSync(OUT_MANIFEST, JSON.stringify({
  graphSource: srcManifest.graphSource,
  worldModel: srcManifest.worldModel,
  note: "The ACL capability trio with the AI's learning penalty applied ABOVE its level as "
    + "well as below, at the central Stromberg value (" + STATED + "%, γ " + GAMMA_ABOVE + "). "
    + "Cloned field-for-field from data/experiments-acl/acl.{2,7,12}.json with only "
    + "aiDampeningAbove changed, so the contrast against γ_above = 1.0 isolates that one "
    + "assumption. Generated by src/generate_acl_gabove_experiments.js.",
  ticksPerYear: srcManifest.ticksPerYear, careerYears: srcManifest.careerYears,
  stromberg: srcManifest.stromberg,
  gammaAboveSource: { statedPercent: STATED, asMultiplier: GAMMA_ABOVE, from: "central Stromberg penalty" },
  capabilityVariants: srcManifest.capabilityVariants,
  studyParams: srcManifest.studyParams,
  replicates: srcManifest.replicates, horizon: srcManifest.horizon, recordAt: srcManifest.recordAt,
  experiments: manifest,
}, null, 2) + "\n");

// Stale sweep: the same contract generate_acl_experiments.js keeps, so a shortened CLONE
// list cannot leave an orphan config behind that a runner would still pick up.
const stale = fs.readdirSync(OUT_DIR)
  .filter((f) => /^acl\.\d+\.json$/.test(f))
  .filter((f) => !manifest.some((m) => path.basename(m.file) === f));
stale.forEach((f) => fs.unlinkSync(path.join(OUT_DIR, f)));

console.log(`wrote ${manifest.length} config(s) -> ${path.relative(paths.ROOT, OUT_DIR)}`);
manifest.forEach((m) => console.log(`  acl.${m.n}  ${m.variant.padEnd(10)}  γ_above ${m.aiDampeningAbove}`
  + `  (cloned from ${m.clonedFrom})`));
if (stale.length) console.log(`  removed ${stale.length} stale config(s)`);
console.log(`\nγ_above = ${GAMMA_ABOVE} — the central Stromberg penalty, ${STATED}%, the same`);
console.log(`multiplier the middle ROW of the figure already uses for γ_below.`);
console.log(`\nnext: ./src/run_valuation_trajectories.sh   (runs both sets, then rebuilds the report)`);
