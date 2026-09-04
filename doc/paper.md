# Capability Decay Simulator — Findings

Working notes on empirical properties of the model, beyond what's specified in
`spec.html`. Each section documents a question that was checked by running the
simulator directly, not assumed — the raw output backing each claim is saved
alongside this document.

## Simulation steady state

> **Read this section as history, not as current numbers.** It documents the
> equilibrium under the _original_ dimensionless-tick calibration on a BA graph
> (meanE ≈ 0.87, read at t=1,000). Under the monthly time base and the
> world-model graph the equilibrium sits at meanE ≈ 0.63 and the horizon is
> t=1,440. The _structural_ argument below — that an attracting equilibrium
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
`personalLearningRate` default (0.001) and with it forced to 0, to separate "is there an
equilibrium at all" from "did ambient growth specifically create it."

Data: [`steady state/seed_variance_at_steady_state.csv`](steady%20state/seed_variance_at_steady_state.csv)

|                                                  | meanE (mean ± sd across 10 seeds) | shareExpert (mean ± sd) |
| ------------------------------------------------ | --------------------------------- | ----------------------- |
| `personalLearningRate` = 0.001 (current default) | 0.871 ± 0.008                     | 0.959 ± 0.010           |
| `personalLearningRate` = 0                       | 0.832 ± 0.014                     | 0.958 ± 0.010           |

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
`decayRate` and up slightly by `personalLearningRate`. The steady state is the point
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
`personalLearningRate`, etc.) — it is not a universal constant of the model structure.
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
neighbours: with probability proportional to their _existing_ degree. In the code
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
can buy — a more realistic topology changes the _sorting_ of people across
institutions, not the mechanism by which they gain or lose expertise.

### The assumption hiding in `prestige`

Under BA, `degree` and "is a hub" are the same thing, so `degree / maxDegree` is a
faithful measure of network centrality. `prestigeWeight` was calibrated against
that meaning.

That equivalence is a property of BA, not something the code enforces. Any graph
built by connecting institutions that share an attribute — same city, same sector —
is a **union of cliques**, and inside a clique every member has nearly the same
degree. On such a graph `degree / maxDegree` stops measuring centrality and starts
measuring _"how large is the group I happen to belong to."_ Same variable, same
coefficient, different quantity — and no error would be raised. Any replacement
graph needs `prestige` sourced explicitly rather than inherited from degree.

### BA is a null model, not a claim about recruitment

BA was presumably chosen because it produces plausibly heterogeneous structure
from two parameters and a seed, and is exactly reproducible. It is not a claim
that finance hiring networks are scale-free. It gives the model _some_ realistic
inequality in institutional connectedness without requiring any real-world data.

The practical consequence: results computed on BA and results computed on a real
loaded graph are **not comparable**, and should never be read side by side as if
they were the same experiment. The defaults in `DEFAULT_PARAMS` — particularly
`prestigeWeight`, `jumpProbability`, and `baseMoveProb` — are tuned to a mean
degree of ~3.9. A realistic graph built from `world-model.json` lands nearer ~18,
which is a different regime for all three.

## The mobility mechanism: how agents move between institutions

Every agent is offered the chance to move on every tick. The mechanism has three
stages — whether a move is considered, which institutions are on offer, and which
one is chosen — and the third stage always includes staying put as an option.

### Stage 1: is a move considered?

An independent Bernoulli draw per agent per tick, with probability proportional to
that agent's own learning rate:

$$\Pr(\text{agent } i \text{ considers a move at } t) \;=\; \mu\,L_i ,$$

with $\mu = 0.01$ under the world-model calibration (`baseMoveProb`; the
unconditioned default is 0.05).

$L_i$ is **not** bounded above by 1. It is drawn once per career from a lognormal,
$L_i = e^{\sigma Z_i}$ with $Z_i \sim \mathcal{N}(0,1)$ and $\sigma = 1$
(`learningRateSpread`), so $L_i \in (0,\infty)$ with median exactly 1 and mean
$e^{\sigma^2/2} = 1.649$. The move probability therefore straddles $\mu$ rather than
sitting below it, and the spread is wide:

| percentile | $L_i$ | $\mu L_i$ | mean years between moves |
| ---------- | ----- | --------- | ------------------------ |
| p10        | 0.28  | 0.0028    | 30                       |
| p25        | 0.51  | 0.0051    | 16                       |
| **p50**    | 1.00  | 0.0100    | 8.3                      |
| p75        | 1.96  | 0.0196    | 4.2                      |
| p90        | 3.60  | 0.0360    | 2.3                      |
| p99        | 10.2  | 0.102     | 0.8                      |

Two things follow that are easy to state wrongly. First, the "a move every ~7
years" in the source comment is the **median** agent; the population *mean* rate is
$\mu\,\mathrm{E}[L] = 0.0165$, or a move every ~5 years. Neither number describes a
typical career well, because the top decile moves roughly every two years while the
bottom quartile barely moves at all in a 40-year career. Any mobility rate quoted
from this model should say which of the two it is.

Second, and more consequential: $L_i$ scales the learning and decay terms as well
as this one, so **mobility and learning speed are perfectly rank-correlated by
construction**. The model cannot represent a fast learner who stays put. Any
measured association between mobility and expertise growth is therefore partly
built in rather than emergent, and should not be read as a finding.

(An edge case, benign: $\mu L_i \ge 1$ requires $L_i \ge 100$, which has probability
$2 \times 10^{-6}$ per draw. Such an agent moves every tick. Nothing breaks, but the
quantity is not formally guaranteed to be a probability.)

### Stage 2: the candidate set

Under the `hybrid` mobility mode used by all reported runs, with probability
$q = 0.10$ (`jumpProbability`) the agent draws a set of up to 25 institutions from
anywhere in the network; otherwise the candidate set is the graph neighbourhood of
their current institution. In both cases **the agent's current institution is always
a member of the set**.

That last clause carries the mechanism. Being selected to consider a move is not the
same as moving: the incumbent institution competes in the choice below on equal
terms, so an agent with no better option stays, and staying is an outcome of the
choice rather than a failure to reach it.

