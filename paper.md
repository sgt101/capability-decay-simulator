# Capability Decay Simulator — Findings

Working notes on empirical properties of the model, beyond what's specified in
`spec.html`. Each section documents a question that was checked by running the
simulator directly, not assumed — the raw output backing each claim is saved
alongside this document.

## Simulation steady state

**Question:** with AI disabled, does the model settle into a steady state — a
population-level equilibrium it converges to and stays at — or does it keep drifting
indefinitely (e.g. toward everyone reaching full expertise, or toward collapse)?

**Answer: yes.** The no-AI baseline has a genuine attracting equilibrium. This was
checked three ways, each with its data recorded in [`steady state/`](steady%20state/)
(reproduce with `node "steady state/run_steady_state.js"`):

### 1. It converges from very different starting populations

Four separate runs, differing only in `expertiseMean` at t=0 (0.05 = mostly novices,
0.28 = default, 0.50, 0.70 = mostly already expert), same seed, tracked out to
t=20,000 — 20× the model's normal 1000-tick reporting horizon.

Data: [`steady state/convergence_from_different_starts.csv`](steady%20state/convergence_from_different_starts.csv)

| start `expertiseMean` | meanE @ t=100 | meanE @ t=1000 | meanE @ t=20000 |
| --------------------- | ------------- | -------------- | --------------- |
| 0.05 (weak)           | 0.569         | 0.753          | 0.866           |
| 0.28 (default)        | 0.775         | 0.857          | 0.864           |
| 0.50                  | 0.907         | 0.900          | 0.879           |
| 0.70 (strong)         | 0.952         | 0.910          | 0.892           |

All four start far apart (meanE spans 0.57–0.95 at t=100) and converge to the same
narrow band — meanE ≈ 0.86–0.89 — by roughly t=2000–4000, whether they climbed up to
get there (weak start) or drifted down to get there (strong start). That convergence
from both directions onto the same value is the signature of a true attracting
equilibrium, not two different systems that both happen to be stable.

### 2. The equilibrium is tight and reproducible across seeds, not a coincidence of one run

10 seeds, each run to t=10,000 (10× normal horizon), no-AI. Repeated with the current
`ambientGrowthRate` default (0.001) and with it forced to 0, to separate "is there an
equilibrium at all" from "did ambient growth specifically create it."

Data: [`steady state/seed_variance_at_steady_state.csv`](steady%20state/seed_variance_at_steady_state.csv)

|                                               | meanE (mean ± sd across 10 seeds) | shareExpert (mean ± sd) |
| --------------------------------------------- | --------------------------------- | ----------------------- |
| `ambientGrowthRate` = 0.001 (current default) | 0.871 ± 0.008                     | 0.959 ± 0.010           |
| `ambientGrowthRate` = 0                       | 0.832 ± 0.014                     | 0.958 ± 0.010           |

Both configurations land in a tight band (standard deviation under 0.015 on a [0,1]
scale, across independently-seeded runs). The equilibrium **predates** ambient growth
— it already existed from turnover alone — ambient growth just shifts its level up by
about 0.04, it doesn't create the stability itself.

### 3. It genuinely holds, out to 50,000 ticks — not just slow to diverge

Averaged across 3 seeds, one continuous run per seed out to t=50,000 (50× normal
horizon), sampled along the way.

Data: [`steady state/long_horizon_trace.csv`](steady%20state/long_horizon_trace.csv)

| t      | meanE (avg of 3 seeds) | shareExpert (avg of 3 seeds) |
| ------ | ---------------------- | ---------------------------- |
| 1,000  | 0.872                  | 0.972                        |
| 5,000  | 0.879                  | 0.961                        |
| 10,000 | 0.877                  | 0.958                        |
| 25,000 | 0.880                  | 0.972                        |
| 50,000 | 0.875                  | 0.968                        |

No trend across 50× the normal horizon — the value at t=50,000 is statistically
indistinguishable from the value at t=1,000. This mattered to check specifically
because an earlier, since-fixed version of the ambient-growth mechanism (see
`spec.html` §11 "Key design decisions") scaled growth off each institution's _live_
average, which created unbounded positive feedback and drove the whole population to
E=1 given a long enough horizon (confirmed saturating by t≈5,000 in that version).
The current version, anchored to each institution's _founding_ average instead,
does not have that failure mode — this table is the check that it doesn't.

### Why the equilibrium exists, mechanistically

