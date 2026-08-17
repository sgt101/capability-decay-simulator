# Capability Decay Simulator

Agent-based model of institutions and humans where reliance on AI erodes the
real expertise (`E`) behind their output over time. See [spec.html](spec.html)
for the full design, [simulator.html](simulator.html) for the interactive
visualizer, and this file for running sweeps headlessly.

The model tracks **one** quantity: latent expertise `E`, what people actually know.
It answers a narrow question — **how much real expertise does AI reliance destroy,
relative to what would have existed without it** — see `pairWithBaseline` below.

An "observed capability" channel (`C`) that AI could inflate above real expertise
existed until 2026-08, for studying the illusion of competence. It was removed with
the two dials that drove it; see "Removed parameters".

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

### Parameter-pair experiment set (`experiments/experiment.N.json`)

One file per unordered pair of **eight** study parameters, with every other
parameter pinned identically across all 28 files. Unordered: `A×B` and `B×A`
are the same grid transposed, so only the `8 choose 2` pairs are generated.

File numbers run 1, 3–6, 8–11, 16–34 — six numbers (2, 7, 12–15) are retired but
their results are archived, so the survivors keep the numbers those results were
written under. Experiments 22–34 are the newest and have not been run yet. See
"Retired: coupled reliance" below.

The eight, and why these:

| Parameter | Role |
|---|---|
| `transferRate` | sets the baseline equilibrium (with `decayRate`) |
| `decayRate` | sets the baseline equilibrium (with `transferRate`) |
| `aiDampeningBelow` | **AI-only.** Learning multiplier below the AI's level — the channel the central claim runs on |
| `aiDampeningAbove` | **AI-only.** Learning multiplier above the AI's level |
| `aiLevelFraction` | **AI-only.** Where that threshold sits |
| `expertiseMean` | starting expertise of the t=0 population |
| `entrantExpertiseMean` | starting expertise of later entrants |

Narrowed from an earlier eleven after reviewing a full 21×21 × 55 run.
`turnoverRate`, `learningRateSpread` and `mobilityFriction` were demoted to
fixed because they moved the primary metrics little relative to the rest
(see `problems.md` P1 for the last of those).

`aiAtrophyMultiplier`'s axis is **log-spaced** over 0.2–5 rather than linear: it is
a multiplier, so equal ratios are the equal steps. That puts neutral (1.0) exactly
at the midpoint, with AI-preserves-skill occupying the lower half.

**The two groups matter more than the count.** The four AI-only parameters
(`aiDampeningBelow`, `aiAtrophyMultiplier`, `aiDampeningAbove`, `aiLevelFraction`)
appear only behind `aiEnabled`, so the
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
./run_experiments.sh                    # all 28
./run_experiments.sh 3 8 16             # just these
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
`REPLICATES` (currently 3) are in the same file. Experiment numbers are stable identities, not list positions: the generator
enumerates pairings over the original parameter order and skips retired ones, so
adding a study parameter means **appending** it to `HISTORICAL_KEY_ORDER` — the
generator throws if that list and `STUDY_PARAMS` fall out of step.

#### Retired: coupled reliance (`aiRelianceIntensity`, ρ)

**Removed from the model in 2026-08.** ρ was a single signed dial deriving both
halves of de-skilling below the AI's level:

```
aiDampeningBelow    = 1 − ρ        ρ=−1 → 2.0    ρ=0 → 1    ρ=+1 → 0
aiAtrophyMultiplier = 5 ^ ρ        ρ=−1 → 0.2    ρ=0 → 1    ρ=+1 → 5
```