### Stage 3: where

Each candidate $j$ in the set $\mathcal{C}_i$ is scored, and the destination drawn
by softmax:

$$u_{ij} \;=\; (1-\kappa)\,\max\!\left(0,\; \bar E_j - E_i\right) \;+\; \kappa\left(E_i - \bar E_j\right) \;+\; \psi\,P_j ,$$

$$\Pr\!\left(J(i) \leftarrow j\right) \;=\; \frac{\exp\!\left(u_{ij}/T_{\text{move}}\right)}{\sum_{k \in \mathcal{C}_i} \exp\!\left(u_{ik}/T_{\text{move}}\right)} ,$$

with $\kappa = 0.5$ (`competitionAversion`), $\psi = 0.3$ (`prestigeWeight`),
$T_{\text{move}} = 0.12$, and $P_j \in [0,1]$ the institution's normalised degree,
fixed at graph construction.

The first two terms are competing appetites. The first is **growth** — move somewhere
stronger than you, where there is something to learn — and it is floored at zero, so a
weaker institution scores zero rather than negative. The second is **status** — move
somewhere weaker than you, where you are the strongest person in the room — and it is
*not* floored. $\kappa$ mixes them; $\psi P_j$ then adds a flat bonus for network
centrality, the name on the door, independent of who works there.

The asymmetric clipping is not a detail. Writing $d = \bar E_j - E_i$, the two
expertise terms collapse to $(1-2\kappa)\,d$ for an institution stronger than the
agent and $\kappa\lvert d\rvert$ for one weaker.

**At the shipped $\kappa = 0.5$ the first of those is exactly zero.** An institution
0.30 above the agent and one exactly level with them score identically on expertise.
Under the calibration actually run, expertise therefore only ever pushes agents
*downward*: every institution better than you is expertise-invisible, only weaker
institutions carry an expertise signal, and that signal is an attraction proportional
to how much weaker they are. The sole force pulling anyone toward a stronger
institution is $\psi P_j$ — and prestige is network degree, which is only loosely
coupled to expertise.

$\kappa = 0.5$ is thus not a midpoint between two appetites but the exact knife-edge
at which the growth appetite is fully cancelled: below it agents climb, at it they do
not, above it they are actively repelled from strong institutions. That is a
substantive commitment sitting in a parameter that reads as a neutral default.

Note also that mobility runs on $\bar E_j$, the institution's population mean, while
learning runs on $T_j$, its teaching level. Deliberate: a place's general standard is
visible from outside, but who specifically will teach you is not.

Finally, the softmax at $T_{\text{move}} = 0.12$ is genuinely soft, not close to
greedy. Measured at $N = 3000$, $M = 80$, $t = 2400$, the mean utility spread within a
candidate set is $0.131$ — essentially equal to $T_{\text{move}}$ — and the
best-scoring candidate is chosen only 35% of the time, against ~18% for a uniform pick
at the typical set size of 5.5. Agents take a worse-scoring institution roughly two
times in three.

Together with the $\kappa = 0.5$ result above, this means the mobility mechanism does
considerably less directed sorting-by-expertise than the shape of $u_{ij}$ suggests. It
is closer to a mixing process with a weak prestige bias than to a competition for
position.


### Measured: what $\kappa$ actually changes

The knife-edge above invites the question of whether the sorting direction matters to
anything reported. It was swept directly: $\kappa \in \{0, 0.25, 0.5, 0.75, 1\}$ crossed
with $\gamma_{\text{below}} \in \{0, 0.5, 1, 1.5, 2\}$, 3 replicates, paired baseline and
treatment arms, horizon 1440, otherwise the world-model configuration used by the reported
sweeps (`data/experiments/kappa.json`, results under `results/kappa/`; 150 runs).

**The AI results do not move.** `meanE_change` at $t = 1440$:

| $\kappa$ \ $\gamma_{\text{below}}$ | 0 | 0.5 | 1 | 1.5 | 2 |
| --------- | ------- | ------- | - | ------- | ------- |
| 0         | -0.4992 | -0.0803 | 0 | +0.0320 | +0.0494 |
| 0.25      | -0.4993 | -0.0795 | 0 | +0.0294 | +0.0478 |
| 0.5       | -0.4998 | -0.0794 | 0 | +0.0329 | +0.0509 |
| 0.75      | -0.4994 | -0.0764 | 0 | +0.0312 | +0.0508 |
| 1         | -0.5024 | -0.0791 | 0 | +0.0327 | +0.0507 |

The range across $\kappa$ within a column is 2-4x the replicate SEM, which is what five
draws from noise produce. Fitting a linear trend on $\kappa$ within each $\gamma$ column,
for `meanE_change`, `shareExpert_change` and `systemCapability_change`, the slope signs
flip between columns and 15 of 16 tests fall below $\lvert z \rvert = 2$.

**Baseline expertise does not move either.** In the no-AI arm, meanE spans 0.5651-0.5665
across $\kappa$ against a within-cell noise gauge of 0.0011. So $\kappa$ neither shifts the
baseline nor scales the AI effect.

**What it does govern is institutional inequality.** `divergence`, the between-institution
variance of $\bar E_j$, in the no-AI arm at $t = 1440$:

| $\kappa$   | 0       | 0.25    | 0.5     | 0.75    | 1       |
| ---------- | ------- | ------- | ------- | ------- | ------- |
| divergence | 0.00573 | 0.00456 | 0.00366 | 0.00325 | 0.00304 |

Monotone, -47% end to end, against a replicate std of ~0.0003 — roughly 9 SEM. The arms
also separate over time: at $\kappa = 0$ divergence climbs from 0.0035 at $t = 120$ to
0.0060 by $t = 720$ and holds there, while at $\kappa = 1$ it stays flat at ~0.0030
throughout.

The interpretation is straightforward. $\kappa$ sets the sorting *direction* and does only
that. Agents who climb ($\kappa < 0.5$) concentrate in strong institutions and the field
stratifies; agents who status-seek ($\kappa > 0.5$) spread downward and institutions
homogenise. The population mean is conserved either way, because expertise is produced
inside institutions from local teaching levels: moving people between institutions changes
who learns from whom, not how much learning there is in total.

