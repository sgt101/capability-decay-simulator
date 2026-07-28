const { initSim, tick, generateBAGraph, mulberry32, DEFAULT_PARAMS } = require("./engine.js");

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
}

function summarize(state) {
  const last = state.history[state.history.length - 1];
  let nanE = false, nanC = false;
  for (let i = 0; i < state.N; i++) {
    if (Number.isNaN(state.E[i])) nanE = true;
    if (Number.isNaN(state.C[i])) nanC = true;
    if (state.E[i] < 0 || state.E[i] > 1) nanE = true;
    if (state.C[i] < 0 || state.C[i] > 1) nanC = true;
  }
  return { last, nanE, nanC };
}

// --- 1. Baseline (AI off) ---
{
  const s = initSim({ seed: 42 });
  for (let k = 0; k < 200; k++) tick(s);
  const { last, nanE, nanC } = summarize(s);
  assert(!nanE && !nanC, "baseline: no NaN / out-of-range E or C");
  assert(s.N === 500, "baseline: population conserved at N");
  console.log("baseline meanE:", last.meanE.toFixed(4), "meanC:", last.meanC.toFixed(4), "gap:", last.gap.toFixed(4), "divergence:", last.divergence.toFixed(5));
  assert(Math.abs(last.gap) < 1e-6, "baseline: brittleness gap is ~0 when AI is off");
}

// --- 2. AI on, floor mode ---
{
  const s = initSim({ seed: 42, aiEnabled: true, aiResponseMode: "floor", aiLevelFraction: 0.7 });
  for (let k = 0; k < 200; k++) tick(s);
  const { last, nanE, nanC } = summarize(s);
  assert(!nanE && !nanC, "AI floor: no NaN / out-of-range");
  console.log("AI floor meanE:", last.meanE.toFixed(4), "meanC:", last.meanC.toFixed(4), "gap:", last.gap.toFixed(4), "aiLevel:", last.aiLevel.toFixed(4));
  assert(last.gap > 0, "AI floor: brittleness gap opens up (C > E on average)");
  // Structural, not empirical: aiLevel = aiLevelFraction * state.startTopE, and
  // aiLevelFraction is defined to run at most 1.0 (100% of the t=0 top performer), so
  // aiLevel can never exceed the fixed t=0 top performer itself. The live/current top
  // performer (last.topE) isn't guaranteed to stay above it though — unlike under the
  // old median-anchored formula, aiLevel now starts close to the population's ceiling,
  // so this is a much tighter benchmark than before.
  assert(last.aiLevel <= s.startTopE + 1e-6, "AI floor: ai_level never exceeds the fixed t=0 top performer it's a fraction of");
}

// --- 2b. ai_level is FIXED for the whole run, derived once from the t=0 population's
//     single highest performer — not recomputed from the (moving) current top
//     performer every tick. ---
{
  const s = initSim({ seed: 8, N: 500, aiEnabled: true, aiLevelFraction: 0.7 });
  const levelAt1 = tick(s).aiLevel;
  for (let k = 0; k < 199; k++) tick(s);
  const levelAt200 = s.history[s.history.length - 1].aiLevel;
  console.log(`ai_level fixedness: t=1 aiLevel=${levelAt1.toFixed(4)}  t=200 aiLevel=${levelAt200.toFixed(4)}  startTopE=${s.startTopE.toFixed(4)}`);
  assert(Math.abs(levelAt1 - levelAt200) < 1e-6, "ai_level: stays fixed across ticks (derived from the t=0 top performer, not the moving one)");
  assert(Math.abs(levelAt1 - 0.7 * s.startTopE) < 1e-6, "ai_level: equals aiLevelFraction * state.startTopE exactly");
}

// --- 3. All five AI response modes run without diverging ---
for (const mode of ["floor", "flat", "linear", "amplified", "exponential"]) {
  const s = initSim({ seed: 7, aiEnabled: true, aiResponseMode: mode, aiGain: 1.0 });
  for (let k = 0; k < 150; k++) tick(s);
  const { last, nanE, nanC } = summarize(s);
  assert(!nanE && !nanC, `AI mode ${mode}: no NaN / out-of-range`);
  console.log(`mode=${mode} meanE=${last.meanE.toFixed(4)} meanC=${last.meanC.toFixed(4)} gap=${last.gap.toFixed(4)}`);
}

// --- 4. Mobility modes ---
for (const mode of ["unconstrained", "edge_constrained", "hybrid"]) {
  const s = initSim({ seed: 3, mobilityMode: mode });
  for (let k = 0; k < 100; k++) tick(s);
  const { nanE, nanC } = summarize(s);
  assert(!nanE && !nanC, `mobility mode ${mode}: no NaN / out-of-range`);
}

// --- 5. Small / edge-case scale ---
{
  const s = initSim({ seed: 9, N: 20, M: 4, graphAttachment: 2 });
  for (let k = 0; k < 50; k++) tick(s);
  const { nanE, nanC } = summarize(s);
  assert(!nanE && !nanC, "tiny scale (N=20, M=4): no NaN / out-of-range");
  assert(s.N === 20, "tiny scale: population conserved");
}

