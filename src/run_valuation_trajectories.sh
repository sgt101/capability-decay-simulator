#!/usr/bin/env bash
# Produces doc/valuation_trajectories.html and its LaTeX tables from scratch: runs the
# capability trajectories at the PST and Barras valuation ratios, for each gamma_above set,
# then builds the report.
#
#   ./src/run_valuation_trajectories.sh                # every set, then build  (~90 min)
#   ./src/run_valuation_trajectories.sh --skip-sweep   # build only, from existing CSVs
#   ./src/run_valuation_trajectories.sh --quick        # 2 replicates, a smoke test
#   ./src/run_valuation_trajectories.sh --only above-1 # one set
#   ./src/run_valuation_trajectories.sh --workers 8
#   RHO=66,187,263,735 REPS=32 ./src/run_valuation_trajectories.sh
#
# WHAT IT IS FOR. The reported capability numbers are computed at a single CAPABILITY_RATIO
# of 1000. PST and Barras are two published ways of valuing fund-manager skill, and each,
# applied to a $400bn and a $1.2Trn value pool, implies a different rho. This runs the four
# and draws each source's pair as a band, so the figure says how much of the trajectory
# depends on which valuation you accept.
#
# WHY IT IS ONE PASS PER CONFIG. rho feeds output metrics only and never enters the state
# update (rho_sensitivity.js asserts this at startup), so ONE simulation per configuration
# yields every rho at once. Adding rho values to the list below costs nothing but disk.
#
# WHY --full-csv. Capability is computed at every recorded tick regardless, but by default
# only --at is WRITTEN. A trajectory needs all 120 recorded ticks, so the flag is a
# write-time choice, not extra compute. Without it the builder finds one tick per series and
# says so rather than drawing a chart of single points.
#
# WHY A SEPARATE DIRECTORY. Output goes under results/rho-trajectories/, NOT results/rho/.
# rho_sensitivity.js writes one directory per config and overwrites what is there, and
# results/rho/ holds the rho LADDER -- twenty-one values, the rank correlations, the
# crossover -- which this report does not need and must not destroy. A failed run here
# cannot damage it. The CSVs are large and gitignored; the .tex and .html are not.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_ROOT="results/rho-trajectories"

# THE SETS, one per value of gamma_above, as "key  config-dir  manifest".
#
# gamma_above and gamma_below are the same kind of quantity in the same units -- engine.js
# multiplies the learning delta by one or the other depending on which side of the AI the
# person sits -- so a set is one answer to "does the AI also slow the learning of the people
# it does NOT outrank".
#
#   above-1        1.0     it does not. The ACL set reports this, and it is an assumption,
#                          not a measurement.
#   above-0.8113   0.8113  it does, by the central Stromberg penalty (-18.87%) -- the same
#                          measured figure the middle ROW of the figure already uses for
#                          gamma_below, so the pair isolates "penalty everywhere" against
#                          "penalty only below" with nothing else moving.
#
# Each output directory gets a set.json naming its manifest and its multiplier, so the
# builder reads what a run actually was rather than inferring it from a path. Adding a
# gamma_above is a line here plus a generator; nothing in the builder changes.
SETS="\
above-1 data/experiments-acl data/experiments.acl.manifest.json
above-0.8113 data/experiments-acl-gabove data/experiments.acl-gabove.manifest.json"

# The three Dell'Acqua capability variants. Kept in step with CONFIGS in
# build_valuation_trajectory_report.js; the builder names any it cannot find rather than
# building a partial figure silently.
NUMS="2 7 12"

# The four valuation ratios. rho_sensitivity.js always appends the shipped CAPABILITY_RATIO
# (1000), so the reference line needs no entry here.
#
#   PST     rho 187 ($400bn)   rho 735 ($1.2Trn)
#   Barras  rho  66 ($400bn)   rho 263 ($1.2Trn)
#
# Only these are requested, not the full ladder: every extra rho multiplies the full-tick
# CSV, and the ladder already lives in results/rho/ where the crossover analysis wants it.
RHO="${RHO:-66,187,263,735}"

# 32 to match what the ACL set's own rho analysis reports at. A valuation band has to be
# wider than replicate scatter to mean anything, and the builder prints the paired standard
# error beside each band so the two can be compared rather than assumed.
REPS="${REPS:-32}"