So the knife-edge at $\kappa = 0.5$ is real as arithmetic but inconsequential for anything
reported here — a useful negative, since it establishes that the shape of the mobility
utility is not quietly driving the AI findings. The default is not a hidden commitment
about expertise; it is a commitment about institutional inequality, which is not currently
a reported outcome.

That changes if `criticalMass` is ever enabled (it is 0 in all reported sets). An
institution-level capability cliff requires institutions to differ from one another, and
$\kappa$ is the parameter controlling whether they do. Any critical-mass study should sweep
the two together rather than pinning $\kappa$ at its default.

### A note on measuring it

Moves are counted inside the mobility loop, not by differencing $J(i)$ across a tick.
Turnover reassigns institutions too, so a difference cannot separate a career move
from a retirement; it reads about 20% high at the calibrated rates and credits
expertise diffusion to entrants who have none.

The related counter `upgradingArrivals` records only arrivals with $E_i > T_j$,
evaluated against the destination as it stood *before* the arrival — moves that raise
the ceiling the destination teaches against, as distinct from lateral relocations that
move a person without moving what anyone there learns from. Where diffusion is
reported, that is the substantive distinction.

## Time, turnover, and population scale

**Question:** what is one tick worth in real time, what population size does that
imply, and does the current parameter set survive being pinned to real time?

The model was built dimensionless — no tick length is declared anywhere. Fixing
one turns out to be far from cosmetic: it converts three free parameters into
_derived_ ones and exposes an inconsistency in the existing calibration.

### The convention: one tick = one month

Adopted convention, not an inference: **1 tick = 1 month**, so 12 ticks per year.
A career is taken as **40 years = 480 ticks**, which fixes turnover:

```
turnoverRate = 1 / 480 = 0.002083     (vs. the current default of 0.01)
```

Career length remains a legitimate thing to sweep — it is a _social_ variable, not
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

| Divisor | Scaled annual intake | `N`        | Humans/institution (M=245) |
| ------- | -------------------- | ---------- | -------------------------- |
| 50      | 1,050                | 42,011     | 171.5                      |
| 100     | 525                  | 21,006     | 85.7                       |
| **200** | **263**              | **10,503** | **42.9**                   |
| 250     | 210                  | 8,402      | 34.3                       |
| 400     | 131                  | 5,251      | 21.4                       |

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
| -------------- | ---------------------- | ----------- | ----------------- |
| 0.01           | 100                    | 0.872       | 0.974             |
| 0.02           | 50                     | 0.620       | 0.859             |
| 0.04           | 25                     | 0.202       | **0.000**         |
| 0.05           | 20                     | 0.140       | **0.000**         |

Above roughly `turnoverRate = 0.02`, entrant inflow outruns peer transfer and the
population cannot renew itself **even with no AI present at all**. That is not a
bug — it is the model saying a 25-tick career is too short to reach expertise at
the current rates. But it means the **AI-vs-no-AI contrast becomes undefined**
there: both arms sit at `shareExpert = 0`, so the shortfall metric measures nothing.

### The current parameters do not survive a 40-year career

This is the consequence that matters. Running at `turnoverRate = 0.002083` with
everything else at defaults (`N=10,503, M=245`, no AI):

| `turnoverRate` | career (years) | meanE @1440 | shareExpert @1440 |
| -------------- | -------------- | ----------- | ----------------- |
| 0.01           | 8              | 0.775       | 0.975             |
| 0.004167       | 20             | 0.918       | 0.991             |
| 0.002778       | 30             | 0.951       | 0.994             |
| **0.002083**   | **40**         | **0.964**   | **0.996**         |

At a 40-year career the no-AI baseline **saturates**: 98.4% of the population sits
above `E = 0.95`, piled against the 1.0 ceiling. `shareExpert` reads 0.996 with no
variance left in it. The model has not broken, but its dynamic range has — a
baseline that is uniformly perfect gives AI nothing to erode that can be measured
against anything.

The cause is that `transferRate = 0.5` means closing half your gap to the
institution mean _every tick_. At monthly ticks that is implausibly fast, and over
a 480-tick career it drives everyone to the ceiling. **A longer career therefore
forces `transferRate` and `decayRate` to be re-derived together.** Scanned at a
40-year career (`N=4000, M=100`, t=4800, cells are `shareExpert / fraction ≥ 0.95`):

| `transferRate` \ `decayRate` | 0.005     | 0.01      | 0.02      | 0.04      | 0.08      |
| ---------------------------- | --------- | --------- | --------- | --------- | --------- |
| **0.5**                      | 1.00/0.99 | 1.00/0.99 | 1.00/0.98 | 1.00/0.00 | 0.99/0.00 |
| **0.3**                      | 0.99/0.69 | 0.99/0.00 | 0.99/0.00 | 0.99/0.00 | 0.00/0.00 |
| **0.2**                      | 0.99/0.00 | 0.99/0.00 | 0.98/0.00 | 0.79/0.00 | 0.00/0.00 |
| **0.15**                     | 0.98/0.00 | 0.98/0.00 | 0.96/0.00 | 0.00/0.00 | 0.00/0.00 |
| **0.1**                      | 0.97/0.00 | 0.95/0.00 | 0.00/0.00 | 0.00/0.00 | 0.00/0.00 |

Two things to read off this. First, raising `decayRate` does pull the population
off the ceiling without collapsing it, so a viable recalibration exists. Second,
**the usable band is narrow and the edges are sharp**: at `transferRate = 0.1`,
moving `decayRate` from 0.01 to 0.02 takes `shareExpert` from 0.95 to 0.00. That
knife-edge is a real property of the model (the same bifurcation the AI-dampening
sweeps show), not a numerical artifact — but it means the recalibration has to be
done by scanning, not by reasoning from the old values.

### Avoiding the ceiling is not enough — the baseline must also be _stationary_