It was introduced to prevent behaviourally incoherent combinations ("learning
fully blocked, no atrophy") and to keep this study tractable. It was removed
because it named three parameters for two independent quantities, and because
the base `5` was an **untested exchange rate** between the two channels: holding
the learning half fixed at ρ = 0.5 and varying only that base from 2 to 8 moves
`meanE_shortfall` from 0.213 to 0.346. A convenience dial should not carry an
unmeasured modelling assumption inside it.

`aiDampeningBelow` and `aiAtrophyMultiplier` are now always set directly. States
the coupling forbade are expressible, and are best read as **mechanism ablations**
— pinning `aiDampeningBelow = 1, aiAtrophyMultiplier = 5` isolates the atrophy
channel from the learning one.

`engine.js` **rejects** a config still setting `aiRelianceIntensity` rather than
ignoring it: unknown keys otherwise flow into `params` and into every CSV column,
so a stale config would advertise a reliance intensity it never simulated.

**Consequences for this experiment set.** The six pairings that swept ρ as an axis —
**2, 7, 12, 13, 14, 15** — are retired rather than translated: a ρ sweep is a lockstep
path through two parameters, which grid mode cannot express, and adding a lockstep
feature would only rebuild ρ under another name.

In their place, the two parameters ρ used to derive are now swept **independently**,
which is what the removal was for — one constrained line through (γ_below, μ_atr)
replaced by both axes in their own right. That is 13 new pairings, **22–34**, taking
the study to eight parameters and 28 experiments. They have not been run yet: ~34,400
runs, about 10.5 CPU-hours.

New numbers start at 22 rather than filling the retired holes, and are appended in
`HISTORICAL_KEY_ORDER` order. Numbering them positionally would have slid existing
pairs along — `aiDampeningBelow × transferRate` would have landed at index 7, taking
a number that already means something else in `results/`.

Their finished CSVs stay under `results/experiment.{2,7,12,13,14,15}/`, and the
checked-in `report.html` remains the readable archive of the 21-experiment study.
That is why the surviving experiments **keep their original numbers** (1, 3–6,
8–11, 16–21) instead of being renumbered 1–15 — renumbering would silently repoint
every archived results directory at a different pairing. The generator asserts this
numbering can't drift.

The 15 survivors are unchanged: they pinned ρ = 0.25, which derived exactly
`aiDampeningBelow = 0.75` and `aiAtrophyMultiplier = 5^0.25 = 1.4953487812212205`,
and those two values are now pinned directly. Verified by re-running a combo of
experiment 1 against its archived row — `meanE` at t=1440 reproduces bit-for-bit.

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
  `shareExpert_shortfall`, and the underlying
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
- **Archived ρ data still renders.** `report.html` as checked in was built before
  `aiRelianceIntensity` was removed and still carries that column; the template no
  longer has ρ-specific rendering, so those experiments fall back to the generic
  path.
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
| `graphAttachment` | edges each new institution attaches with — higher means less-sparse hub formation |
| `transferRate` | how fast a human's expertise rises toward a stronger institution's average. Needs to comfortably outpace `turnoverRate`'s dilution of institution averages or entrants never catch up — that's why this defaults to 0.5, not a small number: see "Entrant renewal" in spec.html |
| `decayRate` | how fast a human's expertise drifts down toward a weaker institution's average |
| `personalLearningRate` | growth for humans already at/above their institution's average — being embedded among strong peers is itself a source of improvement, not just decay. Scales with the institution's **founding** average (fixed at t=0; the live average would create runaway positive feedback — see "Key design decisions" in spec.html), tapering to 0 near the ceiling. Not AI-gated: applies identically in both arms, so it shifts the shared floor rather than the AI/no-AI contrast |
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
| `aiDampeningBelow` | multiplier on **learning** for humans below the AI's level — how much growth AI reliance crowds out. Stored/config/CSV value is always raw `[0,2]`: **`0` = max dampening** (learning zeroed out), **`1` = no dampening at all**, `>1` = amplified. `simulator.html` and `report.html` both *display* this shifted by −1 (reads as −1/0/+1) — only the on-screen label changes, never the number you put in a config file. |
| `aiDampeningAbove` | multiplier on learning for humans at/above the AI's level. Same raw `[0,2]` shape and same −1-shifted display as `aiDampeningBelow` |
| `seed` | RNG seed for a single run (set automatically per-run by the batch runner; only relevant for `simulator.html`'s manual seed field) |
| `graphSource` | `"ba"` (default) = the generated Barabási–Albert graph; `"worldModel"` = the real institution graph built from `world-model.json`. See "World-model graph" below |
| `institutionSizing` | `"uniform"` (default) = humans spread evenly across institutions; `"weighted"` = placed proportional to each organisation's intake. World-model mode only (needs `entryWeights`). Applies to entrants *and* initial placement — placing only at init washes out within ~50 ticks |
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

### Removed parameters (2026-08)

Five dials were deleted after a one-at-a-time sensitivity sweep measured how far each
moved the baseline and the AI shortfall. `engine.js` no longer accepts them.

| Removed | Evidence |
|---|---|
| `aiAtrophyMultiplier` | moved the shortfall by **0.005** alone, and `δ × α` collapses onto `δ·(α−1)` at rank-R² **0.946** (P-notes below) — algebraically the same lever as `decayRate`, applied to a different population |
| `mobilityFriction` | **0.000** on the BA graph (no affinity to act on) and 0.005 for an 8× change on the world model (P1). The only dial on an apparatus P6 calls unfalsifiable |
| `entrantExpertiseSkew` | 0.004, and pinned at 0 in every config that has ever existed |
| `aiGain`, `aiResponseMode` | **0.000 by construction** — they shaped observed capability `C`, which never touched `E` |

**The whole observed-capability channel went with the last two.** `C`, `AI_MODES`, and
the `meanC` / `gap` metrics are gone, and the CSV loses two columns. The model is now
purely about latent expertise. That drops the latent-vs-observed split `spec.html` §1
called foundational — the model can no longer show a field looking capable while being
hollowed out. Reinstating it means restoring `C`, the boost modes and both metrics
together; half of it is worse than neither.

**Consequences for the experiment set.** `aiAtrophyMultiplier` was a study axis, so its
seven pairings (**28–34**) are retired the same way ρ's were: their numbers are never
reissued, and `results/` keeps anything already run. The set is **21 experiments**:
1, 3–6, 8–11, 16–27. `generate_experiments.js` (the legacy 55-experiment BA set) is
**frozen** — it sweeps parameters the engine no longer has, and regenerating it would
renumber and orphan its archived results, so it refuses to run.

### Entrant pipeline

**The problem.** Learning is gap-proportional (`beta * (Ebar - E) * L`), which makes it
*exponential*: fastest when you are furthest behind. Under the monthly calibration an
entrant reached the expert threshold in a median of **1.8 years** against this
project's own stated assumption of **8** (`TARGET_YEARS_TO_EXPERT` in
`calibrate_time_base.js`, marked a domain assumption). The pipeline therefore occupied
~4% of a career, so only ~4% of the population was ever climbing and the rest sat in a
blob **0.025 wide** at the institution mean. There was no ladder of capability, just
experts plus a thin stream of newcomers sprinting past everyone.

**Five mechanisms, all off by default** (`engine.js`) — two for the climb, three for
what happens after it, and one that governs how hard the top of it is to reach:

| Parameter | What it does |
|---|---|
| `learningCap` | Most expertise one tick of peer learning can add. Makes the climb roughly **linear in time** instead of exponential, so people spread along the ladder. Time from the entrant floor to expert ≈ `(0.585 − floor) / cap` months |
| `seniorTenureYears` | Who you learn **from**: the mean over members past this many years, rather than the plain institution average. Without it a cap *collapses* the field — trainees are counted in the average trainees learn from, so a long pipeline drags every target down (measured: meanE 0.611 → 0.304) |
| `aptitudeSpread` | Each person's **ceiling**, drawn on entry by rejection (see below). Asserts that people differ in the expertise they can *attain*, not only in how fast they get there |
| `aboveMeanDrag` | Learning slows once you are already above the population mean, by `1 / (1 + k·(E − meanE))`. Applied after `learningCap`, so it can only ever *reduce* a tick's learning |
| `criticalMass` | Experts an institution needs before it transfers expertise at full efficiency, via the Hill function `n^h / (n^h + n₀^h)` on its **absolute** expert count. `criticalMassSharpness` (h) sets whether that is a slope or a cliff. **Superseded — see below** |
| `teachTopN` | Teaching level is the mean of an institution's best N seniors in **absolute numbers**. A percentile is scale-free and cannot make institutions differ by size |

### Making institutions differ: `teachTopN`

Institution sizes on the world model at N=10500 run from 19 to 1051 members, but the field
was almost indifferent to that, because teaching level was measured as a *percentile*. A
percentile is scale-free: a small institution's best quarter is as good as a large one's, so
no amount of size variation can produce variation in what places can teach.

`teachTopN` replaces the percentile with an absolute count. The best 16 of 1051 people are
genuinely outstanding; the best 16 of 19 are most of the staff. Measured at N=10500,
`baseMoveProb` 0.01, 250 years, 2 seeds — `corrSize` is the correlation between an
institution's size and its mean E. (`teachPercentile` and `teachCapacity` appear here as
the historical comparison that led to both being removed; neither exists in the engine now.)

