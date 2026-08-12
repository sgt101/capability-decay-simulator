# Known problems

Open problems with the model, its data, and the implementation. Each entry states
what the problem is, the evidence for it, why it matters, and what would resolve
it — so a future reader can tell a known limitation from a bug worth chasing.

Severity is about impact on **conclusions**, not on how hard it is to fix:

- **Blocking** — results should not be relied on until resolved.
- **Qualifying** — results are usable but must be reported with this caveat.
- **Housekeeping** — real, but doesn't change any conclusion.

Everything quantitative here was measured, not estimated.

---

## Model

### P1. The world-model graph barely affects expertise outcomes
**Severity: qualifying** — but it undercuts the rationale for the world-model work.

`meanE_shortfall` at t=1440, `aiDampeningBelow = 0`, from
`results-worldmodel/worldmodel.1/`:

| `mobilityFriction` | 0 | 0.05 | 0.1 | 0.2 | 0.4 |
|---|---|---|---|---|---|
| shortfall | 0.525 | 0.522 | 0.521 | 0.520 | 0.520 |

An eightfold change in mobility friction moves the headline metric by 0.005. The
whole affinity apparatus — geographic tiers, bloc structure, the asymmetric
economic gradient — is close to a no-op for how much expertise exists.

**Why:** the graph is consumed in only two places, both in the mobility step.
Learning and decay run on `gap = Ebar[j] - E[i]`, an institution's *internal*
mean, which is indifferent to how that institution is wired to others. A better
topology changes the **sorting** of people across institutions, not the mechanism
by which they gain or lose expertise. This was predicted in `paper.md` before it
was measured; the measurement confirms it.

**What it means:** the world model buys realism in *where people are*, not in
*how much expertise exists*. That is genuinely useful for distributional
questions ("does expertise concentrate in high-index hubs?") and should be used
for those. It should **not** be expected to change the AI-erosion result, and any
write-up that implies otherwise is overclaiming.

**Resolution:** requires a modelling change, not more or better data — some
channel coupling graph position to learning. Candidates: cross-institution
learning (you learn from neighbours, not just colleagues), institution-level AI
adoption (so AI exposure varies by where you are), or institution-level rather
than population-level `ai_level`.

### P2. Asymmetric mobility drains institutions below meaningful occupancy
**Severity: qualifying**

Baseline arm, t=1440, of 245 institutions:

| `mobilityFriction` | 0 | 0.05 | 0.1 | 0.2 | 0.4 |
|---|---|---|---|---|---|
| min occupancy | 1.3 | 0.7 | 0.8 | 0.8 | 0.7 |
| under-occupied (<5) | 12.7 | 21.1 | 21.5 | 22.3 | 27.8 |

5–11% of institutions fall below `MIN_MEANINGFUL_OCCUPANCY`. Friction makes it
**worse**, not better — it traps people in high-market-index locations by
penalising the move back down.

**Why it matters:** in a `k`-member institution your own `E` is `1/k` of `Ebar`,
so the peer gap attenuates to `(k-1)/k` — at `k=1` it is exactly zero. Those
institutions have no meaningful internal dynamics, yet still contribute to
population aggregates like `meanE`.

**Not purely a defect.** Net flow toward deep markets is the brain-drain
phenomenon the asymmetric gradient was built to represent. The diagnostics
(`minOccupancy`, `emptyInstitutions`, `underOccupiedInstitutions`) are recorded
per tick rather than enforced for exactly that reason.

**Resolution:** judge every run on the diagnostics. If it needs suppressing:
cap γ, add a retention/home-bias term, or floor occupancy. Note that a floor
would be suppressing a prediction, so it should be a declared intervention.

### P3. Stationarity is a narrow ridge, not a region
**Severity: qualifying**

The calibration must keep the no-AI baseline *stationary*, and only a thin
diagonal band of (`transferRate`, `decayRate`) does. Scanned against the world
model (`node calibrate_time_base.js --world-model`), 3 of 25 cells qualified:

| | `decayRate` 0.016 | 0.020 | 0.024 |
|---|---|---|---|
| `transferRate` 0.17 | +0.041 drift | +0.023 | **+0.002 ok** |
| 0.15 | +0.028 | **+0.006 ok** | −0.015 |
| 0.13 | **+0.008 ok** | −0.017 | −0.036 |