The scan above selects on dynamic range, and on that basis `(0.13, 0.024)` looked
fine. It was not, and the reason is worth recording because it is easy to miss.

A calibration can sit clear of both the ceiling and collapse and still have its
**equilibrium in a different place from where the initial transient lands**. At
`(0.13, 0.024)` the t=0 population rises quickly to `meanE ≈ 0.60`, but the
system's actual equilibrium is `≈ 0.56`. With 40-year careers it takes many
cohorts to forget the initial condition, so the no-AI baseline sags for the whole
run and beyond (world-model scale, `N=10,504`, 3 seeds):

| t              | 120    | 480    | 960    | 1440   |
| -------------- | ------ | ------ | ------ | ------ |
| meanE baseline | 0.5975 | 0.5818 | 0.5700 | 0.5622 |

−0.035 across the horizon, still falling ten careers later. Two consequences:

1. **`meanE_shortfall` stops being interpretable.** It becomes "what AI removed,
   _plus_ wherever the baseline had wandered to by the reporting tick".
2. **`shareExpert` collapses out of proportion.** Because `sd(E) ≈ 0.06`, a drift
   of 0.035 in the mean sweeps most of the population across the threshold:
   measured across 5 seeds, `shareExpert` fell 0.80 → 0.05 between t=480 and
   t=4800 while `meanE` moved only 7%. The two are not independent signals —
   `correlation(meanE, shareExpert) = 0.987`. `shareExpert` is `meanE` amplified
   roughly 16x, not a second measurement.

### The stationary calibration

Stationarity is therefore the _binding_ criterion, and `calibrate_time_base.js`
now tests it directly (rejecting any cell whose baseline drifts more than 0.010
across the horizon) and scans against the world-model graph via `--world-model`,
because the stationary ridge sits in a different place on BA than on the real
graph.

Verified at production scale (`N=10,504`, `M=245`, 3 seeds):

| calibration       | t=120  | t=480  | t=960  | t=1440     | drift       | shortfall |
| ----------------- | ------ | ------ | ------ | ---------- | ----------- | --------- |
| **(0.15, 0.020)** | 0.6291 | 0.6289 | 0.6293 | **0.6294** | **+0.0002** | 0.369     |
| (0.17, 0.024)     | 0.6301 | 0.6293 | 0.6277 | 0.6274     | −0.0027     | 0.374     |
| (0.13, 0.016)     | 0.6280 | 0.6297 | 0.6313 | 0.6321     | +0.0041     | 0.362     |

`MONTHLY_TICK_PARAMS` uses **`transferRate = 0.15`, `decayRate = 0.020`** — flat
to four decimal places over three careers, with an AI shortfall of 0.369 and a
seed spread on that shortfall of only 0.0042.

No change to initialisation was needed. The earlier drift was not a bad starting
point but a calibration whose equilibrium sat _below_ where the transient settled;
at `(0.15, 0.020)` the default init lands on the equilibrium by itself.

The trade-off is that equilibrium `meanE` (0.63) now sits well _above_
`EXPERT_THRESHOLD` (0.585), so baseline `shareExpert` is ~0.95 with little
downward range. That is the right way round for this model: `meanE` is the
headline metric and is now well-behaved, and `shareExpert` remains readable as a
threshold-crossing indicator.

### The steady state survives realistic population scale

Separately from the turnover question, scale itself is benign. With `turnoverRate`
left at 0.01 and no AI:

| `N`    | `M` | humans/institution | meanE @1000 | shareExpert @1000 |
| ------ | --- | ------------------ | ----------- | ----------------- |
| 500    | 40  | 12.5               | 0.874       | 0.974             |
| 5,777  | 245 | 23.6               | 0.821       | 0.977             |
| 11,553 | 245 | 47.2               | 0.761       | 0.972             |
| 23,106 | 245 | 94.3               | 0.739       | 0.971             |

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

γ_below and α are selected by the _same_ predicate, `below`, and applied to
_disjoint_ branches — an agent has either `gap > 0` or `gap ≤ 0`, never both.
They are the two halves of de-skilling: "didn't get to learn" and "use it or
lose it". As free parameters they permit "AI completely blocks novice learning
but causes no atrophy", which is not a state any account of AI reliance
describes.

### The data already said they were one thing

Before the change, a 21×21 sweep of δ × α collapses onto a single quantity:

| collapse onto | rank-R²   |
| ------------- | --------- |
| **δ·(α−1)**   | **0.946** |
| δ·α           | 0.879     |
| α alone       | 0.734     |
| δ alone       | 0.088     |

`δ·(α−1)` is not a fitted form — it is the algebra. Decay in the AI arm is
`δα·gap` against `δ·gap` in the baseline, so the _excess_ is `δ(α−1)·gap`. The
0.946 is that identity showing up in the measurement.

### The reparameterisation

```
aiDampeningBelow    = 1 − ρ        ρ=−1 → 2.0    ρ=0 → 1    ρ=+1 → 0
aiAtrophyMultiplier = 5 ^ ρ        ρ=−1 → 0.2    ρ=0 → 1    ρ=+1 → 5
```

Linear for the dampening, because it is a _fraction_ of learning retained;
log-symmetric for atrophy, because it is a _multiplier_ and "equal and opposite"
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

| ρ        | γ_below  | meanE      | trapped below λ |
| -------- | -------- | ---------- | --------------- |
| 0.90     | 0.10     | 0.6244     | 0.1%            |
| 0.95     | 0.05     | 0.6206     | 0.1%            |
| **1.00** | **0.00** | **0.0894** | **19.7%**       |

The trapped pool pulls each institution's `Ebar` down, which puts the survivors
into the decay branch, which lowers `Ebar` again — the collapse cascades rather
than merely adding a fifth of the population at zero. `meanE_shortfall` jumps
70× across the final step of the sweep, from 0.008 to 0.544.

This is worth separating from the model's substantive claims. It is not a
finding about AI reliance; it is a singularity at the edge of a chosen
parameterisation meeting a clipping artifact in the entrant draw. ρ = 0.95
behaves indistinguishably from ρ = 0.9. The honest reading is that the model has
nothing to say about _total_ reliance, because total reliance in this
formulation is a degenerate limit rather than an extreme case.

