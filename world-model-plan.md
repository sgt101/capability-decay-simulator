# Loading a real system graph: evaluation of `world-model.json` and an implementation plan

**Revision 3** — incorporates the confirmed decisions on time base (1 tick = 1
month, 40-year careers), asymmetric transfer costs driven by economic gradient,
bloc handling, and multi-hub occupation. Evaluation + plan only; no code written yet.

Everything quantitative below was measured against the actual file and the actual
engine, not estimated.

---

## 0. Decisions this revision is built on

| # | Decision | Status |
|---|---|---|
| 1 | World-model / mobility-costs split — one describes the world, the other the model | Confirmed |
| 2 | Blocs (Anglosphere, Greater China) are facts of life → **data**, but must be toggleable in the simulator | Confirmed |
| 3 | **1 tick = 1 month**; careers are **40 years = 480 ticks**; career length remains sweepable as a *social* variable | Confirmed |
| 4 | Multi-hub occupation handled explicitly; same-city moves between global banks are easy | Confirmed |
| 5 | **Transfer costs are asymmetric**, driven by economic gradient — people don't move against the flow | Confirmed |
| 6 | Don't break the current BA model or its results | Standing |

Decision 3 has a consequence that changes the plan's sequencing — see §4. It is
the most important thing in this document.

---

## 1. What `world-model.json` is

336 nodes, 676 edges. Singapore, Tokyo, Sydney, Toronto and Dubai are being added,
so all counts below are a moving baseline.

| Node type | Count | | Edge type | Count | Shape |
|---|---|---|---|---|---|
| Organisation | 245 | | `LOCATED_IN` | 334 | Organisation → Hub |
| Hub (city) | 49 | | `IN_SECTOR` | 245 | Organisation → Sector |
| Country | 22 | | `PART_OF` | 71 | Hub → Country, Country → Region |
| Sector | 14 | | `PARENT_OF` | 14 | Organisation → Organisation |
| Region | 6 | | `COMPETES_FOR_TALENT` | 7 | Organisation → Organisation |
| | | | `PLACES_GRADUATES_IN` | 4 | Organisation → Hub |
| | | | `OFFSHORE_RECRUITS_FOR` | 1 | Organisation → Hub |

**Structural integrity: clean.** 0 duplicate ids, 0 dangling endpoints, 0
self-loops, 0 duplicate triples. Every organisation's `.sector` and `.hub_city`
resolve to real node labels (245/245), and every `.hub_city` is among that
organisation's own `LOCATED_IN` targets. The issues below concern what the graph
*means* and how confident its numbers are — not whether it is well-formed.

---

## 2. Issues

### B1 — It is a taxonomy, not a peer graph

96% of edges are containment (`LOCATED_IN`, `IN_SECTOR`, `PART_OF`). Only **21
edges connect one organisation to another**. Taken directly as adjacency: **214 of
245 organisations have zero peers**, 225 components, largest 6 nodes.

Under the affinity model (§3) this stops being a blocker — adjacency is *computed*
from attributes — but it does mean the explicit org→org edges are a garnish, not
the backbone.

### B2 — Institution occupancy

Learning and decay both run on `gap = Ebar[j] - E[i]`, and *you are part of that
mean*. In a `k`-person institution your own `E` is `1/k` of `Ebar`, so the peer gap
attenuates to `(k-1)/k`:

| Institution size | 1 | 2 | 3 | 5 | 12 | 30 |
|---|---|---|---|---|---|---|
| Effective peer gap | **0%** | 50% | 67% | 80% | 92% | 97% |

The intake-derived `N` (§4) resolves this at *initialisation*. But decision 5
reintroduces it dynamically: if asymmetric costs drain low-gradient institutions,
they can fall into the degenerate zone mid-run. See §3.

### D1 — Prestige changes meaning

Under BA, `degree` *is* hub-ness and `prestige = degree/maxDegree` is a faithful
centrality measure that `prestigeWeight` was calibrated against. Under a dense
affinity matrix, raw degree is nearly meaningless — everything connects to
everything, just weakly. **Prestige must become explicitly sourced.** For a
world-model run, `intake` or `sizeBand` is the honest choice: prestige in this
domain tracks size and tier, not network centrality.

### D2 — Turnover erases weighted institution sizing

`engine.js:289` reassigns entrants **uniformly**: `inst[i] = Math.floor(rng() * M)`.
Measured — institution 0 seeded with 50% of a 3,000-person population:

| t | 0 | 10 | 50 | 100 | 300 | 1000 |
|---|---|---|---|---|---|---|
| Humans in institution 0 | 1500 | 842 | 184 | 120 | 81 | 92 |

