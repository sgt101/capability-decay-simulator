# Capability Decay Simulator

Agent-based model of institutions and humans where reliance on AI erodes the
real expertise (`E`) behind their output over time. See [spec.html](spec.html)
for the full design, [simulator.html](simulator.html) for the interactive
visualizer, and this file for running sweeps headlessly.

The model also tracks an "observed capability" (`C`) that AI can inflate
above real expertise — useful for studying the illusion of competence, but
it's a secondary axis. The headline question this simulator is built to
answer is narrower and darker: **how much real expertise does AI reliance
destroy, relative to what would have existed without it** — see
`aiAtrophyMultiplier` and `pairWithBaseline` below.

Decline is compounding, not a one-time step down, because new entrants
(everyone who arrives after t=0, via turnover) start as genuine novices and
only become expert by learning from stronger peers — see
`entrantExpertiseMean` below and "Entrant renewal" in spec.html. If AI
suppresses that transfer, entrants never rise, and their growing numbers
drag down institution averages for existing experts too.

## Batch runner

`batch_run.js` runs the same engine (`engine.js`) many times across a
parameter sweep and writes the results to CSV — no browser needed.

```bash
node batch_run.js --config sweep.json --out results.csv --summary-out results_summary.csv
```

### Worked example: how much does AI obliterate expertise?

`sweep.example.json` sweeps `aiAtrophyMultiplier` (how hard AI reliance erodes
expertise a human already has), `aiLevelFraction`, and `turnoverRate`, 3
replicates each, recording at t=100/300/600. It sets `"pairWithBaseline": true`,
which — for every parameter combo — runs a same-seed `aiEnabled:false` twin
alongside the `aiEnabled:true` run, so what comes out is a *shortfall against
a matched no-AI counterfactual*, not a number that only makes sense in
isolation:

```bash
node batch_run.js --config sweep.example.json --workers 4
```

```
[batch] 36 parameter combination(s) x 3 replicate(s) (x2 for baseline+treatment pairing) = 216 run(s)
[batch] each run simulates up to t=600, recording at t=100,300,600
[batch] running with 4 workers
[batch] worker 4/4 finished (1/4)
...
[batch] 216 runs -> 648 rows in 1.3s
[batch] wrote results.csv (648 rows)
[batch] wrote results_summary.csv (216 rows, mean/std across replicates)
[batch] wrote results_shortfall.csv (324 rows — baseline vs AI, positive shortfall = AI eroded it)
```

(worker finish order and timing will vary run to run — that's not a bug, workers race)

`results_shortfall.csv` is the one to open first — a real row from it:

```
aiAtrophyMultiplier=1  t=100  meanE_baseline=0.537  meanE_treatment=0.489  meanE_shortfall=0.048
aiAtrophyMultiplier=1  t=300  meanE_baseline=0.545  meanE_treatment=0.480  meanE_shortfall=0.065
```

Averaged across the whole sweep at t=600, the shortfall rises with the dial
it should rise with:

```
aiAtrophyMultiplier=1.0   mean shortfall = 0.040
aiAtrophyMultiplier=2.0   mean shortfall = 0.059
aiAtrophyMultiplier=3.0   mean shortfall = 0.065
aiAtrophyMultiplier=4.0   mean shortfall = 0.074
```

`results.csv` has one row per run per recorded tick (216 runs × 3 recorded
ticks = 648 rows), every parameter included, ready for `pandas`/R/Excel.
`results_summary.csv` groups those rows by parameter combination, arm, *and*
tick (36 combos × 2 arms × 3 ticks = 216 rows), giving `_mean`/`_std` across
the 3 replicates. `results_shortfall.csv` joins each combo's baseline and
treatment arm on their shared seed and reports `meanE_shortfall` and
`shareExpert_shortfall` directly — `positive` always means AI made it worse.

`sweep.random.example.json` shows the other mode — 10 parameters drawn
continuously at once, for exploring a wide space without the combinatorial
blowup of a full grid. (It doesn't use `pairWithBaseline`; add it the same
way if you want a wide random sweep to also report shortfalls.)

### Parameter-pair experiment set (`experiments/experiment.1.json` .. `experiments/experiment.21.json`)

One file per unordered pair of **seven** study parameters, with every other
parameter pinned identically across all 21 files. 21, not 42: `A×B` and `B×A`
are the same grid transposed, so only the `7 choose 2` unordered pairs are
generated.

The seven, and why these:

| Parameter | Role |
|---|---|
| `transferRate` | sets the baseline equilibrium (with `decayRate`) |
| `decayRate` | sets the baseline equilibrium (with `transferRate`) |
| `aiRelianceIntensity` | **AI-only.** One dial for both halves of de-skilling |
| `aiDampeningAbove` | **AI-only.** Learning multiplier above the AI's level |
| `aiLevelFraction` | **AI-only.** Where that threshold sits |
| `expertiseMean` | starting expertise of the t=0 population |
| `entrantExpertiseMean` | starting expertise of later entrants |

Narrowed from an earlier eleven after reviewing a full 21×21 × 55 run.
`turnoverRate`, `learningRateSpread` and `mobilityFriction` were demoted to
fixed because they moved the primary metrics little relative to the rest
(see `problems.md` P1 for the last of those). Separately,
`aiDampeningBelow` and `aiAtrophyMultiplier` were **replaced by one
parameter**: they gate on the same condition and act on disjoint branches of
the update, so they are two consequences of a single cause. See
"Coupled reliance" below.

**The two groups matter more than the count.** `aiRelianceIntensity`,
`aiDampeningAbove` and `aiLevelFraction` appear only behind `aiEnabled`, so the
no-AI arm is mathematically independent of them and the baseline holds still
while they sweep. The other four move *both* arms — across
`transferRate × decayRate` the baseline `meanE` spans 0.33 to 0.90. A shortfall
of 0.09 against a baseline of 0.33 and against 0.90 are not the same quantity,
so read those four with the `meanE_baseline` metric alongside the shortfall.

Each file is a 21×21 grid with `pairWithBaseline: true`, giving a 2D heatmap of
that pair's interaction on the expertise shortfall, recorded yearly (`recordAt`
every 12 ticks to 1440) so you can watch it evolve rather than only see the
endpoint. Ranges are re-centred on the monthly-tick calibration rather than
copied from the BA set: the usable `transferRate` band under this time base is
roughly 0.11-0.15, so a naive `[0,1]` sweep would spend most of its cells either
collapsed or pinned at the ceiling, measuring nothing. Every range has a comment
above it in `generate_worldmodel_experiments.js` explaining the choice.