## Which parameters actually matter, and a warning about the ones that don't

Reviewing a full 21×21 sweep over eleven parameters narrowed the study set to
seven. Two findings from that review change how the remaining results should be
read.

### The parameters split into baseline-movers and AI-only

The AI-only parameters — `aiDampeningBelow`, `aiDampeningAbove`,
`aiAtrophyMultiplier` and `aiLevelFraction` — appear only behind `aiEnabled`. The no-AI arm is _mathematically_ independent of them, so
the baseline holds still while they sweep. The rest move both arms:

| experiment        | baseline `meanE` across the grid | spread    |
| ----------------- | -------------------------------- | --------- |
| γ_below × γ_above | 0.627 → 0.635                    | **0.008** |
| δ × α             | 0.493 → 0.808                    | 0.316     |
| λ × E₀            | 0.416 → 0.797                    | 0.381     |
| E₀ × entrant      | 0.406 → 0.891                    | 0.485     |
| β × δ             | 0.329 → 0.898                    | **0.569** |

Only the pure-AI pair keeps the baseline still. In β × δ the baseline wanders
across most of the unit interval, so `meanE_shortfall` is not comparable between
that grid's corners: 0.09 against a baseline of 0.33 and against 0.90 are
different quantities, and the second is compressed against the ceiling. Some of
the apparent structure along those axes is the baseline moving rather than AI
biting. This is the same concern that motivated the stationarity work, arriving
by a different route — stationarity was enforced at the _calibration point_, but
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

That has a consequence for a _different_ parameter. γ_above governs only the
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

### Where the expert threshold came from, and what the recalibration did to it

`EXPERT_THRESHOLD` = 0.585 is a hardcoded constant, not a swept parameter, and it does
two jobs: it defines `shareExpert`, and it anchors the capability weight $w(\theta) = 1$.
It was not measured against anything external. It was chosen as a **robustness midpoint** —
the value that makes the model's headline self-renewal/collapse contrast least dependent
on the choice of threshold.

`src/expert_threshold_sensitivity.js` is that argument. It replays the scenario with AI off
and on and recomputes the share at or above a range of candidate thresholds. Under the
legacy regime it was originally run in — `DEFAULT_PARAMS`, BA graph, N = 1500, 1500
dimensionless ticks — the contrast holds across roughly [0.30, 0.84], whose midpoint is
0.57, and 0.585 sits in it. The value it replaced, an undocumented 0.7, sat near the upper
edge where the baseline itself starts to fail, which inflated the AI-amplification numbers
through a baseline-ceiling artifact.

**That argument was never rechecked after the monthly/world-model recalibration, and it
does not carry over.** The script has since been extended to run both regimes; the
world-model half uses `MONTHLY_TICK_PARAMS` + `PIPELINE_PARAMS` + `WORLD_MODEL_PARAMS` on
the world-model graph at horizon 1440 — the calibration every reported experiment uses —
with the treatment arm at $\gamma_{\text{below}} = 0$. Three seeds:

| regime      | baseline meanE | usable band (gap $\ge$ 0.5) | midpoint | 0.585 sits |
| ----------- | -------------- | --------------------------- | -------- | ---------- |
| legacy      | 0.831          | 0.30 - 0.84                 | 0.570    | mid-band   |
| world model | 0.567          | 0.10 - 0.60                 | 0.350    | at the top edge |

The two regimes sit in completely different places relative to the threshold. Legacy
baseline meanE is 0.831, a quarter of the scale above it, so baseline `shareExpert` stays
near 0.98 across the whole band and the threshold barely matters. The world-model baseline
equilibrates at 0.567 — **0.018 below the threshold** — so `shareExpert` is read from the
middle of the population distribution, where it is a step rather than a plateau.

Two consequences, pulling in opposite directions, and the repository already contains both
arguments without reconciling them.

Against: the robustness rationale no longer holds. Under the reported calibration 0.585 is
at the top edge of the usable band, not its midpoint (0.350), which is structurally the
same position 0.7 occupied in the legacy regime and was moved for. `shareExpert` is now
sensitive to small drifts in baseline meanE, so it is a poor metric for comparing across
configurations whose baselines differ.

For: sensitivity is exactly what the entrant-pipeline calibration was trying to buy. The
note on `PIPELINE_PARAMS` records that `shareExpert` previously sat at ~0.95 with no
downward range, making it useless, and that putting the baseline near the threshold
"restores `shareExpert` as a metric" that "discriminates in both directions again". Within
a paired same-seed design, where baseline and treatment differ only in AI, a threshold at
the centre of the distribution gives maximum discriminating power.

Both are true. The resolution is not to move the constant but to be explicit about which
property is being relied on: `shareExpert` is a **high-power, low-robustness** metric under
this calibration. It is well suited to the paired comparisons this study reports and badly
suited to comparing absolute expert shares between configurations. `meanE` has the opposite
profile and remains the metric to read where baselines differ — which is also what the
world-model generator concluded for a separate reason, since `shareExpert_shortfall`
saturates at exactly 0 under strong dampening and stops discriminating there.

A caveat on the band itself: in the world-model regime the treatment arm collapses to
`shareExpert` = 0 at every threshold from 0.2 upward, so the band's upper edge is set
entirely by the baseline thinning out, not by the arms converging. The measurement bounds
where `shareExpert` can see a collapse; it says nothing about where an expert actually is.

### The capability ratio, and how much of the capability result is it

The capability weight converts expertise into what a person is worth:

$$w(E) = \rho^{\frac{E-\theta}{1-\theta}}, \qquad \rho = 1000,\ \theta = 0.585 .$$

Two anchors, both chosen rather than fitted. $w(\theta) = 1$ is close to free — it is a choice
of units, and it is what makes a capability figure readable as "this institution is worth 8,363
experts". $w(1) = \rho$ is the substantive claim: **one person at the ceiling is worth a thousand
who merely qualify as expert.** The exponential form then follows from the two anchors given a
constant proportional return to expertise; only the anchors are free. The implied slope is
$\mathrm{d}\ln w/\mathrm{d}E = \ln\rho/(1-\theta) = 16.6$, i.e. every 0.042 of expertise doubles
what a person is worth.

