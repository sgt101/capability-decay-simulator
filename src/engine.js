// Capability Decay Simulator — engine (framework-agnostic, testable under Node).
//
// Wrapped in an IIFE so this file exposes exactly one name: module.exports under
// Node, globalThis.Engine in a browser. simulator.html loads it via <script src>,
// and two classic scripts share one global scope, so top-level declarations here
// must not collide with declarations in the page.
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

// A ceiling on expertise, drawn by rejection so the density tapers to the boundary
// instead of piling mass at exactly 1.0, which clipping would do.
// APTITUDE_FLOOR keeps a ceiling from landing below the level entrants arrive at.
const APTITUDE_FLOOR = 0.02;
function drawAptitude(rng, mean, spread) {
  for (let k = 0; k < 64; k++) {
    const v = mean + randNormal(rng) * spread;
    if (v > APTITUDE_FLOOR && v < 1) return v;
  }
  return clip01(mean);      // pathological parameters: fall back rather than loop
}

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

// Sits near the middle of the range where the self-renewal/collapse contrast reads
// cleanly — see expert_threshold_sensitivity.js and README "Expert threshold".
const EXPERT_THRESHOLD = 0.585;

// --- capability -------------------------------------------------------------------
// What a person is worth, as distinct from how skilled they are. Expertise is linear
// and bounded in [0,1]; capability is not, because the top of a field does work the
// rest of it cannot do at all.
//
// w(E) = RATIO ^ ((E - EXPERT_THRESHOLD) / (1 - EXPERT_THRESHOLD))
//
// Anchored so w(EXPERT_THRESHOLD) = 1 and w(1) = CAPABILITY_RATIO. The unit is "one
// threshold expert": a capability of 8,363 means an institution is worth 8,363
// experts.
//
// Convex, not logarithmic — a log weighting would compress differences and say the
// opposite of what's intended here. Apply log10() on the output side instead, since
// capability spans several orders of magnitude.
const CAPABILITY_RATIO = 1000;
const CAPABILITY_EXP = 1 / (1 - EXPERT_THRESHOLD);
function capabilityWeight(E) {
  return Math.pow(CAPABILITY_RATIO, (E - EXPERT_THRESHOLD) * CAPABILITY_EXP);
}