// --- 6. Large-ish scale for perf sanity (unconstrained candidate cap matters here) ---
{
  const s = initSim({ seed: 11, N: 2000, M: 300, mobilityMode: "unconstrained" });
  const t0 = Date.now();
  for (let k = 0; k < 50; k++) tick(s);
  const ms = Date.now() - t0;
  const { nanE, nanC } = summarize(s);
  assert(!nanE && !nanC, "large scale unconstrained: no NaN / out-of-range");
  console.log(`large scale (N=2000,M=300) 50 ticks in ${ms}ms`);
  assert(ms < 5000, "large scale: 50 ticks complete in reasonable time (<5s)");
}

// --- 7. Hub emergence: BA graph should have a skewed degree distribution ---
{
  const rng = mulberry32(5);
  const g = generateBAGraph(60, 2, rng);
  const degrees = Array.from(g.degree).sort((a, b) => b - a);
  console.log("top 5 degrees:", degrees.slice(0, 5), "median degree:", degrees[30]);
  assert(degrees[0] > degrees[30] * 1.5, "BA graph: top institution has notably higher degree than median (hub formation)");
}

// --- 8. Expertise distribution shape: rare naivety near 0 ---
{
  const s = initSim({ seed: 21, N: 5000 });
  let below01 = 0, above06 = 0;
  for (let i = 0; i < s.N; i++) { if (s.E[i] < 0.1) below01++; if (s.E[i] > 0.6) above06++; }
  console.log(`init distribution: <0.1 = ${below01} (${(100*below01/s.N).toFixed(1)}%), >0.6 = ${above06} (${(100*above06/s.N).toFixed(1)}%)`);
  assert(below01 / s.N < 0.05, "init distribution: total naivety (E<0.1) is rare (<5%)");
}

// --- 9. Long-run trajectory sanity (does mean E collapse or stabilize?) ---
{
  const s = initSim({ seed: 55 });
  const marks = [0, 50, 100, 200, 400];
  for (let k = 1; k <= 400; k++) {
    tick(s);
    if (marks.includes(k)) console.log(`t=${k} meanE=${s.history[k-1].meanE.toFixed(4)} divergence=${s.history[k-1].divergence.toFixed(5)}`);
  }
}

// --- 10. Atrophy is isolated from learning suppression: with dampeningBelow=1 (no
//     learning penalty) but an elevated atrophy multiplier, meanE should still fall
//     below its own starting value — i.e. AI actively erodes expertise on its own,
//     not merely as a side effect of slower learning. ---
{
  const s = initSim({
    seed: 13, N: 800, aiEnabled: true, aiLevelFraction: 0.9,
    aiDampeningBelow: 1.0, aiDampeningAbove: 1.0, aiAtrophyMultiplier: 4.0,
    transferRate: 0.02, // deliberately weak — isolates atrophy from the (now much
    // stronger default) learning rate, which would otherwise swamp a 300-tick window
  });
  const meanE0 = s.history.length ? s.history[0].meanE : (() => { let sum = 0; for (let i = 0; i < s.N; i++) sum += s.E[i]; return sum / s.N; })();
  for (let k = 0; k < 300; k++) tick(s);
  const last = s.history[s.history.length - 1];
  console.log(`atrophy isolation: meanE0=${meanE0.toFixed(4)} -> meanE(300)=${last.meanE.toFixed(4)}`);
  assert(last.meanE < meanE0, "atrophy isolation: meanE actually declines below its starting value under pure atrophy (no learning dampening)");
}

// --- 11. Paired baseline-vs-AI comparison, same seed: AI (default atrophy 1.5)
//     should leave the population with strictly less real expertise than the
//     no-AI counterfactual, and that shortfall should widen, not shrink, over time. ---
{
  const params = { seed: 99, N: 600, M: 40 };
  const base = initSim(Object.assign({}, params, { aiEnabled: false }));
  const treat = initSim(Object.assign({}, params, { aiEnabled: true }));
  const checkpoints = [100, 300, 600];
  const shortfalls = [];
  for (let k = 1; k <= 600; k++) {
    tick(base); tick(treat);
    if (checkpoints.includes(k)) {
      const b = base.history[k - 1].meanE, t = treat.history[k - 1].meanE;
      shortfalls.push(b - t);
      console.log(`t=${k} meanE_baseline=${b.toFixed(4)} meanE_AI=${t.toFixed(4)} shortfall=${(b - t).toFixed(4)} shareExpert_baseline=${base.history[k-1].shareExpert.toFixed(3)} shareExpert_AI=${treat.history[k-1].shareExpert.toFixed(3)}`);
    }
  }
  assert(shortfalls[shortfalls.length - 1] > 0, "paired comparison: AI leaves strictly less real expertise than the no-AI baseline at t=600");
  assert(shortfalls[2] >= shortfalls[0], "paired comparison: the expertise shortfall widens (or holds), not shrinks, from t=100 to t=600");
}