Unlike $\theta$, $\rho$ has no empirical argument anywhere in the repository. It appears in
`engine.js` and nowhere else, is exported and never imported, and had no sensitivity check. Since
every capability magnitude scales with it, `src/rho_sensitivity.js` and
`src/run_rho_sensitivity.sh` were written to measure how much. Reports under `results/rho/`.

**Method.** The obvious approach — recompute capability from stored expertise — is not available:
`results/*.csv` hold scalar summaries and a `systemCapability` already collapsed at $\rho = 1000$,
and $C = \sum_i w(E_i)\ell(E_i)$ is a sum over the whole population that no set of summary
statistics recovers. So the sweep re-runs the same configs under the same seeds, and cells
correspond to the reports one for one. This is cheap for a reason worth stating: `capabilityWeight`
feeds output only — `tick()` destructures `{Ebar, count, Teach, transferEff}` from
`institutionStats()` and never reads capability — so $\rho$ cannot touch the trajectory of $E$, and
**one pass yields every $\rho$ simultaneously**. The script asserts this at startup rather than
trusting it. Swept at $\rho = 8, 16, \dots, 8192$ (powers of two, plus the shipped 1000), three
replicates, $t = 1440$, over five configs.

**Ordering is robust above $\rho \approx 128$.** Spearman rank correlation of per-cell capability
change against the shipped $\rho$:

| config        | 8         | 16    | 32   | 64   | 128  | 256  | 512  | 2048 | 8192 |
| ------------- | --------- | ----- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| acl.1         | **-0.53** | -0.31 | 0.15 | 0.57 | 0.91 | 0.93 | 0.99 | 0.99 | 0.98 |
| acl.8         | 0.34      | 0.62  | 0.82 | 0.92 | 0.96 | 0.99 | 0.99 | 1.00 | 0.98 |
| experiment.1  | 0.87      | 0.90  | 0.93 | 0.95 | 0.98 | 0.99 | 1.00 | 1.00 | 0.98 |
| experiment.16 | 0.77      | 0.89  | 0.94 | 0.97 | 0.99 | 1.00 | 1.00 | 1.00 | 1.00 |
| experiment.25 | 0.94      | 0.96  | 0.98 | 0.98 | 1.00 | 1.00 | 1.00 | 1.00 | 0.99 |

Every config holds $\ge 0.91$ from $\rho = 128$ upward and $\ge 0.96$ from 256, so the shipped
value sits mid-plateau with roughly a factor of 64 of headroom either side. **Comparative claims —
"this condition is worse than that one" — are therefore independent of the assumption across
$[128, 8192]$.** Below $\rho \approx 64$ the model is qualitatively different and acl.1 inverts
outright: with a nearly flat weight, capability becomes a headcount and the AI leverage term
$\ell(E)$ rather than expertise drives the result.

**Sign and magnitude are not robust.** A natural guess is that $\rho$ only rescales, because
capability change would then be $e^{k\Delta E} - 1$ with $k = \ln\rho/(1-\theta)$. That holds only
when a condition shifts the whole expertise distribution uniformly. In general $\rho$ decides
*which part of the distribution dominates the sum*: at low $\rho$ the weight is nearly flat and $C$
behaves like a headcount; at high $\rho$ almost all of $C$ sits in the top tail, and the result is
whatever happened to the best few percent. Median capability change, per cent:

| config        | 8    | 64    | 128   | 512   | **1000** | 2048  | 8192  | crossover $\rho$ | cells flipping |
| ------------- | ---- | ----- | ----- | ----- | -------- | ----- | ----- | ---------------- | -------------- |
| acl.1         | 10.7 | 5.4   | 5.3   | 5.1   | 3.5      | 1.9   | -0.6  | 5741             | 10/18          |
| acl.8         | -6.2 | -12.4 | -14.9 | -19.1 | -20.9    | -22.5 | -25.1 | —                | 0/18           |
| experiment.1  | 0.6  | -5.2  | -6.4  | -8.4  | -9.2     | -10.2 | -11.7 | 9                | 23/36          |
| experiment.16 | 7.2  | 2.7   | -0.6  | -8.9  | -12.7    | -14.6 | -19.1 | **112**          | 12/36          |
| experiment.25 | 3.4  | 0.3   | 0.3   | 0.5   | 0.6      | 0.7   | 0.9   | —                | 6/36           |

Crossovers span three orders of magnitude, which is why the granularity matters: a four-point
sweep locates none of them.

Two readings follow, and they point in opposite directions.

**experiment.16 crosses at $\rho \approx 112$** — `aiLevelFraction` $\times$ `aiDampeningAbove`,
essentially at the point where the robustness plateau begins. The sign of that pairing's capability
effect is therefore decided by an assumption whose defensible range starts exactly where the sign
changes. Its capability numbers should not be reported as directional findings without stating
$\rho$.

**experiment.25 is the most robust of the five** — `aiLevelFraction` $\times$ `aiDampeningBelow`,
the pairing the model's central claim actually runs on, at correlation 0.94 even at $\rho = 8$. Read
its rank correlation rather than its median: the median sits near zero only because the
$\gamma_{\text{below}}$ axis spans harm through to benefit, so the median cell is neutral by
construction.

The defensible statement is therefore narrower than the reports currently imply: *the ordering of
conditions by capability is robust to $\rho$ over roughly two orders of magnitude around the shipped
value; the sign and magnitude of the aggregate capability effect are not, and follow from
$\rho = 1000$ asserting that the top of the field carries nearly all of the field's value.* A headline
figure such as a 99.99% fall is as much a restatement of that assumption as it is a result.

Note the asymmetry with $\theta$, since the two constants sit in the same formula and a reader will
look for the provenance of both. $\theta$ has an empirical argument and a robustness band, though
the band was measured under a calibration no longer in use (previous section). $\rho$ now has a
measured robustness band and still has no empirical argument at all. Neither is a fit.