// --- what AI does to that capability: asymmetric cognitive leverage ---------------
// AI multiplies what a person is already worth. It does not replace them, and it does
// not put a floor under them.
//
// Two effects, from Dell'Acqua et al. (HBS/BCG), measured on management consultants
// using a GPT-4-class model:
//
//   inside the AI's frontier   quality rises, more for weaker performers than strong
//                              ones — AI levels the field.
//   outside it                 quality falls for people who can't tell it's wrong.
//
// These are four numbers from one study of one profession on one model generation,
// applied here across 40-year careers and hundreds of institutions — parameters, not
// constants, so a run states what it assumed.
//
// Blended smoothly across E rather than split at a threshold: a step function at the
// median makes capability non-monotonic in expertise (someone just above the line
// worth less than someone just below it).
//
// Keyed to the AI's level, not the population median: the person who can't check the
// AI's work is the one it outranks, which is the same population aiDampeningBelow
// governs.
function aclLeverage(E, aiLevel, p) {
  // Share of work inside the frontier: a better AI safely covers more.
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
  // t=0 population above, which represents an already-running, mixed-skill system.
  // Entrants only become expert via peer transfer, so if AI dampens that transfer
  // they stay stuck near zero — and as more of the population is replaced by stuck
  // entrants, institution averages fall further, so nearby experts decay faster too.
  // See spec.html "Entrant renewal".
  entrantExpertiseMean: 0.05, entrantExpertiseSpread: 0.05,
  // Lower bound on an entrant's draw (skew-normal clipped to [0,1]). Without a floor,
  // draws pile up at the boundary. Set to 0 to allow unfloored draws.
  entrantExpertiseFloor: 0.05,
  graphAttachment: 2,
  transferRate: 0.5, decayRate: 0.01, learningRateSpread: 0.4,
  // What you learn on your own once there's nobody left to teach you. Someone who has
  // reached their institution's teaching level is in the decay branch — the taught
  // channel needs a positive gap and they have none — so this is the only route by
  // which they keep improving: slower than being taught, but not zero.
  //
  // Scaled by the institution's FOUNDING average (state.startEbar, fixed at init),
  // not its live one — anchoring to the live average creates a runaway feedback loop
  // (top performers raise the average, which raises personal learning further).
  //
  // PIPELINE_PARAMS overrides this to 0.005 for the calibrated configuration.
  personalLearningRate: 0.001,
  // --- recruitment shock ------------------------------------------------------------
  // A hiring freeze: for a window of years, only a fraction of retirements are
  // refilled. Off by default (recruitmentShockYears = 0).
  //
  // Retirement and hiring are separate steps: retirement vacates a slot, and hiring
  // fills it only if a hire happens. state.active marks which slots hold a person.
  //
  // No catch-up: outside the window every retirement is replaced one for one, so
  // vacancies from the freeze are never worked off and the headcount loss is
  // permanent.
  recruitmentShockStart: 0,     // tick the freeze begins; ignored when Years is 0
  recruitmentShockYears: 0,     // length of the freeze, in years
  recruitmentFraction: 1,       // share of retirements still refilled during it; 1 = no freeze
  mobilityMode: "hybrid", jumpProbability: 0.10,
  competitionAversion: 0.5, prestigeWeight: 0.3, baseMoveProb: 0.05,
  turnoverRate: 0.01,
  // --- entrant pipeline -------------------------------------------------------
  // Both default to 0 = off. Learning is gap-proportional, so it's exponential —
  // fastest when furthest behind — and unconstrained an entrant reaches the expert
  // threshold in a couple of years rather than the intended ~8.
  //
  // learningCap makes the climb roughly linear in time: the most expertise one tick
  // of peer learning can add. Time from the entrant floor to expert is about
  // (0.585 - floor) / cap months.
  learningCap: 0,
  // Who you learn FROM. 0 = the plain institution mean, which includes fellow
  // trainees, so a long pipeline drags the mean down and every target follows it.
  // Above 0, the target is the mean over members with at least this many years of
  // tenure, so trainees no longer dilute what they're climbing toward.
  //
  // Tenure, not rank: a rank-based target (e.g. the top half) ratchets — raising the
  // top half raises the target, which raises the top half. Tenure doesn't respond to
  // expertise, so the target stays a balance point people above it decay back toward.
  seniorTenureYears: 0,
  // --- who becomes what: differentiating careers after training ------------------
  // Without these, everyone converges on the same teaching level and veterans become
  // indistinguishable once they reach it.
  //
  // aptitude: a person's ceiling, drawn at entry. People differ in the expertise they
  // can attain, not only in how fast they get there. 0 = off, everyone can reach 1.0.
  // Drawn by rejection, not clipped — see drawAptitude() — so ceilings don't pile up
  // at exactly 1.0.
  aptitudeMean: 0.75,
  aptitudeSpread: 0,
  // Teaching level: the mean of an institution's best N seniors, counted in absolute
  // numbers, not a percentile — a percentile is scale-free, so it can't make
  // institutions differ by size however much size varies. 0 = off, the plain senior
  // mean.
  teachTopN: 0,
  // --- the brake: learning gets harder the further you are above the field ---------
  // Slows the learning branch (never decay) for anyone above the population mean, by
  // the factor 1 / (1 + aboveMeanDrag * (E - meanE)). 0 = off, and off is exactly
  // 1.0.
  //
  // A brake, not a target: it only ever shrinks a learning delta, so it never pushes
  // anyone down and never carries anyone past the hard caps (aptitude, teacher
  // level). The reference is the live population mean, which does rise as the field
  // learns, easing the brake for those it had slowed — bounded positive feedback,
  // since the mean itself can't rise past the ceiling distribution.
  //
  // Spreads the field without needing an implausibly high teaching target: the upper
  // half of the climb is slow enough that a 40-year career doesn't finish it.
  aboveMeanDrag: 0,
  // --- critical mass: an institution needs a body of experts to transfer anything ---
  // Expertise transfer isn't one person handing knowledge to another — it needs
  // enough people that the tacit part survives one person leaving. Below
  // criticalMass experts, an institution teaches at reduced efficiency; 0 = off
  // (every institution teaches at full efficiency regardless of size).
  //
  // Keyed to the absolute expert count rather than institution rank, because
  // institution sizes vary widely on the graph while teaching capability barely
  // varies with them otherwise — Teach is the mean of the top quartile, and a small
  // institution's best quarter is as good as a big one's.
  criticalMass: 0,
  // Hill exponent: how abruptly efficiency falls away below criticalMass. ~1 is a
  // gentle slope, >=8 is effectively a hard cutoff.
  criticalMassSharpness: 2,
  // Efficiency scales the RATE of transfer, not the target. Scaling the target
  // instead is unconditionally unstable: expert count would set the target and the
  // target would set expert count, with nothing anchoring the loop.
  aiEnabled: false,
  // The AI's reference level, in absolute expertise units (aiLevel = aiLevelFraction
  // * startTopE, and startTopE is 1.0 for any realistic N). Defaults to
  // EXPERT_THRESHOLD: "as good as a human we'd call expert." Sits below the
  // saturation plateau (~0.65) where aiDampeningAbove stops mattering to anybody.
  aiLevelFraction: EXPERT_THRESHOLD,
  // Two consequences of one claim, kept as separate dials: "novices lean on AI and
  // can't verify it" affects LEARNING (aiDampeningBelow, the growth they don't get)
  // and OUTPUT (aclNoviceDeficit, below — the unverified errors they ship). One
  // multiplies a rate of change, the other a level, so they're set independently
  // rather than derived from a single shared dial.
  aiDampeningBelow: 0.30, aiDampeningAbove: 0.80,

  // --- asymmetric cognitive leverage: what AI does to CAPABILITY (see aclLeverage) ---
  // From Dell'Acqua et al. (HBS/BCG). Parameters, not constants — four numbers from
  // one study, stretched a long way, so a run records what it assumed.
  aclNoviceGain: 0.43,        // inside the frontier, bottom-half performers
  aclExpertGain: 0.17,        // inside the frontier, top-half performers
  aclNoviceDeficit: 0.19,     // outside it, for those who can't catch errors
  // How sharply the novice regime gives way to the expert one, in expertise units.
  // Large values approach a hard bin and reintroduce non-monotonicity.
  aclBlendSharpness: 20,
  // F = aiLevel ^ frontierBreadth. 1 = the frontier is exactly the AI's level.
  frontierBreadth: 1,

  seed: 1,

  // --- world-model graph support -----------------------------------------------
  graphSource: "ba",           // "ba" | "worldModel"
  worldModel: null,            // a loadWorldModel() result, not a path — keeps
                                // this file fs-free and browser-compatible
  institutionSizing: "uniform",// "uniform" | "weighted" (intake-proportional)
  // Top-K mobility heuristic. 0 = off (evaluate the full near-neighbour set). When >
  // 0, an agent considers only its K highest-affinity destinations, which matters
  // because mobility dominates runtime. World-model mode only — the BA graph has no
  // affinity ordering to take a top-K of.
  candidateCap: 0,
};