`experiments.worldmodel.manifest.json` lists which pair is in which file, plus
the values swept and the fixed baseline.

> **The BA set is separate.** `experiments-ABGraph/` holds the older
> Barabási–Albert set (`generate_experiments.js`,
> `experiments.manifest.json`, 55 files, 11 params). The two are **not
> comparable** — different topology under a different calibration — so they
> live in separate directories and write to separate results directories.

Run all of them, or a subset, into `results/experiment.<n>/`:

```bash
./run_experiments.sh                    # all 21
./run_experiments.sh 3 7 12             # just these
./run_experiments.sh --workers 14       # more worker threads on a bigger machine
./run_experiments.sh --workers 14 3 7   # both together, any order
./run_experiments.sh --redo             # re-run even already-completed experiments
```

**Resume.** An experiment is skipped if its `results_shortfall.csv` already
exists. That file is written last, and `batch_run.js` writes via temp-file +
atomic rename, so its presence guarantees all three CSVs completed — there is no
truncated-file case to worry about. If a long batch is interrupted, just rerun
the same command; it picks up where it stopped.

Resume is per *experiment*, not per run: `batch_run.js` buffers a whole
experiment in memory and writes at the end, so an interrupt loses that
experiment's work and it restarts from the beginning. Everything before it is
kept.

**Cost.** 21×21 = 441 cells × 3 replicates × 2 pairing arms = 2,646 runs per
experiment, 55,566 across all 21. Measured on an 18-core box: **645 s per
experiment at `--workers 14`**, so roughly 3.8 hours wall for the full set and
~1.7 GB of CSV. `generate_worldmodel_experiments.js` prints its own estimate,
but that assumes perfect scaling and came out ~3× optimistic — time
`./run_experiments.sh 1` on your own machine before committing to the batch.

To change the grid resolution, the values swept, or what's held fixed, edit
`STUDY_PARAMS` / `BASE_FIXED` at the top of `generate_worldmodel_experiments.js`
and rerun `node generate_worldmodel_experiments.js` — it regenerates all 21
files plus the manifest from those two objects. `GRID` (currently 21) and
`REPLICATES` (currently 3) are in the same file. **Regenerating with a different
parameter list renumbers the files**, so anything referencing an experiment by
number needs rechecking against the manifest.

#### Coupled reliance (`aiRelianceIntensity`, ρ)

`aiDampeningBelow` and `aiAtrophyMultiplier` both gate on exactly the same
condition (`E[i] < aiLevel`) and act on disjoint branches of the update — the
first on `gap > 0`, the second on `gap <= 0`. An agent is in one or the other,
never both. As free parameters they permit behaviourally incoherent states like
"AI completely blocks novice learning but causes no atrophy", so a single
reliance intensity now drives both:

