#!/usr/bin/env python3
"""Population-weighted median salary across the world model's institutions.

    python3 src/global_median_salary.py
    python3 src/global_median_salary.py --china private --india women
    python3 src/global_median_salary.py --json

WHAT THIS COMPUTES. Each organisation in data/world-model.json carries a country and an
`intake_estimate_central`. Attaching a published salary figure to each country and
weighting by intake gives a distribution over PEOPLE, from which this reports the median.

WHY INTAKE AND NOT A HEADCOUNT. Three reasons, in increasing order of interest:

  1. There is no headcount in the source. world-model.json carries no population field.
     `org_size_band` is a four-level qualitative band (Boutique/Mid/Large/Mega) whose
     `size_basis` reads "inferred - coarse band, verify" on all 330 organisations, and
     `intake_estimate_central` is itself DERIVED from that band -- the basis strings read
     like "Large base x 2.0 sector x 1.0 mechanism". So intake was not preferred over a
     population count; it is the only size signal the data contains.

  2. Inside the model the two are the same weight exactly, not approximately. Placement is
     intake-proportional (`entryWeights[i] = institutions[i].intake` in world_model.js, and
     engine.js builds its institution CDF from those weights), and the total is linear in
     intake too (`suggestedN = careerYears * totalIntake / divisor`). Modelled headcount per
     institution is therefore a constant multiple of intake, and a constant multiple cancels
     in a weighted median or mean. Weighting by intake and weighting by modelled headcount
     return identical numbers.

  3. Where it WOULD matter is the real world, and this is a genuine limitation. Standing
     headcount is intake x career length, and career lengths are not uniform across
     countries -- retirement ages, turnover and sector churn all differ. If financial-sector
     careers are shorter in one country than another, intake overstates that country's
     standing population. Nothing in this data can correct for it, and it bears directly on
     the result below, which is decided by whichever country's block straddles the halfway
     point.

WHAT IT IS NOT. Three limits worth stating before anyone quotes the number:

  1. It is BETWEEN-country only. Everyone in a country is assigned that country's single
     published figure, so all within-country dispersion is discarded. A real global median
     needs per-country distributions, not per-country point estimates. The effect is not
     neutral: collapsing each country to a point removes precisely the spread that a median
     is meant to be robust to, and the result is closer to "the median country's pay,
     weighted by people" than to "the median person's pay".

  2. The sources are not like for like. Some rows are medians and some are means (means run
     higher when pay is right-skewed, which it is); coverage of bonuses and employer
     contributions differs; two rows are a single company rather than a national statistic.
     They are what is available, not a harmonised series. Each row carries its basis so the
     mismatch stays visible.

  3. Coverage is partial. The table covers the large majority of modelled headcount but not
     all of it; countries with no figure are excluded from the median rather than imputed,
     and the share excluded is reported so the reader can judge.

Figures are the caller's table, reproduced verbatim with sources. Local-currency values are
carried for provenance; the arithmetic is done in USD as supplied.
"""

import argparse
import json
import os
import sys
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLD_MODEL = os.path.join(REPO, "data", "world-model.json")

# key -> (label, basis, local currency string, USD, source url)
SALARIES = {
    "United States": (
        "United States", "median, annualised", "US$83,200", 83200,
        "https://www.bls.gov/news.release/union2.t04.htm"),
    # The UK figure generalised to all of Europe, at the caller's direction. It stands in
    # for twelve further countries with no figure of their own -- close enough for the
    # weighting to be worth more than the precision it costs, but it IS the ONS number
    # wearing a continental label, not a European series.
    "Europe": (
        "Europe (UK figure, generalised)", "UK median annual earnings, applied Europe-wide",
        "GBP58,488", 77100,
        "https://www.ciip.group.cam.ac.uk/innovation/structure-and-performance-of-the-uk-economy-2026/"),
    "China/non-private": (
        "China - urban non-private enterprises", "mean annual wage", "RMB211,164", 29600,
        "https://www.stats.gov.cn/english/PressRelease/202605/t20260518_1963740.html"),
    "China/private": (
        "China - urban private enterprises", "mean annual wage", "RMB140,451", 19700,
        "https://www.stats.gov.cn/english/PressRelease/202605/t20260518_1963740.html"),
    "India/men": (
        "India - HDFC Bank, men", "company median", "INR556,005", 6400,
        "https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/pdf/annual-reports/2024-25/HDFC_Bank_Annual_Report_2024_25-310202.pdf"),
    "India/women": (
        "India - HDFC Bank, women", "company median", "INR386,345", 4400,
        "https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/pdf/annual-reports/2024-25/HDFC_Bank_Annual_Report_2024_25-310202.pdf"),
    "Singapore": (
        "Singapore", "reported median, annualised; incl. employer CPF", "S$111,096", 85000,
        "https://smartwealth.sg/average-income-salary-singapore/"),
    "Hong Kong": (
        "Hong Kong", "median, annualised; excl. discretionary bonuses", "HK$416,400", 53400,
        "https://www.censtatd.gov.hk/wbr/B1050014/B10500142025AN25/att/en/B10500142025AN25.pdf"),
    "Japan": (
        "Japan", "mean, annualised; incl. bonuses", "JPY7,204,284", 48100,
        "https://www.mhlw.go.jp/toukei/itiran/roudou/monthly/r07/25cr/dl/pdf25cr.pdf"),
    "Brazil": (
        "Brazil", "December mean, annualised; excl. 13th-month pay", "R$117,498", 21000,
        "https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/rais/rais-2025/SumrioExecutivo_RAIS20251.pdf"),
    "Chile": (
        "Chile - Santiago metropolitan region", "Apr 2025 mean insurable earnings, annualised",
        "CLP29,800,992", 31300,
        "https://www.bcn.cl/siit/reportesregionales/pdf_region.html?anno=2025&cod_region=13"),
}