Off the ridge in either direction the baseline drifts by 0.02–0.08 across the
horizon. Worse, the ridge **moves with the graph and with `N`** — the BA scan at
M=100 recommends a different cell than the world-model scan, and the equilibrium
level is mildly N-dependent.

So any change to the dynamics, the graph, or the population size invalidates the
calibration. Re-scan with `--world-model`, then verify the winner at production
`N` — never re-derive by scaling from the old values.

### P4. `shareExpert` is `meanE` amplified, not a second measurement
**Severity: qualifying**

Measured across 5 seeds × 6 timepoints:
**`correlation(meanE, shareExpert) = 0.987`**. The scatter is a clean monotone
curve. `shareExpert` carries essentially no information `meanE` does not.

The amplification is ~16x, because the population distribution is tight
(`sd(E) ≈ 0.06`): a 0.04 shift in the mean sweeps most of the population across
the threshold. Under the *old* drifting calibration this was severe — `meanE`
moved 7% while `shareExpert` went 0.80 → 0.05, and seed spread at t=2400 was
0.007 on `meanE` against **0.303** on `shareExpert`.

Under the current stationary calibration the baseline sits at `meanE ≈ 0.63`,
comfortably above `EXPERT_THRESHOLD = 0.585`, so baseline `shareExpert` is ~0.95
and stable (seed spread 0.012). But that is the other failure mode: it now has
little *downward* range, and none upward.

**Use `meanE_shortfall` as the headline metric.** Read `shareExpert` as a
threshold-crossing indicator only, never as a linear measure of how much
expertise exists. If it needs to be usable as a headline, raise
`EXPERT_THRESHOLD` to ~0.63 so it sits in the sensitive band — but note that
puts it back on the knife edge P4 describes.

### P5. `N`, `turnoverRate` and career length are one parameter swept as three
**Severity: blocking for any run that sweeps `turnoverRate`**

`headcount = annual intake × career length` is an identity, and
`career = 1/turnoverRate`. So sweeping `turnoverRate` sweeps career length, which
should move `N` — but the sweep design treats axes as independent, so `N` stays
put and the run silently violates the identity.

**Resolution:** either freeze `turnoverRate` in world-model mode, or add
derived-parameter support to `generate_experiments.js` so `N` follows. Until then,
do not sweep `turnoverRate` in world-model configs.

### P6. The mobility cost model is unfalsifiable
**Severity: qualifying**

`mobility-costs.json` — geo tiers, sector tiers, bloc adjacency, γ — is entirely
assumption. `world-model.json` contains 5 talent-flow edges total, far too few to
fit or test against. The tiers can be tuned until behaviour looks plausible, and
nothing in the dataset can contradict them.

Mitigated in practice by P1: since friction barely affects outcomes, the
unfalsifiable parameters are also low-impact. That is luck, not design.

**Resolution:** systematically collected flow volumes (`PLACES_GRADUATES_IN` with
counts). This is the single most valuable future data addition — and the only one
that would let the cost model be *validated* rather than merely fitted.

---

## Data

### P7. Intake figures are formulaic, not observed
**Severity: qualifying**

`intake_estimate_central` is populated 245/245, but all 43 distinct
`intake_estimate_basis` strings have the form
`"Large base x 2.0 sector x 1.0 mechanism"`. It is a deterministic function of
`org_size_band` × `sector` × `entry_mechanism_id` and carries **no independent
information**. Genuinely observed intake: `annual_intake_low` 3/245,
`annual_intake_high` 4/245, `applications_per_cycle` 2/245. `size_basis` reads
`"inferred - coarse band, verify"` for **all 245**.

This propagates: `N` is now *derived* from intake (`N = 40 × intake / divisor`),
so the population size inherits a three-factor formula's coarseness. Fine as a
relative weighting; **not** calibrated headcount, and should never be described as
such.

### P8. `market_index` values are unsourced assumptions
**Severity: qualifying**

The values in `add_geo_attributes.js` are coarse judgements about relative market
depth, normalised to United States = 1.00. They drive the entire asymmetry
mechanism. Stamped `market_index_basis: "assumption - ... not sourced"` so they
cannot be mistaken for data.

**Resolution:** replace with a citable source (financial-centre index, sector
compensation survey). Low effort, meaningful credibility gain.

### P9. Confidence is low across most of the dataset
**Severity: qualifying**

`data_confidence`: Low 141 (58%), Medium 49, High 55. `geo_source`: inferred 116,
source 80, research 49.