// --- 12. Entrants are genuine novices, distinct from the t=0 population ---
//     Zero out transfer/decay so E can only change via turnover replacement, not
//     learning drift — isolates the sampling distribution itself. Run long enough
//     that most of the population has been replaced at least once, and confirm the
//     survivors cluster near entrantExpertiseMean, not the (much higher) expertiseMean.
{
  const s = initSim({ seed: 17, N: 3000, turnoverRate: 0.05, entrantExpertiseMean: 0.05, entrantExpertiseSpread: 0.05, expertiseMean: 0.28, transferRate: 0, decayRate: 0 });
  for (let k = 0; k < 200; k++) tick(s); // 1-(1-0.05)^200 ~= 99.997% turned over at least once
  let sum = 0; for (let i = 0; i < s.N; i++) sum += s.E[i];
  const mean = sum / s.N;
  console.log(`entrant distribution after heavy turnover: meanE=${mean.toFixed(4)} (entrantExpertiseMean=0.05, old expertiseMean=0.28)`);
  assert(mean < 0.15, "entrants: population mean after heavy turnover is close to entrantExpertiseMean, not the old t=0 expertiseMean");
}

// --- 13. The core requested behavior: with transfer fast enough for novices to
//     genuinely become expert (the new default), a no-AI system self-renews into a
//     healthy, sustained expert population, while AI dampening cuts off the pipeline
//     entirely — shareExpert should collapse to ~0 and stay there, not just dip. ---
{
  const params = { seed: 42, N: 1500, M: 75, turnoverRate: 0.01, transferRate: DEFAULT_PARAMS.transferRate };
  const base = initSim(Object.assign({}, params, { aiEnabled: false }));
  const treat = initSim(Object.assign({}, params, { aiEnabled: true }));
  for (let k = 0; k < 1500; k++) { tick(base); tick(treat); }
  const b = base.history[1499], t = treat.history[1499];
  console.log(`self-renewal test: shareExpert_baseline=${b.shareExpert.toFixed(3)} shareExpert_treatment=${t.shareExpert.toFixed(3)} meanE_baseline=${b.meanE.toFixed(3)} meanE_treatment=${t.meanE.toFixed(3)}`);
  assert(b.shareExpert > 0.7, "self-renewal: no-AI baseline sustains a genuinely expert population (shareExpert > 0.7)");
  assert(t.shareExpert < 0.05, "self-renewal: AI-dampened treatment's expert pipeline collapses (shareExpert < 0.05)");
  assert(b.meanE - t.meanE > 0.3, "self-renewal: the baseline/treatment gap is large, not a marginal difference");
}

// --- 14. Ambient growth: humans at/above their institution's founding average no
//     longer purely decay — being embedded in a strong institution should let them
//     net-improve, not just decay slower. Isolate by zeroing decayRate/transferRate/
//     turnoverRate/baseMoveProb (each would otherwise move institution averages or
//     population composition on their own, confounding the comparison) and comparing
//     ambientGrowthRate=0 against >0: with it off, an above-average population sits
//     flat; with it on, it rises. The strong-vs-weak-institution comparison holds each
//     individual's own E and L fixed (same seed, so identical random draws in both
//     runs) and varies ONLY state.startEbar after init — isolating the institution's
//     founding-strength effect from the (1-E) headroom confound a natural population
//     comparison would introduce (a uniformly higher-E population has fundamentally
//     less room left to grow, which would understate the effect being tested).
{
  function aboveAvgDrift(ambientGrowthRate, startEbarOverride) {
    const s = initSim({
      seed: 31, N: 1000, M: 20, expertiseMean: 0.5, expertiseSpread: 0.05, expertiseSkew: 0,
      transferRate: 0, decayRate: 0, turnoverRate: 0, baseMoveProb: 0,
      ambientGrowthRate, aiEnabled: false,
    });
    if (startEbarOverride != null) s.startEbar.fill(startEbarOverride);
    const before = Array.from(s.E);
    for (let k = 0; k < 100; k++) tick(s);
    let sumBefore = 0, sumAfter = 0, n = 0;
    for (let i = 0; i < s.N; i++) { sumBefore += before[i]; sumAfter += s.E[i]; n++; }
    return (sumAfter - sumBefore) / n;
  }
  const driftOff = aboveAvgDrift(0, null);
  const driftOnWeak = aboveAvgDrift(0.01, 0.3);
  const driftOnStrong = aboveAvgDrift(0.01, 0.9);
  console.log(`ambient growth drift: off=${driftOff.toFixed(5)}  on(weak founding avg=0.3)=${driftOnWeak.toFixed(5)}  on(strong founding avg=0.9)=${driftOnStrong.toFixed(5)}`);
  assert(Math.abs(driftOff) < 1e-6, "ambient growth: with rate=0, an above-average population sits flat (no residual drift)");
  assert(driftOnWeak > 0, "ambient growth: with rate>0, an above-average population still improves even in a weaker institution");
  assert(driftOnStrong > driftOnWeak, "ambient growth: holding individual E/L fixed, a stronger founding institution average produces more growth");
}

console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
