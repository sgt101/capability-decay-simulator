# Capability Decay Simulator — Findings

Working notes on empirical properties of the model, beyond what's specified in
`spec.html`. Each section documents a question that was checked by running the
simulator directly, not assumed — the raw output backing each claim is saved
alongside this document.

## Simulation steady state

> **Read this section as history, not as current numbers.** It documents the
> equilibrium under the *original* dimensionless-tick calibration on a BA graph
> (meanE ≈ 0.87, read at t=1,000). Under the monthly time base and the
> world-model graph the equilibrium sits at meanE ≈ 0.63 and the horizon is
> t=1,440. The *structural* argument below — that an attracting equilibrium
> exists, and why — still holds and is why the recalibration was possible at
> all. The specific values do not. See "Time, turnover, and population scale"
> and "The stationary calibration" below.

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
off the ceiling without collapsing it, so a viable recalibration exists. Second,
**the usable band is narrow and the edges are sharp**: at `transferRate = 0.1`,
moving `decayRate` from 0.01 to 0.02 takes `shareExpert` from 0.95 to 0.00. That
knife-edge is a real property of the model (the same bifurcation the AI-dampening
sweeps show), not a numerical artifact — but it means the recalibration has to be
done by scanning, not by reasoning from the old values.

### Avoiding the ceiling is not enough — the baseline must also be *stationary*

The scan above selects on dynamic range, and on that basis `(0.13, 0.024)` looked
fine. It was not, and the reason is worth recording because it is easy to miss.

A calibration can sit clear of both the ceiling and collapse and still have its
**equilibrium in a different place from where the initial transient lands**. At
`(0.13, 0.024)` the t=0 population rises quickly to `meanE ≈ 0.60`, but the
system's actual equilibrium is `≈ 0.56`. With 40-year careers it takes many
cohorts to forget the initial condition, so the no-AI baseline sags for the whole
run and beyond (world-model scale, `N=10,504`, 3 seeds):

| t | 120 | 480 | 960 | 1440 |
|---|---|---|---|---|
| meanE baseline | 0.5975 | 0.5818 | 0.5700 | 0.5622 |

−0.035 across the horizon, still falling ten careers later. Two consequences:

1. **`meanE_shortfall` stops being interpretable.** It becomes "what AI removed,
   *plus* wherever the baseline had wandered to by the reporting tick".
2. **`shareExpert` collapses out of proportion.** Because `sd(E) ≈ 0.06`, a drift
   of 0.035 in the mean sweeps most of the population across the threshold:
   measured across 5 seeds, `shareExpert` fell 0.80 → 0.05 between t=480 and
   t=4800 while `meanE` moved only 7%. The two are not independent signals —
   `correlation(meanE, shareExpert) = 0.987`. `shareExpert` is `meanE` amplified
   roughly 16x, not a second measurement.

### The stationary calibration

Stationarity is therefore the *binding* criterion, and `calibrate_time_base.js`
now tests it directly (rejecting any cell whose baseline drifts more than 0.010
across the horizon) and scans against the world-model graph via `--world-model`,
because the stationary ridge sits in a different place on BA than on the real
graph.

Verified at production scale (`N=10,504`, `M=245`, 3 seeds):

| calibration | t=120 | t=480 | t=960 | t=1440 | drift | shortfall |
|---|---|---|---|---|---|---|
| **(0.15, 0.020)** | 0.6291 | 0.6289 | 0.6293 | **0.6294** | **+0.0002** | 0.369 |
| (0.17, 0.024) | 0.6301 | 0.6293 | 0.6277 | 0.6274 | −0.0027 | 0.374 |
| (0.13, 0.016) | 0.6280 | 0.6297 | 0.6313 | 0.6321 | +0.0041 | 0.362 |

`MONTHLY_TICK_PARAMS` uses **`transferRate = 0.15`, `decayRate = 0.020`** — flat
to four decimal places over three careers, with an AI shortfall of 0.369 and a
seed spread on that shortfall of only 0.0042.

No change to initialisation was needed. The earlier drift was not a bad starting
point but a calibration whose equilibrium sat *below* where the transient settled;
at `(0.15, 0.020)` the default init lands on the equilibrium by itself.

The trade-off is that equilibrium `meanE` (0.63) now sits well *above*
`EXPERT_THRESHOLD` (0.585), so baseline `shareExpert` is ~0.95 with little
downward range. That is the right way round for this model: `meanE` is the
headline metric and is now well-behaved, and `shareExpert` remains readable as a
threshold-crossing indicator.

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