### P10. Affiliation edges are unweighted
**Severity: qualifying**

`LOCATED_IN` has no weight, so JPMorgan's New York presence and its Sydney
presence count equally — for both affinity (any shared city scores 1.00) and
entrant placement (intake is allocated with no idea where it geographically
lands). 52 organisations occupy more than one hub; JPMorgan occupies 8.

**Resolution:** add a headcount-share `weight` to `LOCATED_IN`. Identified in
`world-model-plan.md` §7 as the highest-value schema change.

### P11. Single-valued facts are stored twice
**Severity: housekeeping**

`IN_SECTOR` (245 edges) duplicates `org.sector` exactly — one per organisation,
zero mismatches. `PART_OF` duplicates `org.country`/`org.region`, also zero
mismatches. Nothing prevents them diverging in future.

**Resolution:** pick one source of truth per fact. For `hub_city`, keep the edges
authoritative and rename the scalar `primary_hub` so it reads as derived.

### P12. Four organisations have zero intake
**Severity: housekeeping**

Grupo Financiero Inbursa, Grupo Aval, Davivienda, Banco de Crédito e Inversiones
— also the only four missing `entry_mechanism_id`. Under intake-weighted entry
they would receive no entrants at all. Currently handled by
`zeroIntakePolicy: "floor1"`, which is a workaround for missing data, not a fix.

---

## Implementation gaps

### ~~P13. `simulator.html` cannot load a world model~~ — RESOLVED
See R4.

### ~~P14. `report.html` cannot show world-model results~~ — RESOLVED
See R8.

### ~~P15. No pairwise world-model experiment set~~ — RESOLVED
`generate_worldmodel_experiments.js` writes 21 files (`7 choose 2`) into
`experiments/`, with the BA set moved to `experiments-ABGraph/`.

> The prediction in the original entry was **wrong** and worth recording as
> such. It expected the structural parameters (`mobilityFriction`, γ, the bloc
> toggle) to be the interesting ones and `expertiseMean` /
> `entrantExpertiseMean` to be irrelevant. Measured, the opposite held:
> `mobilityFriction` moved `meanE_shortfall` by 0.005 across an eightfold
> change (P1) and was demoted to fixed, while `entrantExpertiseMean` moves the
> shortfall by 0.062 at the pinned `aiLevelFraction` — comparable to the
> largest effects in the study (P18).

### ~~P16. `aiLevelFraction` is pinned at 0.70, inside a saturated plateau~~ — RESOLVED
The pin moved to `EXPERT_THRESHOLD` (0.585), below the plateau. The measurement
below is kept because it is what justified the move, and because the saturation
above λ≈0.65 is still a property of the model worth knowing when reading the
6 experiments that sweep λ.

**Severity when open: qualifying** — affected 15 of 21 experiments

λ is a *threshold*: agents below it get AI dampening and atrophy, agents above
get neither. Measured at the pinned `aiRelianceIntensity = 0.25`, the shortfall
rises smoothly with λ and then flattens:

```
λ=0.01   +0.001
λ=0.208  +0.012
λ=0.406  +0.027
λ=0.554  +0.043
λ=0.604  +0.077
λ=0.653  +0.111   <- plateau begins
λ=0.703  +0.113   <- the pinned default
λ=1.000  +0.115
```

Equilibrium `meanE` is ~0.63, so once λ clears that, essentially the whole
population is below the threshold and raising λ further changes nothing.

The pin sits **inside the plateau**. That is a defensible choice — λ is locally
insensitive there, so the pin is not balanced on an edge — but it means every
λ-pinned experiment reports the *saturated* regime, i.e. the maximum-effect case
rather than a typical one. Any headline erosion number from those 15 files
should be read as an upper bound with respect to λ.

The same fact explains why `aiDampeningAbove` measures ~0.002 variance explained
wherever λ is pinned: above λ≈0.65 there is almost nobody left above the
threshold for it to govern. That parameter is not weak, it is switched off by
the pin — at λ=0.01 it drives a 0.74 spread in shortfall.

> **Correction.** An earlier version of this entry claimed the AI effect was
> *identically zero* below λ≈0.65. That was measured on the old 11-parameter
> set, where `aiDampeningBelow` was pinned at 1.0 — with no learning dampening
> the only AI channel was atrophy on below-λ agents, and at low λ there are
> none. Now that `aiRelianceIntensity` sweeps `aiDampeningBelow`, a learning
> channel is always present and the low-λ region is live. The shape is
> saturation above the threshold, not a dead zone below it.

