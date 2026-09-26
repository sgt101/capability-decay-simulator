#!/usr/bin/env bash
# Where is AI a net gain in capability? The (g_n, g_x, d_n) x rho sweep, end to end.
#
#   ./src/run_acl_leverage.sh                     # acl.1-5, 32 replicates, ~45 min
#   ./src/run_acl_leverage.sh --quick             # 2 replicates, ~4 min, for a smoke test
#   ./src/run_acl_leverage.sh acl.1               # just one
#   REPS=10 ./src/run_acl_leverage.sh             # override the replicate count
#   RHO=30,2000 RHO_STEPS=31 ./src/run_acl_leverage.sh
#   GRID=0:1:11 ./src/run_acl_leverage.sh         # the g_n / g_x / d_n grid, per axis
#
# WHY FIVE CONFIGS AND NOT FIFTEEN. The ACL family's fifteen configs differ in exactly four
# settings: aclNoviceGain, aclExpertGain and aclNoviceDeficit -- which are g_n, g_x and d_n,
# the three this study sweeps, and which never touch a career -- and aiDampeningAbove, which
# does. acl.1, acl.6 and acl.11 are therefore the SAME simulation read out at three different
# parameter points, and so on down the family. Running all fifteen would be three identical
# passes over each of five populations. Instead each of the five dampening levels is run once,
# and all three published parameterisations are pinned onto the sweep's grid and marked on its
# page, which reproduces every one of the fifteen exactly and puts them on the same chart.
#
# TWO STEPS, AND ONLY THE FIRST ONE SIMULATES.
#
#   1. src/acl_snapshots.js runs each cell once and writes every person's expertise at the
#      reported year. This is the entire cost of the study.
#   2. src/acl_leverage_sweep.js reads those snapshots and answers the question for every
#      combination of the three leverage parameters and every rho in the range. It runs no
#      simulation at all: capability is linear in the three parameters (see that script's
#      header), so each point is four multiplications on numbers already on disk.
#
# WHY 32 REPLICATES BY DEFAULT. Not for precision alone: it is the replicate count
# results/rho/<config>/rho_summary.json was built with, and the sweep checks itself against
# that file at the published leverage values. With a matching count the check is exact to
# floating point; with a different one the two are different estimates of the same quantity
# and the check has to be skipped. Lower it with REPS= if a rough answer will do, and
# accept that the page will say its verification did not run.
set -euo pipefail
cd "$(dirname "$0")/.."

REPS="${REPS:-32}"
RHO="${RHO:-60,800}"
RHO_STEPS="${RHO_STEPS:-25}"
# One spec, applied to all three axes: they are the same kind of quantity (a fraction of
# output gained or lost) and a reader comparing across them should not have to check
# whether each axis was tabulated on the same ladder. Override per axis with GN/GX/DN.
GRID="${GRID:-0:0.8:9}"
GN="${GN:-$GRID}"
GX="${GX:-$GRID}"
DN="${DN:-$GRID}"

if [ "${1:-}" = "--quick" ]; then
  REPS=2
  shift
fi

# One per aiDampeningAbove level: 1.1, 1.0, 0.9, 0.8 and 0.7. See the note above for why
# acl.6-15 are not here.
CONFIGS=("$@")
if [ ${#CONFIGS[@]} -eq 0 ]; then CONFIGS=(acl.1 acl.2 acl.3 acl.4 acl.5); fi

for name in "${CONFIGS[@]}"; do
  # Accept either a bare config name or a path, so the same script serves the ACL family
  # and any other paired grid config.
  if [ -f "$name" ]; then cfg="$name"; else cfg="data/experiments-acl/${name%.json}.json"; fi
  if [ ! -f "$cfg" ]; then echo "no such config: $cfg" >&2; exit 1; fi
  base="$(basename "$cfg" .json)"
  out="results/acl-leverage/$base"

  echo
  echo "=== $base : expertise snapshots ($REPS replicates) ==============================="
  node src/acl_snapshots.js --config "$cfg" --replicates "$REPS" --out "$out"

  echo
  echo "=== $base : leverage x rho sweep (no simulation) ================================"
  node src/acl_leverage_sweep.js --snapshots "$out" \
    --rho "$RHO" --rho-steps "$RHO_STEPS" --gn "$GN" --gx "$GX" --dn "$DN"

  echo
  echo "open $out/acl_leverage.html"
done

# The snapshots are the expensive part and they are reusable: a different grid, a different
# rho range or a changed figure needs step 2 only.
echo
echo "to re-sweep without re-simulating, e.g. a wider rho range:"
for name in "${CONFIGS[@]}"; do
  base="$(basename "${name%.json}")"
  echo "  node src/acl_leverage_sweep.js --snapshots results/acl-leverage/$base --rho 30,3000 --rho-steps 31"
done