A 50% share washes out to ~3% within 50 ticks. Since intake *is* the
per-organisation entry flow, entrants must be placed proportional to intake. Init
and turnover must share one sampler, or the whole intake dataset is decorative.

### Data quality

**Q1. Intake numbers are modelled, not observed.** `size_basis` is
`"inferred - coarse band, verify"` for **all 245**. `intake_estimate_central`
(sum 52,514) is a deterministic formula — all 43 `intake_estimate_basis` strings
have the form `"Large base x 2.0 sector x 1.0 mechanism"`, so it carries **no
information beyond `org_size_band` + `sector` + `entry_mechanism_id`**. Observed
intake exists for almost nothing (`annual_intake_low` 3/245).

This now propagates further than in earlier revisions: under decision 3, `N` is
*derived* from intake, so the population size inherits the coarseness of a
three-factor formula. Fine as a relative weighting; not calibrated headcount.

**Q2. Confidence is low.** `data_confidence`: Low 141 (58%), Medium 49, High 55.
`geo_source`: inferred 116, source 80, research 49.

**Q3. Four zero-intake records, all LatAm** (Grupo Financiero Inbursa, Grupo Aval,
Davivienda, BCI) — also the only four missing `entry_mechanism_id`. Under
intake-weighted entry they receive **zero entrants forever**. Needs a policy.

**Q4. `COMPETES_FOR_TALENT` is a token sample** — 7 edges, 6 Chinese. Fold in as a
bonus multiplier; never rely on it alone.

**Q5. `PARENT_OF` is ownership, not mobility** — 14 edges. Intra-group transfers
plausibly bypass the visa and qualification frictions that make cross-border moves
rare, so treating them as a strong bonus is defensible, but it is an assumption.

**Q6. No org→org talent flows.** `PLACES_GRADUATES_IN` (4) and
`OFFSHORE_RECRUITS_FOR` (1) point Organisation → **Hub**, describing geography.

---

## 3. The mobility model

### Affinity, asymmetric

```
a(i→j) = geo(i,j) × sector(i,j) × gradient(i→j) × bonus(i,j)
```

Multiplicative composition is what makes "cross-country *and* cross-sector is
harder still" fall out automatically rather than needing a special case.

**Geographic component** (symmetric), with multi-hub handled per decision 4 — take
the **minimum cost across all site pairs**, so two global banks that share any city
count as same-city:

| Relationship | `geo` |
|---|---|
| Share any hub city | 1.00 |
| Same country, no shared city | 0.60 |
| Different country, same bloc | 0.30 |
| Different country, adjacent blocs | 0.12 |
| Different country, distant blocs | 0.04 |

**Sector component** (symmetric):

| Relationship | `sector` |
|---|---|
| Same `subsector_tier` | 1.00 |
| Same `sector`, different subsector | 0.70 |
| Different sector, same family | 0.40 |
| Different sector, different family | 0.15 |

**Gradient component (asymmetric)** — this is decision 5. Rather than an N×N
directional matrix, derive asymmetry from a **single scalar per location**: a
market index `w` (market depth / compensation level). Moving *up* the gradient
costs nothing extra; moving *down* is penalised:

```
gradient(i→j) = min(1, (w_j / w_i) ^ γ)
```

With illustrative `w`: USA 1.00, UK 0.70, India 0.25 —

| Move | `w_j / w_i` | `gradient` (γ=1) |
|---|---|---|
| India → UK | 2.80 | 1.00 (no penalty) |
| UK → India | 0.36 | **0.36** |
| UK → USA | 1.43 | 1.00 (no penalty) |
| USA → UK | 0.70 | **0.70** |

This reproduces the stated requirement exactly, keeps `a ≤ 1`, and needs **one
number per location plus one exponent** rather than a matrix that grows
quadratically as locations are added — which matters given decision 4's expansion.
The market index is a measurable fact (financial-centre rankings, compensation
surveys) so it belongs in `world-model.json`; the exponent γ is a model parameter
and belongs in `mobility-costs.json`.

**Bonus multipliers:** `PARENT_OF` ~3×, `COMPETES_FOR_TALENT` ~2×, both capped at
`a ≤ 1`.

Worked composition — a distant cross-sector downhill move lands around
`0.04 × 0.15 × 0.36 = 0.002`. Rare, never zero, as required.

### Blocs: data, but toggleable

Per decision 2, blocs are facts and live in `world-model.json` as a `bloc`
attribute on `Country` nodes. The bloc-to-bloc affinity *values* are model
assumptions and live in `mobility-costs.json`. A simulator switch
`useBlocAffinity: true|false` collapses all cross-country pairs to a single tier
when off.

