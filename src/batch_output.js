"use strict";
const fs = require("fs");
const path = require("path");
const { once } = require("events");
const { finished } = require("stream/promises");

function csvEscape(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// A bounded write buffer, with the final name published only after validation.
class CSVOutput {
  constructor(file) {
    this.file = file;
    this.tmp = file + ".part";
    this.columns = null;
    this.count = 0;
    this.stream = fs.createWriteStream(this.tmp);
    // Keep asynchronous open/write errors handled even between writes.
    this.done = finished(this.stream);
    this.done.catch(() => {});
    this.stream.on("error", (error) => { this.error = error; });
  }
  async text(value) {
    if (this.error) throw this.error;
    if (!this.stream.write(value)) await once(this.stream, "drain");
  }
  async write(row) {
    if (!this.columns) {
      this.columns = Object.keys(row);
      await this.text(this.columns.map(csvEscape).join(",") + "\n");
    }
    await this.text(this.columns.map((key) => csvEscape(row[key])).join(",") + "\n");
    this.count++;
  }
  async close() {
    this.stream.end();
    await this.done;
  }
  async publish() { await fs.promises.rename(this.tmp, this.file); }
  async abort() {
    this.stream.destroy();
    await this.done.catch(() => {});
    await fs.promises.rm(this.tmp, { force: true });
  }
}

// CSV records can contain quoted commas, quotes, or newlines. Parse incrementally
// rather than reading/splitting the whole file, including during crash recovery.
async function* readCSV(file) {
  let row = [], field = "", quoted = false, afterQuote = false, skipLF = false;
  let started = false;
  for await (const chunk of fs.createReadStream(file, { encoding: "utf8" })) {
    for (const char of chunk) {
      if (skipLF) { skipLF = false; if (char === "\n") continue; }
      if (quoted) {
        if (char === '"') { quoted = false; afterQuote = true; }
        else field += char;
        continue;
      }
      if (afterQuote && char === '"') {
        field += '"'; quoted = true; afterQuote = false; continue;
      }
      if (char === ",") {
        row.push(field); field = ""; afterQuote = false; started = true;
      } else if (char === "\n" || char === "\r") {
        row.push(field); yield row;
        row = []; field = ""; afterQuote = false; started = false;
        skipLF = char === "\r";
      } else if (char === '"' && field === "" && !afterQuote) {
        quoted = true; started = true;
      } else {
        if (afterQuote || char === '"') throw new Error("malformed quoted CSV field");
        field += char; started = true;
      }
    }
  }
  if (quoted) throw new Error("truncated CSV: unterminated quoted field");
  if (started || row.length || afterQuote) { row.push(field); yield row; }
}

async function* readResultRows(file, defaults, metricKeys) {
  let columns;
  const numeric = new Set([...metricKeys, "comboIndex", "replicate", "seed", "t"]);
  for (const [key, value] of Object.entries(defaults)) if (typeof value === "number") numeric.add(key);
  for await (const values of readCSV(file)) {
    if (!columns) {
      columns = values;
      if (new Set(columns).size !== columns.length) throw new Error("duplicate CSV column");
      for (const key of ["comboIndex", "replicate", "seed", "arm", "t", ...metricKeys]) {
        if (!columns.includes(key)) throw new Error(`results CSV is missing column ${key}`);
      }
      continue;
    }
    if (values.length !== columns.length) throw new Error("truncated or malformed results CSV row");
    const row = {};
    columns.forEach((key, i) => {
      const value = values[i];
      if (numeric.has(key)) {
        row[key] = value === "" ? null : Number(value);
        if (value !== "" && !Number.isFinite(row[key])) throw new Error(`invalid number in ${key}`);
      } else if (typeof defaults[key] === "boolean") {
        if (value !== "true" && value !== "false") throw new Error(`invalid boolean in ${key}`);
        row[key] = value === "true";
      } else row[key] = value;
    });
    yield row;
  }
  if (!columns) throw new Error("results CSV is empty");
}

function jobKey(row) { return `${row.comboIndex}|${row.replicate}|${row.arm || ""}`; }

class BatchOutput {
  constructor({ jobs, replicates, pairWithBaseline, raw, summary, shortfall, metricKeys, shortfallKeys }) {
    this.metricKeys = metricKeys;
    this.shortfallKeys = shortfallKeys;
    this.replicates = replicates;
    this.paired = pairWithBaseline;
    this.jobs = new Map();
    this.expectedRows = 0;
    const tickMaps = new Map();
    for (const job of jobs) {
      let ticks = tickMaps.get(job.recordAt);
      if (!ticks) {
        ticks = new Map(job.recordAt.map((tick, i) => [tick, i]));
        tickMaps.set(job.recordAt, ticks);
      }
      if (ticks.size !== job.recordAt.length) throw new Error("config.recordAt contains duplicate ticks");
      const key = jobKey(job);
      if (this.jobs.has(key)) throw new Error(`duplicate job ${key}`);
      this.jobs.set(key, { job, ticks, seen: new Uint8Array(ticks.size) });
      this.expectedRows += ticks.size;
    }
    const files = [raw, summary, pairWithBaseline && shortfall].filter(Boolean).map((file) => path.resolve(file));
    const allPaths = files.flatMap((file) => [file, file + ".part"]);
    if (new Set(allPaths).size !== allPaths.length) throw new Error("output paths and temporary paths must be distinct");
    this.raw = raw ? new CSVOutput(raw) : null;
    this.summary = summary ? new CSVOutput(summary) : null;
    this.shortfall = pairWithBaseline && shortfall ? new CSVOutput(shortfall) : null;
    this.outputs = [this.raw, this.summary, this.shortfall].filter(Boolean);
    this.groups = new Map();
    this.pairs = new Map();
    this.count = 0;
  }
  async add(row) {
    const expected = this.jobs.get(jobKey(row));
    if (!expected) throw new Error(`results contain an unexpected run: ${jobKey(row)}`);
    const index = expected.ticks.get(row.t);
    if (index === undefined) throw new Error(`unexpected recorded tick ${row.t}`);
    if (expected.seen[index]) throw new Error(`duplicate result: ${jobKey(row)} at t=${row.t}`);
    if (row.seed !== expected.job.seed) throw new Error("results seed does not match the config");
    // On recovery this guards against combining a completed CSV with a changed
    // sweep. Do not infer its historical defaults from today's engine defaults.
    for (const [key, value] of Object.entries(expected.job.params)) {
      if (value != null && typeof value !== "object" && row[key] !== value) {
        throw new Error(`results parameter ${key} does not match the config`);
      }
    }
    expected.seen[index] = 1;
    this.count++;
    if (this.raw) await this.raw.write(row);
    if (this.summary) await this.addSummary(row);
    if (this.shortfall) await this.addPair(row);
  }
  async addSummary(row) {
    const key = `${row.comboIndex}|${row.arm}|${row.t}`;
    let group = this.groups.get(key);
    if (!group) {
      const base = { ...row };
      delete base.seed; delete base.replicate;
      for (const metric of this.metricKeys) delete base[metric];
      group = { base, count: 0, n: new Uint32Array(this.metricKeys.length),
        mean: new Float64Array(this.metricKeys.length), m2: new Float64Array(this.metricKeys.length) };
      this.groups.set(key, group);
    }
    group.count++;
    // Online sample mean/variance: no per-replicate row arrays or copies.
    this.metricKeys.forEach((metric, i) => {
      const value = row[metric];
      if (value == null) return;
      const delta = value - group.mean[i];
      group.mean[i] += delta / ++group.n[i];
      group.m2[i] += delta * (value - group.mean[i]);
    });
    if (group.count === this.replicates) {
      this.metricKeys.forEach((metric, i) => {
        group.base[metric + "_mean"] = group.n[i] ? group.mean[i] : null;
        group.base[metric + "_std"] = group.n[i]
          ? Math.sqrt(Math.max(0, group.n[i] > 1 ? group.m2[i] / (group.n[i] - 1) : 0)) : null;
      });
      group.base.n = group.count;
      await this.summary.write(group.base);
      this.groups.delete(key);
    }
  }
  async addPair(row) {
    const key = `${row.comboIndex}|${row.replicate}|${row.t}`;
    const other = this.pairs.get(key);
    if (!other) { this.pairs.set(key, row); return; }
    const baseline = row.arm === "baseline" ? row : other;
    const treatment = row.arm === "treatment" ? row : other;
    const base = { ...treatment };
    delete base.seed; delete base.arm; delete base.aiEnabled;
    for (const metric of this.metricKeys) delete base[metric];
    for (const metric of this.shortfallKeys) {
      base[metric + "_baseline"] = baseline[metric];
      base[metric + "_treatment"] = treatment[metric];
      base[metric + "_change"] = treatment[metric] - baseline[metric];
    }
    await this.shortfall.write(base);
    this.pairs.delete(key);
  }
  async finish() {
    if (this.count !== this.expectedRows || this.groups.size || this.pairs.size) {
      throw new Error(`incomplete results: received ${this.count} of ${this.expectedRows} expected rows`);
    }
    await Promise.all(this.outputs.map((output) => output.close()));
    // Shortfall remains last: the shell runners use its presence as completion.
    for (const output of this.outputs) await output.publish();
  }
  async abort() { await Promise.all(this.outputs.map((output) => output.abort())); }
}

module.exports = { BatchOutput, CSVOutput, readCSV, readResultRows };