# world-model `country` value -> SALARIES key. Only the spelling differs for most; the two
# ambiguous cases are resolved by CLI flag because the table offers two figures for each and
# neither is obviously the right one for a financial-sector workforce.
COUNTRY_MAP = {
    "United States": "United States",
    "Singapore": "Singapore",
    "Hong Kong SAR": "Hong Kong",      # table says "Hong Kong"
    "Japan": "Japan",
    "Brazil": "Brazil",
    "Chile": "Chile",                  # table is Santiago only -- see caveat in output
    "China": None,                     # filled from --china
    "India": None,                     # filled from --india
}

# Europe is grouped by the world model's OWN `region` field rather than a hand-listed set of
# countries, so it tracks the data if the source changes. Belgium is its own region in the
# source rather than sitting under Continental Europe -- a quirk of the data, not a claim
# about Belgium -- so it is named explicitly.
EUROPE_REGIONS = {"United Kingdom", "Continental Europe", "Belgium"}


def load_institutions(path):
    """Organisation nodes with a country and a positive intake."""
    with open(path, encoding="utf-8") as fh:
        world = json.load(fh)
    orgs = []
    for n in world.get("nodes", []):
        if n.get("node_type") != "Organisation":
            continue
        intake = n.get("intake_estimate_central")
        if not intake or intake <= 0:
            continue
        orgs.append({"label": n.get("label"), "country": n.get("country"),
                     "region": n.get("region"), "hub": n.get("hub_city"),
                     "intake": float(intake)})
    return orgs


def group_of(org):
    """The bucket an organisation's salary is looked up under.

    Europe is one bucket because a single figure now stands for the whole continent;
    everywhere else is still its own country.
    """
    if org.get("region") in EUROPE_REGIONS:
        return "Europe"
    return org.get("country") or "(unknown)"


def weighted_quantile(pairs, q):
    """Quantile of a discrete distribution given (value, weight) mass points.

    Mass points, not samples: everyone sharing a country shares one value exactly. Where the
    cumulative weight lands exactly on the quantile the answer is the midpoint of the two
    adjacent values, which is the same convention a plain median uses for an even count.
    """
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    if total <= 0:
        return float("nan")
    target = total * q
    cum = 0.0
    for i, (value, weight) in enumerate(pairs):
        cum += weight
        if cum > target + 1e-9:
            return value
        if abs(cum - target) <= 1e-9:                 # exactly on the boundary
            nxt = pairs[i + 1][0] if i + 1 < len(pairs) else value
            return (value + nxt) / 2
    return pairs[-1][0]


def median_margin(pairs):
    """Where the 50% line falls inside the bucket that contains it.

    The median of a mass-point distribution is whichever bucket straddles the halfway
    point, so it can be decided by a couple of percent of headcount rather than by any
    property of the wages. This reports how much room there is either side, because a
    median sitting 1pp inside its bucket is a different claim from one sitting 15pp in.
    """
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    cum = 0.0
    for i, (value, weight) in enumerate(pairs):
        lo = cum
        cum += weight
        if cum > total / 2:
            return {
                "value": value, "lo_share": lo / total, "hi_share": cum / total,
                "margin_below_pp": (total / 2 - lo) / total,
                "margin_below_people": total / 2 - lo,
                "margin_above_pp": (cum - total / 2) / total,
                "margin_above_people": cum - total / 2,
                "next_lower": pairs[i - 1][0] if i else None,
                "next_higher": pairs[i + 1][0] if i + 1 < len(pairs) else None,
            }
    return None