```
aiDampeningBelow    = 1 − ρ        ρ=−1 → 2.0    ρ=0 → 1    ρ=+1 → 0
aiAtrophyMultiplier = 5 ^ ρ        ρ=−1 → 0.2    ρ=0 → 1    ρ=+1 → 5
```

Linear for the dampening (a retained *fraction*), log-symmetric for atrophy (a
*multiplier*), so "equal and opposite" means the right thing for each. Both hit
the endpoints of the ranges those two parameters were previously swept over, so
nothing explored is lost except `aiAtrophyMultiplier < 0.2`.

**ρ = 0 is exactly AI-inert** — measured, the shortfall is 0.00000 at every
`aiLevelFraction`. **Negative ρ is the optimistic case**, AI as a well-used tool
that both teaches and preserves; it is signed deliberately so the model can test
that rather than assume it away.

ρ is monotone and signed across its whole range, with an exact zero at 0
(N = 10,504, t = 1440, λ = 0.585, baseline meanE = 0.6371):

```
  rho   gamma_below   meanE     shortfall
 -1.0      2.00       0.7210     -0.0840
  0.0      1.00       0.6371     +0.0000
  0.4      0.60       0.3935     +0.2436
  1.0      0.00       0.0557     +0.5814
```

> **`shareExpert_shortfall` saturates on this axis.** At λ = 0.585 `shareExpert`
> hits exactly 0 for ρ ≳ 0.35, so roughly half the positive range is floored on
> that metric. `meanE_shortfall` stays informative throughout and is the one to
> read. See `problems.md` R11.

`aiRelianceIntensity` defaults to `null`, meaning decoupled — the historical
behaviour with both parameters set directly. Setting ρ *and* either derived
parameter throws rather than silently resolving. The existing BA set and any
existing config are therefore unaffected.

### Visualizing the experiment set: `report.html`

After `run_experiments.sh` has populated `results/`, build the heatmap browser:

```bash
node build_report.js      # reads results/, writes report.html
```

Open `report.html` directly in a browser — no server needed, everything is
embedded at build time. Rerun `node build_report.js` any time you rerun
experiments; it always reflects whatever's currently in `results/` (and
tells you if any of the 21 are missing).

**The manifest must match the results.** The manifest supplies the x/y axis
keys per experiment; `results/` only supplies columns. Point the BA manifest at
world-model results and experiment 6 is read as `learningRateSpread ×
transferRate` — both present in those CSVs but *constant* — so the whole 21×21
grid silently collapses to one averaged cell that still looks like a plausible
heatmap. That happened. `build_report.js` now refuses to write anything if a
manifest-declared sweep axis does not vary in the results, and names the
mismatch. To build the BA set instead:

```bash
node build_report.js --manifest experiments.manifest.json \
                     --results results-ba --out report-ba.html
```

| Flag | Default |
|---|---|
| `--manifest <path>` | `experiments.worldmodel.manifest.json` |
| `--results <dir>` | `results` |
| `--out <path>` | `report.html` |

- **Sidebar** — click any of the loaded experiments to switch instantly; no
  page reload, since every grid is already in memory. Below the list, the
  parameters held fixed for that view.
- **Heatmap** — the selected metric (default `meanE_shortfall`; also
  `shareExpert_shortfall`, `meanC_shortfall`, and the underlying
  baseline/treatment means) across the pair's 21×21 grid, colored on a
  diverging scale (rust = AI eroded expertise, blue = AI net-neutral-or-better
  in that corner, gray = zero) so a sign flip is visually obvious, not just a
  lighter shade. Hover a cell for exact values across every metric plus its
  replicate count. Per-cell numeric labels and axis ticks thin out
  automatically at this resolution so they stay legible — hover is the
  reliable way to read an exact value. The color domain is fixed globally
  across every loaded experiment and every tick, so switching between them
  never silently rescales what a given color means.
- **Metric / t controls** (top bar) — switch between the shortfall metrics
  and the underlying baseline/treatment means, and scrub through the 120
  recorded ticks (one per simulated year) to watch a grid evolve rather than
  only see its endpoint.
- **Axis labels** use one precision per parameter, chosen once from every value
  that parameter takes anywhere in the report, so the same parameter reads
  identically on every chart. The precision is whatever keeps rounding error
  under a tenth of the axis's own step — enough that an evenly spaced grid also
  *prints* evenly spaced.
