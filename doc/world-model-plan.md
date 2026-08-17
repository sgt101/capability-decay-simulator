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

Scan `transferRate` × `decayRate` × `personalLearningRate` at `turnoverRate = 0.002083`
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

> **Answered, and the guess was backwards.** The set does want a different
> parameter list — it is now 7 parameters and 21 files — but not the list
> predicted here. `mobilityFriction` moved `meanE_shortfall` by 0.005 across an
> eightfold change and was demoted to a fixed value; `entrantExpertiseMean`
> moves it by 0.062 and stayed. The structural parameters turned out to be the
> weak ones and the population properties the strong ones. See `problems.md`
> P15 and P18.

### A side effect worth exploiting

Pinning the tick to real time makes several parameters **falsifiable for the first
time**. Time-to-expert becomes a claim about how many years a graduate analyst
takes to become senior — checkable against reality. `decayRate` becomes a claim
about how fast an unused skill degrades. Neither could be validated while the tick
was dimensionless. Phase A is therefore not just bookkeeping: it is the first
opportunity to check the model against something outside itself.

---

## 7. Data representation: are the edges just signifiers?

Partly — and where they are, it is a symptom of storing the same fact twice.

### The file is a bipartite affiliation network, not a peer graph

The confusion is worth naming precisely. `world-model.json` is not a badly-formed
peer graph; it is a well-formed **affiliation network** — Organisations affiliate
with Contexts (Hubs, Sectors), which are themselves nested via `PART_OF`. Deriving
a peer graph from it by connecting co-affiliated organisations is the textbook
*one-mode projection*, not a workaround.

So the edges are not signifiers by nature. The reason they *feel* like signifiers
is that the same information is stored **twice with different cardinality** — once
as edges, once denormalised onto node attributes — leaving two sources of truth
that disagree about how many values a fact can have.

### What is actually lost by ignoring the edges

Measured, not assumed:

| Edge type | Count | Recoverable from node attributes? |
|---|---|---|
| `IN_SECTOR` | 245 | **Yes, entirely.** Exactly one per org, always equal to `org.sector` (0 mismatches). Pure duplication. |
| `PART_OF` | 71 | **Yes** for affinity — `org.country`/`org.region` are exact denormalised copies (0 mismatches). But it is the scaffolding `bloc` and `market_index` must hang off. |
| `LOCATED_IN` | 334 | **Only the first per org.** Set-valued (193 orgs in 1 hub … JPMorgan in 8) while `org.hub_city` is scalar. **89 facts lost.** |
| `PARENT_OF` | 14 | **No.** Irreducible pairwise fact. |
| `COMPETES_FOR_TALENT` | 7 | **No.** Irreducible pairwise fact. |
| `PLACES_GRADUATES_IN` | 4 | **No.** And *not* location data — see below. |
| `OFFSHORE_RECRUITS_FOR` | 1 | **No.** |

```
561 of 676 edges (83%)  recoverable from node attributes
115 of 676 edges (17%)  irreducible
      89   multi-site presence
      21   org <-> org relations
       5   talent flow
```

The losses are not equal — one affects the plan, two are marginal:

**1. Multi-site presence (89 facts).** Collapsing `LOCATED_IN` to the scalar
`hub_city` makes every global bank single-sited. That directly contradicts the
requirement that moves between global banks in the same city are easy — JPMorgan
would occupy one city instead of eight, so most such moves would be priced as
cross-city or cross-country.

**2. Irreducible pairwise relations (21 facts).** `PARENT_OF` and
`COMPETES_FOR_TALENT` cannot be reconstructed from any attribute. They are exactly
the kind of fact an attribute-based kernel cannot express, which is why §3 folds
them in as bonus multipliers rather than deriving them.

**3. Talent flow (5 facts) — semantically distinct, but negligible in quantity.**
`PLACES_GRADUATES_IN` is not a location edge: verified, all four Santander targets
(São Paulo, Mexico City, Santiago, Bogotá) are cities Santander is **not**
`LOCATED_IN`, so it encodes a recruiting pipeline rather than geography. That
distinction is real, but at five records it is a curiosity, not a resource — the
same judgement already applied to `COMPETES_FOR_TALENT` in Q4, and it should not
be dressed up as more than that because the phenomenon it names happens to be the
model's subject.

What the count does indicate is a **gap, not a finding**: the file has no
systematic record of where people move. That is unsurprising — it is a taxonomy,
and taxonomies describe structure. But it has one consequence worth stating. Under
the affinity model, mobility is *derived* from the §3 cost tiers, so flow data
would serve as **validation**, not input. With none available, the tier costs, γ,
and the bloc matrix are unfalsifiable: they can be tuned until the behaviour looks
plausible, but nothing in the dataset can contradict them. That is a limitation of
the model's evidential standing, not a defect in the file.

