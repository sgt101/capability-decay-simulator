// Capability Decay Simulator — engine (framework-agnostic, testable under Node)
//
// SCOPE: wrapped in an IIFE so this file publishes EXACTLY ONE name — module.exports
// under Node, globalThis.Engine in a browser. simulator.html loads it with
// <script src>, and two classic scripts share ONE global lexical scope: anything
// declared at top level here would collide with an identically-named declaration in
// the page and throw SyntaxError before either script ran. That is precisely what
// broke the page in 2026-08 (seven collisions, starting at the RNG). The body below
// is deliberately NOT re-indented — the wrapper is a scope boundary, not a reason for
// a whitespace diff over every line in the file.
(function () {

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randNormal(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clip01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// An aptitude ceiling, drawn by REJECTION rather than by clipping. Clipping a normal
// to [0,1] puts an atom at exactly 1.0 — measured, 10% of ceilings landed there, and
// since ~63% of people sit within 0.02 of their own ceiling that atom propagated
// straight into the expertise distribution as a wall of extreme experts. Same artefact
// as the entrant floor's pile-up at exactly 0 (problems.md P19), same fix: don't let
// the boundary collect mass. Resampling gives a truncated normal, whose density tapers
// to the edge instead.
//
// APTITUDE_FLOOR keeps a ceiling from landing below the level entrants arrive at,
// which would strand someone below the entrant floor for their whole career.
const APTITUDE_FLOOR = 0.02;
function drawAptitude(rng, mean, spread) {
  for (let k = 0; k < 64; k++) {
    const v = mean + randNormal(rng) * spread;
    if (v > APTITUDE_FLOOR && v < 1) return v;
  }
  return clip01(mean);      // pathological parameters: fall back rather than loop
}

// HISTORICAL (removed 2026-08): a single signed dial `aiRelianceIntensity` (rho)
// used to drive both halves of de-skilling — aiDampeningBelow = 1 - rho and
// aiAtrophyMultiplier = 5^rho. It was removed because it named three parameters for
// two independent quantities, and because the base 5 was an untested exchange rate
// between the two channels: holding the learning half at rho = 0.5, varying that base
// from 2 to 8 moved meanE_shortfall from 0.213 to 0.346. The two multipliers are now
// always set directly. Don't reintroduce a coupling without measuring its base first.
//
// Old configs are rejected rather than ignored — see initSim().

function sampleSkewNormalClipped(rng, mu, omega, alpha) {
  const x0 = randNormal(rng), x1 = randNormal(rng);
  const delta = alpha / Math.sqrt(1 + alpha * alpha);
  const u1 = delta * x0 + Math.sqrt(1 - delta * delta) * x1;
  const z = x0 >= 0 ? u1 : -u1;
  return clip01(mu + omega * z);
}

function sampleLognormal(rng, sigma) {
  return Math.exp(randNormal(rng) * sigma);
}

// --- Barabasi-Albert sparse graph over institutions ---
function generateBAGraph(M, mAttach, rng) {
  const m = Math.max(1, Math.min(mAttach, M - 1));
  const neighbors = Array.from({ length: M }, () => new Set());
  const degree = new Uint32Array(M);
  const m0 = m + 1;

  for (let a = 0; a < m0; a++) {
    for (let b = a + 1; b < m0; b++) {
      neighbors[a].add(b); neighbors[b].add(a);
      degree[a]++; degree[b]++;
    }
  }
  const repeated = [];
  for (let a = 0; a < m0; a++) for (let k = 0; k < degree[a]; k++) repeated.push(a);

  for (let i = m0; i < M; i++) {
    const targets = new Set();
    let tries = 0;
    while (targets.size < m && tries < 200) {
      tries++;
      const cand = repeated.length ? repeated[Math.floor(rng() * repeated.length)] : Math.floor(rng() * i);
      if (cand !== i && !targets.has(cand)) targets.add(cand);
    }
    while (targets.size < m) { // fallback for tiny graphs
      const cand = Math.floor(rng() * i);
      if (cand !== i) targets.add(cand);
    }
    targets.forEach((t) => {
      neighbors[i].add(t); neighbors[t].add(i);
      degree[i]++; degree[t]++;
      repeated.push(i, t);
    });
  }

  let maxDeg = 1;
  for (let i = 0; i < M; i++) if (degree[i] > maxDeg) maxDeg = degree[i];
  const prestige = new Float32Array(M);
  for (let i = 0; i < M; i++) prestige[i] = degree[i] / maxDeg;

  return { M, neighbors, degree, prestige };
}

// REMOVED 2026-08: the observed-capability channel (C, aiGain, aiResponseMode and the
// AI_MODES boost shapes). C never touched E — it only fed meanC and the illusion gap —
// so with the boost dials gone it carried no information. The model is now purely
// about latent expertise: what people can actually do, and what AI reliance does to it.
// Reinstating the split means restoring C, the modes, and the meanC/gap metrics
// together; half of it is worse than neither.

// Chosen to sit roughly in the middle of the range where the self-renewal/collapse
// contrast reads cleanly (~0.3-0.86) — see expert_threshold_sensitivity.js and the
// "Expert threshold" section in README.md for the empirical check behind this choice.
// (Previously 0.7 — undocumented and close enough to the upper edge of that range
// that it inflated the AI-amplification-regime numbers via a baseline-ceiling
// artifact; 0.585 doesn't have that problem.)
const EXPERT_THRESHOLD = 0.585;

// --- capability -------------------------------------------------------------------
// What a person is WORTH, as distinct from how skilled they are. Expertise is linear
// and bounded in [0,1]; capability is not, because the top of a field does work the
// rest of it cannot do at all.
//
// w(E) = RATIO ^ ((E - EXPERT_THRESHOLD) / (1 - EXPERT_THRESHOLD))
//
// Anchored so that w(EXPERT_THRESHOLD) = 1 and w(1) = CAPABILITY_RATIO. The unit is
// therefore "one threshold expert", and a capability of 8,363 states that an
// institution is worth 8,363 experts. Both constants are stated assumptions, not fits:
// the ratio says one person at the ceiling is worth a thousand people who merely
// qualify, and the anchor is the model's own definition of an expert.
//
// This is CONVEX, not logarithmic. A logarithmic weighting compresses differences and
// would say the opposite of what is intended here. The logarithm belongs on the output:
// log10(w) is linear in E, and capability spans enough orders of magnitude that a log
// axis is the only readable way to chart it (measured: severe AI dampening moves meanE
// by -72% and capability by -99.99%).
const CAPABILITY_RATIO = 1000;
const CAPABILITY_EXP = 1 / (1 - EXPERT_THRESHOLD);
function capabilityWeight(E) {
  return Math.pow(CAPABILITY_RATIO, (E - EXPERT_THRESHOLD) * CAPABILITY_EXP);
}

// --- what AI does to that capability: asymmetric cognitive leverage ---------------
// AI MULTIPLIES what a person is already worth. It does not replace them, and it does
// not put a floor under them.
//
// The floor it replaces — counting anyone below the AI AS the AI — had the property
// that at a high ai_level_fraction system capability read N x w(aiLevel) no matter what
// the humans did: pinned, flat, and blind to a collapse happening underneath it. A
// multiplier cannot do that, and the human signal survives.
//
// Two effects, from Dell'Acqua et al. (HBS/BCG, 2023/2026), measured on management
// consultants across ~18 tasks with a GPT-4-class model:
//
//   INSIDE the AI's frontier   quality rises, but unevenly: +43% for the bottom half of
//                              performers against +17% for the top half. AI levels.
//   OUTSIDE it                 quality falls for those who cannot tell it is wrong:
//                              -19 points for novices, ~0 for experts, who catch it.
//
// PROVENANCE, and the size of the extrapolation: those are four numbers from ONE study
// of one profession on one model generation, applied here across 40-year careers and
// 245 institutions. Splitting work by a frontier ratio and blending the two regimes
// linearly is OUR synthesis, not a finding of the paper. They are parameters, not
// constants, so a run states what it assumed.
//
// SMOOTH, not binned. The study reports two cohorts because that is how you report an
// experiment; taken literally as a step at the median it makes capability NON-MONOTONIC
// in expertise — measured, a person at 0.501 came out 10% less capable than one at
// 0.499, and everyone up to 0.555 was worth less than someone below the line. Expertise
// here is continuous and people cross that line constantly, so the step is blended.
// The cost is small: the cohort means come out ~1.40 / 1.21 against the study's
// 1.43 / 1.17, which is a better trade than a capability function that punishes skill.
//
// Keyed to the AI's LEVEL, not to the population median. The person who cannot check the
// AI's work is the person the AI outranks, and that is the same population aiDampening-
// Below governs — see the note there. Using the median would have made someone a novice
// for learning and an expert for output at the same time.
function aclLeverage(E, aiLevel, p) {
  // The share of work inside the frontier, derived from how good the AI is rather than
  // stated separately: a better AI safely covers more. frontierBreadth = 1 makes them
  // equal; below 1 widens the frontier for a given AI, above 1 narrows it.
  const F = Math.pow(aiLevel, p.frontierBreadth);
  // 1 well below the AI, 0 well above it.
  const mix = 1 / (1 + Math.exp(p.aclBlendSharpness * (E - aiLevel)));
  const alpha = 1 + p.aclExpertGain + (p.aclNoviceGain - p.aclExpertGain) * mix;
  const beta = 1 - p.aclNoviceDeficit * mix;
  return F * alpha + (1 - F) * beta;
}

const DEFAULT_PARAMS = {
  N: 500, M: 40,
  expertiseMean: 0.28, expertiseSpread: 0.30, expertiseSkew: 3,
  // New entrants (turnover replacements) start as genuine novices, distinct from the
  // t=0 population above (which represents an already-running, mixed-skill system).
  // This is what makes AI-driven decline compounding rather than a one-time step down
  // to a lower plateau: entrants only become expert via peer transfer, so if AI
  // dampens that transfer, they stay stuck near-zero — and as more of the population
  // is replaced by stuck entrants, institution averages fall further, so even
  // existing experts near them decay faster too (their own gap = Ebar - E gets more
  // negative). See spec.html "Entrant renewal" for the full mechanism.
  entrantExpertiseMean: 0.05, entrantExpertiseSpread: 0.05,
  // Lower bound on an entrant's draw. The draw is skew-normal clipped to [0,1],
  // so at entrantExpertiseMean = 0.05 with spread 0.05, ~16% of entrants used to
  // arrive at exactly E = 0 — and at a nominal mean of 0, fully half did. That
  // pile-up at the boundary made the bottom of the entrantExpertiseMean axis
  // non-linear in its own parameter (nominal 0 realised as 0.020), and it fed
  // the absorbing state at maximum de-skilling (problems.md P19/R11 — written
  // when that was reached via the since-removed aiRelianceIntensity = 1).
  // Set to 0 for the pre-2026-08 behaviour.
  entrantExpertiseFloor: 0.05,
  graphAttachment: 2,
  transferRate: 0.5, decayRate: 0.01, learningRateSpread: 0.4,
  // What you learn on your own once there is nobody left to be taught by. Someone who
  // has reached their institution's teaching level is in the decay branch — the taught
  // channel needs a positive gap and they have none — so this is the ONLY route by which
  // they keep improving: slower than being taught, but not zero. Renamed from
  // ambientGrowthRate (2026-08) because "ambient growth" described where it sat in the
  // code rather than what it represents, and it now carries the AI contrast for everyone
  // who has already arrived.
  //
  // Scaled by how strong the institution is. Checked: this has to be anchored to the
  // institution's FOUNDING average
  // (state.startEbar, fixed at init), not its live one — using the live average
  // creates a runaway positive feedback loop (top performers rise -> average rises
  // -> personal learning rises further -> ...) that saturates the entire population to
  // E=1 by t~2000-5000 regardless of AI. The fixed anchor still saturates given a
  // long enough horizon (nothing here is a stable equilibrium, only a slow one), but
  // at this default it stays a gentle, non-dominant effect through the model's
  // standard 1000-tick horizon and doesn't meaningfully touch the AI/no-AI contrast
  // under worst-case dampening (see generate_experiments.js's aiDampeningBelow/Above
  // default) — checked directly against the self-renewal scenario.
  //
  // Stays at 0.001 here even though the shipped calibration uses 0.005: every archived
  // experiment omits this key, so DEFAULT_PARAMS is what they resolve to, and moving it
  // would silently re-run them under a different model. PIPELINE_PARAMS carries the
  // current value.
  personalLearningRate: 0.001,
  mobilityMode: "hybrid", jumpProbability: 0.10,
  competitionAversion: 0.5, prestigeWeight: 0.3, baseMoveProb: 0.05,
  turnoverRate: 0.01,
  // --- entrant pipeline (2026-08) -------------------------------------------
  // Both default to 0 = OFF, i.e. the dynamics every existing config and every
  // archived result were produced under. See PIPELINE_PARAMS for the calibrated set.
  //
  // The problem they fix: learning is gap-proportional, so it is EXPONENTIAL —
  // fastest when furthest behind. Measured on the monthly calibration, an entrant
  // reached the expert threshold in a median of 1.8 years against this project's own
  // stated assumption of 8 (calibrate_time_base.js, TARGET_YEARS_TO_EXPERT). The
  // pipeline therefore occupied ~4% of a career, so ~4% of the population was ever on
  // it and the distribution was a point mass at the institution mean.
  //
  // learningCap makes the climb roughly LINEAR in time: the most expertise one tick of
  // peer learning can add, before the per-person learning rate scales it. Time from
  // the entrant floor to expert is about (0.585 - floor) / cap months.
  learningCap: 0,
  // Who you learn FROM. 0 = the plain institution mean, which includes fellow
  // trainees — that is why a cap alone collapses the field: a long pipeline drags the
  // mean down and every target follows it. Above 0, the target is the mean over
  // members with at least this many YEARS of tenure, so trainees no longer dilute
  // what they are climbing toward.
  //
  // Tenure is deliberately the criterion rather than rank. A rank-based target (the
  // top half, say) RATCHETS: raising the top half raises the target, which raises the
  // top half. Measured, that inflates the field by +0.08 per 1,000 ticks toward
  // saturation — the same runaway documented above for personalLearningRate against a
  // live average. Tenure does not respond to expertise, so the target stays a balance
  // point that people above it decay back toward.
  seniorTenureYears: 0,
  // --- who becomes what: differentiating careers AFTER training (2026-08) --------
  // Measured by tenure band, the model was well behaved up to year 8 and a single point
  // after it: the 8-20y band sat at 0.642 and the 20y+ band at 0.645. Half the field was
  // indistinguishable, because once you reach your institution's teaching level nothing
  // can separate one veteran from another.
  //
  // aptitude: a person's ceiling, drawn at entry. Asserts that people differ in the
  // expertise they can ATTAIN, not only in how fast they get there — a claim about
  // the world, made deliberately. 0 = off, everyone can reach 1.0.
  // Drawn by rejection, not clipped — see drawAptitude(). A clipped normal put 10% of
  // ceilings on exactly 1.0, and that atom became a wall of extreme experts.
  aptitudeMean: 0.75,
  aptitudeSpread: 0,
  // Teaching level is the mean of an institution's best N seniors, counted in ABSOLUTE
  // numbers. A percentile is scale-free and therefore cannot make institutions differ by
  // size however much size varies; an absolute count can — the best 8 of 1051 people are
  // outstanding, the best 8 of 19 are most of the staff. 0 = off, the plain senior mean.
  teachTopN: 0,
  // --- the brake: learning gets harder the further you are above the field ---------
  // Slows the LEARNING branch for anyone already above the population mean, by the
  // factor 1 / (1 + aboveMeanDrag * (E - meanE)). 0 = off, and off is exactly 1.0, so
  // archived runs reproduce bit-identically.
  //
  // This is a BRAKE, not a target and not a decay term. The distinction matters and is
  // the reason it does not trip the ratchet documented under seniorTenureYears:
  //   - it never moves anyone down, so it adds no restoring force to argue about;
  //   - it only ever multiplies delta by something in (0, 1], so it cannot push the
  //     field up either. The hard caps stay exactly where they were — learning still
  //     requires gap > 0, so nobody passes min(aptitude, teacher level) by any route.
  //   - the reference is the live population mean, which does rise as the field learns,
  //     releasing the brake for those it had slowed. That IS positive feedback, but it
  //     is bounded by those same caps: the mean cannot chase itself past the ceiling
  //     distribution. Verified to t=12000 (1,000 years) — see the drift check below.
  //
  // What it buys: a populated ladder without needing an implausibly high destination.
  // The old way to spread the field was to raise the target (a top-quartile teaching
  // level), which
  // put everyone's attractor in the top quartile. This spreads it by making the upper
  // half of the climb slow enough that a 40-year career does not finish it.
  aboveMeanDrag: 0,
  // --- critical mass: an institution needs a body of experts to transfer anything ----
  // Expertise transfer is not one person handing knowledge to another — it needs a
  // department, a seminar, enough people that the tacit part survives one person
  // leaving. Below criticalMass experts an institution teaches at reduced efficiency;
  // 0 = off (every institution teaches at full efficiency regardless of size).
  //
  // This is the lever for institutional differentiation. Institution SIZES already span
  // 50x (measured: 9 to 485 members on the BA graph at N=2000, M=40), but teaching
  // capability barely varies with them, because Teach is the mean of the top quartile
  // and a small institution's best quarter is as good as a big one's. Keying transfer
  // to the absolute expert count is what makes that 50x span matter.
  criticalMass: 0,
  // Hill exponent: how abruptly efficiency falls away below criticalMass. ~1 is a gentle
  // slope, >=8 is effectively a hard cutoff.
  criticalMassSharpness: 2,
  // Efficiency scales the RATE of transfer, deliberately, not the target. The obvious
  // alternative — a thin institution can pass on less, so scale the target itself — was
  // built and measured, and it is UNCONDITIONALLY UNSTABLE. Expert count sets the
  // target, the target sets expert count, and nothing anchors the loop: a healthy field
  // of 1,257 experts collapsed to zero in 10 years, at every (criticalMass, sharpness)
  // tried. Scaling the rate is stable precisely because the destination stays fixed
  // while people move toward it. Do not re-derive the target variant; it is a runaway.
  aiEnabled: false,
  // The AI's reference level, in absolute expertise units (aiLevel =
  // aiLevelFraction x startTopE, and startTopE is 1.0 for any realistic N — see
  // problems.md P17). Defaulted to EXPERT_THRESHOLD deliberately: the natural
  // reading of "the AI's level" is "as good as a human we would call expert",
  // and that is a stated quantity rather than a free choice. It also sits below
  // the saturation plateau that begins around 0.65, where lambda stops mattering
  // and aiDampeningAbove stops governing anybody (P16).
  aiLevelFraction: EXPERT_THRESHOLD,
  // TWO FACES OF ONE CLAIM, deliberately kept apart. "Novices lean on AI and cannot
  // verify it" has a consequence in the LEARNING domain — aiDampeningBelow, the growth
  // they don't get — and a consequence in the OUTPUT domain — aclNoviceDeficit, the
  // unverified errors they ship. Same cause, different quantities: one multiplies a
  // rate of change, the other a level, and measured they differ by ~2.7x (0.30 against
  // 0.81). Driving both from one dial needs an exchange rate between them, which is
  // precisely the mistake REMOVED_PARAMS records under aiRelianceIntensity — its
  // untested base moved the headline result from 0.213 to 0.346. They stay independent.
  aiDampeningBelow: 0.30, aiDampeningAbove: 0.80,

  // --- asymmetric cognitive leverage: what AI does to CAPABILITY (see aclLeverage) ---
  // Dell'Acqua et al. (HBS/BCG). Parameters rather than constants so a run records what
  // it assumed — these are four numbers from one study, stretched a long way.
  aclNoviceGain: 0.43,        // +43% inside the frontier, bottom-half performers
  aclExpertGain: 0.17,        // +17% inside the frontier, top-half performers
  aclNoviceDeficit: 0.19,     // -19 points outside it, for those who cannot catch errors
  // How sharply the novice regime gives way to the expert one, in expertise units.
  // ~20 puts the transition across roughly an interquartile range; large values
  // approach the study's hard bin and reintroduce the non-monotonicity it causes.
  aclBlendSharpness: 20,
  // F = aiLevel ^ frontierBreadth. 1 = the frontier is exactly the AI's level.
  frontierBreadth: 1,

  seed: 1,

  // --- world-model graph support (world-model-plan.md phases C/D) ----------
  // All default to today's behaviour, so an existing config is unaffected.
  graphSource: "ba",           // "ba" | "worldModel"
  worldModel: null,            // a loadWorldModel() result, NOT a path — keeps
                               // this file fs-free and browser-compatible
  institutionSizing: "uniform",// "uniform" | "weighted" (intake-proportional)
  // Top-K mobility heuristic. 0 = off (evaluate the full near-neighbour set, the
  // original behaviour). When > 0, an agent considers only its K highest-affinity
  // destinations instead of every neighbour — mobility is ~75% of runtime and its
  // cost is linear in the candidate count. World-model mode only; the BA graph has
  // no affinity ordering to take a top-K of.
  candidateCap: 0,
};

// --- the declared time base -------------------------------------------------------
// Stated here, once, and derived from rather than repeated. Two scripts used to carry
// their own `CAREER_YEARS = 40` and one of them rebuilt the turnover rate from it, so
// the shipped rate and the rate being calibrated against could drift apart in silence.
//
// CAREER_YEARS is the CALIBRATION career length: the value MONTHLY_TICK_PARAMS and
// WORLD_MODEL_PARAMS were fitted at. It is NOT the career length of a running model —
// turnoverRate is a live control in simulator.html, so the career length of any given
// run is 1 / (params.turnoverRate * TICKS_PER_YEAR) and moves when the slider moves.
// Read this constant as "what the shipped numbers assume", never as "what is true now".
const TICKS_PER_YEAR = 12;
const CAREER_YEARS = 40;

// Calibrated parameter set for the DECLARED time base: 1 tick = 1 month, career
// = 40 years = 480 ticks. DEFAULT_PARAMS above was tuned when the tick was
// dimensionless and does NOT survive that reading — at turnoverRate = 1/480 its
// transferRate = 0.5 drives 98% of the population above E = 0.95, saturating the
// no-AI baseline so the AI contrast has nothing to measure against.
//
// Kept as a separate overlay rather than folded into DEFAULT_PARAMS so the
// existing BA experiment set and its published results are untouched. Apply with
//   initSim(Object.assign({}, MONTHLY_TICK_PARAMS, yourParams))
//
// Derivation: calibrate_time_base.js and the "Time, turnover, and population
// scale" section of paper.md.
//
// Selected for a STATIONARY no-AI baseline, which is what makes meanE_shortfall
// interpretable — the shortfall is then "what AI removed", not "what AI removed
// plus wherever the baseline happened to have drifted to by the reporting tick".
// Measured at world-model scale (N=10,504, M=245), meanE over the 1440-tick
// horizon: 0.6291 -> 0.6294, a drift of +0.0002. Confirmed stationary long-run
// too (0.6589 at t=4800 vs 0.6586 at t=9600 for N=3000).
//
// The earlier pairing (0.13, 0.024) was NOT stationary: its equilibrium sits at
// ~0.56, below where the initial transient lands, so the baseline fell 0.5975 ->
// 0.5622 across the horizon (-0.035) and kept declining for another ten careers.
// Because sd(E) is only ~0.06, that slow drift dragged shareExpert from 0.80 to
// 0.05 — see problems.md P4/P7.
//
// Trade-off accepted: the higher baseline puts shareExpert at ~0.95, so that
// metric has little downward range left. meanE is the headline metric here.
const MONTHLY_TICK_PARAMS = {
  turnoverRate: 1 / (CAREER_YEARS * TICKS_PER_YEAR),   // 0.002083 — a 40-year career
  transferRate: 0.15,      // equilibrium meanE ~0.63 at world-model scale
  decayRate: 0.020,        // counterweight; sets where that equilibrium sits
};
// Parameters this engine used to have. Kept as a rejection list rather than dropped
// silently: a config written against an older engine should fail loudly, not run on
// defaults while its CSV row still names the parameter. See README's "Removed
// parameters" for the measurements behind each.
const REMOVED_PARAMS = {
  aiRelianceIntensity: "set aiDampeningBelow directly (the old mapping was 1 - rho)",
  aiAtrophyMultiplier: "the atrophy branch is gone; AI now acts only by dampening learning",
  mobilityFriction: "the affinity-priced move penalty is gone (it moved the shortfall by 0.005)",
  entrantExpertiseSkew: "entrant draws are unskewed; it was pinned at 0 everywhere",
  aiGain: "the observed-capability channel C was removed, and with it every dial that shaped it",
  aiResponseMode: "the observed-capability channel C was removed, and with it every dial that shaped it",
  ambientGrowthRate: "renamed to personalLearningRate (2026-08) — same units and default, but it is now AI-gated by aiDampeningBelow/Above, so a run using it is not the run this engine would produce",
  // Removed 2026-08 after an ablation from the calibrated configuration. Per-person
  // teacher assignment is gone entirely: everyone learns from Teach[j], their
  // institution's teaching level. The three went together because they were one
  // mechanism — a pool, a draw from it, and a cap on the draw.
  teachPercentile: "teachTopN replaced it — an absolute count, not a percentile. Measured INERT once teachTopN was on: max |dE| exactly 0",
  teacherTermYears: "per-person teachers are gone; teachTopN left the pool too small and too alike for a persistent draw to carry any variance (IQR moved 0.297 -> 0.313 without it)",
  teachCapacity: "measured to do nothing at the shipped setting (mean 0.566 -> 0.569, IQR unchanged); it only ever rationed a pool that is no longer drawn from",
};

// Calibrated entrant pipeline — see calibrate_pipeline.js for the scan, and
// DEFAULT_PARAMS.learningCap for what the two mechanisms do and why.
//
// Layered over MONTHLY_TICK_PARAMS, not folded into it, for the same reason that set
// is kept separate from DEFAULT_PARAMS: the 15 completed world-model experiments and
// every archived result were produced WITHOUT it, and stay reproducible.
//
// Measured at N=2000, M=40, no AI, 3 seeds, drift over t=2000..4800:
//
//                      before        after
//   years to expert     1.8          7.8      (stated assumption: 8)
//   meanE               0.61         0.61
//   p25 - p75           0.010        0.303    <- a populated distribution, not a spike
//   below expert         5%           38%
//   at E >= 0.85         0%            0%     (21% before ceilings were drawn by
//                                              rejection rather than clipped)
//   never reach expert   0%           19%     (ceiling below the threshold, by design)
//   drift               -0.012       +0.003   (both stationary)
//
// It also restores shareExpert as a metric. It used to sit at ~0.95 with no downward
// range (README, "Time base"); under AI it now moves 0.647 -> 0.408.
//
// Drift is measured from t=2000 because this mechanism's transient runs for several
// careers: the field has to reach a stationary tenure structure and replace everyone
// who was in it at t=0. meanE is still rising at t=1200 and level from t=2000. The
// LADDER, which is the point, forms much sooner — by year 10.
//
// Scale-robust in a way the old decay-rate tuning was not, because the cap fixes the
// climb rate in absolute terms rather than relative to institution size: at 5, 13, 25
// and 50 people per institution the ladder holds at 18-19% below expert.
//
// It also repairs a known measurement problem. README's "Time base" notes that
// baseline shareExpert sat at ~0.95 with little downward range, making it a poor
// metric. With the pipeline the baseline sits near the threshold, so shareExpert
// discriminates in both directions again.
const PIPELINE_PARAMS = {
  learningCap: 0.0056,        // ~8 years from the entrant floor to expert
  seniorTenureYears: 8,       // learn from those past the pipeline, not from fellow trainees
  decayRate: 0.027,           // re-fitted: a longer pipeline shifts where decay balances
  // Careers differentiate after training as well as during it.
  aptitudeSpread: 0.20,       // ceilings ~N(0.75, 0.20), clipped to [0,1]
  // 0.005, not the older 0.001, because the slider grid is 0.005 and a default the
  // control cannot represent would snap to 0 the moment anyone touched it. Measured at
  // N=10500 over 200 years with no AI, the move costs nothing: meanE 0.571 -> 0.569,
  // IQR 0.316 -> 0.326, share below expert 43% -> 44%.
  personalLearningRate: 0.005,
  // Teaching selection. This set used to get it from teachPercentile (the top quarter of
  // seniors); with that gone, teachTopN is the only thing standing between the model and
  // a plain senior mean — which includes everyone still climbing and collapses the field
  // (measured: meanE 0.59 -> 0.42 with no selection at all).
  teachTopN: 8,
  // Learning slows the further you are above the field. Scanned k = 4/8/16/32 at
  // N=1500, M=40, 3 seeds: k=16 clears the E >= 0.80 band (24% -> 0%) and pulls p99
  // from 0.84 to 0.79, while leaving time-to-expert at 7.8y, the share below expert at
  // 37% and the IQR at 0.276. Stationary: meanE moves +0.0039 between t=2000 and
  // t=12000, i.e. over 830 years.
  aboveMeanDrag: 16,
};

// The DEPLOYMENT calibration: the configuration this model is actually run in, fitted by
// calibrate_worldmodel.js on the world-model graph at N=10500. Layered over
// MONTHLY_TICK_PARAMS and PIPELINE_PARAMS for the usual reason — the archived batch results
// predate it and stay reproducible because none of them names it.
//
// Why N belongs in a parameter set: below 10500 the people-per-institution distribution
// stops matching the world model's own. At N=2000 across 245 institutions the median
// institution holds 5 people, which is not a department, and every institution-level
// mechanism here is then measuring noise.
//
// Verified at the full horizon, 2 seeds, 1000 years:
//
//   median years to expert     7.7      (assumption: 8)
//   interquartile range       0.312     (0.279 before; the ladder)
//   share below expert        42.9%
//   institutional spread      0.119     (0.099 before)
//   corr(size, institution E)  0.336     (0.280 before)
//   drift over 1000 years   -0.0015     (stationary)
//
// Re-verified after per-person teacher assignment was removed (teachPercentile,
// teacherTermYears, teachCapacity — see REMOVED_PARAMS). Everyone now learns from
// Teach[j] directly. IQR rose 0.301 -> 0.312 and corrSize fell 0.373 -> 0.336; both
// still pass, and the configuration is simpler by three parameters.
//
// learningRateSpread does the work aptitudeSpread could not. Both widen the individual
// distribution, but ceilings widen it from BELOW — they add people who never reach expert,
// which drove the below-expert share to 57-68% and diluted the between-institution signal
// back to baseline. Varying learning SPEED smears people along the climb instead: slow
// learners still arrive, so no permanent underclass forms inside each institution and the
// institutional signal survives. See README, "Making institutions differ".
// How far the simulated field is scaled down from the real one. The world model's own
// data says 52,518 people enter per year, which at CAREER_YEARS gives a headcount of
// ~2.1 million — far past what this engine runs interactively. Everything is therefore
// simulated at 1:200, and BOTH sides of the identity scale together, so a simulated
// career is still 40 years and simulated intake is still exactly 1/200 of real intake.
//
// Named here because it used to exist only as the number 200 inside one prose comment,
// while the test suite reached for a different divisor (400) with nothing saying the
// two were scales of the same field. See suggestedN() in world_model.js, which applies
// it, and problems.md P5 for what the identity is.
const FIELD_DIVISOR = 200;

const WORLD_MODEL_PARAMS = {
  // The round figure the calibration was fitted at. The identity-exact value is 10,504
  // (= suggestedN(wm, CAREER_YEARS, FIELD_DIVISOR)), which is what the experiment
  // generator uses; the 4-person difference is immaterial and this set is kept at the
  // number the fit actually used. test_world_model.js asserts the two agree.
  N: 10500,                   // matches the world model's own size distribution
  baseMoveProb: 0.01,         // a move every ~7 years, not every 20 months
  learningCap: 0.0048,
  learningRateSpread: 1.0,
  teachTopN: 8,               // absolute pool, so institution size buys teaching quality
};

const MOVE_TEMPERATURE = 0.12;
const UNCONSTRAINED_CANDIDATE_CAP = 25;

// Institution occupancy below this makes an institution's internal dynamics
// meaningless: learning runs on gap = Ebar[j] - E[i], and you are part of Ebar,
// so in a k-member institution the peer gap you feel is attenuated to (k-1)/k.
// At k=1 it is exactly zero. Reported per tick rather than enforced — the drain
// that asymmetric mobility produces is a real prediction, not an error, but a run
// where institutions fall below this should be treated as suspect.
const MIN_MEANINGFUL_OCCUPANCY = 5;

// Cumulative-weight sampling, shared by initial placement and turnover. This
// pairing is the whole point: placing entrants uniformly (as the engine used to)
// erases any intake-weighted distribution within ~50 ticks, so weighted sizing
// applied only at init is purely cosmetic. See world-model-plan.md D2.
function sampleInstitution(state, rng) {
  const cdf = state.institutionCDF;
  if (!cdf) return Math.floor(rng() * state.M);
  const r = rng() * cdf[cdf.length - 1];
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
  return lo;
}

function initSim(userParams) {
  const params = Object.assign({}, DEFAULT_PARAMS, userParams || {});

  // Rejected, not ignored. initSim merges unknown keys straight into params and from
  // there into every CSV column, so a stale config would otherwise run on defaults
  // while its results rows advertised a parameter that no longer does anything.
  if (userParams) {
    for (const [key, why] of Object.entries(REMOVED_PARAMS)) {
      if (userParams[key] != null) throw new Error(`[engine] ${key} was removed — ${why}`);
    }
  }

  const rng = mulberry32(params.seed >>> 0 || 1);

  let graph;
  if (params.graphSource === "worldModel") {
    const wm = params.worldModel;
    if (!wm || !wm.isWorldModel) {
      throw new Error("[engine] graphSource 'worldModel' requires params.worldModel to be a loadWorldModel() result");
    }
    // M is DERIVED from the data, not configured. Fail loudly rather than
    // silently ignoring whichever of the two the caller meant.
    if (userParams && userParams.M != null && userParams.M !== wm.M) {
      throw new Error(`[engine] M is derived from the world model (${wm.M}) — remove M from the config (got ${userParams.M})`);
    }
    params.M = wm.M;
    graph = wm;
  } else {
    graph = generateBAGraph(params.M, params.graphAttachment, rng);
  }

  const N = params.N;
  const E = new Float32Array(N);
  const L = new Float32Array(N);
  const inst = new Int32Array(N);
  // Months served. Drawn across a whole career at t=0 rather than starting everyone at
  // zero: a real field is a mix of tenures, and starting them all "new" would leave no
  // seniors to learn from for the first several years.
  //
  // Drawn from its OWN generator, not the main one. Taking N draws from rng() here
  // would shift every downstream draw and silently change every result the model has
  // ever produced — checked against an archived world-model row, which stopped
  // reproducing until this was separated out.
  const tenure = new Int32Array(N);
  // Aptitude ceilings. Drawn from tenureRng for the same
  // reason tenure is: taking draws from the main stream would shift every downstream
  // value and change every result the model has ever produced.
  const aptitude = new Float32Array(N);
  const tenureRng = mulberry32(((params.seed >>> 0 || 1) ^ 0x9e3779b9) >>> 0);

  // Built before placement so init and turnover draw from the same distribution.
  let institutionCDF = null;
  if (params.institutionSizing === "weighted") {
    const w = graph.entryWeights;
    if (!w) throw new Error("[engine] institutionSizing 'weighted' requires a world model supplying entryWeights");
    institutionCDF = new Float64Array(params.M);
    let acc = 0;
    for (let j = 0; j < params.M; j++) { acc += w[j]; institutionCDF[j] = acc; }
  }
  const placer = { M: params.M, institutionCDF };

  for (let i = 0; i < N; i++) {
    E[i] = sampleSkewNormalClipped(rng, params.expertiseMean, params.expertiseSpread, params.expertiseSkew);
    L[i] = sampleLognormal(rng, params.learningRateSpread);
    aptitude[i] = params.aptitudeSpread > 0
      ? drawAptitude(tenureRng, params.aptitudeMean, params.aptitudeSpread) : 1;
    tenure[i] = Math.floor(tenureRng() / Math.max(params.turnoverRate, 1e-9));
    inst[i] = sampleInstitution(placer, rng);
  }

  // Fixed for the whole run, set once from the t=0 population: "the greatest human
  // expert at the start of the simulation" — the single highest E, captured once at
  // init. ai_level is a fraction of THIS, not of the current/live top performer, so
  // it's a stable benchmark that doesn't chase the population's own trajectory as it
  // grows or collapses over the run (an earlier version recomputed this from the live
  // top performer every tick and had exactly that moving-target problem).
  let startTopE = 0;
  for (let i = 0; i < N; i++) if (E[i] > startTopE) startTopE = E[i];

  // Each institution's OWN founding average, fixed at init — the anchor for ambient
  // growth (see personalLearningRate above). Deliberately not recomputed per tick: an
  // institution's live average is itself moved by the very effect this anchors, so
  // using it directly would create unbounded positive feedback.
  const startEbar = new Float32Array(params.M);
  const startCount = new Int32Array(params.M);
  for (let i = 0; i < N; i++) { startEbar[inst[i]] += E[i]; startCount[inst[i]]++; }
  for (let j = 0; j < params.M; j++) startEbar[j] = startCount[j] > 0 ? startEbar[j] / startCount[j] : 0;

  // Each person's CAREER-START institution, for the mixing measurement in tick(). Reset
  // to the new placement when someone retires and is replaced, so an entrant starts a
  // fresh origin of their own rather than dropping out of the measure.
  //
  // This used to mark a refilled slot with -1 and count only the survivors of the t=0
  // population. That cohort decays with turnover — 8% of the field left after a century
  // — so the statistic ended up describing a vanishing sliver and saturating at its own
  // baseline, blind to how every person who arrived since had been redistributed.
  const origin = Int32Array.from(inst);
  // Ticks since this person last changed institution, by either route. A direct mixing
  // TIMESCALE, and stationary in a way retention alone is not: retention answers "how
  // many are still where they began", this answers "how long has the average person been
  // where they are", and the second is what moves the instant mobility changes.
  const sinceMove = new Int32Array(N);

  return {
    params, rng, graph,
    N, M: params.M,
    E, L, tenure, aptitude, inst,
    // Reusable mobility scratch (problems.md O1). Bounded by M+1: a candidate set
    // can never hold more than every institution plus the current one. ~2KB at
    // M=245. Allocated once per run, not once per moving agent per tick.
    scratchCand: new Int32Array(params.M + 1),
    scratchUtil: new Float64Array(params.M + 1),
    institutionCDF,
    startTopE, startEbar, origin, sinceMove,
    t: 0,
    // Cumulative turnover events since t=0. One event is one retirement AND one
    // entrant — the population is conserved by construction, so the two counts are
    // equal. Kept as a running total rather than re-summed from history, so scrubbing
    // to an earlier tick reads the value as of that tick.
    turnoverTotal: 0,
    history: [],
    snapshots: [],
    lastAiLevel: null,
  };
}

function institutionStats(state) {
  const { M, inst, E } = state;
  const sumE = new Float64Array(M);
  const count = new Int32Array(M);
  // Experts per institution, in ABSOLUTE numbers — the input to critical mass below.
  const experts = new Int32Array(M);
  // Capability, in threshold-expert equivalents: what a person is worth, times what AI
  // does to that worth. Both halves are documented at capabilityWeight/aclLeverage.
  //
  // capabilityHuman is the same sum with the AI multiplier left off — the field's own
  // capability, unaugmented. Carried alongside rather than derived later because the
  // GAP between the two is the leverage, and that is the quantity worth reading.
  //
  // Folded into the loop that already walks E, so it costs one pow() per person rather
  // than a second pass.
  const capability = new Float64Array(M);
  const capabilityHuman = new Float64Array(M);
  const aiOn = state.params.aiEnabled;
  const aiLevel = aiOn ? state.params.aiLevelFraction * state.startTopE : 0;
  for (let i = 0; i < state.N; i++) {
    sumE[inst[i]] += E[i]; count[inst[i]]++;
    if (E[i] >= EXPERT_THRESHOLD) experts[inst[i]]++;
    const wi = capabilityWeight(E[i]);
    capabilityHuman[inst[i]] += wi;
    capability[inst[i]] += aiOn ? wi * aclLeverage(E[i], aiLevel, state.params) : wi;
  }
  const Ebar = new Float32Array(M);
  for (let j = 0; j < M; j++) Ebar[j] = count[j] > 0 ? sumE[j] / count[j] : 0;

  // Teaching capability: the mean over members past seniorTenureYears, which is what
  // trainees actually learn from when the pipeline mechanism is on. Falls back to the
  // plain mean per institution wherever there are no seniors — otherwise a young
  // institution would have nothing to teach with and its members would decay to zero.
  const senior = state.params.seniorTenureYears;
  let Teach = Ebar;
  if (senior > 0 && state.tenure) {
    const minMonths = senior * TICKS_PER_YEAR;
    const sSum = new Float64Array(M), sCount = new Int32Array(M);
    for (let i = 0; i < state.N; i++) {
      if (state.tenure[i] >= minMonths) { sSum[inst[i]] += E[i]; sCount[inst[i]]++; }
    }
    Teach = new Float32Array(M);
    for (let j = 0; j < M; j++) Teach[j] = sCount[j] > 0 ? sSum[j] / sCount[j] : Ebar[j];

    // teachTopN: what a place can teach is the mean of its best N seniors in ABSOLUTE
    // numbers, not its best quarter. This is the whole point — a percentile is
    // scale-free, so a 9-person institution's best quarter is as good as a 1426-person
    // one's, and institutions cannot differ by size no matter how much size varies. An
    // absolute count makes the top of a big place genuinely deeper: the best 8 of 1426
    // are far above the best 8 of 9, who are simply most of the institution.
    //
    // Anchored to real individuals' expertise, exactly as the plain senior mean is, so
    // it carries no feedback loop of its own — unlike scaling the target by expert
    // count, which was measured to collapse the field unconditionally.
    if (state.params.teachTopN > 0) {
      const nTop = state.params.teachTopN;
      const byInst = Array.from({ length: M }, () => []);
      for (let i = 0; i < state.N; i++) if (state.tenure[i] >= minMonths) byInst[inst[i]].push(E[i]);
      for (let j = 0; j < M; j++) {
        const a = byInst[j];
        if (!a.length) continue;                 // no seniors: keep the Ebar fallback
        a.sort((x, y) => y - x);
        const k = Math.min(nTop, a.length);
        let s = 0;
        for (let q = 0; q < k; q++) s += a[q];
        Teach[j] = s / k;
      }
    }
  }
  // Critical mass: how well an institution can transfer expertise at all, as a function
  // of how many experts it actually has. A Hill function, so ONE pair of parameters
  // spans both natural readings of the idea:
  //
  //   sharpness ~1   a smooth falloff — big places teach better, small ones still teach
  //   sharpness >=8  effectively a hard threshold at criticalMass experts
  //
  // Deliberately keyed to the ABSOLUTE expert count, not to size rank. Rank re-creates
  // the ratchet documented under seniorTenureYears — the biggest institution would hold
  // full efficiency however few experts it had left, so the measure would say nothing
  // about capability and could never register the whole field thinning out.
  let transferEff = null;
  const n0 = state.params.criticalMass;
  if (n0 > 0) {
    const h = state.params.criticalMassSharpness;
    transferEff = new Float32Array(M);
    for (let j = 0; j < M; j++) {
      const n = Math.pow(experts[j], h), d = Math.pow(n0, h);
      transferEff[j] = n / (n + d);
    }
  }
  // Critical mass scales what an institution can DO as well as what it can teach: a
  // department too thin to pass anything on is also too thin to deliver. Applied here
  // rather than left to the caller so every reader of `capability` sees the same
  // number, and it is exactly 1.0 when the mechanism is off.
  if (transferEff) for (let j = 0; j < M; j++) {
    capability[j] *= transferEff[j];
    capabilityHuman[j] *= transferEff[j];
  }

  return { Ebar, count, Teach, experts, transferEff, capability, capabilityHuman };
}

// Fills state.scratchCand with the candidate institution indices for this human
// and returns HOW MANY. Writing into a preallocated buffer rather than returning
// a fresh Set/Array removes ~3 allocations per moving agent; with ~560 movers per
// tick that was the single largest cost in the engine (problems.md O1).
//
// Dedupe is a linear scan rather than a Set: the candidate list is bounded by
// UNCONSTRAINED_CANDIDATE_CAP (25), and at that size a scan over a contiguous
// Int32Array beats hashing plus the allocation.
function fillCandidates(state, humanIdx, rng) {
  const mode = state.params.mobilityMode;
  const current = state.inst[humanIdx];
  const buf = state.scratchCand;
  let n = 0;
  const useFull = mode === "unconstrained" || (mode === "hybrid" && rng() < state.params.jumpProbability);

  if (useFull) {
    if (state.M <= UNCONSTRAINED_CANDIDATE_CAP) {
      for (let j = 0; j < state.M; j++) buf[n++] = j;
      return n;
    }
    buf[n++] = current;
    const sampleDest = state.graph.sampleDestination;
    if (sampleDest) {
      let draws = 0;
      const budget = UNCONSTRAINED_CANDIDATE_CAP * 8;
      while (n < UNCONSTRAINED_CANDIDATE_CAP && draws < budget) {
        draws++;
        const cand = sampleDest(current, rng());
        if (cand < 0) continue;
        let dup = false;
        for (let k = 0; k < n; k++) if (buf[k] === cand) { dup = true; break; }
        if (!dup) buf[n++] = cand;
      }
      return n;
    }
    while (n < UNCONSTRAINED_CANDIDATE_CAP) {
      const cand = Math.floor(rng() * state.M);
      let dup = false;
      for (let k = 0; k < n; k++) if (buf[k] === cand) { dup = true; break; }
      if (!dup) buf[n++] = cand;
    }
    return n;
  }

  const cap = state.params.candidateCap | 0;
  const top = state.graph.topDestinations;
  if (cap > 0 && top) {
    const K = state.graph.TOP_K;
    const c = Math.min(cap, state.graph.topCount[current]);
    for (let r = 0; r < c; r++) buf[n++] = top[current * K + r];
    buf[n++] = current;
    return n;
  }
  for (const j of state.graph.neighbors[current]) buf[n++] = j;
  buf[n++] = current;
  return n;
}

// Operates on preallocated buffers over [0, n). Overwrites `utils` with the
// softmax weights in place — the raw utilities aren't needed once maxU is known
// — so no weights array is allocated either. Arithmetic and summation order are
// unchanged from the array version, so results are bit-identical.
function softmaxPick(rng, ids, utils, n, temperature) {
  let maxU = -Infinity;
  for (let k = 0; k < n; k++) if (utils[k] > maxU) maxU = utils[k];
  let sum = 0;
  for (let k = 0; k < n; k++) { const e = Math.exp((utils[k] - maxU) / temperature); utils[k] = e; sum += e; }
  let r = rng() * sum;
  for (let k = 0; k < n; k++) {
    r -= utils[k];
    if (r <= 0) return ids[k];
  }
  return ids[n - 1];
}

function tick(state) {
  const p = state.params;
  const { N, M, E, L, tenure, aptitude, inst, rng, graph } = state;
  const { Ebar, count, Teach, transferEff } = institutionStats(state);

  let topE = 0, sumE0 = 0;
  for (let i = 0; i < N; i++) { if (E[i] > topE) topE = E[i]; sumE0 += E[i]; }
  // Reference for the above-mean brake: the population mean as it stands at the START
  // of this tick, so every person in this tick is braked against the same number and
  // the sweep order does not matter.
  const refE = sumE0 / N;
  // aiLevel is a fraction of the fixed t=0 top performer (state.startTopE), not of the
  // live/current one — a stable benchmark, not a moving target. topE above is the
  // live current top performer, still tracked and reported as its own metric, just
  // no longer used to derive aiLevel.
  const aiLevel = p.aiEnabled ? p.aiLevelFraction * state.startTopE : null;
  state.lastAiLevel = aiLevel;


  for (let i = 0; i < N; i++) {
    const j = inst[i];
    // What you are climbing toward: your institution's teaching capability — the mean
    // of its best teachTopN seniors — and never past your own ceiling.
    const source = Teach[j];
    const gap = (aptitude[i] < source ? aptitude[i] : source) - E[i];
    const below = p.aiEnabled && E[i] < aiLevel;
    let delta;
    if (gap > 0) {
      // learning: peers are stronger than you. AI reliance crowds this out —
      // below the AI's level, dampen it; the growth you would have had, you don't.
      delta = p.transferRate * gap * L[i];
      // Linear rather than exponential climb — see learningCap in DEFAULT_PARAMS.
      if (p.learningCap > 0) { const lim = p.learningCap * L[i]; if (delta > lim) delta = lim; }
      // Above the field, every further step costs more. Applied AFTER the cap, so the
      // cap stays the ceiling on a tick's learning and this only ever reduces it.
      if (p.aboveMeanDrag > 0 && E[i] > refE) delta /= 1 + p.aboveMeanDrag * (E[i] - refE);
      // An institution without a body of experts transfers less of what it knows.
      if (transferEff) delta *= transferEff[j];
      if (p.aiEnabled) delta *= below ? p.aiDampeningBelow : p.aiDampeningAbove;
    } else {
      // decay: peers are weaker than you, or you're idle relative to them. This is
      // never dampened by AI — reliance on AI actively accelerates it instead, since
      // it's the "use it or lose it" half of de-skilling, not the "didn't get to learn" half.
      const decay = p.decayRate * gap * L[i];
      // Countered by personal learning: even at/above the local ceiling, people keep
      // learning from being embedded in a strong institution — not gap-closing (there's
      // no local gap left to close) but general osmosis, scaled by how strong the
      // institution was to begin with.
      // Ambient growth respects the ceiling too, or it walks people straight past it.
      const headroom = (aptitude[i] < 1 ? aptitude[i] : 1) - E[i];
      let ambient = p.personalLearningRate * state.startEbar[j] * L[i] * (headroom > 0 ? headroom : 0);
      // AI-gated on the same below/above split as taught learning (2026-08). Organic
      // improvement IS learning — slower than being taught, but the same kind of thing —
      // so it is the channel by which someone who has already reached their institution's
      // teaching level can still get better, and the only one AI can act on for them.
      // Without this, gamma_above was a no-op for everyone who had arrived: they sit in
      // this branch with gap <= 0, which the learning multiplier never reaches.
      //
      // This REVERSES an earlier decision to leave ambient un-gated on the grounds that
      // it only sized a shared floor. That was true while it was the same in both arms;
      // it stopped being the right call once gamma_above was the dial people reached for
      // to preserve held expertise. Note this changes AI-on results — no-AI runs are
      // untouched, since the multiplier is only applied when aiEnabled.
      if (p.aiEnabled) ambient *= below ? p.aiDampeningBelow : p.aiDampeningAbove;
      delta = decay + ambient;
    }
    E[i] = clip01(E[i] + delta);
  }

  // Diffusion counters ride along with the mobility loop. They are counted HERE and not
  // by diffing inst[] afterwards, because turnover below reassigns inst as well: a diff
  // cannot tell a career move from a retirement, reads ~20% high at the calibrated
  // rates, and credits expertise transfer to entrants who have none.
  let moves = 0, moveExpertiseFlux = 0, upgradingArrivals = 0;
  for (let i = 0; i < N; i++) {
    if (rng() >= p.baseMoveProb * L[i]) continue;
    const from = inst[i];
    const cands = state.scratchCand, utils = state.scratchUtil;
    const nc = fillCandidates(state, i, rng);
    for (let k = 0; k < nc; k++) {
      const j = cands[k];
      const growth = Math.max(0, Ebar[j] - E[i]);
      const status = E[i] - Ebar[j];
      let u = (1 - p.competitionAversion) * growth + p.competitionAversion * status + p.prestigeWeight * graph.prestige[j];
      utils[k] = u;
    }
    const to = softmaxPick(rng, cands, utils, nc, MOVE_TEMPERATURE);
    inst[i] = to;
    // The current institution is always in the candidate set, so being selected to
    // consider a move is not the same as moving. Only a changed index counts.
    if (to !== from) {
      moves++;
      if (state.sinceMove) state.sinceMove[i] = 0;
      moveExpertiseFlux += E[i];
      // A move only transfers CAPABILITY if the arrival is better than what the
      // destination already teaches from; otherwise it is a lateral relocation that
      // moves a person without moving the ceiling anyone there learns against. Teach
      // is this tick's, i.e. the destination as it stood before the arrival.
      if (E[i] > Teach[to]) upgradingArrivals++;
    }
  }

  let removed = 0;
  for (let i = 0; i < N; i++) {
    if (rng() < p.turnoverRate) {
      const draw = sampleSkewNormalClipped(rng, p.entrantExpertiseMean, p.entrantExpertiseSpread, 0);
      E[i] = draw < p.entrantExpertiseFloor ? p.entrantExpertiseFloor : draw;
      L[i] = sampleLognormal(rng, p.learningRateSpread);
      if (state.tenure) state.tenure[i] = 0;      // a replacement starts from scratch
      if (state.aptitude) {
        state.aptitude[i] = p.aptitudeSpread > 0
          ? drawAptitude(rng, p.aptitudeMean, p.aptitudeSpread) : 1;
      }
      // Same sampler as initial placement — see sampleInstitution(). Placing
      // entrants uniformly here is what used to wash out any weighted sizing.
      inst[i] = sampleInstitution(state, rng);
      // A new person, so their career starts HERE. Recording the placement as their
      // origin is what puts entrants into the mixing measure instead of retiring the
      // slot out of it — without this the statistic only ever describes the t=0 cohort,
      // and that cohort is mostly gone within two careers.
      if (state.origin) state.origin[i] = inst[i];
      if (state.sinceMove) state.sinceMove[i] = 0;
      removed++;
    }
  }

  if (state.tenure) for (let i = 0; i < N; i++) state.tenure[i]++;
  if (state.sinceMove) for (let i = 0; i < N; i++) state.sinceMove[i]++;

  state.turnoverTotal += removed;

  state.t++;

  // Percentiles are taken from a fixed 1000-bin histogram over [0,1] rather than by
  // sorting. A sort is O(N log N) per tick and would cost roughly a third of tick time
  // at N=10500 — paid by every batch run, not just the page. Bucketing rides along in
  // the loop that already walks E, so the extra cost is one array write per person plus
  // a 1000-element scan. The price is resolution: percentiles are exact to 0.001, which
  // is finer than any use they have here.
  const PCTL_BINS = 1000;
  const eHist = new Int32Array(PCTL_BINS);
  let sumE = 0, belowCount = 0, expertCount = 0;
  let systemCapability = 0, systemCapabilityHuman = 0;
  for (let i = 0; i < N; i++) {
    sumE += E[i];
    const wi = capabilityWeight(E[i]);
    systemCapabilityHuman += wi;
    systemCapability += p.aiEnabled ? wi * aclLeverage(E[i], aiLevel, p) : wi;
    if (p.aiEnabled && E[i] < aiLevel) belowCount++;
    if (E[i] >= EXPERT_THRESHOLD) expertCount++;
    let b = (E[i] * PCTL_BINS) | 0;
    if (b < 0) b = 0; else if (b >= PCTL_BINS) b = PCTL_BINS - 1;
    eHist[b]++;
  }
  const meanE = sumE / N;

  // Nearest-rank percentiles, read off the cumulative histogram in one pass.
  const wantAt = [Math.ceil(0.10 * N), Math.ceil(0.50 * N), Math.ceil(0.90 * N)];
  const pctls = [0, 0, 0];
  {
    let cum = 0, k = 0;
    for (let b = 0; b < PCTL_BINS && k < 3; b++) {
      cum += eHist[b];
      while (k < 3 && cum >= wantAt[k]) { pctls[k] = (b + 0.5) / PCTL_BINS; k++; }
    }
  }
  const p10E = pctls[0], p50E = pctls[1], p90E = pctls[2];

  let activeCount = 0, sumEbar = 0;
  for (let j = 0; j < M; j++) if (count[j] > 0) { activeCount++; sumEbar += Ebar[j]; }
  const meanEbar = activeCount ? sumEbar / activeCount : 0;
  let varEbar = 0;
  for (let j = 0; j < M; j++) if (count[j] > 0) varEbar += (Ebar[j] - meanEbar) ** 2;
  varEbar = activeCount ? varEbar / activeCount : 0;

  // Occupancy diagnostics. Asymmetric mobility drains low-market-index
  // institutions by design (that is the brain-drain prediction), but an
  // institution that falls below MIN_MEANINGFUL_OCCUPANCY has an Ebar that is
  // mostly noise, so its internal dynamics stop meaning anything. Recorded per
  // tick rather than enforced, so a run can be judged rather than silently
  // rejected. Counted AFTER mobility and turnover, so it reflects the state the
  // next tick will actually run on.
  const occ = new Int32Array(M);
  for (let i = 0; i < N; i++) occ[inst[i]]++;
  let minOcc = Infinity, emptyInst = 0, underOcc = 0;
  for (let j = 0; j < M; j++) {
    if (occ[j] < minOcc) minOcc = occ[j];
    if (occ[j] === 0) emptyInst++;
    if (occ[j] < MIN_MEANINGFUL_OCCUPANCY) underOcc++;
  }

  // Mixing. Of everyone in the field, how many are still in the institution their career
  // started in? Measured over the WHOLE population, entrants included — each arrival
  // brings a fresh origin, so the statistic is stationary and keeps meaning something
  // after the founding cohort has gone.
  //
  // mixedBaseline is what originRetention would read if that cohort were scattered in
  // proportion to CURRENT institution sizes: the value retention decays toward, and the
  // comparator retention is meaningless without.
  //
  // Under the default uniform placement it comes out at almost exactly 1/M, and that is
  // correct rather than a bug worth "fixing" — the t=0 cohort is spread evenly over
  // institutions, so averaging each institution's current share over a uniform set of
  // origins returns 1/M however skewed sizes later become. Measured: sizes spanning 15x
  // at t=480 still give 2.63% against 1/M = 2.50%. It departs from 1/M only when the
  // ORIGINS are skewed, i.e. institutionSizing = "weighted" — which is what the
  // deployment configuration uses, so the term earns its keep there and is inert on BA.
  //
  // Costs one extra O(N) pass, which the percentile histogram above went to some trouble
  // to avoid paying twice. Measured at N=10500 on the world graph: 0.052 ms against a
  // 1.54 ms tick, i.e. 3.4%. Worth it for a number nothing else in the model reports;
  // if that ever stops being true, this is the pass to drop.
  let originHome = 0, mixedAcc = 0, sinceMoveAcc = 0;
  const origin = state.origin, sinceMove = state.sinceMove;
  if (origin) {
    for (let i = 0; i < N; i++) {
      const o = origin[i];
      if (inst[i] === o) originHome++;
      mixedAcc += occ[o];
      if (sinceMove) sinceMoveAcc += sinceMove[i];
    }
  }

  const entry = {
    t: state.t, meanE,
    // The shape of the distribution, not just its centre — a mean alone cannot tell a
    // field that is uniformly mediocre from one that is split into experts and novices.
    p10E, p50E, p90E,
    divergence: varEbar, topE, aiLevel,
    shareBelowAI: p.aiEnabled ? belowCount / N : null,
    shareExpert: expertCount / N,
    turnover: removed,
    turnoverTotal: state.turnoverTotal,
    // --- diffusion of expertise across the network (2026-08) --------------------
    // Career moves ONLY. Turnover reassigns inst too, but that channel carries
    // expertise outward — an experienced person disappears and a novice appears
    // somewhere unrelated — so folding the two together would report dilution as
    // transfer. Retirements are already reported above as `turnover`.
    //
    // All three are per-TICK counts, not rates. Annualise over a trailing window
    // rather than scaling one tick by TICKS_PER_YEAR: at the calibrated move
    // probability a single tick is a small integer and reads as pure noise.
    // The field's capability in threshold-expert equivalents — see capabilityWeight().
    // Measured at the END of the tick, like meanE and the percentiles, so the two agree.
    //
    // UNGATED by critical mass. When criticalMass > 0 the per-institution figures from
    // institutionStats() are each scaled by transferEff and will sum to LESS than this;
    // the difference is precisely the capability stranded in institutions too thin to
    // function, which is worth being able to see as a gap rather than folded away. With
    // the shipped criticalMass of 0 the two are identical.
    systemCapability,
    // The same field with the AI multiplier left off. Reported alongside because the
    // ratio of the two IS the leverage, and because a single number cannot distinguish
    // a field that got better from one that was propped up.
    systemCapabilityHuman,
    moves,
    moveExpertiseFlux,
    upgradingArrivals,
    originRetention: origin ? originHome / N : null,
    mixedBaseline: origin ? mixedAcc / (N * N) : null,
    // Average months a person has been in their current institution, by either route.
    // The timescale retention cannot give on its own: retention is a level, this is how
    // long it takes the field to turn over its arrangement of people.
    meanMonthsInPlace: sinceMove ? sinceMoveAcc / N : null,
    minOccupancy: minOcc === Infinity ? 0 : minOcc,
    emptyInstitutions: emptyInst,
    underOccupiedInstitutions: underOcc,
  };
  state.history.push(entry);
  return entry;
}

const API = {
  mulberry32, randNormal, sampleSkewNormalClipped, sampleLognormal, clip01,
  generateBAGraph, DEFAULT_PARAMS, EXPERT_THRESHOLD,
  capabilityWeight, CAPABILITY_RATIO, aclLeverage,
  MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, WORLD_MODEL_PARAMS, TICKS_PER_YEAR, MIN_MEANINGFUL_OCCUPANCY,
  CAREER_YEARS, FIELD_DIVISOR,
  initSim, institutionStats, tick, sampleInstitution,
};

// Dual-mode export, same pattern as world_model.js. Node gets CommonJS; the
// browser gets globalThis.Engine, so simulator.html <script src>es THIS file
// instead of carrying its own copy of the model. There was such a copy until
// 2026-08; nothing compared the two, so the interactive tool could silently
// simulate different dynamics from the ones the published results came from.
//
// No fallback if this file is missing: the page throws and renders nothing.
// A simulator that quietly runs a different model than the batch runs is worse
// than one that doesn't start.
if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
} else if (typeof globalThis !== "undefined") {
  globalThis.Engine = API;
}

})();