def apply_hub_scaling(orgs, specs):
    """Multiply the intake of every organisation in a named hub. HUB=FACTOR, repeatable.

    A counterfactual on the population WEIGHTS, which is the axis the median actually turns
    on -- none of the wage figures are in question here, only how many people sit behind
    each one. Scaling a hub changes the covered total too, so the halfway point moves with
    it; that is the whole point and is why the margin is reported alongside.
    """
    if not specs:
        return orgs, {}
    factors = {}
    for spec in specs:
        hub, sep, raw = spec.partition("=")
        if not sep:
            raise SystemExit(f"--scale-hub wants HUB=FACTOR, got {spec!r}")
        try:
            factors[hub.strip()] = float(raw)
        except ValueError:
            raise SystemExit(f"--scale-hub factor must be a number, got {raw!r}")
    known = {o.get("hub") for o in orgs}
    unknown = sorted(h for h in factors if h not in known)
    if unknown:
        raise SystemExit("--scale-hub: no such hub in the world model: " + ", ".join(unknown))
    out, added = [], defaultdict(float)
    for o in orgs:
        f = factors.get(o.get("hub"))
        if f is None:
            out.append(o)
        else:
            added[o["hub"]] += o["intake"] * (f - 1)
            out.append(dict(o, intake=o["intake"] * f))
    return out, {h: (factors[h], added[h]) for h in factors}


CHINA_SERIES = ["non-private", "private"]
INDIA_SERIES = ["men", "women", "blend"]


def compute(orgs, china, india):
    """Everything downstream of the two ambiguous series choices.

    One function so the headline figure and every row of the sensitivity table come out of
    the same code path. A sensitivity table computed a second way is a sensitivity table
    nobody can check against the headline.
    """
    mapping = dict(COUNTRY_MAP)
    mapping["China"] = "China/non-private" if china == "non-private" else "China/private"
    mapping["India"] = None if india == "blend" else "India/" + india

    def usd_for(group):
        if group == "Europe":
            return SALARIES["Europe"][3]
        if group == "India" and india == "blend":
            return (SALARIES["India/men"][3] + SALARIES["India/women"][3]) / 2
        key = mapping.get(group)
        return SALARIES[key][3] if key else None

    by_group = defaultdict(float)
    for o in orgs:
        by_group[group_of(o)] += o["intake"]

    covered, uncovered = [], []
    for group, intake in by_group.items():
        usd = usd_for(group)
        (covered if usd is not None else uncovered).append((group, intake, usd))
    covered.sort(key=lambda r: r[2])
    uncovered.sort(key=lambda r: -r[1])

    covered_intake = sum(i for _, i, _ in covered)
    total_intake = covered_intake + sum(i for _, i, _ in uncovered)
    pairs = [(usd, intake) for _, intake, usd in covered]

    return {
        "china": china, "india": india, "mapping": mapping,
        "covered": covered, "uncovered": uncovered, "pairs": pairs,
        "covered_intake": covered_intake, "total_intake": total_intake,
        "coverage": covered_intake / total_intake if total_intake else 0.0,
        "median": weighted_quantile(pairs, 0.5),
        "p25": weighted_quantile(pairs, 0.25),
        "p75": weighted_quantile(pairs, 0.75),
        "mean": sum(v * w for v, w in pairs) / covered_intake if covered_intake else float("nan"),
        "margin": median_margin(pairs),
    }