| | mean | to expert | IQR | below expert | instSpread | corrSize | mentored |
|---|---|---|---|---|---|---|---|
| baseline (`teachPercentile` 0.75) | 0.603 | 7.8y | 0.279 | 38% | 0.099 | 0.280 | 100% |
| `teachTopN` 8 | 0.605 | 7.8y | 0.266 | 37% | 0.115 | 0.308 | 100% |
| `teachTopN` 16 | 0.575 | 8.0y | 0.206 | 40% | 0.129 | 0.355 | 100% |
| `teachCapacity` 3 | 0.566 | 7.8y | 0.196 | 37% | 0.106 | 0.258 | 75% |
| `teachCapacity` 10 | 0.603 | 7.8y | 0.284 | 38% | 0.106 | 0.283 | 100% |
| both: 16 and 10 | 0.574 | 8.0y | 0.213 | 40% | 0.123 | **0.369** | 85% |

**`teachCapacity` on its own did nothing**, and the reason is worth keeping. With a
percentile pool the number of eligible teachers grows with the institution, so total slots
grow with it too and every place rations in the same proportion. Capacity is size-neutral by
construction. It only became a size effect once `teachTopN` fixed the pool at an absolute
number — at which point total slots are `teachTopN × teachCapacity` regardless of size, and
**large institutions got worse access**: at `teachTopN` 8 with capacity 5, institutions over
50 people mentored only 34% of their members, against 98–100% for smaller ones, while still
reaching the highest mean E (0.634). Excellent teachers, terrible ratios — a real phenomenon,
but one that partly *cancelled* `teachTopN`: at `teachTopN` 8, adding capacity 5 lowered
`corrSize` from 0.308 to 0.290.