It's an inflow/outflow balance, not a special tuning of any one parameter. Every
tick, `turnoverRate` (default 0.01/tick) replaces about 1% of the population with
fresh entrants who start near `entrantExpertiseMean` (default 0.05 — deliberately
low, see "Entrant renewal" in `spec.html` §7). These entrants land below their
institution's average, so they're pulled upward by `transferRate` (default 0.5,
tuned specifically to be fast enough for this to work — see §7). Meanwhile everyone
already at or above their institution's average is pulled down slightly by
`decayRate` and up slightly by `ambientGrowthRate`. The steady state is the point
where the constant inflow of novices (dragging the population average down) balances
the rate at which they catch up and the rest of the population's slower drift — the
same shape as a demographic equilibrium (births vs. deaths), not a static population
of unchanging individuals.

This also explains why `shareExpert` settles at ~96%, not 100%: there is always a
fresh cohort of recent entrants still ramping up (a healthy system with continuous
turnover always has _some_ newcomers below the expert threshold), even though the
system as a whole is fully stable.

### A practical implication for reading `report.html`

The equilibrium value (meanE ≈ 0.87–0.88) is measurably higher than the value at the
model's standard t=1,000 reporting checkpoint (meanE ≈ 0.857–0.872 depending on
seed) — the no-AI baseline hasn't fully finished climbing to its steady state by the
time every experiment in `report.html` takes its reading. This doesn't change the
qualitative AI-vs-no-AI story (the AI arm typically collapses toward 0 well before
t=1,000 under the worst-case dampening most experiments use as their fixed backdrop),
but it means every `meanE_baseline` value in the existing report slightly
understates the no-AI arm's true long-run health, and by extension slightly
overstates `meanE_shortfall`. Extending `HORIZON`/`RECORD_AT` in
`generate_experiments.js` would let a future report read the fully-converged
equilibrium instead of a still-climbing snapshot, at the cost of longer runs.

**Note:** this equilibrium is specific to the model's current fixed/default
parameters (`turnoverRate`, `transferRate`, `entrantExpertiseMean`, `decayRate`,
`ambientGrowthRate`, etc.) — it is not a universal constant of the model structure.
Different values of those parameters settle at different equilibria; that's exactly
what the parameter-pair heatmaps in `report.html` are measuring, just read at t=1,000
rather than at full convergence.

## The institution graph: what "BA" means and what it silently assumes

Every result in this document was produced on a **Barabási–Albert (BA)** graph —
the structure `generateBAGraph(M, mAttach, rng)` in `engine.js` builds. Since the
graph is never varied in the current experiment set, it's easy to forget it is a
modelling choice at all. This section records what that choice is and what it
carries with it, because swapping it (see `world-model-plan.md`) changes more than
it appears to.

### The algorithm

BA builds a graph by **preferential attachment**. Start with a small
fully-connected seed of `m+1` nodes, then add nodes one at a time, each bringing
`m` edges (`graphAttachment`, default 2). The key step is how a new node picks its
neighbours: with probability proportional to their *existing* degree. In the code
that's the `repeated` array — it holds each node once per edge it already has, so
drawing from it uniformly is drawing proportional to degree.

Rich get richer. The result is a **scale-free** network: a heavy-tailed degree
distribution with a few dominant hubs and a long tail of sparsely-connected nodes.
At the model's defaults (`M=40, graphAttachment=2`) that is 77 edges, mean degree
3.9, and max degree 17 — the busiest institution carries ~4.4× the average number
of connections.

### What the graph is used for

Only two things, both in the mobility step. The graph does **not** touch learning
or decay directly — those depend on `Ebar[j]`, an institution's own internal mean,
which is indifferent to how that institution is wired to others.

1. **Who you can move to.** `candidateInstitutions()` returns
   `graph.neighbors[current]` plus `current`, unless a `jumpProbability` roll
   grants access to the whole network.
2. **Prestige.** `prestige[i] = degree[i] / maxDegree`, which enters the move
   utility weighted by `prestigeWeight`.

The graph's influence on expertise is therefore entirely **indirect**: it shapes
who ends up in which institution, and institution composition is what drives
learning. This is worth stating plainly because it bounds how much a better graph
can buy — a more realistic topology changes the *sorting* of people across
institutions, not the mechanism by which they gain or lose expertise.

### The assumption hiding in `prestige`

Under BA, `degree` and "is a hub" are the same thing, so `degree / maxDegree` is a
faithful measure of network centrality. `prestigeWeight` was calibrated against
that meaning.