# Stride 1 always: the ACL grids are only 6 lambda x 3 gamma_below, and any stride above 1
# would drop the penalties the rows are made of.
STRIDE=1

WORKERS=""
SKIP_SWEEP=0
ONLY=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-sweep) SKIP_SWEEP=1; shift ;;
    --quick) REPS=2; shift ;;
    --only) ONLY="$2"; shift 2 ;;
    --workers) WORKERS="$2"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

# Expanded with the ${arr[@]+"${arr[@]}"} guard rather than as a bare "${WORKER_ARGS[@]}":
# bash 3.2, still /bin/bash on macOS, treats an EMPTY array as unset under `set -u` and
# aborts. Fixed in 4.4, so this only bites someone on the stock system shell, and only when
# --workers is omitted.
WORKER_ARGS=()
[ -n "$WORKERS" ] && WORKER_ARGS=(--workers "$WORKERS")

if [ ! -d "data/experiments-acl" ]; then
  echo "no data/experiments-acl — generate the set first:" >&2
  echo "  node src/generate_acl_experiments.js" >&2
  exit 1
fi

# The gamma_above configs are CLONES of the ACL ones with a single field changed, so
# regenerating them here is cheap, idempotent, and keeps the two in step: if the ACL set
# moves, the clones move with it.
node src/generate_acl_gabove_experiments.js >/dev/null || {
  echo "could not generate the gamma_above configs" >&2
  exit 1
}

if [ "$SKIP_SWEEP" = "0" ]; then
  echo "valuation trajectories: rho $RHO (+ shipped 1000), $REPS replicates, stride $STRIDE"
  echo "configs: $NUMS   ->   $OUT_ROOT/<set>/"
  echo
  while IFS=' ' read -r key cfgdir man; do
    [ -z "$key" ] && continue
    if [ -n "$ONLY" ] && [ "$ONLY" != "$key" ]; then continue; fi
    if [ ! -d "$cfgdir" ]; then
      echo "skip set $key: no $cfgdir" >&2
      continue
    fi
    mkdir -p "$OUT_ROOT/$key"

    # set.json is written BEFORE the runs, so an interrupted sweep still leaves a directory
    # the builder can describe and report as incomplete rather than skip in silence. The
    # multiplier is read out of the config rather than restated here, so the file cannot
    # disagree with the runs beside it.
    node -e '
      const fs = require("fs"), path = require("path");
      const [outdir, key, cfgdir, man] = process.argv.slice(1);
      const g = JSON.parse(fs.readFileSync(path.join(cfgdir, "acl.2.json"), "utf8"))
        .fixed.aiDampeningAbove;
      fs.writeFileSync(path.join(outdir, "set.json"), JSON.stringify({
        key, manifest: man, configDir: cfgdir,
        aiDampeningAbove: g, gammaAbove: Number((g - 1).toFixed(6)),
      }, null, 2) + "\n");
      console.log(g);
    ' "$OUT_ROOT/$key" "$key" "$cfgdir" "$man" > "$OUT_ROOT/$key/.gabove"
    gabove=$(cat "$OUT_ROOT/$key/.gabove")
    rm -f "$OUT_ROOT/$key/.gabove"

    echo "--- set $key   (gamma_above $gabove) ---"
    for n in $NUMS; do
      cfg="$cfgdir/acl.$n.json"
      if [ ! -f "$cfg" ]; then
        echo "skip: $cfg not found" >&2
        continue
      fi
      echo "=== $key / acl.$n ==="
      node src/rho_sensitivity.js \
        --config "$cfg" \
        --rho "$RHO" \
        --stride "$STRIDE" \
        --replicates "$REPS" \
        --full-csv \
        --out "$OUT_ROOT/$key/acl.$n" \
        ${WORKER_ARGS[@]+"${WORKER_ARGS[@]}"}
      echo
    done
  done <<EOF
$SETS
EOF
else
  echo "--skip-sweep: building the report from whatever is already under $OUT_ROOT/"
  echo
fi

# Builds doc/valuation_trajectories.html and writes the two .tex tables beside the runs. It
# fails with the reason named -- no directory, one tick only, or a different --rho list --
# rather than producing a figure that does not match its own caption.
node src/build_valuation_trajectory_report.js --from "$OUT_ROOT"

echo
echo "next: node src/build_pages.js      (assembles site/, including this report)"
echo "      node src/test/test_landing_links.js"