// --- the declared time base -------------------------------------------------------
// CAREER_YEARS is the calibration career length MONTHLY_TICK_PARAMS and
// WORLD_MODEL_PARAMS were fitted at — not the career length of a running model.
// turnoverRate is a live control, so the actual career length of any run is
// 1 / (params.turnoverRate * TICKS_PER_YEAR).
const TICKS_PER_YEAR = 12;
const CAREER_YEARS = 40;

// Calibrated for the declared time base: 1 tick = 1 month, career = 40 years = 480
// ticks. DEFAULT_PARAMS above assumes a dimensionless tick and does not survive this
// reading.
//
// Kept as a separate overlay rather than folded into DEFAULT_PARAMS, so configs that
// omit it keep running under plain DEFAULT_PARAMS. Apply with:
//   initSim(Object.assign({}, MONTHLY_TICK_PARAMS, yourParams))
//
// See calibrate_time_base.js and paper.md, "Time, turnover, and population scale".
//
// Selected for a stationary no-AI baseline, so meanE_shortfall reads as "what AI
// removed" rather than "what AI removed plus wherever the baseline drifted to".
const MONTHLY_TICK_PARAMS = {
  turnoverRate: 1 / (CAREER_YEARS * TICKS_PER_YEAR),   // ~0.0021 — a 40-year career
  transferRate: 0.15,      // equilibrium meanE ~0.63 at world-model scale
  decayRate: 0.020,        // counterweight; sets where that equilibrium sits
};
// Parameters this engine no longer supports. A config naming one fails loudly rather
// than silently running on defaults while its CSV row still advertises the
// parameter. See README's "Removed parameters" for the reasoning behind each.
const REMOVED_PARAMS = {
  aiRelianceIntensity: "set aiDampeningBelow directly (the old mapping was 1 - rho)",
  aiAtrophyMultiplier: "the atrophy branch is gone; AI now acts only by dampening learning",
  mobilityFriction: "the affinity-priced move penalty is gone",
  entrantExpertiseSkew: "entrant draws are unskewed; it was pinned at 0 everywhere",
  aiGain: "the observed-capability channel C was removed, and with it every dial that shaped it",
  aiResponseMode: "the observed-capability channel C was removed, and with it every dial that shaped it",
  ambientGrowthRate: "renamed to personalLearningRate — same units and default, but it is now AI-gated by aiDampeningBelow/Above",
  // These three were one mechanism: a pool, a draw from it, and a cap on the draw.
  // Per-person teacher assignment is gone; everyone now learns from Teach[j], their
  // institution's teaching level.
  teachPercentile: "teachTopN replaced it — an absolute count, not a percentile",
  teacherTermYears: "per-person teachers are gone; teachTopN made a persistent per-person draw pointless",
  teachCapacity: "it only ever rationed a pool that is no longer drawn from",
};