- **`ρ` is resolved wherever it appears.** `aiRelianceIntensity` derives two
  engine parameters and neither is a column in the results, so a bare −1..+1
  axis would be unreadable. The figure caption explains the mapping, and the
  cell tooltip, the held-fixed panel and the trajectory headers all show what
  that specific ρ resolves to (`peer learning ×0.75, skill loss ×1.50`).
- **Table view** — exact values as a plain table, for reading precise
  numbers or copying out.
- **⇄ flip axes** (top bar) — swaps which of the pair's two parameters is
  shown on the horizontal vs vertical axis. Applies at once to the heatmap,
  the table (row/column headers swap too), and both trajectory panels
  (including which parameter the "hold fixed" dropdown offers first) — one
  toggle, every view stays consistent. A view preference, not tied to a
  specific experiment: it stays on when you switch experiments, unlike the
  trajectory panels' held values (which reset, since a specific number from
  one experiment's axis usually doesn't exist in another's).

### CLI options

| Flag | One-line meaning |
|---|---|
| `--config <path>` | the sweep config JSON to run (required) |
| `--out <path>` | per-run CSV path (default `results.csv`) |
| `--summary-out <path>` | per-combo mean/std CSV path (default `results_summary.csv`) |
| `--no-summary` | skip writing the summary CSV |
| `--shortfall-out <path>` | baseline-vs-AI shortfall CSV, only written when the config sets `pairWithBaseline` (default `results_shortfall.csv`) |
| `--no-shortfall` | skip the shortfall CSV even if `pairWithBaseline` is set |
| `--workers <n>` | parallel worker threads (default: up to 8, capped at your CPU count) |
| `--max-runs <n>` | refuse to run more than this many simulations (default 20000) |
| `--force` | bypass `--max-runs` |
| `--dry-run` | print the run count and exit without simulating |

### Sweep config fields

| Field | One-line meaning |
|---|---|
| `mode` | `"grid"` = every combination of every param axis; `"random"` = independently draw each param `runs` times |
| `runs` | (random mode only) how many parameter combinations to draw |
| `replicates` | how many distinct-seed repeats per parameter combination, to average out the model's own randomness |
| `horizon` | ticks to simulate a run out to (bounds `recordAt`) |
| `recordAt` | which ticks to write a row for, e.g. `[100, 300, 500]` to see a trajectory, not just an endpoint |
| `seed` | base seed the whole sweep is deterministically derived from |
| `fixed` | parameters held constant across every run |
| `params` | parameters being swept — each is `{"values":[...]}` (a discrete list) or `{"range":[lo,hi]}`, plus `"steps":k` for a grid linspace or `"int":true` for integer random draws |
| `pairWithBaseline` | default `false` — for every combo, also run a same-seed `aiEnabled:false` twin, and write `results_shortfall.csv` comparing them. Don't put `aiEnabled` in `fixed`/`params` when this is on — it's set per arm automatically |
| `worldModel` | `{ "worldModelPath": ..., "mobilityCostsPath": ..., "worldModelOptions": {...} }` — **paths, not data**. Only needed when `fixed.graphSource` is `"worldModel"`. See below |

### Simulation parameters (usable in `fixed` / `params`)

