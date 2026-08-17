const { initSim, tick, generateBAGraph, mulberry32, DEFAULT_PARAMS } = require("./engine.js");

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:", msg);
}

function summarize(state) {
  const last = state.history[state.history.length - 1];
  let nanE = false;
  for (let i = 0; i < state.N; i++) {
    if (Number.isNaN(state.E[i])) nanE = true;
    if (state.E[i] < 0 || state.E[i] > 1) nanE = true;
  }
  return { last, nanE };
}

// --- 1. Baseline (AI off) ---
{
  const s = initSim({ seed: 42 });
  for (let k = 0; k < 200; k++) tick(s);
  const { last, nanE } = summarize(s);
  assert(!nanE, "baseline: no NaN / out-of-range E");
  assert(s.N === 500, "baseline: population conserved at N");
  console.log("baseline meanE:", last.meanE.toFixed(4), "divergence:", last.divergence.toFixed(5));
  assert(!("meanC" in last) && !("gap" in last),
    "the observed-capability channel is gone: no meanC, no illusion gap (removed 2026-08)");
}

// --- 2. AI on, floor mode ---
{
  const s = initSim({ seed: 42, aiEnabled: true, aiLevelFraction: 0.7 });
  for (let k = 0; k < 200; k++) tick(s);
  const { last, nanE } = summarize(s);
  assert(!nanE, "AI on: no NaN / out-of-range");
  console.log("AI on meanE:", last.meanE.toFixed(4), "aiLevel:", last.aiLevel.toFixed(4));
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

// --- 3. (removed) The five AI response modes shaped observed capability C, which
//     was deleted in 2026-08 along with aiGain and aiResponseMode. Nothing replaces
//     this section: with no C there is no boost shape to exercise.

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
    aiDampeningBelow: 1.0, aiDampeningAbove: 1.0,
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
//     personalLearningRate=0 against >0: with it off, an above-average population sits
//     flat; with it on, it rises. The strong-vs-weak-institution comparison holds each
//     individual's own E and L fixed (same seed, so identical random draws in both
//     runs) and varies ONLY state.startEbar after init — isolating the institution's
//     founding-strength effect from the (1-E) headroom confound a natural population
//     comparison would introduce (a uniformly higher-E population has fundamentally
//     less room left to grow, which would understate the effect being tested).
{
  function aboveAvgDrift(personalLearningRate, startEbarOverride) {
    const s = initSim({
      seed: 31, N: 1000, M: 20, expertiseMean: 0.5, expertiseSpread: 0.05, expertiseSkew: 0,
      transferRate: 0, decayRate: 0, turnoverRate: 0, baseMoveProb: 0,
      personalLearningRate, aiEnabled: false,
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
  console.log(`personal learning drift: off=${driftOff.toFixed(5)}  on(weak founding avg=0.3)=${driftOnWeak.toFixed(5)}  on(strong founding avg=0.9)=${driftOnStrong.toFixed(5)}`);
  assert(Math.abs(driftOff) < 1e-6, "personal learning: with rate=0, an above-average population sits flat (no residual drift)");
  assert(driftOnWeak > 0, "personal learning: with rate>0, an above-average population still improves even in a weaker institution");
  assert(driftOnStrong > driftOnWeak, "personal learning: holding individual E/L fixed, a stronger founding institution average produces more growth");
}


// --- entrant pipeline (learningCap + seniorTenureYears) --------------------
console.log("\n--- entrant pipeline ---");
{
  const { PIPELINE_PARAMS, MONTHLY_TICK_PARAMS, EXPERT_THRESHOLD } = require("./engine.js");
  const base = { N: 800, M: 40, seed: 7 };

  // OFF by default: every archived result was produced without this, so an untouched
  // config must be bit-for-bit what it always was.
  const plain = initSim(base);
  assert(plain.params.learningCap === 0, "learningCap defaults to 0 (off)");
  assert(plain.params.seniorTenureYears === 0, "seniorTenureYears defaults to 0 (off)");
  const traceOf = (extra) => {
    const s = initSim(Object.assign({}, base, extra));
    for (let i = 0; i < 200; i++) tick(s);
    return s.history.map((h) => h.meanE.toFixed(12)).join(",");
  };
  assert(traceOf({}) === traceOf({ learningCap: 0, seniorTenureYears: 0 }),
    "explicitly setting both to 0 is identical to omitting them");

  // Tenure must come from its own RNG stream — drawing it from the main one would
  // shift every downstream value and silently change every existing result.
  assert(traceOf({ seniorTenureYears: 8 }) !== traceOf({}),
    "turning the mechanism on does change the dynamics (sanity: it is wired up)");
  const s0 = initSim(base), s1 = initSim(Object.assign({}, base, { seniorTenureYears: 8 }));
  let sameE = true;
  for (let i = 0; i < s0.N; i++) if (s0.E[i] !== s1.E[i]) { sameE = false; break; }
  assert(sameE, "the starting population is identical with and without the mechanism (tenure uses a separate stream)");

  // Tenure ages and resets on turnover.
  const t0 = initSim(Object.assign({}, base, { turnoverRate: 0 }));
  const before = t0.tenure[0];
  tick(t0);
  assert(t0.tenure[0] === before + 1, "tenure advances one month per tick");

  // The pipeline produces a LADDER, which is the whole point: a spread population
  // with a real share still below the expert threshold.
  const pipe = initSim(Object.assign({ N: 2000, M: 40, seed: 3 }, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS));
  for (let i = 0; i < 600; i++) tick(pipe);
  const sorted = Array.from(pipe.E).sort((a, b) => a - b);
  const spread = sorted[Math.floor(0.9 * sorted.length)] - sorted[Math.floor(0.1 * sorted.length)];
  const below = sorted.filter((e) => e < EXPERT_THRESHOLD).length / sorted.length;
  assert(spread > 0.15, `PIPELINE_PARAMS gives a spread population (p10-p90 ${spread.toFixed(3)} > 0.15)`);
  assert(below > 0.10, `a real share is still climbing (${(below * 100).toFixed(0)}% below expert > 10%)`);

  // What now carries the post-training spread. Per-person teacher assignment was
  // removed in 2026-08 after it measured inert against the shipped configuration, so
  // aptitude ceilings are the mechanism that separates one veteran from another.
  const shape = (extra) => {
    const st = initSim(Object.assign({ N: 1500, M: 40, seed: 3 }, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, extra));
    for (let i = 0; i < 1200; i++) tick(st);
    const arr = Array.from(st.E).sort((a, b) => a - b);
    return { iqr: arr[Math.floor(0.75 * arr.length)] - arr[Math.floor(0.25 * arr.length)],
             mean: arr.reduce((a, b) => a + b, 0) / arr.length };
  };
  const shipped = shape({});
  assert(shipped.iqr > 0.15, `the shipped set spreads the body of the distribution (IQR ${shipped.iqr.toFixed(3)} > 0.15)`);
  assert(shape({ aptitudeSpread: 0 }).iqr < shipped.iqr - 0.05,
    `without aptitude ceilings the body compresses (IQR ${shape({ aptitudeSpread: 0 }).iqr.toFixed(3)} vs ${shipped.iqr.toFixed(3)})`);

  // Ceilings must not collect at the boundary. A clipped normal put 10% of them on
  // exactly 1.0, and because most people converge onto their ceiling that atom became
  // a wall of extreme experts in the expertise distribution itself.
  {
    const st = initSim(Object.assign({ N: 4000, M: 40, seed: 2 }, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS));
    const caps = Array.from(st.aptitude);
    const atCeiling = caps.filter((c) => c >= 0.999).length / caps.length;
    assert(atCeiling < 0.005, `aptitude ceilings do not pile up at 1.0 (${(atCeiling * 100).toFixed(2)}% there, was 10% when clipped)`);
    assert(Math.min(...caps) > 0.01, "no ceiling lands at or below zero either");
    for (let i = 0; i < 1500; i++) tick(st);
    // Extreme expertise must be bounded by the CEILING distribution rather than by a
    // clipping artefact — reaching the top has to stay something only some of those
    // capable of it manage. Stated as a ratio, not an absolute share: teachTopN is an
    // absolute count, so how selective it is depends on institution size, and a fixed
    // threshold here would only describe this one scale. (The artefact this test was
    // originally written against — ceilings piling on exactly 1.0 — is asserted
    // directly two lines above.)
    const extreme = Array.from(st.E).filter((e) => e >= 0.85).length / st.N;
    const entitled = Array.from(st.aptitude).filter((a) => a >= 0.85).length / st.N;
    assert(extreme < entitled * 0.7,
      `reaching the top stays selective (${(extreme * 100).toFixed(1)}% at E>=0.85, of ${(entitled * 100).toFixed(1)}% with a ceiling that high)`);
  }

  // No one may be pushed UP past their own ceiling, by any route including ambient
  // growth. Stated as a per-tick invariant rather than as "E <= aptitude at the end":
  // APTITUDE_FLOOR is 0.02 while entrants arrive near 0.05, so a person can be BORN
  // above their ceiling and then decay toward it. That is legitimate — someone whose
  // potential sits below where they started — and an end-state comparison scores it as
  // a breach. What must never happen is expertise RISING at or above the ceiling.
  {
    const st = initSim(Object.assign({ N: 600, M: 20, seed: 11 }, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS));
    for (let i = 0; i < 1500; i++) tick(st);
    const before = Float32Array.from(st.E);
    let worstRise = 0;
    for (let k = 0; k < 200; k++) {
      before.set(st.E);
      tick(st);
      for (let i = 0; i < st.N; i++) {
        if (before[i] >= st.aptitude[i]) worstRise = Math.max(worstRise, st.E[i] - before[i]);
      }
    }
    assert(worstRise <= 1e-6,
      `nobody at or above their ceiling ever gains expertise (largest rise ${worstRise.toExponential(1)})`);
  }

  // Without the senior target, the same cap collapses the field instead — the failure
  // mode the tenure rule exists to prevent.
  const capOnly = initSim(Object.assign({ N: 2000, M: 40, seed: 3 }, MONTHLY_TICK_PARAMS,
    { learningCap: PIPELINE_PARAMS.learningCap, decayRate: PIPELINE_PARAMS.decayRate }));
  let m;
  for (let i = 0; i < 600; i++) m = tick(capOnly);
  const withSeniors = pipe.history[pipe.history.length - 1].meanE;
  assert(m.meanE < withSeniors - 0.1,
    `a cap without the senior target collapses the field (${m.meanE.toFixed(3)} vs ${withSeniors.toFixed(3)})`);
}

console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");