### P17. `aiLevelFraction` is not a fraction of anything
**Severity: cosmetic, but it misleads**

`aiLevel = aiLevelFraction × startTopE`, documented as "a fraction of the t=0
population's single greatest expert". Measured, `startTopE` is **1.0 for every
value of `expertiseMean`** from 0 to 0.8 — with N = 10,504 draws and `clip01`,
the initial maximum always hits the ceiling. So `aiLevel = aiLevelFraction`, an
absolute expertise threshold.

Harmless numerically, but it means the parameter's name and documentation
describe a coupling to the starting population that does not exist. It also
explains why `aiLevelFraction × expertiseMean` does not collapse onto their
product (rank-R² 0.134) while λ alone gives 0.685.

### P18. Four of the seven study parameters move the baseline, not just the AI arm
**Severity: affects how the headline metric should be read**

`aiRelianceIntensity`, `aiDampeningAbove` and `aiLevelFraction` appear only
behind `aiEnabled`, so the no-AI arm is mathematically independent of them.
`transferRate`, `decayRate`, `expertiseMean` and `entrantExpertiseMean` move
both arms. Baseline `meanE` across each grid, measured at t=1440:

| experiment | baseline `meanE` range | spread |
|---|---|---|
| γ_below × γ_above | 0.627 → 0.635 | **0.008** |
| δ × α | 0.493 → 0.808 | 0.316 |
| λ × E₀ | 0.416 → 0.797 | 0.381 |
| E₀ × entrant | 0.406 → 0.891 | 0.485 |
| β × δ | 0.329 → 0.898 | **0.569** |

`meanE_shortfall` of 0.09 against a baseline of 0.33 and against 0.90 are not
the same quantity, and the latter is compressed against the ceiling. Some of
the apparent "interesting dynamics" along those four axes is the baseline
moving rather than AI biting. Read them with `meanE_baseline` alongside.

Two collapses worth knowing, both measured as rank-R² of a 1-D reduction:
`δ × α` collapses onto `δ·(α−1)` at **0.946** (which is just the algebra: excess
decay in the AI arm is `δα − δ`), and `β × δ` onto `δ/β` at **0.937** (the
equilibrium-setting ratio).

### ~~P19. `aiRelianceIntensity = +1` is an absorbing state~~ — RESOLVED
See R11.

---

## Potential optimisations

### ~~O1. Allocation churn in the mobility path~~ — RESOLVED
See R6.

### O2. Top-K candidate heuristic — measured, and NOT recommended
**Implemented as `candidateCap`, default 0 (off). Kept as an option; the
measured trade is poor.**

The idea: instead of evaluating every near neighbour, an agent considers only its
K highest-affinity destinations (precomputed as `topDestinations`, sorted once at
load). Measured at N=10,504, t=1440, 3 seeds:

| `candidateCap` | ms/tick | speedup | meanE (no AI) | shortfall | under-occupied |
|---|---|---|---|---|---|
| off (~14.4 cands) | 1.081 | 1.00x | 0.5558 | 0.3467 | **25** |
| 12 | 0.940 | 1.15x | 0.5598 | 0.3537 | 51 |
| 8 | 0.859 | 1.26x | 0.5639 | 0.3582 | 57 |
| 4 | 0.781 | 1.38x | 0.5690 | 0.3640 | **76** |
| 2 | 0.735 | 1.47x | 0.5724 | 0.3699 | 69 |

**Two reasons not to use it.**

*The speedup is capped low.* Candidate evaluation is only 32% of the tick — going
from ~14 candidates to 2 saves 0.35 ms of 1.08. Even eliminating it entirely caps
at ~1.47x, because 68% of the tick is per-mover fixed overhead (allocation, `Set`
construction, call overhead) and the O(N) passes. The candidate count was never
the bottleneck. Note the starting point is ~14.4 candidates, not 245 — the search
was already bounded by the near-neighbour set and the jump cap.

*The fidelity cost lands on the worst possible metric.* Under-occupied
institutions go from 25 to 51 at K=12 and **76 at K=4** — a 3x worsening of P2,
the drain problem, which is already a flagged limitation. Restricting everyone to
the same few high-affinity destinations concentrates agents there and starves the
rest. meanE drift (+0.017 at K=2, ~3%) is tolerable; tripling the number of
institutions whose internal dynamics are meaningless is not.