#### Why per-person teachers were removed (2026-08)

An ablation from the calibrated configuration — one mechanism off per row, everything else
as shipped — found three of the eight doing no measurable work:

```
                                 toExp    mean     IQR <expert  >=.80  corrSize
(shipped)                         7.6y   0.566   0.297     43%     8%     0.296
teachPercentile -> 0              7.6y   0.566   0.297     43%     8%     0.296
teacherTermYears -> 0             7.7y   0.569   0.313     44%     9%     0.288
teachCapacity -> 0                7.7y   0.569   0.297     43%     8%     0.305
```

`teachPercentile` was **provably inert** — bit-identical, max |dE| exactly 0 — because
`teachTopN` took precedence everywhere it was read. `teacherTermYears` was nearly so, and
for an instructive reason: its mechanism was making the teacher *draw* a persistent random
effect, and `teachTopN` had shrunk the eligible pool to eight people who are all near the
top of their institution, leaving almost no variance in the draw to persist. The mechanism
that gave it its power removed its purpose.

All three are gone, along with per-person teacher assignment entirely. Everyone now learns
from `Teach[j]`, their institution's teaching level. `initSim` throws on all three keys, so
an older config fails loudly rather than running on defaults.

One consequence worth recording: `teachPercentile` was the only thing selecting a teaching
pool in `PIPELINE_PARAMS`, so removing it left that set falling back to the plain senior
mean — which includes everyone still climbing — and the field collapsed from meanE 0.59 to
0.42. `teachTopN` is now part of `PIPELINE_PARAMS` for that reason.

**The cost of `teachTopN` is individual spread.** It shrinks the teacher pool and makes it
homogeneous, which removes the variance in *who you draw as a teacher* — one of the three
mechanisms that produced a ladder in the first place. IQR falls 0.279 → 0.206. It buys
spread between institutions with spread between people.