// Calibrated entrant pipeline — see calibrate_pipeline.js. Layered over
// MONTHLY_TICK_PARAMS rather than folded into it, so configs that omit it keep
// running under the plain time-base calibration. See DEFAULT_PARAMS.learningCap for
// what the two pipeline mechanisms do.
const PIPELINE_PARAMS = {
  learningCap: 0.0056,        // ~8 years from the entrant floor to expert
  seniorTenureYears: 8,       // learn from those past the pipeline, not fellow trainees
  decayRate: 0.027,           // re-fitted for the longer pipeline
  aptitudeSpread: 0.20,       // ceilings ~N(0.75, 0.20), clipped to [0,1]
  personalLearningRate: 0.005,
  // Absolute count, not a percentile — otherwise the teaching target is the plain
  // senior mean, which includes everyone still climbing and collapses the field.
  teachTopN: 8,
  // Learning slows the further above the field you are; keeps the top of the
  // distribution populated without extending time-to-expert.
  aboveMeanDrag: 16,
};

// The deployment calibration: the configuration this model actually runs in, fitted
// by calibrate_worldmodel.js on the world-model graph. Layered over
// MONTHLY_TICK_PARAMS and PIPELINE_PARAMS for the same reproducibility reason.
//
// N matters here because below it the people-per-institution distribution stops
// matching the world model's own, and institution-level mechanisms measure noise
// rather than signal.
//
// How far the simulated field is scaled down from the real one. The world model's
// own data implies a real headcount far past what this engine can run interactively.
// Both sides of the intake identity scale together, so a simulated career is still
// 40 years and simulated intake is still exactly 1/FIELD_DIVISOR of real intake. See
// suggestedN() in world_model.js.
const FIELD_DIVISOR = 200;

const WORLD_MODEL_PARAMS = {
  N: 11322,                   // matches the world model's own size distribution —
                               // suggestedN(wm, CAREER_YEARS, FIELD_DIVISOR)
  baseMoveProb: 0.01,         // a move every ~7 years
  learningCap: 0.0048,
  learningRateSpread: 1.0,
  teachTopN: 8,               // absolute pool, so institution size buys teaching quality
};

const MOVE_TEMPERATURE = 0.12;
const UNCONSTRAINED_CANDIDATE_CAP = 25;

// Below this occupancy, an institution's internal dynamics are mostly noise: peer
// learning runs on gap = Ebar[j] - E[i], and a k-member institution attenuates that
// gap to (k-1)/k — exactly zero at k=1. Reported per tick rather than enforced.
const MIN_MEANINGFUL_OCCUPANCY = 5;

