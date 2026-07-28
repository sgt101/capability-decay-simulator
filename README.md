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

### Parameter-pair experiment set (`experiments/experiment.1.json` .. `experiments/experiment.55.json`)

One file per pair of eleven study parameters — the original six dynamics
parameters (`turnoverRate`, `learningRateSpread`, `transferRate`,
`decayRate`, `aiDampeningBelow`, `aiDampeningAbove`) plus five AI-mechanism
and population parameters added later (`aiAtrophyMultiplier`,
`aiLevelFraction`, `expertiseMean`, `entrantExpertiseMean`, `aiGain`) — with
every other parameter (population size, graph, mobility) pinned at the same
fixed value across all 55 files. 55, not 110: `A×B` and `B×A` would be the
same grid transposed, not new information, so only the 55 unordered pairs
(`11 choose 2`) are generated. `experiment.1..15` are the original six-param
pairs and keep their original numbering exactly; `experiment.16..55` are the
40 new pairs introduced by the five added parameters, appended rather than
interleaved specifically so regenerating never silently renumbers a file you
might be referencing elsewhere.

Each is a 21×21 grid with `pairWithBaseline: true`, so each file is a single
2D heatmap of that pair's interaction on the expertise shortfall — `x`, `y`,
and a color for `meanE_shortfall` (or `shareExpert_shortfall`, or
`meanC_shortfall` — see below), faceted over `t` if you want to watch it
evolve rather than take a single tick. Not every axis uses the same `[0,1]`
step-0.05 default; several are zoomed into a narrower range where anything
happens at all, or widened past `[0,1]` to cover a regime the naive range
would silently exclude (e.g. `aiDampeningBelow`/`aiDampeningAbove` extended
to `[0,2]` so the *amplified* regime, `>1`, isn't excluded by construction —
the only way `meanE_shortfall` can go negative). Every exception is checked
empirically and explained in a comment directly above the parameter in
`generate_experiments.js`, not just asserted. Two worth knowing before
reading the new heatmaps:

- **`aiGain` only affects observed capability `C`, never real expertise
  `E`** — it has zero effect on `meanE_shortfall`/`shareExpert_shortfall`.
  `meanC_shortfall` (below) is the metric to look at for its 10 pairs.
- **`aiLevelFraction` is close to a no-op except paired against
  `aiDampeningBelow`/`aiDampeningAbove`** — the below/above threshold only
  matters for *learning* when the two dampening values actually differ, and
  every non-dampening param is studied at the same fixed, neutral
  `aiDampeningBelow == aiDampeningAbove == 1.0`. A small residual effect
  survives through `aiAtrophyMultiplier`'s own non-neutral default (1.5)
  acting on *decay* instead (meanE ranges roughly 0.81-0.82 through most of
  the sweep, dropping to ~0.77 as `aiLevelFraction` approaches 1.0), but it's
  far smaller than this parameter's two informative pairings against the
  dampening params themselves (~0.45 range there). That's a checked finding,
  not a bug.

`experiments.manifest.json` lists which pair is in which file, plus the
values swept and the fixed baseline, so you don't have to open all 55 to
remember what's what.

Run all of them, or a subset, into `results/experiment.<n>/`:

```bash
./run_experiments.sh                    # all 55
./run_experiments.sh 3 7 12             # just these
./run_experiments.sh --workers 14       # more worker threads on a bigger machine
./run_experiments.sh --workers 14 3 7   # both together, any order
```

At 21×21=441 grid cells × 5 replicates × 2 pairing arms, that's 4,410 runs
per experiment — 242,550 across all 55 (up from 66,150 across the original
15). `node generate_experiments.js` prints a rough range each time you
regenerate, not a single number — two real measurements on the same
machine, same `--workers 8`, disagreed by 4x (106s vs. 712s for comparable
job counts), so treat any estimate here skeptically; at that spread the full
55-experiment batch could be anywhere from ~2.5 to ~11 hours. Run
`./run_experiments.sh 1` first and time it before committing to the full
batch. `--workers` is the knob to bring the real number down on a machine
with cores to spare, once you know what "real" looks like on your box.

If you want to change the grid resolution, the values swept, or what's held
fixed, edit `STUDY_PARAMS` / `BASE_FIXED` at the top of `generate_experiments.js`
and rerun `node generate_experiments.js` — it regenerates all 55 files plus
the manifest from those two objects, rather than each file needing hand edits.
Replicates are set in the same file (`REPLICATES`, currently 5) if you want
to trade runtime against per-cell noise.

### Visualizing the experiment set: `report.html`

After `run_experiments.sh` has populated `results/`, build the heatmap browser:

```bash
node build_report.js      # reads results/, writes report.html
```

Open `report.html` directly in a browser — no server needed, everything is
embedded at build time. Rerun `node build_report.js` any time you rerun
experiments; it always reflects whatever's currently in `results/` (and
tells you if any of the 55 are missing).

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
  and the underlying baseline/treatment means, and scrub through the 10
  recorded ticks to watch a grid evolve rather than only see its endpoint.
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
| `aiLevelFraction` | AI's strength as a fraction of the **t=0 population's single greatest expert** (fixed for the whole run, not the current/live top performer). For typical population sizes the t=0 maximum sits close to the `[0,1]` ceiling, so at the default `0.70` this lands around 0.70 in absolute terms — meaningfully above the expert threshold (now `0.585`, see below), not coincident with it — "below AI level" tracks closer to "not yet expert" than to "below the typical human" |
| `aiDampeningBelow` | multiplier on **learning** for humans below the AI's level — how much growth AI reliance crowds out. Stored/config/CSV value is always raw `[0,2]`: **`0` = max dampening** (learning zeroed out), **`1` = no dampening at all**, `>1` = amplified. `simulator.html` and `report.html` both *display* this shifted by −1 (reads as −1/0/+1) — only the on-screen label changes, never the number you put in a config file |
| `aiAtrophyMultiplier` | multiplier on **decay** for humans below the AI's level — how hard AI reliance erodes expertise they already had. This is the headline erosion dial; `1` = no extra erosion, higher = faster obliteration |
| `aiDampeningAbove` | multiplier on learning for humans at/above the AI's level. Same raw `[0,2]` shape and same −1-shifted display as `aiDampeningBelow` |
| `aiResponseMode` | *(secondary — governs the illusion, not the erosion)* how the AI-inflated observed-capability metric `C` scales with a human's own expertise: `floor` / `flat` / `linear` / `amplified` / `exponential` |
| `aiGain` | *(secondary)* overall strength of the `C` boost, `0` = no visible effect regardless of mode |
| `seed` | RNG seed for a single run (set automatically per-run by the batch runner; only relevant for `simulator.html`'s manual seed field) |

## Expert threshold

`EXPERT_THRESHOLD = 0.585` is a bare constant in `engine.js` (duplicated identically
in `simulator.html`) — it is **not** a `DEFAULT_PARAMS` entry, is never swept in
`generate_experiments.js`, and has no slider in `simulator.html`. Its only use:

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

## Tests

```bash
node test_engine.js        # engine unit tests (no DOM)
node dom_stub_test.js simulator.html          # drives simulator.html's actual UI code end-to-end under a stubbed DOM
node dom_stub_test_report.js report.html      # same, for report.html — build it first
```