## Collapsing the AI mechanism: one reliance dial instead of two

The model originally exposed `aiDampeningBelow` (γ_below) and
`aiAtrophyMultiplier` (α) as independent parameters. They are not independent in
any meaningful sense, and treating them as such was letting the sweep spend its
budget on states the model should never have been able to express.

### They gate on the same condition and act on disjoint branches

The per-agent update is:

```
gap = Ebar[j] − E[i]          below = aiEnabled && E[i] < aiLevel

gap > 0  (learning):  ΔE = β · gap · L  × (below ? γ_below : γ_above)
gap ≤ 0  (decay):     ΔE = δ · gap · L  × (below ? α : 1)      + ambient
```

γ_below and α are selected by the *same* predicate, `below`, and applied to
*disjoint* branches — an agent has either `gap > 0` or `gap ≤ 0`, never both.
They are the two halves of de-skilling: "didn't get to learn" and "use it or
lose it". As free parameters they permit "AI completely blocks novice learning
but causes no atrophy", which is not a state any account of AI reliance
describes.

### The data already said they were one thing

Before the change, a 21×21 sweep of δ × α collapses onto a single quantity:

| collapse onto | rank-R² |
|---|---|
| **δ·(α−1)** | **0.946** |
| δ·α | 0.879 |
| α alone | 0.734 |
| δ alone | 0.088 |

`δ·(α−1)` is not a fitted form — it is the algebra. Decay in the AI arm is
`δα·gap` against `δ·gap` in the baseline, so the *excess* is `δ(α−1)·gap`. The
0.946 is that identity showing up in the measurement.

### The reparameterisation

```
aiDampeningBelow    = 1 − ρ        ρ=−1 → 2.0    ρ=0 → 1    ρ=+1 → 0
aiAtrophyMultiplier = 5 ^ ρ        ρ=−1 → 0.2    ρ=0 → 1    ρ=+1 → 5
```

Linear for the dampening, because it is a *fraction* of learning retained;
log-symmetric for atrophy, because it is a *multiplier* and "equal and opposite"
for a multiplier means symmetric in log space. Both hit the endpoints of the
ranges the two parameters were previously swept over, so nothing in the explored
space is lost except α < 0.2.

Two properties are worth stating explicitly because they are what make ρ a
better axis than the pair it replaces.

**ρ = 0 is exactly inert.** Measured across the full λ range, `meanE_shortfall`
at ρ = 0 is 0.00000 — not approximately zero, zero. The no-AI and with-AI arms
are bit-identical in expertise. That gives the metric a true origin, which the
old pair did not have: γ_below = 1, α = 1 was inert too, but nothing about the
parameterisation made that the natural centre of either range.

**The sign of ρ is the sign of the result.** Negative ρ — AI as a well-used tool
that both teaches and preserves — produces negative shortfall throughout:

```
   ρ   |  λ=0.01   0.21    0.41    0.60    0.80    1.00
 -1.00 |  -0.005  -0.031  -0.057  -0.090  -0.168  -0.294
 -0.40 |  -0.002  -0.014  -0.032  -0.052  -0.150  -0.164
 +0.00 |  +0.000  +0.000  +0.000  +0.000  +0.000  +0.000
 +0.40 |  +0.002  +0.031  +0.071  +0.254  +0.262  +0.262
 +1.00 |  +0.544  +0.613  +0.610  +0.612  +0.610  +0.612
```

Keeping ρ signed is a deliberate modelling choice. Restricting it to [0,1] would
make the model structurally incapable of expressing the optimistic case — the
AI-helps regime would be unreachable by construction rather than unsupported by
evidence, and a model that cannot represent the answer it is being asked about
cannot be said to have tested it.

### The ρ = +1 endpoint is degenerate, and it is the parameterisation's fault

`aiDampeningBelow = 1 − ρ` reaches exactly 0 at ρ = +1, which makes the learning
branch `ΔE = 0` for any agent below λ. Since rising is the only way out from
below λ, that is an absorbing state. Entrants clipped at 0 — about 16% of them at
`entrantExpertiseMean = 0.05` — enter it on arrival and never leave. Measured at
λ = 0.01, t = 1440:

| ρ | γ_below | meanE | trapped below λ |
|---|---|---|---|
| 0.90 | 0.10 | 0.6244 | 0.1% |
| 0.95 | 0.05 | 0.6206 | 0.1% |
| **1.00** | **0.00** | **0.0894** | **19.7%** |

