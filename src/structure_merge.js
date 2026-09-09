// Shared plumbing for the two structure "add rows without a full re-run" scripts —
// run_structure_M_extension.js (the high-M tail) and run_structure_worldmodel_row.js
// (the real graph as one row). Each runs a cut-down config through batch_run.js and
// folds its rows into the CSVs already in results/structure.N/.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const paths = require("./paths.js");

// results_shortfall.csv LAST: it is the file build_report.js reads, so an interrupt
// mid-merge leaves the report seeing the old, self-consistent grid rather than a
// half-grown one.
const CSV_NAMES = ["results.csv", "results_summary.csv", "results_shortfall.csv"];
const OUT_FLAG = { "results.csv": "--out", "results_summary.csv": "--summary-out",
  "results_shortfall.csv": "--shortfall-out" };

// The header line without reading the whole file — the shortfall CSVs run past 500 MB.
function firstLine(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 16);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const s = buf.toString("utf8", 0, n);
    const nl = s.indexOf("\n");
    return nl < 0 ? s : s.slice(0, nl);
  } finally { fs.closeSync(fd); }
}

function endsWithNewline(file) {
  const sz = fs.statSync(file).size;
  if (sz === 0) return true;
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, sz - 1);
    return b[0] === 0x0a;
  } finally { fs.closeSync(fd); }
}

// True if any DATA row's M column (field index 1: "N,M,...") is one of `values`.
// Streamed a chunk at a time, exits on the first hit. Used for the "already merged?"
// guard, so a re-run is a no-op rather than a double-append.
function mColumnHasAny(file, values) {
  const want = new Set(values);
  const fd = fs.openSync(file, "r");
  const buf = Buffer.allocUnsafe(1 << 20);
  let leftover = "", header = true, hit = false, n;
  try {
    while (!hit && (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      const data = leftover + buf.toString("utf8", 0, n);
      let from = 0, nl;
      while ((nl = data.indexOf("\n", from)) !== -1) {
        const line = data.slice(from, nl);
        from = nl + 1;
        if (header) { header = false; continue; }
        if (!line) continue;
        const c1 = line.indexOf(","), c2 = line.indexOf(",", c1 + 1);
        if (c1 > 0 && c2 > c1 && want.has(Number(line.slice(c1 + 1, c2)))) { hit = true; break; }
      }
      leftover = data.slice(from);
    }
    if (!hit && leftover) {
      const c1 = leftover.indexOf(","), c2 = leftover.indexOf(",", c1 + 1);
      if (c1 > 0 && c2 > c1 && want.has(Number(leftover.slice(c1 + 1, c2)))) hit = true;
    }
  } finally { fs.closeSync(fd); }
  return hit;
}

// Append src's data rows onto dst, re-ordered to DST's column layout BY NAME. Target
// columns missing from src are filled blank; src columns missing from the target are
// dropped. Both lists are returned so the caller can sanity-check them — this is how a
// graphSource "worldModel" run (which carries worldModelFingerprint where a BA run has
// an empty `worldModel` column) is folded into a BA CSV without hard-coding positions.
function remapAppend(dstFile, srcFile) {
  const dstH = firstLine(dstFile).split(",");
  const lines = fs.readFileSync(srcFile, "utf8").split("\n");   // scratch CSVs are small
  const srcH = lines[0].split(",");
  const pick = dstH.map((name) => srcH.indexOf(name));
  const filled = dstH.filter((_, i) => pick[i] < 0);
  const dropped = srcH.filter((name) => !dstH.includes(name));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = lines[i].split(",");
    out.push(pick.map((j) => (j < 0 ? "" : f[j])).join(","));
  }
  if (out.length) {
    if (!endsWithNewline(dstFile)) fs.appendFileSync(dstFile, "\n");
    fs.appendFileSync(dstFile, out.join("\n") + "\n");
  }
  return { added: out.length, filled, dropped };
}

// Runs `sub` (a full config object) through batch_run.js into tmp/<scratch>/<tag>/, then
// remapAppends each of the three CSVs onto results/<tag>/. Returns
//   { ok: true,  results: [{added,filled,dropped} x3] }   on success
//   { ok: false, reason }                                 otherwise
function runAndMerge(tag, sub, scratch, opts = {}) {
  const outDir = path.join(paths.RESULTS, tag);
  const subDir = path.join(paths.TMP, scratch, tag);
  fs.rmSync(subDir, { recursive: true, force: true });
  fs.mkdirSync(subDir, { recursive: true });
  const subCfg = path.join(subDir, "config.json");
  fs.writeFileSync(subCfg, JSON.stringify(sub, null, 2) + "\n");

  const args = [path.join(paths.SRC, "batch_run.js"), "--config", subCfg];
  if (opts.workers) args.push("--workers", String(opts.workers));
  for (const name of CSV_NAMES) args.push(OUT_FLAG[name], path.join(subDir, name));
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) return { ok: false, reason: `batch_run exited ${r.status}` };

  for (const name of CSV_NAMES) {
    if (!fs.existsSync(path.join(subDir, name))) return { ok: false, reason: `batch_run did not write ${name}` };
    if (!fs.existsSync(path.join(outDir, name))) return { ok: false, reason: `${name} is not in results/${tag}/ — run the base set first` };
  }
  const results = CSV_NAMES.map((name) => remapAppend(path.join(outDir, name), path.join(subDir, name)));
  fs.rmSync(subDir, { recursive: true, force: true });
  return { ok: true, results };
}

module.exports = { CSV_NAMES, firstLine, endsWithNewline, mColumnHasAny, remapAppend, runAndMerge };