def basis_for(res, group):
    if group == "Europe":
        return SALARIES["Europe"][1]
    key = res["mapping"].get(group)
    return SALARIES[key][1] if key else "unweighted mean of the men's and women's medians"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--china", choices=CHINA_SERIES, default="non-private",
                    help="which Chinese wage series to use (default: non-private)")
    ap.add_argument("--india", choices=INDIA_SERIES, default="men",
                    help="which HDFC Bank median to use; 'blend' is the unweighted mean of "
                         "the two, which assumes a 50/50 workforce (default: men)")
    ap.add_argument("--scale-hub", action="append", metavar="HUB=FACTOR",
                    help="multiply a hub's intake, e.g. --scale-hub 'New York=2'. "
                         "Repeatable. A counterfactual on the population weights.")
    ap.add_argument("--world-model", default=WORLD_MODEL, help="path to world-model.json")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a report")
    args = ap.parse_args()

    orgs = load_institutions(args.world_model)
    orgs, scaled = apply_hub_scaling(orgs, args.scale_hub)
    res = compute(orgs, args.china, args.india)
    variants = [compute(orgs, c, i) for c in CHINA_SERIES for i in INDIA_SERIES]

    if args.json:
        json.dump({
            "median_usd": res["median"], "p25_usd": res["p25"], "p75_usd": res["p75"],
            "weighted_mean_usd": res["mean"],
            "covered_intake": res["covered_intake"], "total_intake": res["total_intake"],
            "coverage_fraction": res["coverage"],
            "china_series": res["china"], "india_series": res["india"],
            "hub_scaling": {h: {"factor": f, "people_added": a} for h, (f, a) in scaled.items()},
            "median_margin": res["margin"],
            "countries": [{"group": g, "intake": i, "usd": u} for g, i, u in res["covered"]],
            "excluded": [{"group": g, "intake": i} for g, i, _ in res["uncovered"]],
            # Every combination as its own complete result. Deliberately NOT reduced to a
            # min/max: the spread across assumptions is not an uncertainty interval, and
            # collapsing it to a range invites reading it as one.
            "variants": [{"china_series": v["china"], "india_series": v["india"],
                          "median_usd": v["median"], "weighted_mean_usd": v["mean"]}
                         for v in variants],
        }, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return

    print("=" * 78)
    print("Population-weighted median salary across the world model's institutions")
    print("=" * 78)
    print(f"world model : {os.path.relpath(args.world_model, REPO)}")
    print("weighting   : intake_estimate_central (the simulator's own entryWeights)")
    print(f"series used : China = {res['china']}, India = HDFC {res['india']}")
    for hub, (factor, added) in sorted(scaled.items()):
        print(f"counterfact : {hub} intake x{factor:g}  ({added:+,.0f} people)")
    print()

    print(f"{'group':<24}{'intake':>9}{'share':>9}{'USD':>12}   basis")
    print("-" * 78)
    for group, intake, usd in res["covered"]:
        print(f"{group:<24}{intake:>9,.0f}{intake / res['total_intake']:>9.1%}"
              f"{usd:>12,.0f}   {basis_for(res, group)}")
    print("-" * 78)
    print(f"{'covered':<24}{res['covered_intake']:>9,.0f}{res['coverage']:>9.1%}")
    print()

    if res["uncovered"]:
        excl = sum(i for _, i, _ in res["uncovered"])
        print(f"excluded - no figure in the table ({excl:,.0f} people, "
              f"{excl / res['total_intake']:.1%} of modelled headcount):")
        line = "  "
        for group, intake, _ in res["uncovered"]:
            piece = f"{group} {intake:,.0f}   "
            if len(line) + len(piece) > 76:
                print(line.rstrip())
                line = "  "
            line += piece
        if line.strip():
            print(line.rstrip())
        print()

    print("=" * 78)
    print(f"  MEDIAN                 ${res['median']:>10,.0f}")
    print(f"  25th / 75th percentile ${res['p25']:>10,.0f}  /  ${res['p75']:,.0f}")
    print(f"  weighted mean          ${res['mean']:>10,.0f}")
    print("=" * 78)

    mm = res["margin"]
    if mm:
        print()
        print("How firm is that median?")
        print(f"  the bucket holding the 50% line spans {mm['lo_share']:.1%}-{mm['hi_share']:.1%} "
              f"of covered headcount")
        print(f"  the 50% line sits {mm['margin_below_pp']:.1%} above its lower edge "
              f"({mm['margin_below_people']:,.0f} people)")
        if mm["next_lower"] is not None:
            print(f"  shift that many people below it and the median becomes "
                  f"${mm['next_lower']:,.0f}")

    print()
    print("Sensitivity to the two ambiguous series choices")
    print("  Each row is a COMPLETE result under a stated assumption, not a draw from a")
    print("  distribution. The spread across rows is not an uncertainty interval and should")
    print("  not be quoted as one - pick a row, and say which.")
    print()
    print(f"  {'China series':<14}{'India series':<14}{'median':>11}{'weighted mean':>16}"
          f"{'median margin':>18}")
    print("  " + "-" * 73)
    for v in variants:
        mark = "  <-" if (v["china"], v["india"]) == (res["china"], res["india"]) else ""
        marg = v["margin"]
        marg_s = (f"{marg['margin_below_pp']:.1%} ({marg['margin_below_people']:,.0f})"
                  if marg else "-")
        med_s, mean_s = f"${v['median']:,.0f}", f"${v['mean']:,.0f}"
        print(f"  {v['china']:<14}{'HDFC ' + v['india']:<14}{med_s:>11}{mean_s:>16}"
              f"{marg_s:>18}{mark}")

    print()
    print("Caveats - see the module docstring for the full statement:")
    print("  * between-country only: within-country dispersion is discarded entirely,")
    print("    so this is nearer 'the median country's pay, weighted by people' than")
    print("    'the median person's pay'.")
    print("  * sources mix medians and means, and differ on bonuses and employer")
    print("    contributions; the India rows are one company, not a national figure.")
    print("  * Europe is the UK figure standing in for twelve further countries.")
    print("  * the Chile row is the Santiago metropolitan region applied to all Chilean")
    print("    institutions.")
    print(f"  * {1 - res['coverage']:.1%} of modelled headcount is excluded rather than imputed.")


if __name__ == "__main__":
    main()