Caveats on the measurement: stride-4 subsampling for the 21x21 pairings (36 of 441 cells; the ACL
grids are swept whole at 18), three replicates, and the median is taken across cells rather than
weighted. Tighten with `--stride 1 --replicates 10` before any of these numbers goes into a figure.

### Reading the model equations against the results

Three things about the stated formulas that a reader will otherwise get wrong.

**γ is a multiplier, and the figures show it shifted.** In the update function
`aiDampeningBelow` and `aiDampeningAbove` multiply the learning increment, so
**γ = 1 is no effect**, below 1 dampens and above 1 amplifies. Every report page
displays them shifted by −1 instead, on a −1 / 0 / +1 scale where −1 is maximum
dampening and 0 is neutral (`report.template.html`, `DAMPENING_KEYS`). A table
axis reading γ_below = −0.236 is therefore **γ_below = 0.764 in the equations**.
Both conventions appear in this document; neither is wrong, but a figure and a
formula placed side by side without this sentence read as a contradiction.

**The AI's level is fixed at t = 0.** `aiLevel = aiLevelFraction × startTopE`
uses the greatest expert in the *initial* population, not the live maximum — a
stable benchmark rather than a moving target, so that the threshold does not
chase the population it is degrading. Written as *a* = λ·max E(0), the (0) is
load-bearing: a reader who assumes the live maximum has a different model in
mind, one with a feedback loop this one deliberately does not have. See also
`aiLevelFraction` is not a fraction of anything above — startTopE measures 1.0
in practice, so λ is an absolute expertise threshold.

**The critical-mass term is switched off in every result reported here.**
Institutional transfer efficiency η_j = n^h / (n^h + n₀^h) — a Hill function on
an institution's absolute expert count, halving efficiency at n₀ — multiplies
both the learning increment and institutional capability. It is guarded on
`criticalMass > 0`, and `criticalMass = 0` in **all 45 result sets** on disk, so
η_j = 1 everywhere and the term drops out of both the update and the capability
sum. Wherever η_j appears in an equation here it is an available mechanism, not
one these runs used: every number in this document comes from a model in which
an institution holding one expert teaches exactly as efficiently as one holding
three hundred. At N = 11,322 across M = 330 institutions — mean occupancy ~34 —
enabling it would plausibly matter, since it is the mechanism most able to turn
a gradual decline in expertise into an institution-level cliff. Untested.

## Recruitment processes

| Process                                                                        | Type       | Region             |
| ------------------------------------------------------------------------------ | ---------- | ------------------ |
| Summer Analyst internship converting to full-time                              | Mechanism  | USA                |
| Centralised public-sector exam (SBI PO / IBPS PO)                              | Mechanism  | India              |
| Private-bank hire-and-train campus programme (PGDBF/PGDBS)                     | Mechanism  | India              |
| Global Capability Centre campus analyst scheme                                 | Mechanism  | India              |
| Fixed autumn cycle (秋招) + spring supplementary round (春招)                  | Mechanism  | China              |
| Programa de Trainee (single annual cohort)                                     | Mechanism  | Latin America      |
| Programa de Estágio / internship-led entry                                     | Mechanism  | Latin America      |
| Public exam (concurso público) - state banks                                   | Mechanism  | Latin America      |
| National-hub rotational graduate / traineeship scheme                          | Mechanism  | Continental Europe |
| Actuarial / technical development programme                                    | Mechanism  | USA                |
| Elite Indian campuses (IIMs / IITs / top commerce colleges)                    | TalentPool | India              |
| Chinese-language campus channels (校园招聘 microsites, 51job, Zhaopin, liepin) | TalentPool | China              |
| Cia de Talentos (LatAm graduate recruitment intermediary)                      | TalentPool | Latin America      |
| Manipal Global / NIIT University (hire-train academy partners)                 | TalentPool | India              |
| SENA (Colombian technical training system)                                     | TalentPool | Latin America      |

# Asymmetric Cognitive Leverage

The operationalisation of Asymmetric Cognitive Leverage Theory rests on empirical data from landmark workplace studies—most notably the Harvard Business School / Boston Consulting Group (HBS/BCG) study by Dell'Acqua et al. This research explicitly measured how baseline human expertise interacts with AI to change output quality and speed.
To calculate overall organisational capability, you can use these empirical benchmarks to model your performance based on a distribution of human expertise and the task landscape.

---

## 1. Empirical Benchmarks (The Quantified Distribution)

The HBS/BCG study evaluated knowledge workers (management consultants) across a variety of complex tasks. When given access to a highly capable AI model (such as GPT-4 class systems), the performance changes were distinctly asymmetric based on the worker's initial skill level:

- The Skill-Leveling Effect (Inside the Frontier):
- Low-Baseline Performers (Bottom 50%): Experienced a 43% increase in task performance and output quality when using AI.
  - High-Baseline Performers (Top 50%): Experienced only a 17% increase in performance.
  - Speed Domain: Across all expert levels, task execution time dropped by an average of 25.1%, meaning efficiency scaled evenly, but quality gains were highly skewed toward the novices.
- The Performance-Degradation Effect (Outside the Frontier):
- When workers used AI for tasks outside its true capabilities (the "Jagged Frontier"), overall performance dropped by 19 percentage points due to over-reliance and lack of verification.
  - Asymmetric Risk: Novices were significantly worse at catching these errors, while experts maintained a higher baseline because of their domain judgment.

---

## 2. A Mathematical Framework for Organisational Capability

To translate these empirical dynamics into a calculated organizational capability metric ($C_{org}$), you must model your workforce as a distribution and split your task architecture based on the AI's capability frontier.

## Step A: Define Your Inputs

1.  Human Expertise Distribution ($H$): Categorise your workforce into percentiles or cohorts ($i$), where $W_i$ is the weight (percentage) of that cohort in the organisation, and $E_i$ is their baseline capability score (0 to 1).
2.  AI Frontier Ratio ($F$): The percentage of organizational tasks that fall safely inside the AI's current capabilities (e.g., $F = 0.70$ means 70% of work is standard synthesis, drafting, and analysis; 30% requires edge-case human validation).