**Conclusion:** O1 is the better lever — it targets the 68% (per-mover fixed
cost) rather than the 32%, and costs no fidelity at all. `candidateCap` is left
in place, defaulted off, for anyone who wants speed and does not care about the
occupancy distribution.

---

## Resolved

Kept for the record — both were found by running the code, not by reading it.

### R1. `buildRow` serialised the entire world model into every CSV row
`Object.assign({}, sim.params)` copied `params.worldModel` — a full graph with
Sets and an affinity closure — into all 450 rows. Failed after ~2 minutes of
compute with an unhelpful `[batch] undefined`. Now copies scalars only and
records `worldModelFingerprint` for identity instead.

### R2. The `M`-cannot-be-swept guard fired in BA mode
First version rejected `M` in `config.params` unconditionally, which would have
blocked a legitimate BA sweep. Now scoped to `graphSource === "worldModel"`,
where `M` is genuinely derived from the data.

### R7. The no-AI baseline drifted, making meanE_shortfall uninterpretable
The monthly-tick calibration `(transferRate 0.13, decayRate 0.024)` was selected
on dynamic range and looked healthy, but was **not stationary**: its equilibrium
(`meanE ≈ 0.56`) sat below where the initial transient settled (`≈ 0.60`), so the
baseline sagged for the whole run and well beyond it (world-model scale,
`N=10,504`, 3 seeds):

| t | 120 | 480 | 960 | 1440 |
|---|---|---|---|---|
| meanE baseline | 0.5975 | 0.5818 | 0.5700 | 0.5622 |

−0.035 across the horizon and still falling ten careers later, at which point
`shareExpert` had gone 0.80 → 0.05. `meanE_shortfall` was therefore measuring
"what AI removed, plus wherever the baseline had wandered to".

Recalibrated to **`transferRate = 0.15`, `decayRate = 0.020`**, verified at
production scale over 3 seeds:

| t | 120 | 480 | 960 | 1440 |
|---|---|---|---|---|
| meanE baseline | 0.6291 | 0.6289 | 0.6293 | **0.6294** |

Drift **+0.0002** across three careers, AI shortfall 0.369, seed spread on the
shortfall 0.0042. No initialisation change was needed — the old drift was not a
bad starting point but an equilibrium in the wrong place, and at (0.15, 0.020)
the default init lands on the equilibrium by itself.

`calibrate_time_base.js` had two flaws that let this through, both fixed: it
never tested stationarity at all (it selected on dynamic range and
time-to-expert), and it scanned a **BA graph at M=100** while calibrating for a
245-institution world model. It now measures drift across the real 1440-tick
horizon, **rejects** any cell drifting more than 0.010, ranks survivors by
flatness, and takes `--world-model` to scan the graph actually being used.

### R6. Allocation churn in the mobility path
Every moving agent allocated four short-lived objects — a `Set`, an `Array.from`
copy, a utilities array from `.map`, and a weights array inside `softmaxPick` —
about **2,250 allocations per tick** at N=10,504.

Replaced with preallocated per-run scratch buffers on `state` (`scratchCand`
Int32Array, `scratchUtil` Float64Array, both M+1 long, ~2KB at M=245).
`candidateInstitutions` became `fillCandidates`, which writes into the buffer and
returns a count; `Set`-based dedupe became a linear scan (at <=25 entries a scan
over a contiguous Int32Array beats hashing plus allocation); and `softmaxPick`
now works in place, overwriting the utilities with the softmax weights rather
than building a second array.

**1.35x faster** — 1.052 -> 0.780 ms/tick. Cumulative with R5: **4.5x** off the
original 3.52 ms/tick. The 55-experiment batch went 109 -> 31 -> **23 CPU-hours**
(~2.9h wall at 8 workers). GC dropped from 1.6% of samples to 1.0%.

> Those CPU-hour figures are for the 55-experiment, 15x15 set that was current
> at the time. This speedup is what paid for the return to 21x21: the present
> 21-experiment set at 21x21 x 3 replicates costs ~17 CPU-hours, measured at
> 645 s per experiment on 14 workers.

**Bit-identical output**, which was verified rather than assumed: nine
configurations (BA default / AI on / unconstrained / edge_constrained / large M,
world-model plain / weighted+friction / top-K / jump-only) were hashed over the
full per-tick history plus final institution assignments before and after the
change. All nine matched exactly. Arithmetic and summation order were preserved
deliberately so this would hold.