| Key | One-line meaning |
|---|---|
| `N` | number of humans in the system |
| `M` | number of institutions in the graph |
| `expertiseMean` | mean of the **t=0 population's** starting expertise (an already-running system) — does not affect entrants who arrive later via turnover |
| `expertiseSpread` | spread (scale) of the t=0 population's starting expertise before clipping to [0,1] |
| `expertiseSkew` | skews the t=0 population so total novices are rare; positive thins the low tail |
| `entrantExpertiseMean` | mean starting expertise for every turnover replacement (mid-run), not t=0 — deliberately low; entrants are genuine novices who must earn expertise via peer transfer |
| `entrantExpertiseSpread` | spread of entrant starting expertise before clipping to [0,1] |
| `entrantExpertiseSkew` | skew of entrant starting expertise (default 0 — unskewed, no built-in tail of already-good entrants) |
| `graphAttachment` | edges each new institution attaches with — higher means less-sparse hub formation |
| `transferRate` | how fast a human's expertise rises toward a stronger institution's average. Needs to comfortably outpace `turnoverRate`'s dilution of institution averages or entrants never catch up — that's why this defaults to 0.5, not a small number: see "Entrant renewal" in spec.html |
| `decayRate` | how fast a human's expertise drifts down toward a weaker institution's average |
| `ambientGrowthRate` | growth for humans already at/above their institution's average — being embedded among strong peers is itself a source of improvement, not just decay. Scales with the institution's **founding** average (fixed at t=0; the live average would create runaway positive feedback — see "Key design decisions" in spec.html), tapering to 0 near the ceiling. Not AI-gated: applies identically in both arms, so it shifts the shared floor rather than the AI/no-AI contrast |
| `learningRateSpread` | spread of each human's individual learning-rate multiplier |
| `mobilityMode` | `"unconstrained"` (any institution), `"edge_constrained"` (graph neighbors only), or `"hybrid"` (mostly neighbors, occasional jump) |
| `jumpProbability` | in hybrid mode, chance a human considers the whole graph instead of just neighbors |
| `competitionAversion` | how much a human favors institutions where they'd stand out over ones where they'd grow |
| `prestigeWeight` | how much a human favors well-connected ("hub") institutions regardless of competition |
| `baseMoveProb` | baseline per-tick chance a human reconsiders their institution at all |
| `turnoverRate` | fraction of the population replaced with fresh humans each tick |
| `aiEnabled` | master switch for the AI mechanism — off means no erosion, no dampening, no capability boost |
| `aiLevelFraction` | AI's strength as a fraction of the **t=0 population's single greatest expert**, fixed for the run. Measured, that maximum is `1.0` for any realistic `N` (clipping to `[0,1]` guarantees it), so this is in practice an **absolute expertise threshold** — see `problems.md` P17. Defaults to `EXPERT_THRESHOLD` (0.585), i.e. "the AI is as good as a human we would call expert", which is a stated quantity rather than an arbitrary pick. The effect saturates above ~0.65, so the earlier `0.70` default sat inside a plateau where λ stops mattering and `aiDampeningAbove` governs nobody |
| `entrantExpertiseFloor` | lower bound on an entrant's draw, default `0.05`. Without it ~16% of entrants arrived at exactly `E = 0` (and half of them at a nominal mean of 0), which distorted the bottom of the `entrantExpertiseMean` axis and fed an absorbing state at high reliance — see `problems.md` P19/R11. Set to `0` for the pre-2026-08 behaviour. **Not AI-gated**, so it moves the no-AI baseline too |
| `aiRelianceIntensity` | **ρ.** One dial driving both `aiDampeningBelow` and `aiAtrophyMultiplier`, which are two consequences of the same cause. `[-1, +1]`, where `−1` = AI teaches and preserves, `0` = AI changes nothing at all, `+1` = total reliance. `null` (default) = decoupled, set the two directly instead. Setting this *and* either derived parameter throws. See "Coupled reliance" above |
| `aiDampeningBelow` | multiplier on **learning** for humans below the AI's level — how much growth AI reliance crowds out. Stored/config/CSV value is always raw `[0,2]`: **`0` = max dampening** (learning zeroed out), **`1` = no dampening at all**, `>1` = amplified. `simulator.html` and `report.html` both *display* this shifted by −1 (reads as −1/0/+1) — only the on-screen label changes, never the number you put in a config file. **Derived, not set, when `aiRelianceIntensity` is in use** |
| `aiAtrophyMultiplier` | multiplier on **decay** for humans below the AI's level — how hard AI reliance erodes expertise they already had. `1` = no extra erosion, higher = faster obliteration. **Derived, not set, when `aiRelianceIntensity` is in use** |
| `aiDampeningAbove` | multiplier on learning for humans at/above the AI's level. Same raw `[0,2]` shape and same −1-shifted display as `aiDampeningBelow` |
| `aiResponseMode` | *(secondary — governs the illusion, not the erosion)* how the AI-inflated observed-capability metric `C` scales with a human's own expertise: `floor` / `flat` / `linear` / `amplified` / `exponential` |
| `aiGain` | *(secondary)* overall strength of the `C` boost, `0` = no visible effect regardless of mode |
| `seed` | RNG seed for a single run (set automatically per-run by the batch runner; only relevant for `simulator.html`'s manual seed field) |
| `graphSource` | `"ba"` (default) = the generated Barabási–Albert graph; `"worldModel"` = the real institution graph built from `world-model.json`. See "World-model graph" below |
| `institutionSizing` | `"uniform"` (default) = humans spread evenly across institutions; `"weighted"` = placed proportional to each organisation's intake. World-model mode only (needs `entryWeights`). Applies to entrants *and* initial placement — placing only at init washes out within ~50 ticks |
| `mobilityFriction` | prices moves by affinity: adds `φ·log(affinity)` to the move utility, so distant cross-sector moves get rarer. **`0` (default) reproduces BA behaviour exactly**, and it can never fire on a BA graph (no affinity function) |
| `worldModel` | a loaded `world_model.js` result. Not set in a config file — `batch_run.js` builds it from `config.worldModel` paths (below), and `simulator.html` from its file inputs |

## Expert threshold

`EXPERT_THRESHOLD = 0.585` is a bare constant in `engine.js` (duplicated identically
in `simulator.html`) — it is **not** a `DEFAULT_PARAMS` entry, is never swept by
either experiment generator, and has no slider in `simulator.html`. Its only use:

```js
if (E[i] >= EXPERT_THRESHOLD) expertCount++;
```

It defines `shareExpert(t)`, the metric behind every `shareExpert_baseline` /
`shareExpert_treatment` / `shareExpert_shortfall` value in `report.html` and the
self-renewal test in `test_engine.js`. It is purely an **observational cutoff for
reporting** — nothing in `tick()` reads it, so it has zero effect on the dynamics
themselves (learning, decay, mobility, AI mechanism all run on the continuous `E`
value regardless of where this line is drawn).

It was originally `0.7` — a plausible round number, picked once with no calibration
run or empirical check behind it, unlike almost every other constant in this
project. The sensitivity check below is what it looked like at the time, and is why
the value changed.

**Sensitivity check** (`node expert_threshold_sensitivity.js`): reruns the
self-renewal scenario from `test_engine.js` (no-AI baseline vs. AI-dampened
treatment, matched seed, t=1500) and recomputes `shareExpert` directly from the
final population at candidate thresholds from 0.1 to 0.9, without changing
`engine.js`. The baseline/treatment contrast is robust across a wide middle band —
essentially flat at "baseline high, treatment ~0" from threshold 0.3 through 0.86 —
but breaks down at both ends, for two different reasons:

| threshold | shareExpert_baseline | shareExpert_treatment | gap |
|---|---|---|---|
| 0.10 | 0.995 | 0.976 | 0.019 — too low a bar to discriminate; even the AI-collapsed population mostly clears it |
| 0.20 | 0.993 | 0.894 | 0.099 — still too low |
| 0.30 | 0.993 | 0.007 | 0.986 — contrast becomes sharp |
| **0.585 (current default)** | **0.979** | **0.000** | **0.979** |
| 0.70 (former default) | 0.967 | 0.000 | 0.967 |
| 0.86 | 0.679 | 0.000 | 0.679 — still robust |
| 0.88 | 0.007 | 0.000 | 0.007 — too high a bar; even the *healthy* no-AI baseline can't clear it |
| 0.90 | 0.003 | 0.000 | 0.003 |

`0.585` sits near the middle of the robust `[0.3, 0.86]` band (≈0.28 from each edge)
rather than close to its upper edge (`0.7` was only 0.16 from it). That matters for
more than margin: in the AI-*amplification* regime (dampening `>1`, AI net-helping
rather than hurting), a threshold close to the upper edge manufactures an inflated
apparent AI benefit, because amplified humans get pushed past a ceiling the
unassisted no-AI baseline can't reach on its own (the baseline's own steady-state
ceiling — see `paper.md`, "Simulation steady state" — sits at meanE≈0.87, and
`shareExpert_baseline` starts failing thresholds above roughly that point even
though the population is perfectly healthy). Checked directly: at
`aiDampeningBelow=aiDampeningAbove=1.7`, the reported baseline-minus-treatment
shortfall was `-0.019` under the old `0.7` threshold vs. `-0.010` under `0.585` —
same sign (AI still reads as beneficial, correctly), but the old threshold overstated
the effect by roughly 2x. The headline collapse story is unaffected either way —
both thresholds show baseline ~97-98%, treatment ~0% under the engine's own default
dampening (0.30/0.80 — this check doesn't override it, so it isn't the experiment
set's worst-case backdrop).

Because `EXPERT_THRESHOLD` is fixed and unexposed, no experiment in the pairwise set
tests sensitivity to *where* the expert line is drawn — every `shareExpert` result
in `report.html` reflects whichever threshold was active in `engine.js` when
`./run_experiments.sh` was last run. Results generated before this change was made
used `0.7` and are stale with respect to the current `0.585`.

The upper breakdown isn't an AI effect — it's the no-AI steady state itself (see
`paper.md`, "Simulation steady state": meanE converges to ≈0.87 even under a healthy
no-AI baseline), so any threshold above roughly 0.87 makes even a fully self-renewing
population look collapsed. The current default of 0.7 sits comfortably in the middle
of the robust band, well clear of either failure mode — the headline self-renewal/
collapse contrast doesn't depend delicately on that specific number, even though it
was never calibrated.

## World-model graph

By default the simulator runs on a **generated** Barabási–Albert graph. It can
instead run on the real institution graph in `world-model.json` — 245 financial
organisations across 49 cities, with mobility priced by geography, sector and
economic gradient.

> **World-model results are not comparable with BA results.** Different topology
> under a different calibration. Keep them in separate result directories and
> never read a BA heatmap and a world-model heatmap as the same experiment.

### Turning it on in batch

Three things: a `worldModel` block giving **paths**, `graphSource` in `fixed`, and
**no `M`** (it is derived from the data — setting it throws rather than being
silently ignored).

```jsonc
{
  "horizon": 1440,                    // 3 careers at 1 tick = 1 month
  "recordAt": [480, 960, 1440],
  "pairWithBaseline": true,

  "worldModel": {                     // paths, resolved relative to the repo root
    "worldModelPath": "world-model.json",
    "mobilityCostsPath": "mobility-costs.json",
    "worldModelOptions": {
      "useBlocAffinity": true,        // false = ablate the Anglosphere/Greater China grouping
      "hubSource": "located_in",      // "scalar" would discard 89 multi-site facts
      "prestigeFrom": "intake",       // "degree" | "sizeBand" | "weightedDegree"
      "zeroIntakePolicy": "floor1",   // "drop" | "keep"
      "useExplicitEdges": true        // fold in PARENT_OF / COMPETES_FOR_TALENT bonuses
    }
  },

  "fixed": {
    "graphSource": "worldModel",      // <- the flag
    "institutionSizing": "weighted",  // place entrants proportional to intake
    "N": 10504,                       // 40 years x (52,514 annual intake / 200)
    "turnoverRate": 0.002083,         // 1/480 — a 40-year career in monthly ticks
    "transferRate": 0.15,             // from calibrate_time_base.js --world-model
    "decayRate": 0.020                //   " — chosen for a STATIONARY baseline
  },

  "params": {
    "mobilityFriction":  { "values": [0, 0.05, 0.1, 0.2, 0.4] },
    "aiDampeningBelow":  { "values": [0.0, 0.25, 0.5, 0.75, 1.0] }
  }
}
```

Run it like any other config — nothing on the command line changes:

```bash
node batch_run.js --config experiments-worldmodel/worldmodel.1.json --workers 8 \
  --out results-worldmodel/worldmodel.1/results.csv \
  --summary-out results-worldmodel/worldmodel.1/results_summary.csv \
  --shortfall-out results-worldmodel/worldmodel.1/results_shortfall.csv
```

`experiments-worldmodel/worldmodel.1.json` is a complete worked example.

### Why paths and not data

A loaded world model holds a closure (`affinity`), so it cannot cross a
`worker_threads` boundary. Each worker reads the two JSON files itself and caches
the result — parsing 400KB once per worker is nothing against thousands of runs.

### Time base

The world-model configs **and `simulator.html`** declare **1 tick = 1 month, career
= 40 years = 480 ticks**. That is not the default calibration: `DEFAULT_PARAMS` was tuned when the
tick was dimensionless, and at `turnoverRate = 1/480` its `transferRate = 0.5`
saturates the no-AI baseline (98% of the population above `E = 0.95`), leaving AI
nothing measurable to erode.

`engine.js` exports `MONTHLY_TICK_PARAMS` with the recalibrated values.
`DEFAULT_PARAMS` is deliberately **unchanged**, so the BA experiment set and its
published results are untouched.

```bash
node calibrate_time_base.js --world-model   # the scan behind those numbers
```

`simulator.html` carries its own copy of `MONTHLY_TICK_PARAMS` and layers it over
`DEFAULT_PARAMS` at boot, so the interactive tool runs the calibrated set and the
legacy one is not reachable from the UI at all. `dom_stub_test.js` asserts the two
copies agree and that the overlay is actually applied — a declared-but-unapplied
overlay would otherwise pass silently.

Why the interactive page needs the calibrated set specifically, beyond consistency:
on the legacy pairing the no-AI baseline is **still climbing steeply through the
window a user watches**, so toggling `ai_enabled` shows AI's effect plus wherever the
baseline was heading anyway. Measured on the simulator's own boot config (BA graph,
N=500, M=40, seed 1), `meanE` over t=60→480:

| | legacy `DEFAULT_PARAMS` | `MONTHLY_TICK_PARAMS` |
|---|---|---|
| meanE t=60 → t=480 | 0.754 → 0.837 (**+0.082**) | 0.638 → 0.656 (+0.018) |
| AI on at t=240 → meanE shortfall at t=1000 | 0.123 | 0.048 |

The smaller shortfall is the part actually attributable to AI. Note that the
calibration ridge was scanned at world-model scale (N=10,504, M=245); on the BA
default it is *approximately* stationary, not exactly — +0.018 over the first 480
ticks and −0.003 between t=1000 and t=3000. Read interactive runs as illustrative and
the batch runs as the measurement.

The calibration is selected for a **stationary no-AI baseline**, which is what
makes `meanE_shortfall` interpretable — the shortfall is then "what AI removed",
not "what AI removed plus wherever the baseline had drifted to by the reporting
tick". Measured at production scale, `meanE` moves from 0.6291 at t=120 to 0.6294
at t=1440: a drift of +0.0002 over three careers.

Two consequences worth knowing. **`meanE_shortfall` is the headline metric** —
baseline `shareExpert` sits at ~0.95 and has little range left, by design.
And **the stationary band is a narrow ridge** that moves with the graph and with
`N`, so any change to the dynamics means re-scanning with `--world-model` and
verifying at production `N` (see `problems.md` P3).