// Cumulative-weight sampling, shared by initial placement and turnover — applying
// weighted sizing only at init would wash out within ~50 ticks. See
// world-model-plan.md D2.
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

  // Reject unknown-but-removed keys rather than ignore them, so a stale config fails
  // loudly instead of silently running on defaults.
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
    // M is derived from the data, not configured — fail rather than silently pick
    // one of two conflicting values.
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
  // Months served, drawn across a whole career at t=0 rather than starting everyone
  // at zero — a real field is a mix of tenures, and starting them all "new" would
  // leave no seniors to learn from for the first several years.
  //
  // Drawn from its own generator, not the main rng — taking draws from the main
  // stream here would shift every downstream value.
  const tenure = new Int32Array(N);
  // Aptitude ceilings, also drawn from tenureRng for the same reason.
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

  // Fixed for the whole run: the highest E at t=0. aiLevel is a fraction of this
  // fixed benchmark, not the live top performer, so it doesn't chase the
  // population's own trajectory as it grows or collapses over the run.
  let startTopE = 0;
  for (let i = 0; i < N; i++) if (E[i] > startTopE) startTopE = E[i];

  // Each institution's own founding average, fixed at init — the anchor for
  // personalLearningRate. Using the live average instead would create unbounded
  // positive feedback, since the live average is itself moved by this same effect.
  const startEbar = new Float32Array(params.M);
  const startCount = new Int32Array(params.M);
  for (let i = 0; i < N; i++) { startEbar[inst[i]] += E[i]; startCount[inst[i]]++; }
  for (let j = 0; j < params.M; j++) startEbar[j] = startCount[j] > 0 ? startEbar[j] / startCount[j] : 0;

  // Each person's career-start institution, for the mixing measurement in tick().
  // Reset when someone retires and is replaced, so an entrant gets a fresh origin
  // rather than dropping out of the measure.
  const origin = Int32Array.from(inst);
  // Ticks since this person last changed institution, by either route — a mixing
  // timescale distinct from retention: retention says how many are still where they
  // began, this says how long the average person has been where they are.
  const sinceMove = new Int32Array(N);
  // Which slots hold a person. Everyone is present at t=0; a recruitment freeze is
  // the only thing that clears a bit, and only a hire sets one back. Every
  // population statistic below runs over active slots only — a vacancy is an absent
  // person, not a person with expertise 0.
  const active = new Uint8Array(N).fill(1);

  return {
    active, activeCount: N,
    params, rng, graph,
    N, M: params.M,
    E, L, tenure, aptitude, inst,
    // Reusable mobility scratch, bounded by M+1 (every institution plus the current
    // one), allocated once per run rather than once per moving agent per tick.
    scratchCand: new Int32Array(params.M + 1),
    scratchUtil: new Float64Array(params.M + 1),
    institutionCDF,
    startTopE, startEbar, origin, sinceMove,
    t: 0,
    // Cumulative turnover events since t=0 — one retirement and one entrant per
    // event, kept as a running total so scrubbing to an earlier tick reads the value
    // as of that tick.
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
  // Experts per institution, in absolute numbers — the input to critical mass below.
  const experts = new Int32Array(M);
  // Capability, in threshold-expert equivalents (see capabilityWeight/aclLeverage).
  // capabilityHuman is the same sum without the AI multiplier, carried alongside so
  // the gap between the two — the leverage — can be read directly.
  const capability = new Float64Array(M);
  const capabilityHuman = new Float64Array(M);
  const aiOn = state.params.aiEnabled;
  const aiLevel = aiOn ? state.params.aiLevelFraction * state.startTopE : 0;
  const active = state.active;
  for (let i = 0; i < state.N; i++) {
    if (!active[i]) continue;                 // vacant slot: no person, no expertise
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
  // plain mean per institution where there are no seniors.
  const senior = state.params.seniorTenureYears;
  let Teach = Ebar;
  if (senior > 0 && state.tenure) {
    const minMonths = senior * TICKS_PER_YEAR;
    const sSum = new Float64Array(M), sCount = new Int32Array(M);
    for (let i = 0; i < state.N; i++) {
      if (active[i] && state.tenure[i] >= minMonths) { sSum[inst[i]] += E[i]; sCount[inst[i]]++; }
    }
    Teach = new Float32Array(M);
    for (let j = 0; j < M; j++) Teach[j] = sCount[j] > 0 ? sSum[j] / sCount[j] : Ebar[j];

    // teachTopN: what a place can teach is the mean of its best N seniors in
    // absolute numbers, not its best quarter — a percentile is scale-free, so a
    // small institution's best quarter would read as good as a big one's. An
    // absolute count makes the top of a big place genuinely deeper.
    if (state.params.teachTopN > 0) {
      const nTop = state.params.teachTopN;
      const byInst = Array.from({ length: M }, () => []);
      for (let i = 0; i < state.N; i++) if (active[i] && state.tenure[i] >= minMonths) byInst[inst[i]].push(E[i]);
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
  // Critical mass: how well an institution can transfer expertise at all, as a
  // function of how many experts it has (a Hill function). sharpness ~1 is a smooth
  // falloff; >=8 is close to a hard threshold at criticalMass experts.
  //
  // Keyed to the absolute expert count, not size rank — a rank-based measure would
  // let the biggest institution hold full efficiency however few experts it had
  // left, so it could never register the whole field thinning out.
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
  // Critical mass scales what an institution can DO as well as what it can teach, so
  // every reader of `capability` sees the same number. Exactly 1.0 when off.
  if (transferEff) for (let j = 0; j < M; j++) {
    capability[j] *= transferEff[j];
    capabilityHuman[j] *= transferEff[j];
  }

  return { Ebar, count, Teach, experts, transferEff, capability, capabilityHuman };
}

// Fills state.scratchCand with the candidate institution indices for this person and
// returns how many. Writes into a preallocated buffer rather than returning a fresh
// Set/Array to avoid per-agent allocation on the mobility hot path.
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

// Softmax pick over preallocated buffers, [0, n). Overwrites `utils` with the
// softmax weights in place, so no separate weights array is allocated.
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
  const { N, M, E, L, tenure, aptitude, inst, rng, graph, active } = state;
  const { Ebar, Teach, transferEff } = institutionStats(state);

  let sumE0 = 0, nActive = 0;
  for (let i = 0; i < N; i++) {
    if (!active[i]) continue;
    sumE0 += E[i]; nActive++;
  }
  // Reference for the above-mean brake: the population mean at the START of this
  // tick, so every person is braked against the same number and sweep order doesn't
  // matter.
  const refE = nActive ? sumE0 / nActive : 0;
  // A fraction of the fixed t=0 top performer (state.startTopE), not the live one —
  // a stable benchmark, not a moving target. The live top performer is tracked and
  // reported separately below, after this tick's updates.
  const aiLevel = p.aiEnabled ? p.aiLevelFraction * state.startTopE : null;
  state.lastAiLevel = aiLevel;

  for (let i = 0; i < N; i++) {
    if (!active[i]) continue;
    const j = inst[i];
    // What you're climbing toward: your institution's teaching capability, never
    // past your own ceiling.
    const source = Teach[j];
    const gap = (aptitude[i] < source ? aptitude[i] : source) - E[i];
    const below = p.aiEnabled && E[i] < aiLevel;
    let delta;
    if (gap > 0) {
      // Learning: peers are stronger than you. AI reliance below the AI's level
      // dampens the growth you'd otherwise have.
      delta = p.transferRate * gap * L[i];
      // Linear rather than exponential climb — see learningCap in DEFAULT_PARAMS.
      if (p.learningCap > 0) { const lim = p.learningCap * L[i]; if (delta > lim) delta = lim; }
      // Applied after the cap, so this only ever reduces the tick's learning further.
      if (p.aboveMeanDrag > 0 && E[i] > refE) delta /= 1 + p.aboveMeanDrag * (E[i] - refE);
      // An institution without a body of experts transfers less of what it knows.
      if (transferEff) delta *= transferEff[j];
      if (p.aiEnabled) delta *= below ? p.aiDampeningBelow : p.aiDampeningAbove;
    } else {
      // Decay: peers are weaker than you, or you're idle relative to them. Never
      // dampened by AI — reliance on AI accelerates it instead ("use it or lose it").
      const decay = p.decayRate * gap * L[i];
      // Countered by personal learning: general osmosis from a strong institution,
      // scaled by how strong it was to begin with, even with no local gap left to
      // close. Respects the aptitude ceiling.
      const headroom = (aptitude[i] < 1 ? aptitude[i] : 1) - E[i];
      let ambient = p.personalLearningRate * state.startEbar[j] * L[i] * (headroom > 0 ? headroom : 0);
      // AI-gated the same way as taught learning: the only channel by which someone
      // who has already reached their teaching level can still improve, so it's
      // where aiDampeningAbove actually acts on them.
      if (p.aiEnabled) ambient *= below ? p.aiDampeningBelow : p.aiDampeningAbove;
      delta = decay + ambient;
    }
    E[i] = clip01(E[i] + delta);
  }

  // Diffusion counters are counted here rather than by diffing inst[] afterwards,
  // because turnover below reassigns inst too — a diff can't tell a career move from
  // a retirement, and would credit expertise transfer to entrants who have none.
  let moves = 0, moveExpertiseFlux = 0, upgradingArrivals = 0;
  for (let i = 0; i < N; i++) {
    if (!active[i]) continue;
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
    // The current institution is always a candidate, so being considered for a move
    // isn't the same as moving — only a changed index counts.
    if (to !== from) {
      moves++;
      if (state.sinceMove) state.sinceMove[i] = 0;
      moveExpertiseFlux += E[i];
      // A move only transfers capability if the arrival is better than what the
      // destination already teaches from (Teach as it stood before the arrival);
      // otherwise it's a lateral relocation.
      if (E[i] > Teach[to]) upgradingArrivals++;
    }
  }

  // --- retirement, then hiring ---------------------------------------------------
  // Two steps: retirement vacates a slot, hiring is a separate decision that may or
  // may not fill it. Hire probability is 1 outside the freeze window (every
  // retirement replaced, headcount conserved) and recruitmentFraction inside it (a
  // share of retirements go unreplaced). See DEFAULT_PARAMS.recruitmentShockYears.
  const shockYears = p.recruitmentShockYears || 0;
  const shockFrom = p.recruitmentShockStart || 0;
  const inShock = shockYears > 0
    && state.t >= shockFrom
    && state.t < shockFrom + shockYears * TICKS_PER_YEAR;
  const hireProb = inShock ? p.recruitmentFraction : 1;

  let removed = 0, hired = 0;
  for (let i = 0; i < N; i++) {
    if (!active[i]) continue;                   // already vacant; nothing retires from it
    if (rng() >= p.turnoverRate) continue;
    removed++;
    // Drawn whether or not the slot is refilled, so the RNG stream doesn't depend on
    // the freeze and a frozen run stays comparable to an unfrozen one at the same
    // seed.
    const draw = sampleSkewNormalClipped(rng, p.entrantExpertiseMean, p.entrantExpertiseSpread, 0);
    const newL = sampleLognormal(rng, p.learningRateSpread);
    const newApt = p.aptitudeSpread > 0 ? drawAptitude(rng, p.aptitudeMean, p.aptitudeSpread) : 1;
    const newInst = sampleInstitution(state, rng);
    // No draw consumed when there's no freeze, so hireProb === 1 reproduces the
    // unfrozen RNG sequence exactly.
    const takeIt = hireProb >= 1 || rng() < hireProb;
    if (!takeIt) { active[i] = 0; continue; }   // nobody hired: the slot stays empty
    hired++;
    E[i] = draw < p.entrantExpertiseFloor ? p.entrantExpertiseFloor : draw;
    L[i] = newL;
    if (state.tenure) state.tenure[i] = 0;      // a replacement starts from scratch
    if (state.aptitude) state.aptitude[i] = newApt;
    inst[i] = newInst;
    // A new person, so their career starts here — this is what puts entrants into
    // the mixing measure instead of retiring the slot out of it.
    if (state.origin) state.origin[i] = inst[i];
    if (state.sinceMove) state.sinceMove[i] = 0;
  }
  state.activeCount = 0;
  for (let i = 0; i < N; i++) if (active[i]) state.activeCount++;
  state.hiredTotal = (state.hiredTotal || 0) + hired;

  if (state.tenure) for (let i = 0; i < N; i++) state.tenure[i]++;
  if (state.sinceMove) for (let i = 0; i < N; i++) state.sinceMove[i]++;

  state.turnoverTotal += removed;

  state.t++;

  // Percentiles are taken from a fixed 1000-bin histogram over [0,1] rather than by
  // sorting, which is cheaper at scale. Bucketing rides along in the loop that
  // already walks E. Resolution is 0.001, finer than any use they have here.
  const PCTL_BINS = 1000;
  const eHist = new Int32Array(PCTL_BINS);
  const endSumE = new Float64Array(M);
  const occ = new Int32Array(M);
  let sumE = 0, belowCount = 0, expertCount = 0;
  let systemCapability = 0, systemCapabilityHuman = 0;
  let topE = 0;
  for (let i = 0; i < N; i++) {
    if (!active[i]) continue;                 // a vacancy is an absent person, not E = 0
    sumE += E[i];
    endSumE[inst[i]] += E[i];
    occ[inst[i]]++;
    if (E[i] > topE) topE = E[i];
    const wi = capabilityWeight(E[i]);
    systemCapabilityHuman += wi;
    systemCapability += p.aiEnabled ? wi * aclLeverage(E[i], aiLevel, p) : wi;
    if (p.aiEnabled && E[i] < aiLevel) belowCount++;
    if (E[i] >= EXPERT_THRESHOLD) expertCount++;
    let b = (E[i] * PCTL_BINS) | 0;
    if (b < 0) b = 0; else if (b >= PCTL_BINS) b = PCTL_BINS - 1;
    eHist[b]++;
  }
  // Over the active headcount, not N — under a recruitment freeze the two differ,
  // and dividing by N would read a shrinking field as falling expertise per person.
  const An = state.activeCount;
  const meanE = An ? sumE / An : 0;

  // Nearest-rank percentiles, read off the cumulative histogram in one pass.
  const wantAt = [Math.ceil(0.10 * An), Math.ceil(0.50 * An), Math.ceil(0.90 * An)];
  const pctls = [0, 0, 0];
  {
    let cum = 0, k = 0;
    for (let b = 0; b < PCTL_BINS && k < 3; b++) {
      cum += eHist[b];
      while (k < 3 && cum >= wantAt[k]) { pctls[k] = (b + 0.5) / PCTL_BINS; k++; }
    }
  }
  const p10E = pctls[0], p50E = pctls[1], p90E = pctls[2];

  const endEbar = new Float32Array(M);
  let occupiedInst = 0, sumEbar = 0;
  for (let j = 0; j < M; j++) if (occ[j] > 0) {
    endEbar[j] = endSumE[j] / occ[j];
    occupiedInst++;
    sumEbar += endEbar[j];
  }
  const meanEbar = occupiedInst ? sumEbar / occupiedInst : 0;
  let varEbar = 0;
  for (let j = 0; j < M; j++) if (occ[j] > 0) varEbar += (endEbar[j] - meanEbar) ** 2;
  varEbar = occupiedInst ? varEbar / occupiedInst : 0;

  // Occupancy diagnostics, reported rather than enforced. Asymmetric mobility drains
  // low-market-index institutions by design; an institution below
  // MIN_MEANINGFUL_OCCUPANCY has an Ebar that's mostly noise. Counted after mobility
  // and turnover, so it reflects the state the next tick will run on.
  let minOcc = Infinity, emptyInst = 0, underOcc = 0;
  for (let j = 0; j < M; j++) {
    if (occ[j] < minOcc) minOcc = occ[j];
    if (occ[j] === 0) emptyInst++;
    if (occ[j] < MIN_MEANINGFUL_OCCUPANCY) underOcc++;
  }

  // Mixing: of everyone in the field, how many are still in the institution their
  // career started in? Measured over the whole population, entrants included — each
  // arrival brings a fresh origin, so the statistic stays meaningful after the
  // founding cohort is gone.
  //
  // mixedBaseline is what originRetention would read if that cohort were scattered
  // in proportion to current institution sizes — the value retention is compared
  // against. Under uniform placement it comes out at almost exactly 1/M; it departs
  // from that only when origins are skewed (institutionSizing = "weighted").
  let originHome = 0, mixedAcc = 0, sinceMoveAcc = 0;
  const origin = state.origin, sinceMove = state.sinceMove;
  if (origin) {
    for (let i = 0; i < N; i++) {
      if (!active[i]) continue;
      const o = origin[i];
      if (inst[i] === o) originHome++;
      mixedAcc += occ[o];
      if (sinceMove) sinceMoveAcc += sinceMove[i];
    }
  }

  const entry = {
    t: state.t, meanE,
    // Distribution shape, not just the centre — separates a uniformly mediocre
    // field from one split into experts and novices.
    p10E, p50E, p90E,
    divergence: varEbar, topE, aiLevel,
    shareBelowAI: p.aiEnabled ? (An ? belowCount / An : 0) : null,
    shareExpert: An ? expertCount / An : 0,
    // Headcount as a fraction of the establishment. 1 unless a recruitment freeze
    // has left slots empty; lets a capability or expertise change be read against
    // how much of the field is still there.
    activeFraction: An / N,
    turnover: removed,
    turnoverTotal: state.turnoverTotal,
    // --- diffusion of expertise across the network -------------------------------
    // Career moves only. Turnover reassigns inst too, but carries expertise
    // outward (an experienced person leaves, a novice appears elsewhere), so it's
    // reported separately above as `turnover`.
    //
    // Per-tick counts, not rates — annualise over a trailing window rather than
    // scaling one tick, since at the calibrated move probability a single tick is a
    // small integer and reads as noise.
    // Capability in threshold-expert equivalents, measured at the end of the tick
    // like meanE and the percentiles. Ungated by critical mass: when criticalMass >
    // 0 the per-institution figures from institutionStats() sum to less than this,
    // and the difference is capability stranded in institutions too thin to
    // function.
    systemCapability,
    // The same field with the AI multiplier left off, so the ratio of the two gives
    // the leverage.
    systemCapabilityHuman,
    moves,
    moveExpertiseFlux,
    upgradingArrivals,
    originRetention: origin ? (An ? originHome / An : 0) : null,
    mixedBaseline: origin ? (An ? mixedAcc / (An * An) : 0) : null,
    // Average months a person has been in their current institution, by either
    // route — the timescale retention alone can't give.
    meanMonthsInPlace: sinceMove ? (An ? sinceMoveAcc / An : 0) : null,
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

// Dual export: Node gets CommonJS, the browser gets globalThis.Engine, so
// simulator.html uses this file directly via <script src> instead of carrying its
// own copy of the model.
//
// No fallback if this file is missing: the page throws and renders nothing. A
// simulator that quietly runs a different model than the batch runs is worse than
// one that doesn't start.
if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
} else if (typeof globalThis !== "undefined") {
  globalThis.Engine = API;
}

})();