**At `teachTopN` 16 that trade cannot be undone, and this bounds how far the mechanism can
be pushed.** A 4×4 re-fit of `learningCap` × `aptitudeSpread` (`calibrate_worldmodel.js`,
world model, N=10500, `baseMoveProb` 0.01) returned **no usable cell**:

```
  cap\spread          0.20             0.24             0.28             0.32
  0.0048    9.4y/0.215/43%  10.3y/0.234/51%  11.3y/0.236/59%  12.7y/0.252/68%
  0.0056    8.1y/0.207/39%   8.6y/0.222/47%   9.4y/0.237/54%  10.6y/0.254/61%
  0.0065    6.9y/0.206/38%   7.3y/0.220/45%   7.8y/0.237/52%   8.9y/0.250/60%
  0.0075    6.1y/0.195/36%   6.3y/0.224/42%   6.8y/0.234/50%   7.6y/0.255/57%
```

IQR tops out near 0.255 anywhere in the grid, against a 0.27 bar. `learningCap` moves the
timing but not the spread. `aptitudeSpread` moves the spread only by driving the
below-expert share to 57–68%, because wider ceilings add people who *never* reach expert —
that lengthens the lower tail rather than filling the middle, so it is not a substitute for
the teacher variance `teachTopN` removed. Use `teachTopN` 8, which costs far less individual
spread to begin with (IQR 0.266 at stock settings).

Both are stable where critical mass was not, because both read off real individuals'
expertise rather than an institutional aggregate. Over 1,000 years at `baseMoveProb` 0.01:
baseline 0.598 → 0.610, `teachTopN` 16 gives 0.573 → 0.579, and both together 0.574 → 0.579.

### Why learning slows above the mean

Before `aboveMeanDrag`, nothing made the last step up cost more than the first, and it
showed: **24% of the field sat at E ≥ 0.80**, with p90 and p99 both pinned at 0.84 — a
wall at the top rather than a tail. The cause was structural. Everyone's attractor is
their teacher's level (median **0.838**, against a population mean of 0.613), 75% of
people sit within 0.02 of it, and at that point both remaining terms vanish — `gap → 0`
kills decay, `headroom → 0` kills personal learning. Arriving was terminal.

The brake fixes the top end without adding a restoring force. At `k = 16` the E ≥ 0.80
band clears **entirely** (24% → 0%) and p99 falls 0.84 → 0.79, while time-to-expert
stays at **7.8 years**, the share below expert stays at **37%**, and the IQR holds at
**0.276**.

It is deliberately *not* a decay term. It never moves anyone down, and since it only
multiplies `delta` by something in (0, 1] it cannot push the field up either — the hard
caps are untouched, so nobody passes `min(aptitude, teacher level)` by any route. Its
reference *is* the live population mean, which rises as the field learns and so releases
the brake on people it had slowed. That is genuine positive feedback, and the reason
there is a test for it: measured, meanE moves **+0.004 between t=2000 and t=12000** — 830
years — because the feedback is bounded by the ceiling distribution it cannot exceed.

**What it does not fix:** it cannot replace the top-quartile teaching target. With
`teachPercentile = 0` the field still collapses at every drag setting tried (k = 8 to 64:
IQR 0.018–0.039, 100% below expert, nobody ever reaching expert), because the brake slows
the *seniors* too and the target falls with them. Raising the destination and slowing the
climb are not substitutes — the model currently needs both.

### Critical mass, and why it scales the rate rather than the target

Institution **sizes** already span 50× — 9 to 485 members at N=2000, M=40 — but
institution *teaching levels* span almost nothing, because `Teach` is the mean of the top
quartile and a small institution's best quarter is as good as a large one's. Critical mass
attaches transfer to the one quantity that already varies: the absolute number of experts
in the place.

Keyed to the absolute count, **not** to size rank. Rank re-creates the ratchet documented
under `seniorTenureYears` — the largest institution would hold full efficiency however few
experts it had left, so the measure could never register the field as a whole thinning out.

Measured at N=2000, M=40, 3 seeds (`instSpread` = p90−p10 of institution mean E):