### A cleaner representation

Separate three kinds of thing the current schema conflates:

| Kind | What it is | Cardinality | Examples |
|---|---|---|---|
| **Attribute** | property of one entity | scalar | `sector`, `subsector_tier`, `org_size_band`, `intake`, `market_index`, `bloc` |
| **Affiliation** | membership of a context | **set-valued, weighted** | org → hubs |
| **Relation** | irreducible pairwise fact | pairwise, **directional, weighted** | `PARENT_OF`, `COMPETES_FOR_TALENT`, `PLACES_GRADUATES_IN` |

Affinity is then a **kernel over attributes + affiliations, modulated by
relations** — and the peer graph becomes an *output* of the model rather than an
input to it. That is the real conceptual shift: there is no "transfer graph" in the
data, only the ingredients from which one is computed.

### Concrete schema changes worth making

Ordered by value, and all cheap relative to a restructure:

1. **Weight the affiliation edges.** `LOCATED_IN` is currently unweighted, so
   JPMorgan's New York presence and its Sydney presence count equally. A `weight`
   field (headcount share) would fix both the affinity calculation *and* entrant
   placement, which currently allocates an organisation's intake with no idea where
   it geographically lands. This is the single highest-value addition.
2. **Pick one source of truth for single-valued facts.** Either drop the 245
   `IN_SECTOR` edges or drop `org.sector` — they cannot disagree today, but nothing
   prevents it. For `hub_city`, keep the edges as authoritative and rename the
   scalar to `primary_hub` so it reads as derived rather than definitive.
3. **Treat the existing flow edges as annotation, not structure.** Five records
   cannot inform the model; fold them in as a bonus multiplier alongside
   `COMPETES_FOR_TALENT` or leave them out. Separately — and as speculative future
   work rather than part of this plan — systematically collected flow volumes would
   be the only thing capable of *validating* the §3 cost tiers rather than merely
   fitting them. Worth noting when deciding what to collect next; not worth acting
   on now.
4. **Hang `bloc` and `market_index` off the `PART_OF` hierarchy** (Phase B), which
   is what that hierarchy is genuinely useful for even though it is redundant for
   affinity.
5. **Consider a temporal dimension.** Nothing in the file is dated, so all
   structure is static in a model whose entire subject is change over time.

### What this does not change

The affinity model in §3 stands. This section argues the *inputs* should be
cleaner, not that the kernel approach is wrong — an attribute kernel plus a sparse
relational overlay is the right shape given that 83% of the edges are attributes in
disguise. The practical consequence for the loader (Phase C) is only that
`hubSource: "located_in"` must be the default rather than an option: reading the
scalar throws away 89 facts that the stated requirements depend on.

---

## 8. Implementation status

Phases A-G implemented. What landed, and two results that qualify the design.

### Files

| File | Purpose |
|---|---|
| `calibrate_time_base.js` | Phase A scan. `node src/calibrate_time_base.js` |
| `mobility-costs.json` | Model assumptions: geo/sector tiers, bloc matrix, γ, edge bonuses |
| `add_geo_attributes.js` | Phase B. Adds `bloc` + `market_index` to `world-model.json` (idempotent, `--dry-run`) |
| `world_model.js` | Phase C loader. fs-free, returns `generateBAGraph`'s shape + `affinity`, `entryWeights`, `fingerprint` |
| `test_world_model.js` | Phase G. 65 checks |
| `experiments-worldmodel/worldmodel.1.json` | Worked example config → `results-worldmodel/` |
| `generate_worldmodel_experiments.js` | The pairwise set. 7 study params → 21 files in `experiments/` |

`engine.js` gained `graphSource`, `worldModel`, `institutionSizing`, `mobilityFriction`,
`MONTHLY_TICK_PARAMS`, a shared `sampleInstitution()` (the D2 fix), and per-tick
occupancy diagnostics. `batch_run.js` resolves the world model per worker from
paths (a loaded model holds a closure and cannot be structured-cloned).

### Phase A result

> **Superseded.** These values were later found to *drift* rather than sit
> still: the no-AI baseline wandered over the 1440-tick horizon, which makes
> `meanE_shortfall` mean "what AI removed, plus wherever the baseline had got
> to by the reporting tick". `calibrate_time_base.js` now rejects a cell for
> drifting however healthy its level looks, and the shipped values are
> **`transferRate = 0.15`, `decayRate = 0.020`** (drift +0.0002 over the full
> horizon). The original finding is kept below because the narrowness it
> describes is still true and still the reason this is difficult.