## Step B: Apply the Performance Multipliers ($\alpha_i$)

Based on the empirical data, define the AI capability boost ($\alpha_i$) for a worker inside the frontier:

- For Novices/Juniors ($E_i < 0.5$): $\alpha_{novice} \approx 1.43$ (A 43% gain).
- For Experts/Seniors ($E_i \ge 0.5$): $\alpha_{expert} \approx 1.17$ (A 17% gain).

## Step C: Account for the Deficit Multiplier ($\beta_i$)

For the tasks outside the frontier ($1 - F$), performance changes based on whether the human has the expertise to catch errors:

- For Experts: $\beta_{expert} \approx 1.0$ (They catch errors; performance remains flat or slightly aided by speed).
- For Novices: $\beta_{novice} \approx 0.81$ (A 19-percentage-point performance drop due to unverified hallucinations).

## Step D: The Capability Equation

The total capability score of any given cohort $i$ working with an AI system can be calculated as:
$$C_i = E_i \times \left[ (F \times \alpha_i) + ((1 - F) \times \beta_i) \right]$$
To find the aggregate Organisational Capability ($C_{org}$), calculate the weighted sum of all cohorts:
$$C_{org} = \sum (W_i \times C_i)$$

---

## 3. Key Structural Insights for Leadership

- The Compression Paradox: Deploying AI into a junior-heavy organization yields massive immediate capability gains because it lifts the lowest common denominator. However, it creates a "hollow middle" where juniors never learn the verification skills required to become senior experts.
- The Expert Leverage Point: While seniors get a smaller percentage boost, their absolute economic output is vastly higher because they can safely operate at the edge of the frontier ($1-F$). A single senior expert directing multiple AI agents can produce up to 5x the analytical output of an unaugmented counterpart.

The primary reference and empirical foundation for the framework provided above is detailed below in standard markdown format:

## Primary Study Reference

- Title: Navigating the Jagged Technological Frontier: Field Experimental Evidence of the Effects of AI on Knowledge Worker Productivity and Quality [1]
- Authors: Fabrizio (Harvard Business School), Edward McFowland III (Harvard Business School), [Ethan Mollick](https://www.google.com/search?q=ethan+mollick&kgmid=/g/1143q1bpg) (Wharton School of the University of Pennsylvania), [Hila Lifshitz-Assaf](https://www.google.com/search?q=hila+lifshitz-assaf&kgmid=/g/11f0ypwyrl) (Warwick Business School), [Katherine C. Kellogg](https://www.google.com/search?q=katherine+c.+kellogg&kgmid=/g/11f0rvhnzd) (MIT Sloan School of Management), Sari Rajaniemi (Boston Consulting Group), Alison Woolley (Boston Consulting Group), and [Karim R. Lakhani](https://www.google.com/search?q=karim+r.+lakhani&kgmid=/m/03ghc67) (Harvard Business School). [2]
- Publication Detail: Originally released as a Harvard Business School Working Paper / SSRN pre-print; subsequently published in the peer-reviewed journal Organization Science. [3, 4, 5]
- Links:
- [SSRN Working Paper Repository](https://papers.ssrn.com/sol3/papers.cfmabstract_id=4573321)
  - [INFORMS PubsOnLine / Organization Science Journal](https://pubsonline.informs.org/doi/10.1287/orsc.2025.21838) [1, 6]

---

## Key Contextual & Theoretical References

The mathematical modeling of cognitive gaps, "hollow middle" skill degradation, and organizational leverage frameworks build upon the following related research:

- Theory of "The Jagged Frontier": Explored extensively in practical application by [Ethan Mollick](https://www.google.com/search?q=ethan+mollick&kgmid=/g/1143q1bpg). You can view his breakdown on the [Harvard Business School AI Institute](https://aiinstitute.hbs.edu/back-to-the-beginnings-of-ai-at-work/) portal or watch his video summary, [Ethan Mollick](https://www.google.com/search?q=ethan+mollick&kgmid=/g/1143q1bpg): "Navigating the Jagged Technological Frontier". [5, 7]
- Cognitive Debt & Atrophy: For understanding the baseline shift ($\beta_{novice}$) and how workers outsource error correction to AI, see the 2026 paper "Cognitive Debt: AI as Intellectual Leverage and the Dynamics of Learning Atrophy". [8]
- Skill Mitigation Frameworks: To see how organizations structure environments to mitigate the performance drops identified in the HBS/BCG data, refer to the [BCG Executive Insights on AI and Critical Skills Risk](https://www.bcg.com/publications/2026/when-everyone-uses-ai-companies-risk-critical-skills). [9]

---

If you need help implementing these specific percentages into an Excel model or Python script to simulate your workforce, let me know!

[1] [https://papers.ssrn.com](https://papers.ssrn.com/sol3/papers.cfmabstract_id=4573321)
[2] [https://www.thecrimson.com](https://www.thecrimson.com/article/2023/10/13/jagged-edge-ai-bcg/)
[3] [https://www.scirp.org](https://www.scirp.org/reference/referencespapers?referenceid=3902279)
[4] [https://www.ebsco.com](https://www.ebsco.com/articles/social-sciences-and-humanities/ae8300a6-197d-54c5-b89b-a9c0240104cb/navigating-the-jagged-technological-frontier-field-experimental-evidence-of-the-effects-of-artificial-intelligence-on-knowledge-worker-productivity-and-quality)
[5] [https://aiinstitute.hbs.edu](https://aiinstitute.hbs.edu/back-to-the-beginnings-of-ai-at-work/)
[6] [https://pubsonline.informs.org](https://pubsonline.informs.org/doi/10.1287/orsc.2025.21838)
[7] [https://www.youtube.com](https://www.youtube.com/watch?v=dPJ6Bxsky0s)
[8] [https://arxiv.org](https://arxiv.org/pdf/2606.15078)
[9] [https://www.bcg.com](https://www.bcg.com/publications/2026/when-everyone-uses-ai-companies-risk-critical-skills)