| | mean | to expert | IQR | below expert | instSpread |
|---|---|---|---|---|---|
| off | 0.601 | 7.8y | 0.285 | 38% | 0.086 |
| n₀=5, h=2 | 0.593 | 8.3y | 0.306 | 40% | 0.112 |
| n₀=10, h=2 | 0.577 | 9.4y | 0.306 | 41% | 0.106 |
| n₀=20, h=2 | 0.554 | 11.5y | 0.323 | 44% | 0.113 |
| n₀=40, h=2 | 0.499 | 16.2y | 0.363 | 52% | 0.133 |

Two things to read off it. **Sharpness barely matters** — instSpread runs 0.121 at h=1 and
0.137 at h=8, so "a hard threshold at 20 experts" and "a smooth falloff by size" produce
nearly the same world; the choice between them is not worth agonising over. And the cost is
paid in **time to expert**, which leaves the 6–10 year calibration band above n₀≈10. At
n₀=5 or 10 critical mass is close to free; at n₀=20 it needs `learningCap` re-fitted.

**No concentration hazard:** the largest institution holds 21–22% of the field with critical
mass on, the same as off, so the obvious rich-get-richer spiral does not materialise.

#### Critical mass is only stable while mobility is high — do not use it

An earlier version of this section said the rate variant was stable "precisely because the
destination stays fixed." That was wrong, and the correction matters more than the original
claim. It is stable only while people are moving between institutions often enough to carry
expertise in from elsewhere. Turn mobility down and the same feedback loop the target
variant had reappears through the rate: a thin institution learns slowly, so it produces
fewer experts, so its efficiency falls, so it learns more slowly.

Measured on the world model at N=10500, varying `baseMoveProb` with n₀=20, h=2:

| `baseMoveProb` | 50y | 100y | 250y | 500y | 750y | 1000y |
|---|---|---|---|---|---|---|
| 0.02 | 0.504 | 0.511 | 0.513 | 0.517 | 0.515 | 0.515 |
| 0.01 | 0.480 | 0.489 | 0.485 | 0.483 | 0.491 | 0.488 |
| 0.0075 | 0.457 | 0.459 | 0.460 | 0.453 | 0.429 | **0.118** |
| 0.005 | 0.427 | 0.376 | **0.077** | 0.068 | 0.067 | 0.067 |

The 0.0075 row is the one to take seriously: level for 750 years, then gone. A 250-year run
reports a healthy field that is on its way to zero, which is exactly the silent-wrong-answer
case this project cares about avoiding. There is no safe distance from the boundary, only an
untested one.

Critical mass also never delivered what it was built for. Institutional spread went 0.099 to
0.110 — inside noise — while costing five years of time-to-expert. `teachTopN` achieves the
same intent through the teaching *level*, is anchored to individuals rather than to an
institutional aggregate, and is flat over 1,000 years at `baseMoveProb` 0.01. **Prefer it.
`criticalMass` defaults to 0 and should stay there.**

#### The variant that does not work

The natural alternative — a thin institution can pass on *less*, so scale its **target**
rather than its rate — was built and measured, and it is **unconditionally unstable**.
Expert count sets the target, the target sets expert count, and nothing anchors the loop.
A healthy field of 1,257 experts collapsed to **zero within 10 years** of switching it on,
identically at every (n₀, h) tried, so this is not a bootstrap artefact that a better
initial condition would fix. Scaling the *rate* is stable precisely because the destination
stays fixed while people move toward it. The engine carries a comment saying so; the code
is gone.

**Post-training differentiation** exists because the model was well behaved up to year 8 and
a single point after it. By tenure band, before: the 8–20y group sat at **0.642** and the
20y+ group at **0.645** — half the field, indistinguishable. Nothing could make one veteran
differ from another, because once you reach your institution's teaching level there is no
mechanism left.

Three mechanisms were built for this and were interlocking, each failing alone (IQR 0.010
with none of them; 0.009 with `aptitudeSpread` alone, which collapsed the field to 0.417;
0.076 with `teacherTermYears` alone; 0.323 with all three). Two of the three —
`teachPercentile` and `teacherTermYears` — were **removed in 2026-08** once `teachTopN`
superseded them; see "Why per-person teachers were removed" above. What now carries the
spread is `aptitudeSpread` against `teachTopN`'s teaching level: without ceilings the body
of the distribution compresses from IQR 0.270 to 0.093.