The trapped pool pulls each institution's `Ebar` down, which puts the survivors
into the decay branch, which lowers `Ebar` again — the collapse cascades rather
than merely adding a fifth of the population at zero. `meanE_shortfall` jumps
70× across the final step of the sweep, from 0.008 to 0.544.

This is worth separating from the model's substantive claims. It is not a
finding about AI reliance; it is a singularity at the edge of a chosen
parameterisation meeting a clipping artifact in the entrant draw. ρ = 0.95
behaves indistinguishably from ρ = 0.9. The honest reading is that the model has
nothing to say about *total* reliance, because total reliance in this
formulation is a degenerate limit rather than an extreme case.

## Which parameters actually matter, and a warning about the ones that don't

Reviewing a full 21×21 sweep over eleven parameters narrowed the study set to
seven. Two findings from that review change how the remaining results should be
read.

### The parameters split into baseline-movers and AI-only

`aiRelianceIntensity`, `aiDampeningAbove` and `aiLevelFraction` appear only
behind `aiEnabled`. The no-AI arm is *mathematically* independent of them, so
the baseline holds still while they sweep. The rest move both arms:

| experiment | baseline `meanE` across the grid | spread |
|---|---|---|
| γ_below × γ_above | 0.627 → 0.635 | **0.008** |
| δ × α | 0.493 → 0.808 | 0.316 |
| λ × E₀ | 0.416 → 0.797 | 0.381 |
| E₀ × entrant | 0.406 → 0.891 | 0.485 |
| β × δ | 0.329 → 0.898 | **0.569** |

Only the pure-AI pair keeps the baseline still. In β × δ the baseline wanders
across most of the unit interval, so `meanE_shortfall` is not comparable between
that grid's corners: 0.09 against a baseline of 0.33 and against 0.90 are
different quantities, and the second is compressed against the ceiling. Some of
the apparent structure along those axes is the baseline moving rather than AI
biting. This is the same concern that motivated the stationarity work, arriving
by a different route — stationarity was enforced at the *calibration point*, but
sweeping β or δ walks away from it by construction.

### A pinned parameter can silently switch another one off

λ is a threshold, and equilibrium meanE ≈ 0.63, so λ decides what fraction of
the population is subject to AI at all. Once λ clears the population mean,
essentially everyone is below it and raising λ further changes nothing — the
effect saturates:

```
λ=0.01   +0.001
λ=0.406  +0.027
λ=0.604  +0.077
λ=0.653  +0.111    <- plateau begins
λ=0.703  +0.113
λ=1.000  +0.115
```

That has a consequence for a *different* parameter. γ_above governs only the
above-threshold population, so inside the plateau it governs almost nobody.
Spread in `meanE_shortfall` attributable to γ_above, by λ:

```
λ=0.01   0.7382    <- gamma_above governs everyone
λ=0.41   0.3243
λ=0.60   0.1158
λ=0.65   0.0424    <- crossover
λ=0.70   0.0037
λ=1.00   0.0033
```

At λ = 0.70 — which was the pinned default when this was measured — γ_above
shows 0.002 variance explained, which reads as "this parameter does nothing" and
is entirely an artifact of where λ sat. Read the other way, γ_above is the single
most powerful parameter in the model at low λ.

**The pin has since moved to `EXPERT_THRESHOLD` = 0.585**, below the plateau, on
the grounds that "the AI is as good as a human we would call expert" is a stated
quantity rather than an arbitrary choice. That restores γ_above to a live
parameter and stops every λ-pinned figure reporting the saturated maximum.

The general lesson stands regardless of where the pin ends up: a null result for
one parameter can be manufactured entirely by the pinned value of another, and
nothing in the figure showing that null gives any hint of it. The only defence is
to check the interaction before believing the null.

The general lesson is worth stating plainly, because it applies to any pairwise
design: **in a sweep that pins n−2 parameters per figure, a null result is a
statement about the pinned point, not about the parameter.** Two of the eleven
original parameters were nearly dropped on exactly this basis before the
interaction was checked.

### `aiLevelFraction` is not a fraction of anything

`aiLevel = aiLevelFraction × startTopE`, documented as a fraction of the t=0
population's greatest expert. `startTopE` measures **1.0 for every value of
`expertiseMean` from 0 to 0.8** — with N = 10,504 draws and clipping to [0,1],
the initial maximum always reaches the ceiling. λ is therefore an absolute
expertise threshold, and the intended coupling to the starting population does
not exist. Numerically harmless; it just means the name describes something the
model does not do.

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
