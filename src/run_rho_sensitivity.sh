#!/usr/bin/env bash
# Capability-ratio (rho) sensitivity across a representative slice of both reported
# experiment sets.
#
#   ./src/run_rho_sensitivity.sh                 # the default slice, ~10 min
#   ./src/run_rho_sensitivity.sh --quick         # a smaller one, ~2 min, for a smoke test
#   RHO=10,50,100,1000,10000 ./src/run_rho_sensitivity.sh
#
# WHY THIS EXISTS. w(E) = rho^((E-theta)/(1-theta)) turns expertise into capability.
# theta has an empirical argument behind it (expert_threshold_sensitivity.js); rho is a
# stated assumption with none, and every capability magnitude in the reports scales with
# it. This measures whether the CONCLUSIONS scale with it too.
#
# WHY IT RE-RUNS. results/*.csv store scalar summaries and a systemCapability already
# collapsed at rho = 1000. C is a sum over the whole population, which no set of summary
# statistics recovers, so the expertise array has to exist again. Same configs, same
# seeds, so cells correspond to the reports one for one.
#
# Each config is one pass regardless of how many rho are asked for: rho feeds output
# only and never enters the update (rho_sensitivity.js asserts this at startup).
set -euo pipefail
cd "$(dirname "$0")/.."

# Powers of two from 8 to 8192. Four points could not resolve the sign change: the
# crossover rho -- where AI stops reading as a capability gain and starts reading as a
# loss -- is the number this experiment exists to find, and it needs a curve, not a
# sample. The shipped CAPABILITY_RATIO is always added by rho_sensitivity.js.
RHO="${RHO:-8,16,32,64,128,256,512,1024,2048,4096,8192}"
REPS=3
QUICK=0
if [ "${1:-}" = "--quick" ]; then QUICK=1; REPS=2; fi

# A slice, not the whole study: the full worldmodel pairing is 21x21x3x2 = 2,646 runs and
# there are 28 of them. These four span the axes that actually move capability.
#
#   experiment.25  aiLevelFraction x aiDampeningBelow — the two dials the model's central
#                  claim runs on, so the pairing whose capability numbers matter most
#   experiment.16  aiLevelFraction x aiDampeningAbove — the same axis crossed with the
#                  ABOVE-threshold channel, which acts on the top tail; rho decides how
#                  much the top tail counts, so this is where the two interact
#   experiment.1   transferRate x decayRate — a pairing with NO AI axis, so it tests
#                  whether rho matters when the AI channel is not what differs
#   acl.1, acl.8   the assisted-learning set, where the leverage term l(E) varies across
#                  cells; that is where rho is most likely to reorder, since rho decides
#                  which part of the distribution l gets weighted by
# "path stride" pairs. Stride subsamples each grid axis, and the right value depends on
# the grid: the worldmodel pairings are 21x21, where every 4th value still leaves 36 cells,
# while the ACL grids are only 6x3 and a stride above 1 would collapse them to a handful of
# points that cannot resolve a crossover at all.
# "path stride" pairs, read below with an explicit IFS split rather than by relying on
# unquoted word-splitting: that idiom is a bash-ism, and under zsh it does not split at
# all, which would silently hand every config an empty stride.
#
# Stride subsamples each grid axis, and the right value depends on the grid: the
# worldmodel pairings are 21x21, where every 4th value still leaves 36 cells, while the
# ACL grids are only 6x3 and a stride above 1 collapses them to a handful of points that
# cannot resolve a crossover at all.
CONFIGS="\
data/experiments/experiment.25.json 4
data/experiments/experiment.16.json 4
data/experiments/experiment.1.json 4
data/experiments-acl/acl.1.json 1
data/experiments-acl/acl.8.json 1"

echo "rho sweep: $RHO   replicates $REPS"
while IFS=' ' read -r cfg stride; do
  [ -z "$cfg" ] && continue
  [ "$QUICK" = "1" ] && stride=$((stride * 2))
  if [ ! -f "$cfg" ]; then
    echo "  skipping $cfg — not present (generate it first)" >&2
    continue
  fi
  echo
  echo "--- $cfg (stride $stride) ---"
  node src/rho_sensitivity.js --config "$cfg" --rho "$RHO" --stride "$stride" --replicates "$REPS"
done <<EOF
$CONFIGS
EOF

node src/rho_sensitivity.js --index

echo
echo "reports written under results/rho/*/rho_report.html"
echo "combined index: results/rho/index.html"
echo "open them, or read the rank-correlation table at the top of each: a correlation of"
echo "1.000 against rho=1000 means the ordering of cells does not depend on the assumption."