| Parameter | What it does |
|---|---|
| `learningCap` | Most expertise one tick of peer learning can add. Makes the climb roughly **linear in time** instead of exponential, so people spread along the ladder. Time from the entrant floor to expert ≈ `(0.585 − floor) / cap` months |
| `seniorTenureYears` | Who you learn **from**: the mean over members past this many years, rather than the plain institution average. Without it a cap *collapses* the field — trainees are counted in the average trainees learn from, so a long pipeline drags every target down (measured: meanE 0.611 → 0.304) |

Tenure, not rank, is deliberate for `seniorTenureYears`. A rank-based target (learn from the top half) **ratchets** —
lifting the top lifts the target, which lifts the top — and inflates the field toward
saturation at +0.08 per 1,000 ticks. That is the same runaway `personalLearningRate` is
anchored against. Tenure does not respond to expertise, so the target stays a balance
point people decay back toward. Tenure is drawn across a career at `t=0` from **its own
RNG stream**, so switching the mechanism on does not shift the main stream and change
every existing result — checked against an archived world-model row, which reproduces
bit-for-bit with the mechanism off.

```bash
node calibrate_pipeline.js            # the scan: 6-10y to expert, stationary, and a populated ladder
node calibrate_pipeline.js --verify   # one cell in detail (env: CAP, DR, TEN)
```

`engine.js` exports the result as `PIPELINE_PARAMS` (`learningCap` 0.0056,
`seniorTenureYears` 8, `decayRate` re-fitted to 0.027 — a longer pipeline moves where
decay balances). Measured at N=2000, M=40, no AI:

| | before | after |
|---|---|---|
| years to expert | 1.8 | **7.8** |
| meanE | 0.61 | 0.62 |
| interquartile range | 0.010 | **0.305** |
| below expert | 5% | **37%** |
| never reach expert | 0% | ~19% (ceiling below the threshold, by design) |
| drift (t=2000→4800) | −0.012 | −0.001 |

**Ceilings are drawn by rejection, not clipped.** A normal clipped to `[0,1]` put **10%
of ceilings on exactly 1.0**, and since ~63% of people converge to within 0.02 of their
own ceiling, that atom propagated into the expertise distribution as a wall of extreme
experts — 21% of the field at `E ≥ 0.85`. It is the same artefact `problems.md` P19
records for the entrant floor's pile-up at exactly 0, and the same fix: resample rather
than let the boundary collect mass. After it, that figure is **0%** with the level and
spread unchanged.

**Known and not fixed: institutions barely differ in what they can teach.** Measured
across 40 institutions, the top-quartile level spans only 0.734–0.845 (IQR 0.044), so
everyone whose personal ceiling exceeds their institution's teaching level stacks
against nearly the same wall — about 10% of the population sits within ±0.03 of the
median institution's level. Thinning that needs institution-level stratification, not
another individual-level dial; see problems.md P1 on how little the graph currently
moves outcomes.

Under AI it also restores `shareExpert` as a metric: **0.647 → 0.408**, against a
baseline that used to sit at ~0.95 with nowhere to go.