That equivalence is a property of BA, not something the code enforces. Any graph
built by connecting institutions that share an attribute — same city, same sector —
is a **union of cliques**, and inside a clique every member has nearly the same
degree. On such a graph `degree / maxDegree` stops measuring centrality and starts
measuring *"how large is the group I happen to belong to."* Same variable, same
coefficient, different quantity — and no error would be raised. Any replacement
graph needs `prestige` sourced explicitly rather than inherited from degree.

### BA is a null model, not a claim about recruitment

BA was presumably chosen because it produces plausibly heterogeneous structure
from two parameters and a seed, and is exactly reproducible. It is not a claim
that finance hiring networks are scale-free. It gives the model *some* realistic
inequality in institutional connectedness without requiring any real-world data.

The practical consequence: results computed on BA and results computed on a real
loaded graph are **not comparable**, and should never be read side by side as if
they were the same experiment. The defaults in `DEFAULT_PARAMS` — particularly
`prestigeWeight`, `jumpProbability`, and `baseMoveProb` — are tuned to a mean
degree of ~3.9. A realistic graph built from `world-model.json` lands nearer ~18,
which is a different regime for all three.

## Time, turnover, and population scale

**Question:** what is one tick worth in real time, what population size does that
imply, and does the current parameter set survive being pinned to real time?

The model was built dimensionless — no tick length is declared anywhere. Fixing
one turns out to be far from cosmetic: it converts three free parameters into
*derived* ones and exposes an inconsistency in the existing calibration.

### The convention: one tick = one month

Adopted convention, not an inference: **1 tick = 1 month**, so 12 ticks per year.
A career is taken as **40 years = 480 ticks**, which fixes turnover:

```
turnoverRate = 1 / 480 = 0.002083     (vs. the current default of 0.01)
```

Career length remains a legitimate thing to sweep — it is a *social* variable, not
a physical constant. If it turned out that people had to work 50 years to stave off
collapse, that is a finding the model should be able to express. But sweeping it
now means sweeping a quantity with units, and `N` has to move with it (below).

Under this convention the current default `turnoverRate = 0.01` implies a career of
100 ticks = **8.3 years**, which is far too short.

### Population size follows from intake × career length

At equilibrium, headcount = annual intake × career length — the standard
demographic identity. So `N` is not free either:

```
N = 40 × (annual intake / divisor)
```

| Divisor | Scaled annual intake | `N` | Humans/institution (M=245) |
|---|---|---|---|
| 50 | 1,050 | 42,011 | 171.5 |
| 100 | 525 | 21,006 | 85.7 |
| **200** | **263** | **10,503** | **42.9** |
| 250 | 210 | 8,402 | 34.3 |
| 400 | 131 | 5,251 | 21.4 |

**`N`, `turnoverRate`, and career length are one statement seen from three sides.**
They cannot be set independently. Since `turnoverRate` is one of the eleven swept
study parameters, sweeping it in a data-anchored run means sweeping career length,
which should move `N` too — a coupling the current independent-axis sweep design
cannot express.

Horizon also acquires meaning: at 480 ticks per career, `HORIZON = 1000` is 83
years (~2.1 careers) and `HORIZON = 1440` is exactly 3 careers.

### Turnover governs whether the system can renew itself

Measured at `N=3000, M=245, seed=1`, no AI, with everything else at defaults:

| `turnoverRate` | implied career (ticks) | meanE @1000 | shareExpert @1000 |
|---|---|---|---|
| 0.01 | 100 | 0.872 | 0.974 |
| 0.02 | 50 | 0.620 | 0.859 |
| 0.04 | 25 | 0.202 | **0.000** |
| 0.05 | 20 | 0.140 | **0.000** |

Above roughly `turnoverRate = 0.02`, entrant inflow outruns peer transfer and the
population cannot renew itself **even with no AI present at all**. That is not a
bug — it is the model saying a 25-tick career is too short to reach expertise at
the current rates. But it means the **AI-vs-no-AI contrast becomes undefined**
there: both arms sit at `shareExpert = 0`, so the shortfall metric measures nothing.

### The current parameters do not survive a 40-year career

This is the consequence that matters. Running at `turnoverRate = 0.002083` with
everything else at defaults (`N=10,503, M=245`, no AI):

| `turnoverRate` | career (years) | meanE @1440 | shareExpert @1440 |
|---|---|---|---|
| 0.01 | 8 | 0.775 | 0.975 |
| 0.004167 | 20 | 0.918 | 0.991 |
| 0.002778 | 30 | 0.951 | 0.994 |
| **0.002083** | **40** | **0.964** | **0.996** |