`N`, `turnoverRate` and career length are one identity (`headcount = annual intake
x career length`), not three free parameters — so **do not sweep `turnoverRate`**
in a world-model config without moving `N` with it. See `problems.md` P5.

### Extra CSV columns

World-model runs add `worldModelFingerprint` (identifies which revision of
`world-model.json` + which options produced the row — the file is expected to
change) and the derived `M`, plus occupancy diagnostics on every run:
`minOccupancy`, `emptyInstitutions`, `underOccupiedInstitutions`.

**Check those.** Asymmetric mobility drains low-market-index institutions by
design, and an institution below ~5 members has an `Ebar` that is mostly noise
while still feeding population aggregates. See `problems.md` P2.

### In `simulator.html`

**Time base.** One tick is one month. The scrub bar reads `t = 240 · 20y 0m`, the
timeline charts label their x axis in years, and the speed control is in months/s.

**Dial ranges are set for a monthly tick**, not for the dimensionless era, so the
usable band of each parameter sits inside the slider's travel rather than in its first
tenth: `transfer_rate` 0–0.3 (usable ≈0.11–0.20, calibrated 0.15), `decay_rate` 0–0.05
(swept 0.005–0.040), `base_move_prob` 0–0.1, `turnover_rate` 0–0.02 stepped by 1/4800
so the calibrated 1/480 is exactly representable and reading out as a career length in
years. `ambient_growth_rate` keeps its 0–0.02 range, which came from a saturation check
rather than the calibration scan. Every slider carries a plain-language description on
hover; the always-visible `hint` under a slider is the mechanical/calibration detail.