It is **scale-robust** where the old decay tuning was not — the cap fixes the climb
rate absolutely rather than relative to institution size, so 5, 13, 25 and 50 people
per institution all hold at 18–19% below expert. It also repairs a known measurement
problem: baseline `shareExpert` used to sit at ~0.95 with no downward range (see "Time
base" below); with the pipeline the baseline sits near the threshold, so the metric
discriminates in both directions again.

Two caveats. The transient runs for **several careers** — meanE is level only from
t≈2000 (165 years), though the ladder itself forms by year 10, so drift must be
measured from there. And `simulator.html` boots with this overlay while the batch
engine does not: the 15 completed world-model experiments were produced without it and
stay reproducible, so **interactive runs and batch results are no longer the same
model**. Running the experiment set under the pipeline means re-calibrating and
re-running it.

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
years. `personal_learning_rate` keeps its 0–0.02 range, which came from a saturation check
rather than the calibration scan. Every slider carries a plain-language description on
hover; the always-visible `hint` under a slider is the mechanical/calibration detail.

Top of the sidebar → **Steady state**: sets the learning dials so the no-AI baseline
holds level rather than drifting, then rebuilds. `transfer_rate` 0.15,
`turnover_rate` 1/480, `personal_learning_rate` 0.001, `expertise_mean` 0.28, AI off,
and `decay_rate` **derived from the current N/M** — learning runs on the gap to your
institution's mean, so bigger institutions pull harder and need more decay to
balance (0.026 at 5 people per institution, 0.024 at 13, 0.021 at 100).

Two things this does not do. It cannot make the run flat from `t=0`: the starting
population is drawn from a skew-normal that is not the equilibrium distribution, so
`meanE` climbs from ~0.51 to ~0.64 over the first ten years and holds from there —
read the baseline from t≈120 on. And it will not help you by raising the starting
level: transfer (0.15) is six times faster than decay (0.024), so a population that
starts *above* equilibrium takes centuries to come back down, while one that starts
below converges in a decade. `personal_learning_rate` is load-bearing here — set it to 0
and the population collapses from 0.645 to 0.415 by t=3000.

Sidebar → **World model graph**: the data is **already loaded** — `simulator.html`
pulls in `world-model-data.js`, a generated bundle of `world-model.json` +
`mobility-costs.json`, so the 245-institution graph is ready the moment the page
opens. Flip `use_world_model` and press **Rebuild**; the file inputs above it are
only needed to substitute your own edited data.

```bash
node build_world_model_data.js            # regenerate after editing either JSON
node build_world_model_data.js --check    # is the bundle current? (test_world_model.js runs this)
```

A generated script rather than `fetch()` because the page is opened straight off the
filesystem, where a `fetch` for a sibling file is blocked at `file://` and a classic
script tag is not. The bundle is optional: delete it and the page falls back to the
file inputs. Having the data loaded does **not** change what the simulator runs on —
the graph source still defaults to BA until you flip the switch.

The **Expertise distribution** panel counts cumulative turnover beside its title —
`entrants 1,459 · retirements 1,459 · 120y in, 2.92x the population replaced`. The two
numbers are equal by construction: one turnover event is one retirement *and* one
entrant, since the population is conserved. Both are shown because "has anyone left
yet" and "has anyone arrived yet" are different questions to ask of a young run. The
count follows the scrub bar, reading as of the tick being viewed rather than the live
one; `engine.js` carries it as `turnoverTotal` on the state and in every history entry.

Clicking a node in the network panel names it: on the world-model graph the inspector
shows the organisation's **label, city, country, sector and annual intake** — the city
resolved through `LOCATED_IN` to the hub nodes' own labels, falling back to the
organisation's `hub_city` — and hovering a node gives "Label — City". On the generated
BA graph there is nothing to name, so nodes stay numbered.

Everything in this group is structural, so it applies on **Rebuild** (the button
flags itself when a structural change is waiting). `mobility_friction` is a live
slider under Mobility.

Sidebar → **AI**: `γ_below`, `γ_above` and `μ_atr` are three independent sliders,
set directly. There is no coupling and no derived readout — the `couple_reliance`
toggle and the `ρ_AI` dial behind it were removed with the parameter in 2026-08.
Combinations the coupling used to forbid (learning dampened without any atrophy,
or the reverse) are now reachable, and are the way to isolate one channel from the
other.

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
                                              #   (loads engine.js/world_model.js as a browser does — shared global scope)
node dom_stub_test_report.js report.html      # same, for report.html — build it first
node test_world_model.js   # world-model loader + engine integration (65 checks)
```

The ρ→(`γ_below`, `μ_atr`) mapping exists in three places: `engine.js` for batch
runs, `simulator.html` for the browser, `report.template.html` for display.
`dom_stub_test.js` imports the **real engine** and asserts the simulator derives
identical values at ρ = −1, −0.5, 0, 0.25, 0.5, 1; `dom_stub_test_report.js`
does the same for the report. A silent divergence would let the interactive tool
and the published results describe different models.
