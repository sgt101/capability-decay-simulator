#!/usr/bin/env bash
# Capability-ratio (rho) sensitivity across a representative slice of every reported
# experiment set.
#
#   ./src/run_rho_sensitivity.sh                 # the default slice at 32 reps, ~4-5 hours
#   ./src/run_rho_sensitivity.sh --quick         # a smaller one, ~3 min, for a smoke test
#   RHO=10,50,100,1000,10000 ./src/run_rho_sensitivity.sh
#   REPS=10 ./src/run_rho_sensitivity.sh         # override the replicate count
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

# Powers of two from 1 to 2048. Four points could not resolve the sign change: the
# crossover rho -- where AI stops reading as a capability gain and starts reading as a
# loss -- is the number this experiment exists to find, and it needs a curve, not a
# sample. 1 is the degenerate end (no premium for expertise -- capability is plain
# headcount), included deliberately as the reference for "does the convexity assumption
# itself matter", not just its size. The shipped CAPABILITY_RATIO is always added by
# rho_sensitivity.js.
RHO="${RHO:-1,2,4,8,16,32,64,128,256,512,1024,2048}"
# 32 to match the replicate count the structure and recruitment sets themselves report
# at, applied uniformly across all seven configs here regardless of what each one's own
# report used — rho_sensitivity.js no longer caps this at the config's own replicate
# count (see its REPS validation), so this is a genuine, deliberate increase in precision
# for the experiment.*/acl.* configs, not a no-op.
REPS="${REPS:-32}"
QUICK=0
if [ "${1:-}" = "--quick" ]; then QUICK=1; REPS=2; fi

# A slice, not the whole study: the full worldmodel pairing alone is 21x21x3x2 = 2,646
# runs and there are 28 of them across all four sets. These seven span the axes that
# actually move capability, one representative pairing per reported set:
#
#   experiment.25  aiLevelFraction x aiDampeningBelow — the two dials the model's central
#                  claim runs on, so the pairing whose capability numbers matter most
#   experiment.16  aiLevelFraction x aiDampeningAbove — the same axis crossed with the
#                  ABOVE-threshold channel, which acts on the top tail; rho decides how
#                  much the top tail counts, so this is where the two interact
#   experiment.1   transferRate x decayRate — a pairing with NO AI axis, so it tests
#                  whether rho matters when the AI channel is not what differs
#   acl.2, acl.7,  the assisted-learning set's three capability-leverage variants --
#   acl.12         published, weak, wrong -- held at the SAME gamma_above (0.0) so the
#                  three are comparable on that axis and differ only in the leverage
#                  term l(E), which is where rho is most likely to reorder: rho decides
#                  which part of the expertise distribution l gets weighted by
#   structure.1    aiLevelFraction x M — the structure set's central AI axis crossed with
#                  institution count, which reshapes the expertise distribution rho then
#                  reweights; tests whether rho matters when the population capability
#                  sums over changes shape, not just when the AI parameters do
#   recruitment.4  recruitmentFraction x aiLevelFraction — the recruitment set's AI axis
#                  crossed with freeze depth, so headcount itself is shrinking; tests
#                  whether rho's low end (headcount-like) and high end (top-tail-only)
#                  diverge differently once the field is losing people outright
#
# "path stride" pairs, read below with an explicit IFS split rather than by relying on
# unquoted word-splitting: that idiom is a bash-ism, and under zsh it does not split at
# all, which would silently hand every config an empty stride.
#
# Stride subsamples each grid axis, and the right value depends on the grid: the
# worldmodel and structure pairings run 20-21 values per axis, where a stride of 4 still
# leaves 30-40 cells, while the ACL grids are only 6x3 and a stride above 1 would collapse
# them to a handful of points that cannot resolve a crossover at all.
CONFIGS="\
data/experiments/experiment.25.json 4
data/experiments/experiment.16.json 4
data/experiments/experiment.1.json 4
data/experiments-acl/acl.2.json 1
data/experiments-acl/acl.7.json 1
data/experiments-acl/acl.12.json 1
data/experiments-structure/structure.1.json 4
data/experiments-recruitment/recruitment.4.json 4"

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