Sidebar → **World model graph**: a toggle mirroring `fixed.graphSource`, file
inputs for the two JSON files, and an intake-sizing checkbox. Structural, so it
applies on **Rebuild**. `mobility_friction` is a live slider under Mobility.

Sidebar → **AI** → `couple_reliance`: on, a single `ρ_AI` slider drives both
`γ_below` and `μ_atr`, and their own sliders are *replaced* by a live readout of
what ρ resolves to — showing them would invite edits the next ρ change silently
overwrites. Off, the independent sliders, unchanged. Turning coupling on infers
ρ from the current `γ_below` rather than snapping to a default, so the learning
half stays exactly where you had it; turning it off leaves both derived values
in place, so decoupling never moves the model. (`ρ` alone is already taken by
`competition_aversion` in this page, hence `ρ_AI`; in the report, where
competition aversion is not a study parameter, it is plain `ρ`.)

The page pulls in `world_model.js` with `<script src>` rather than carrying a
second copy of the loader, so the browser and `batch_run.js` share one
implementation. If `world_model.js` is not alongside the page, the controls
disable themselves and the simulator still runs in BA mode.

### Before trusting any of it

Read `problems.md`. In particular **P1**: across an eightfold change in
`mobilityFriction` the headline `meanE_shortfall` moved by 0.005. The graph is
consumed only in the mobility step, while learning runs on an institution's
*internal* mean — so the world model buys realism in *where people are*, not in
*how much expertise exists*, and should not be expected to change the AI-erosion
result.

## Tests

```bash
node test_engine.js        # engine unit tests (no DOM)
node dom_stub_test.js simulator.html          # drives simulator.html's actual UI code end-to-end under a stubbed DOM
node dom_stub_test_report.js report.html      # same, for report.html — build it first
node test_world_model.js   # world-model loader + engine integration (65 checks)
```

The ρ→(`γ_below`, `μ_atr`) mapping exists in three places: `engine.js` for batch
runs, `simulator.html` for the browser, `report.template.html` for display.
`dom_stub_test.js` imports the **real engine** and asserts the simulator derives
identical values at ρ = −1, −0.5, 0, 0.25, 0.5, 1; `dom_stub_test_report.js`
does the same for the report. A silent divergence would let the interactive tool
and the published results describe different models.