| Bloc | Members (post-expansion) |
|---|---|
| `ANGLO` | USA, UK, Canada, Australia |
| `GTCHINA` | China (+ HK, Singapore if treated as Greater China) |
| `EUR` | Continental Europe |
| `INDIA` | India |
| `LATAM` | Latin America |
| `MENA` | UAE |
| `EASIA` | Japan (+ Singapore, if not `GTCHINA`) |

Singapore is the genuine judgement call — Anglophone common-law financial centre,
Greater China commercial ties, physically East Asia. Worth making it a documented
choice rather than a silent assignment, and the `useBlocAffinity` toggle gives a
clean ablation: **does bloc structure change outcomes at all?** That is a real
experiment, not just a config option.

### Sector distance is not binary

Among the 14 sectors, Investment Banking → Elite Boutique is a far smaller step
than Investment Banking → Insurance. Needs sector families (markets-facing,
advisory, asset-side, infrastructure/data, policy/regulatory) — another
`mobility-costs.json` assumption.

### How it enters the engine

The move utility ([`engine.js:276-280`](engine.js#L276-L280)) has no friction term.
Add one:

```js
+ p.mobilityFriction * Math.log(affinity(current, j))
```

`a ≤ 1` so the log is ≤ 0, making it a penalty. Under the existing softmax at
temperature `T` this multiplies a candidate's weight by `a^(mobilityFriction/T)`,
giving the parameter a clean interpretation — and **`mobilityFriction = 0`
reproduces current behaviour exactly**, which is how decision 6 gets enforced
rather than hoped for.

Cost is not a concern. Measured at `N=11,553, M=245`, 200 ticks:

| Mobility mode | Candidates | ms/tick |
|---|---|---|
| `hybrid`, jump 0.1 | ~4 | 0.83 |
| `unconstrained` | 25 (capped) | 1.25 |

Mobility is not the bottleneck — the per-human learning loop is. Keep the existing
candidate cap; make candidate *sampling* affinity-weighted rather than uniform.

### The drain risk that decision 5 introduces

Asymmetric costs mean net flow toward high-market-index locations. Combined with
intake-weighted entry, low-gradient institutions continuously receive entrants who
then leave. This is a **feature** — it is exactly the brain-drain phenomenon, and
it makes the model produce a checkable prediction: expertise should concentrate in
high-index hubs and stay chronically depleted in low-index ones.

But it is also a failure mode. If drain is strong enough, low-index institutions
fall below the B2 occupancy threshold *during the run*, at which point their `Ebar`
becomes noise and their internal dynamics stop meaning anything. **Institution
occupancy must be monitored as a first-class output**, not assumed stable. Suggest
a `minInstitutionOccupancy` diagnostic in the run summary, and treat any run where
institutions fall below ~5 members as suspect.

---

## 4. Time base and population scale — and why it re-sequences the plan

Decision 3 fixes 1 tick = 1 month and careers at 40 years = 480 ticks, so:

```
turnoverRate = 1 / 480 = 0.002083        (current default: 0.01)
N            = 40 × (annual intake / divisor)
```

Under the new convention the current default `turnoverRate = 0.01` implies an
**8.3-year career**. Career length stays sweepable — it is a social variable, and
"people must work 50 years to stave off collapse" is a legitimate finding — but
`N` must move with it, which the current independent-axis sweep design cannot
express.

| Divisor | Scaled annual intake | `N` | Humans/institution (M=245) |
|---|---|---|---|
| 100 | 525 | 21,006 | 85.7 |
| **200** | **263** | **10,503** | **42.9** |
| 250 | 210 | 8,402 | 34.3 |
| 400 | 131 | 5,251 | 21.4 |

**Recommend divisor 200 → `N = 10,503`**, ~43 per institution: clear of the B2
degeneracy with headroom for drain. `HORIZON = 1440` is exactly 3 careers.

### The current parameters do not survive a 40-year career

Measured, no AI, everything else at defaults (`N=10,503, M=245`):

| `turnoverRate` | career | meanE @1440 | shareExpert @1440 |
|---|---|---|---|
| 0.01 | 8y | 0.775 | 0.975 |
| 0.004167 | 20y | 0.918 | 0.991 |
| **0.002083** | **40y** | **0.964** | **0.996** |

At 40 years the no-AI baseline **saturates** — 98.4% of the population sits above
`E = 0.95`, piled against the ceiling, `shareExpert` at 0.996 with no variance left.
The model isn't broken, but its dynamic range is: a uniformly perfect baseline
gives AI nothing measurable to erode.

The cause is `transferRate = 0.5` — closing half your gap to the institution mean
*every month*, implausibly fast, compounded over 480 ticks. So **`transferRate` and
`decayRate` must be re-derived together.** Scanned at a 40-year career
(`N=4000, M=100`, t=4800; cells are `shareExpert / fraction ≥ 0.95`):

| `transferRate` \ `decayRate` | 0.005 | 0.01 | 0.02 | 0.04 | 0.08 |
|---|---|---|---|---|---|
| **0.5** | 1.00/0.99 | 1.00/0.99 | 1.00/0.98 | 1.00/0.00 | 0.99/0.00 |
| **0.3** | 0.99/0.69 | 0.99/0.00 | 0.99/0.00 | 0.99/0.00 | 0.00/0.00 |
| **0.2** | 0.99/0.00 | 0.99/0.00 | 0.98/0.00 | 0.79/0.00 | 0.00/0.00 |
| **0.15** | 0.98/0.00 | 0.98/0.00 | 0.96/0.00 | 0.00/0.00 | 0.00/0.00 |
| **0.1** | 0.97/0.00 | 0.95/0.00 | 0.00/0.00 | 0.00/0.00 | 0.00/0.00 |

A viable recalibration exists — `(0.2, 0.04)` and `(0.15, 0.02)` are both in range.
But **the usable band is narrow with sharp edges**: at `transferRate = 0.1`, moving
`decayRate` from 0.01 to 0.02 takes `shareExpert` from 0.95 to 0.00. The
recalibration must be done by scanning, not by reasoning from the old values.

### Why this re-sequences everything

The recalibration above is **independent of the graph work**. It is required for
any 40-year-career run, BA or world-model. It needs no new code — only parameter
scans on the existing engine.

So it should be done **first**, on BA, before any loader is written. That way the
graph work lands on a parameter set that is already known to produce a usable
dynamic range, instead of the two problems being debugged simultaneously — which
they otherwise would be, since a saturated baseline and a broken graph both
present as "the heatmaps are flat."

---

## 5. Implementation plan

### Phase A — Time recalibration (no new code, do first)

Scan `transferRate` × `decayRate` × `ambientGrowthRate` at `turnoverRate = 0.002083`
on the existing BA model. Target: no-AI baseline with `shareExpert` in a
*measurable* band (roughly 0.5-0.9), negligible mass above `E = 0.95`, and a
plausible time-to-expert. Record in `paper.md` alongside the existing steady-state
work. **Deliverable: a defensible monthly-tick parameter set.** Everything else
depends on this.

### Phase B — Data and config additions

1. Add the five new locations, with new `Country`/`Region` nodes as needed.
2. Add `bloc` to `Country` nodes; add `market_index` to `Hub` (or `Country`) nodes — decision 5's scalar.
3. Create `mobility-costs.json`: bloc affinity matrix, geo tiers, sector tiers, sector families, γ, edge bonuses.
4. Decide the zero-intake policy (Q3).

### Phase C — `world_model.js`, a pure loader

No `fs` inside, so it runs under Node and in the browser.

```js
loadWorldModel(worldJson, costsJson, opts) -> {
  M, neighbors, degree, prestige,   // same shape as generateBAGraph()
  affinity,                         // (i,j) -> (0,1], ASYMMETRIC
  institutions, entryWeights, fingerprint, warnings
}
```

| Option | Values | Default |
|---|---|---|
| `useBlocAffinity` | on/off (decision 2's ablation) | `true` |
| `hubSource` | `scalar` \| `located_in` (min cost across sites) | `located_in` |
| `prestigeFrom` | `degree` \| `sizeBand` \| `intake` \| `weightedDegree` | `intake` |
| `zeroIntakePolicy` | `drop` \| `floor1` \| `keep` | `floor1` |
| `useExplicitEdges` | fold in `PARENT_OF` / `COMPETES_FOR_TALENT` | `true` |

Validation: throw on dangling refs and duplicate ids; warn on isolated
institutions, zero-intake orgs, countries without a `bloc` or `market_index`, and
sectors without a family. Emit affinity statistics as loader output so the ad-hoc
inspection scripts behind this document don't need rewriting as the data grows.

### Phase D — Engine changes

```js
graphSource: "ba",              // "ba" | "worldModel"
worldModel: null,               // parsed object, NOT a path — keeps engine.js fs-free
worldModelOptions: {},
institutionSizing: "uniform",   // "uniform" | "weighted"
mobilityFriction: 0,            // 0 == today's behaviour exactly
```

- `initSim`: derive `M` from data in world-model mode. `M` becomes an output — throw if a config sets both, rather than silently ignoring one. Warn if `N/M < 5` (B2).
- Extract `sampleInstitution(state, rng)`, called at **both** [`engine.js:148`](engine.js#L148) and [`engine.js:289`](engine.js#L289) — the D2 fix.
- Add the friction term; make candidate sampling affinity-weighted.
- Add per-institution occupancy to the recorded history (§3 drain risk).

### Phase E — Provenance

Results currently depend only on `(params, seed)`. An external file breaks that
silently, and decision 4 guarantees the file will change. Hash node ids + edge ids
+ resolved cost config into a `fingerprint`, stamped into `state`, batch summaries,
and `report.html`. Without it, CSVs from before and after the Singapore/Tokyo/
Sydney/Toronto/Dubai additions are indistinguishable.

### Phase F — Consumers

| Consumer | Change |
|---|---|
| `batch_run.js` | Accept `worldModelPath` + `mobilityCostsPath`; parse **once**, share across runs. Refuse to sweep `M`. |
| `generate_experiments.js` | A **separate** world-model set writing to `results-worldmodel/`, leaving the BA set untouched. Drop `M`; set `N` and `HORIZON` per §4. Add derived-parameter support so career length can be swept with `N` following. |
| `simulator.html` | No filesystem — `<input type="file">` for both JSONs, plus a status line. Don't inline 400KB that keeps changing. |
| `report.html` | Label world-model experiments distinctly; a BA heatmap and a world-model heatmap must never render as the same kind of thing. |

### Phase G — Tests

- `test_world_model.js`: determinism; shape parity with `generateBAGraph`; affinity ordering matches §3's worked table; **asymmetry assertions** (`a(India→UK) > a(UK→India)`); bloc toggle changes cross-bloc costs and nothing else; multi-hub minimum-cost resolution; zero-intake policy; and **weighted placement still holds after 1000 ticks** (the D2 regression, the one most likely to silently rot).
- `test_engine.js`: world-model smoke test, the `N/M` guard, and an assertion that `mobilityFriction = 0` reproduces BA results bit-for-bit — decision 6, enforced.

---

## 6. Open questions

**1. What is "expert" in years?** Phase A needs a target. The recalibration can hit
almost any time-to-expert, but *which* is right is a domain judgement — 5 years?
10? It anchors `transferRate`, so it should be chosen deliberately rather than
falling out of whichever scan cell looks tidiest.

**2. Career length and `N` are one parameter, not two.** Sweeping career length
requires `N` to follow. Either the sweep generator gains derived-parameter support
(Phase F), or career length is frozen per experiment set. Given decision 3
explicitly wants it sweepable, the former.

**3. Does `market_index` vary by hub or by country?** New York and a smaller US
city are not the same market. Per-hub is more faithful; per-country is far less
data to source and defend. Recommend per-country initially with a per-hub override
where it obviously matters (New York, London, Singapore, Dubai).

**4. Should the gradient also affect *entry*, not just mobility?** Currently intake
determines where entrants start. But the same economic gradient that drives
mobility plausibly drives where people *try* to start. Leaving entry purely
intake-driven is defensible (intake already reflects demand) — worth stating as a
deliberate choice.

**5. Does drain destabilise low-index institutions?** §3's risk. Needs measuring
once Phases C-D land; it may force a floor on occupancy or a cap on the gradient.

**6. Intake ≠ headcount unless retention is uniform.** Sizing institutions by
intake assumes every organisation retains people equally. With asymmetric mobility
this becomes visibly false — high-gradient institutions retain better *by
construction*. The initial allocation and the emergent equilibrium will differ, and
that difference is arguably a result worth reporting rather than a bug.

**7. The 55-pair experiment design may not transfer.** Several current study
parameters (`expertiseMean`, `entrantExpertiseMean`) are population properties the
world model doesn't constrain, while the interesting new ones are structural
(`mobilityFriction`, γ, bloc toggle, sector-family costs). The world-model set
probably wants a different parameter list, not a copy of the BA one.

### A side effect worth exploiting

Pinning the tick to real time makes several parameters **falsifiable for the first
time**. Time-to-expert becomes a claim about how many years a graduate analyst
takes to become senior — checkable against reality. `decayRate` becomes a claim
about how fast an unused skill degrades. Neither could be validated while the tick
was dimensionless. Phase A is therefore not just bookkeeping: it is the first
opportunity to check the model against something outside itself.