Post-fix profile: mobility is still the largest block, but `fillCandidates` is now
9.1% and `softmaxPick` 3.4%, with the remainder inlined into `tick`. Remaining
headroom is modest and would mean restructuring the per-agent loop itself.

### R5. Affinity rejection sampling was 75% of engine runtime
Profiling the world-model engine showed mobility at 86% of each tick, of which
the jump branch alone was 75% — it rejection-sampled candidates against
`affinity()`, needing ~350 evaluations (each doing linear scans over
`hubIds`/`countryIds`/`blocs`) to accept 25 distinct destinations.

Replaced with a precomputed row-major cumulative-affinity table
(`affinityCDF`, M x M float64, ~469KB at M=245, built once in ~19ms). Sampling is
now an O(log M) binary search, and `affinityAt()` reads a single affinity as a
CDF difference in O(1), which the mobility-friction term uses instead of
recomputing.

**3.3x faster** — 3.52 -> 1.05 ms/tick, taking the 55-experiment batch from 109
to 31 CPU-hours (~3.9h wall at 8 workers).

Also strictly more correct: the old sampler silently topped up **uniformly**
whenever it exhausted its 500-try budget, so low-affinity institutions got a
partly-uniform candidate set rather than an affinity-weighted one. The
replacement samples exactly — verified against the true weights to within
sampling noise (max deviation 1.3e-3 at 120k draws).

World-model results therefore differ from any produced before this change. The
fingerprint carries `sampler:v2-cdf` and moved `2d79575e` -> `a2a0fec2`, so old
and new CSVs are distinguishable. BA runs are unaffected (no affinity function).

### R4. `simulator.html` had no world-model support
Now has a "World model graph" sidebar group: an on/off toggle mirroring
`batch_run.js`'s `fixed.graphSource`, file inputs for `world-model.json` and
`mobility-costs.json`, an intake-weighted-sizing checkbox, and a live
`mobility_friction` slider. `M` is derived from the data and the `M` field is
ignored while it is on.

The page pulls in `world_model.js` with `<script src>` rather than carrying a
second copy of the loader — the browser and `batch_run.js` share one
implementation, so there is nothing to drift. If the file is not alongside the
page, the controls disable themselves and the simulator still runs in BA mode.
`dom_stub_test.js` exercises the whole path against the real project data.

### R11. The rho = +1 absorbing state, and the lambda pin that made it worse
Two changes, which turned out to interact.

`aiLevelFraction` now defaults to `EXPERT_THRESHOLD` (0.585) rather than 0.70.
"The AI is as good as a human we would call expert" is a stated quantity rather
than an arbitrary pick, and 0.585 sits below the saturation plateau that starts
around 0.65 — so λ-pinned figures no longer all report the maximum-effect
regime, and `aiDampeningAbove` has a population to govern again.

`entrantExpertiseFloor` (default 0.05) stops entrants arriving at exactly 0.

Neither alone was sufficient, and the reason is worth recording. The floor fixes
the trap only where entrants land *above* λ:

| λ | floor | meanE at ρ=0.9 | meanE at ρ=1.0 |
|---|---|---|---|
| 0.01 | 0 | 0.6244 | 0.0894 |
| 0.01 | 0.05 | 0.6365 | 0.6353 |
| 0.585 | 0 | 0.0749 | 0.0209 |
| 0.585 | 0.05 | 0.0930 | 0.0557 |

At λ = 0.585 entrants at 0.05 are still far below the threshold, so `γ_below`
still governs them. What removes the *discontinuity* is that at this λ the
collapse becomes gradual — by ρ = 0.8 the system has already largely gone, so
ρ = 1 is the end of a trend rather than a cliff. Measured across the top of the
range, meanE now steps by 1.18x, 1.22x, 1.36x (ρ = 0.85 → 1.00), against the
~70x jump before.

The full ρ profile at the new default, N = 10,504, t = 1440, baseline
meanE = 0.6371:

```
  rho   gamma_below   meanE     shortfall
 -1.0      2.00       0.7210     -0.0840
 -0.4      1.40       0.6849     -0.0479
  0.0      1.00       0.6371     +0.0000
  0.4      0.60       0.3935     +0.2436
  0.8      0.20       0.1293     +0.5077
  1.0      0.00       0.0557     +0.5814
```

Monotone, signed, with an exact zero at ρ = 0.