At a 40-year career the no-AI baseline **saturates**: 98.4% of the population sits
above `E = 0.95`, piled against the 1.0 ceiling. `shareExpert` reads 0.996 with no
variance left in it. The model has not broken, but its dynamic range has — a
baseline that is uniformly perfect gives AI nothing to erode that can be measured
against anything.

The cause is that `transferRate = 0.5` means closing half your gap to the
institution mean *every tick*. At monthly ticks that is implausibly fast, and over
a 480-tick career it drives everyone to the ceiling. **A longer career therefore
forces `transferRate` and `decayRate` to be re-derived together.** Scanned at a
40-year career (`N=4000, M=100`, t=4800, cells are `shareExpert / fraction ≥ 0.95`):

| `transferRate` \ `decayRate` | 0.005 | 0.01 | 0.02 | 0.04 | 0.08 |
|---|---|---|---|---|---|
| **0.5** | 1.00/0.99 | 1.00/0.99 | 1.00/0.98 | 1.00/0.00 | 0.99/0.00 |
| **0.3** | 0.99/0.69 | 0.99/0.00 | 0.99/0.00 | 0.99/0.00 | 0.00/0.00 |
| **0.2** | 0.99/0.00 | 0.99/0.00 | 0.98/0.00 | 0.79/0.00 | 0.00/0.00 |
| **0.15** | 0.98/0.00 | 0.98/0.00 | 0.96/0.00 | 0.00/0.00 | 0.00/0.00 |
| **0.1** | 0.97/0.00 | 0.95/0.00 | 0.00/0.00 | 0.00/0.00 | 0.00/0.00 |

Two things to read off this. First, raising `decayRate` does pull the population
off the ceiling without collapsing it, so a viable recalibration exists —
`(0.2, 0.04)` and `(0.15, 0.02)` are both in range. Second, **the usable band is
narrow and the edges are sharp**: at `transferRate = 0.1`, moving `decayRate` from
0.01 to 0.02 takes `shareExpert` from 0.95 to 0.00. That knife-edge is a real
property of the model (the same bifurcation the AI-dampening sweeps show), not a
numerical artifact — but it means the recalibration has to be done by scanning,
not by reasoning from the old values.

### The steady state survives realistic population scale

Separately from the turnover question, scale itself is benign. With `turnoverRate`
left at 0.01 and no AI:

| `N` | `M` | humans/institution | meanE @1000 | shareExpert @1000 |
|---|---|---|---|---|
| 500 | 40 | 12.5 | 0.874 | 0.974 |
| 5,777 | 245 | 23.6 | 0.821 | 0.977 |
| 11,553 | 245 | 47.2 | 0.761 | 0.972 |
| 23,106 | 245 | 94.3 | 0.739 | 0.971 |

Equilibrium `meanE` drifts down as institutions get larger (more internal
averaging, so a smaller effective peer gap), but `shareExpert` holds at ~0.97
throughout. **The self-renewal property is robust to population scale.** It is
`turnoverRate` — not `N` and not `M` — that governs whether the system can sustain
itself.

## Recruitment processes

| Process | Type | Region |
|---|---|---|
| Summer Analyst internship converting to full-time | Mechanism | USA |
| Centralised public-sector exam (SBI PO / IBPS PO) | Mechanism | India |
| Private-bank hire-and-train campus programme (PGDBF/PGDBS) | Mechanism | India |
| Global Capability Centre campus analyst scheme | Mechanism | India |
| Fixed autumn cycle (秋招) + spring supplementary round (春招) | Mechanism | China |
| Programa de Trainee (single annual cohort) | Mechanism | Latin America |
| Programa de Estágio / internship-led entry | Mechanism | Latin America |
| Public exam (concurso público) - state banks | Mechanism | Latin America |
| National-hub rotational graduate / traineeship scheme | Mechanism | Continental Europe |
| Actuarial / technical development programme | Mechanism | USA |
| Elite Indian campuses (IIMs / IITs / top commerce colleges) | TalentPool | India |
| Chinese-language campus channels (校园招聘 microsites, 51job, Zhaopin, liepin) | TalentPool | China |
| Cia de Talentos (LatAm graduate recruitment intermediary) | TalentPool | Latin America |
| Manipal Global / NIIT University (hire-train academy partners) | TalentPool | India |
| SENA (Colombian technical training system) | TalentPool | Latin America |
