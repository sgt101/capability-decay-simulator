"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildJobs, METRIC_KEYS, SHORTFALL_KEYS } = require("../batch_run.js");
const { initSim, tick, DEFAULT_PARAMS } = require("../engine.js");
const { readCSV, readResultRows, CSVOutput } = require("../batch_output.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "capability-batch-test-"));
const cli = path.resolve(__dirname, "../batch_run.js");
const config = {
  mode: "grid", replicates: 3, horizon: 12, recordAt: [1, 6, 12], seed: 7,
  pairWithBaseline: true, baselineParams: { recruitmentShockYears: 0 },
  fixed: { N: 24, M: 4, aiDampeningAbove: 1, turnoverRate: 0.1,
    recruitmentShockYears: 1, recruitmentFraction: 0.5 },
  params: { aiDampeningBelow: { values: [0.8, 1] } },
};
const configPath = path.join(tmp, "config.json");
fs.writeFileSync(configPath, JSON.stringify(config));
const files = (prefix) => Object.fromEntries(["raw", "summary", "paired"]
  .map((kind) => [kind, path.join(tmp, `${prefix}-${kind}.csv`)]));
function run(prefix, extra = [], cfg = configPath, heap = 64) {
  const out = files(prefix);
  const result = spawnSync(process.execPath, [`--max-old-space-size=${heap}`, cli,
    "--config", cfg, "--out", out.raw, "--summary-out", out.summary,
    "--shortfall-out", out.paired, ...extra], { encoding: "utf8", timeout: 120000 });
  return { ...out, ...result };
}
async function records(file) {
  const result = [];
  for await (const row of readResultRows(file, DEFAULT_PARAMS, METRIC_KEYS)) result.push(row);
  return result;
}
async function genericRows(file) {
  let header;
  const result = [];
  for await (const row of readCSV(file)) {
    if (!header) header = row;
    else result.push(Object.fromEntries(header.map((key, i) => [key, row[i]])));
  }
  return result;
}
const key = (r) => `${r.comboIndex}|${r.replicate}|${r.arm}|${r.t}`;
const sorted = (rows) => rows.sort((a, b) => key(a).localeCompare(key(b)));
function close(actual, expected, label) {
  if (expected == null) assert.equal(actual, "", label);
  else assert.ok(Math.abs(Number(actual) - expected) <= 1e-12 * Math.max(1, Math.abs(expected)),
    `${label}: ${actual} != ${expected}`);
}

async function main() {
  const sequential = run("sequential", ["--workers", "1"]);
  assert.equal(sequential.status, 0, sequential.stderr);
  const parallel = run("parallel", ["--workers", "2"]);
  assert.equal(parallel.status, 0, parallel.stderr);
  const rows = await records(sequential.raw);
  assert.deepEqual(sorted(await records(parallel.raw)), sorted(rows));

  // Check simulation values against direct engine runs, independently of the writer.
  const expected = new Map();
  for (const job of buildJobs(config).jobs) {
    const sim = initSim({ ...job.params, seed: job.seed });
    for (let t = 1; t <= config.horizon; t++) {
      const entry = tick(sim);
      if (config.recordAt.includes(t)) expected.set(key({ ...job, t }), entry);
    }
  }
  assert.equal(rows.length, expected.size);
  for (const row of rows) for (const metric of METRIC_KEYS) {
    assert.equal(row[metric], expected.get(key(row))[metric], metric);
  }

  // Independent two-pass sample variance calculation, including null AI metrics.
  const groups = new Map();
  for (const row of rows) {
    const k = `${row.comboIndex}|${row.arm}|${row.t}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  const summaries = await genericRows(sequential.summary);
  assert.equal(summaries.length, groups.size);
  for (const summary of summaries) {
    const group = groups.get(`${summary.comboIndex}|${summary.arm}|${summary.t}`);
    assert.equal(Number(summary.n), group.length);
    for (const metric of METRIC_KEYS) {
      const vals = group.map((r) => r[metric]).filter((v) => v != null);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const std = vals.length ? Math.sqrt(vals.length > 1
        ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1) : 0) : null;
      close(summary[metric + "_mean"], mean, metric + " mean");
      close(summary[metric + "_std"], std, metric + " std");
    }
  }
  const rawMap = new Map(rows.map((r) => [key(r), r]));
  const pairs = await genericRows(sequential.paired);
  assert.equal(pairs.length, rows.length / 2);
  for (const row of pairs) for (const metric of SHORTFALL_KEYS) {
    const baseline = rawMap.get(key({ ...row, arm: "baseline" }));
    const treatment = rawMap.get(key({ ...row, arm: "treatment" }));
    close(row[metric + "_baseline"], baseline[metric], metric + " baseline");
    close(row[metric + "_treatment"], treatment[metric], metric + " treatment");
    close(row[metric + "_change"], treatment[metric] - baseline[metric], metric + " change");
  }
  assert.deepEqual(sorted(await genericRows(parallel.paired)), sorted(pairs));
  console.log("ok: sequential/parallel runs retain engine results, paired signs, means and sample deviations");

  const rawBefore = fs.readFileSync(sequential.raw);
  const recovered = run("recovery", ["--from-results", sequential.raw]);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(fs.readFileSync(sequential.raw), rawBefore);
  assert.equal(fs.existsSync(recovered.raw), false);
  assert.deepEqual(sorted(await genericRows(recovered.summary)), sorted(summaries));
  assert.deepEqual(sorted(await genericRows(recovered.paired)), sorted(pairs));

  // Recovery accepts out-of-order results but refuses missing/duplicate/config-mismatched rows.
  const lines = rawBefore.toString().trimEnd().split("\n");
  const reversed = path.join(tmp, "reversed.csv");
  fs.writeFileSync(reversed, [lines[0], ...lines.slice(1).reverse()].join("\n") + "\n");
  const reverseRun = run("reverse", ["--from-results", reversed]);
  assert.equal(reverseRun.status, 0, reverseRun.stderr);
  assert.deepEqual(sorted(await genericRows(reverseRun.paired)), sorted(pairs));
  for (const [name, content, error] of [
    ["missing", lines.slice(0, -1).join("\n") + "\n", /incomplete results/],
    ["duplicate", [lines[0], lines[1], ...lines.slice(1)].join("\n") + "\n", /duplicate result/],
    ["truncated", lines.slice(0, -1).join("\n") + "\n1,2", /malformed results CSV/],
  ]) {
    const input = path.join(tmp, name + ".csv");
    fs.writeFileSync(input, content);
    const output = files(name);
    fs.writeFileSync(output.summary, "previous summary");
    fs.writeFileSync(output.paired, "previous comparison");
    const attempt = run(name, ["--from-results", input]);
    assert.notEqual(attempt.status, 0);
    assert.match(attempt.stderr, error);
    assert.equal(fs.readFileSync(output.summary, "utf8"), "previous summary");
    assert.equal(fs.readFileSync(output.paired, "utf8"), "previous comparison");
    assert.equal(fs.existsSync(output.paired + ".part"), false);
  }
  const changed = path.join(tmp, "changed.json");
  fs.writeFileSync(changed, JSON.stringify({ ...config, fixed: { ...config.fixed, N: 25 } }));
  assert.match(run("changed", ["--from-results", sequential.raw], changed).stderr, /parameter N does not match/);
  console.log("ok: recovery preserves inputs, validates completeness and rejects mismatched data atomically");

  const singleConfig = path.join(tmp, "single.json");
  fs.writeFileSync(singleConfig, JSON.stringify({ horizon: 4, replicates: 1, fixed: { N: 12, M: 3 } }));
  const single = run("single", ["--workers", "1", "--no-raw"], singleConfig);
  assert.equal(single.status, 0, single.stderr);
  assert.equal(fs.existsSync(single.raw), false);
  assert.equal(fs.existsSync(single.paired), false);
  assert.equal((await genericRows(single.summary))[0].meanE_std, "0");

  const badConfig = path.join(tmp, "bad.json");
  fs.writeFileSync(badConfig, JSON.stringify({ horizon: 4, replicates: 2,
    fixed: { N: 12, graphSource: "worldModel" } }));
  const failedWorker = run("failed-worker", ["--workers", "2"], badConfig);
  assert.notEqual(failedWorker.status, 0);
  assert.match(failedWorker.stderr, /needs config.worldModel/);
  assert.equal(fs.existsSync(failedWorker.summary), false);
  assert.equal(fs.existsSync(failedWorker.summary + ".part"), false);
  assert.match(run("missing-value", ["--from-results"]).stderr, /needs a value/);
  const inputCollision = run("collision", ["--from-results", sequential.raw, "--summary-out", sequential.raw]);
  assert.match(inputCollision.stderr, /must not overwrite/);
  assert.deepEqual(fs.readFileSync(sequential.raw), rawBefore);

  const quotedFile = path.join(tmp, "quoted.csv");
  const writer = new CSVOutput(quotedFile);
  const value = 'comma, quote " and\r\nnewline ' + "é".repeat(40000);
  await writer.write({ name: value, number: 2 });
  await writer.close(); await writer.publish();
  assert.equal((await genericRows(quotedFile))[0].name, value);
  console.log("ok: single runs, disabled outputs and quoted CSV records");

  // The original runner retained all 76,800 rows. This fixture exceeds a 64 MB
  // heap in that implementation while streaming completes within the same limit.
  const stressConfig = path.join(tmp, "stress.json");
  fs.writeFileSync(stressConfig, JSON.stringify({ horizon: 120,
    recordAt: Array.from({ length: 120 }, (_, i) => i + 1), replicates: 4,
    pairWithBaseline: true, fixed: { N: 8, M: 4 },
    params: { aiDampeningBelow: { range: [0, 2], steps: 80 } } }));
  const stress = run("stress", ["--workers", "2"], stressConfig);
  assert.equal(stress.status, 0, stress.stderr);
  assert.match(stress.stderr, /76800 rows processed/);
  const stressRecovery = run("stress-recovery", ["--from-results", stress.raw], stressConfig);
  assert.equal(stressRecovery.status, 0, stressRecovery.stderr);
  assert.deepEqual(fs.readFileSync(stressRecovery.summary), fs.readFileSync(stress.summary));
  assert.deepEqual(fs.readFileSync(stressRecovery.paired), fs.readFileSync(stress.paired));
  console.log("ok: simulation and recovery complete 76,800 rows under a 64 MB heap limit");
}

main().then(() => console.log("ALL BATCH CHECKS PASSED"))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