`transferRate = 0.13`, `decayRate = 0.024`, `turnoverRate = 1/480`. Gives ~5.4
years to expert and a baseline `shareExpert ≈ 0.44` — room to move in both
directions. Exported as `MONTHLY_TICK_PARAMS`, deliberately **not** folded into
`DEFAULT_PARAMS`, so the BA set is untouched (asserted in `test_world_model.js`:
`mobilityFriction` cannot fire on a BA graph, and BA runs are bit-identical).

The usable band is narrow. At `transferRate = 0.13`, moving `decayRate` from
0.022 to 0.026 takes `shareExpert` from 0.87 to 0.00. Equilibrium `meanE` sits at
~0.57, straddling `EXPERT_THRESHOLD = 0.585`, so `shareExpert` behaves like a step
function — maximally sensitive, which is useful, but not robust.

### Result 1 — mobilityFriction barely moves the outcome

From `results-worldmodel/worldmodel.1/`, `meanE_shortfall` at t=1440:

| `mobilityFriction` | 0 | 0.05 | 0.1 | 0.2 | 0.4 |
|---|---|---|---|---|---|
| shortfall at `aiDampeningBelow=0` | 0.525 | 0.522 | 0.521 | 0.520 | 0.520 |

An eightfold change in friction moves the headline metric by 0.005. The entire
affinity apparatus — tiers, blocs, asymmetric gradient — is close to a no-op for
expertise outcomes.

This was predicted and is not a bug: the graph touches only *mobility*, and
learning runs on `Ebar[j]`, an institution's internal mean. If institutions have
broadly similar `Ebar`, moving between them changes little. `paper.md` states it
directly — "a more realistic topology changes the *sorting* of people across
institutions, not the mechanism by which they gain or lose expertise."

The honest conclusion: **the world model buys realism in *where* people are, not
in *how much expertise exists*.** Worth having for questions about geographic and
sectoral distribution; it should not be expected to change the AI-erosion result.
If it is meant to, the coupling has to change — e.g. cross-institution learning,
or institution-level AI adoption — which is a modelling change, not a data one.

### Result 2 — the drain risk is real

Baseline arm, t=1440, out of 245 institutions:

| `mobilityFriction` | 0 | 0.05 | 0.1 | 0.2 | 0.4 |
|---|---|---|---|---|---|
| min occupancy | 1.3 | 0.7 | 0.8 | 0.8 | 0.7 |
| under-occupied (<5) | 12.7 | 21.1 | 21.5 | 22.3 | 27.8 |

Between 5% and 11% of institutions fall below meaningful occupancy, and friction
makes it worse — it traps people in high-index locations by penalising the move
back down. Those institutions' `Ebar` is noise, so their internal dynamics are
meaningless even though they still contribute to population aggregates.

Not fatal at these levels, but it must be read alongside any result. The
diagnostics are in the CSVs (`minOccupancy`, `emptyInstitutions`,
`underOccupiedInstitutions`) rather than enforced, because the drain is a genuine
prediction — but a run should be judged on them, not assumed sound.

### Done since

- **`simulator.html` file-input UI** (Phase F). Toggle, two file inputs, intake-sizing checkbox, live `mobility_friction` slider. Shares `world_model.js` with the batch runner via `<script src>` rather than carrying a second loader.
- **`report.html` for world-model results.** `build_report.js` takes `--manifest`/`--results`/`--out`, defaults to the world-model set, and refuses to build if the manifest's declared sweep axes do not vary in the results — a guard added after that exact mismatch silently collapsed every grid to a single averaged cell.
- **The pairwise world-model set.** `generate_worldmodel_experiments.js` → 21 files. The open question's prediction about *which* parameters would matter was wrong; see `problems.md` P15.
- **Stationary recalibration.** `transferRate = 0.15`, `decayRate = 0.020`.

### Not done

- Career length as a swept parameter with `N` following (§6, open question 2). Still blocking — `N`, `turnoverRate` and career length are one identity, and sweeping the rate without moving `N` describes a fixed-size system with different attrition, not a different demography.
- `aiLevelFraction` is pinned at 0.70 in the 15 files that do not sweep it, which is inside the saturated plateau, so those figures report an upper bound with respect to λ rather than a typical value (`problems.md` P16).
- Maximum de-skilling (then expressed as `aiRelianceIntensity = +1`; that parameter was removed in 2026-08) is an absorbing state that collapses the population, discontinuously, at the top of the swept range (`problems.md` P19). It affects one full edge of the grid in the 6 experiments that sweep ρ, and it sets the report's global colour scale. The cheapest fix is to stop the range at 0.95.
- The bloc toggle, γ, and the sector-family cost tiers are model assumptions in `mobility-costs.json` that are never swept — they are fixed inputs, not studied parameters.