Regression-tested three ways in `test_world_model.js`: no entrant can arrive
below the floor at any mean; the ρ 0.9→1.0 ratio must stay under 3x; and the
no-AI baseline must remain stationary, since the floor is not AI-gated and
therefore moves the baseline (drift 0.0025 with it on).

> **Not resolved by this: `shareExpert_shortfall` saturates.** At λ = 0.585,
> `shareExpert` hits exactly 0 for ρ ≳ 0.35, so about half the positive ρ range
> is floored on that metric. `meanE_shortfall` stays informative across the whole
> range and is the metric to read.

> **Residual, one cell:** the entrant draw is skew-normal(mean, 0.05, 0) and the
> floor bites when the mean is within a spread of it, so at the bottom of the
> `entrantExpertiseMean` axis (nominal 0.05) about half of entrants land exactly
> on the floor and the realised mean is 0.070. Realised tracks nominal from
> ~0.14 upward. A shape artifact in one cell of 21, not a degeneracy.

### R8. `build_report.js` read the wrong manifest, collapsing every grid to one cell
`build_report.js` hardcoded `experiments.manifest.json` — the **BA** manifest —
while `results/` held **world-model** runs. The manifest supplies the x/y axis
keys; the CSV only supplies columns. For experiment 6 it looked up
`learningRateSpread × transferRate`, found both columns present but *constant*
(0.4 and 0.13), and grouped all 675 rows per tick into a **single averaged
cell**. Every experiment past #5 was affected, and each still rendered as a
plausible-looking heatmap.

Fixed: the manifest, results directory and output path are now flags
(defaulting to the world-model set), and a degenerate-axis guard refuses to
write anything if a manifest-declared sweep axis has fewer than two distinct
values in the results.

### R9. The report payload exceeded the maximum string length
At 21×21 the report failed to build with `RangeError: Invalid string length`.
The cause was not data volume but **key-name repetition**: the payload stored
one object per cell, so `"shareExpert_treatment"` and its eleven siblings — about
175 bytes of key names — were re-encoded 2,910,600 times (441 × 120 × 55). At
15×15 it squeaked in at 196 MB; 21×21 pushed it past V8's ~536,870,888-character
ceiling and `JSON.stringify` threw before `template.replace` even ran.

Fixed three ways: the payload is **columnar** (one flat array per metric,
indexed `(xi·nY + yi)·nT + ti`, so key names are paid once per experiment
rather than once per cell), values are rounded to 5 decimals (1e-5 resolution on
metrics living in [-1,1], far finer than 3-replicate noise), and the file is
**streamed** one experiment at a time rather than built as a single string.
Result: 180 MB at 21×21, smaller than the 196 MB the 15×15 build produced with
1.96× the data. The two `exp.cells.find()` linear scans over 52,920 cells became
O(1) indexing as a side effect.

### R10. Axis labels mixed three precisions on one ruler
`fmtNum` chooses precision from each value's own magnitude (4dp below 0.01, 3dp
above) then strips trailing zeros. Correct for metrics, wrong for an axis:
`decayRate` printed as `0.005 0.0067 0.0085 0.01 0.012`, and the same parameter
rendered differently depending on which chart you were on.

Precision is now chosen once **per parameter**, from every value it takes
anywhere in the report. The rule is *rounding error under a tenth of the axis's
own step*, not merely "labels are distinct" — distinctness alone let `decayRate`
through at 3dp, where an evenly spaced grid prints as `0.005 0.007 0.009 0.010`
and looks unevenly spaced. Parameters that only ever appear held-fixed have no
step and fall back to within 0.5% of their own value, which also stops
`turnoverRate = 0.00208` collapsing to `0`.

### R3. Weighted institution sizing was erased by turnover
`engine.js` placed turnover entrants uniformly, so any intake-weighted
distribution decayed to uniform within ~50 ticks (measured: a 50% share fell to
3%). Init and turnover now share `sampleInstitution()`. Regression-tested — after
1000 ticks, intake-vs-occupancy correlation is 0.451 weighted vs 0.083 uniform.

> Note: that test only isolates placement with `prestigeWeight = 0`. With prestige
> left at its default, occupancy tracks intake through a *second* channel —
> `prestigeFrom: "intake"` means mobility pulls people toward high-intake
> institutions regardless of where they entered (uniform placement still shows
> r = 0.82). Worth remembering when interpreting occupancy.
