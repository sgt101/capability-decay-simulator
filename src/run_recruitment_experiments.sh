#!/usr/bin/env bash
# Runs the recruitment-shock set: what a hiring freeze does to a field already at
# equilibrium, and how that interacts with each AI dial.
#
#   ./src/run_recruitment_experiments.sh              # all four -- run count depends on\n#                                                      # how the configs were generated (see\n#                                                      # --replicates in the generator)
#   ./src/run_recruitment_experiments.sh 3            # just recruitment.3
#
# Generate the configs first if they are not present -- timing (when the freeze lands,
# how long the run continues afterward) is a flag to that script, not to this one:
#   node src/generate_recruitment_experiments.js
#   node src/generate_recruitment_experiments.js --shock-start-years 120 --aftermath-years 100
#
# Runs are LONGER than the other sets regardless of the chosen timing, because the freeze
# has to land on a field that has already reached equilibrium and then run long enough
# afterward to be worth reading. Expect this to take substantially longer per run than the
# other sets; how much longer depends on the horizon the configs were generated with.
#
# WHICH METRIC. Not meanE: a freeze removes ENTRANTS, the least expert people in the
# field, so mean expertise per surviving person barely moves and can rise. Read
# systemCapability (an absolute sum over people) against activeFraction (how much of the
# establishment is still staffed). Capability falling no faster than headcount is a
# smaller field doing proportionally the same work; capability falling faster is a field
# that has lost its ladder as well as its people.
set -euo pipefail
cd "$(dirname "$0")/.."

# Flags, not bare positionals. This used to read $1 as an experiment number, so
# `--workers 16` was taken as the number, matched nothing, and the script skipped every
# config and then reported success. An unmatched selection is now an error, and the count
# of experiments actually run is printed at the end -- a runner that does nothing must not
# look like a runner that did everything.
WORKERS=""
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --workers) WORKERS="$2"; shift 2 ;;
    --workers=*) WORKERS="${1#*=}"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; echo "usage: $0 [--workers N] [EXPERIMENT_NUMBER]" >&2; exit 2 ;;
    *) ONLY="$1"; shift ;;
  esac
done

# Expanded with the ${arr[@]+"${arr[@]}"} guard everywhere below, not as a bare
# "${WORKER_ARGS[@]}". Bash 3.2 -- still /bin/bash on macOS -- treats an EMPTY array as
# unset under `set -u` and aborts with "WORKER_ARGS[@]: unbound variable". The bug was
# fixed in bash 4.4, so this only ever fails for someone running the default system shell,
# and only when --workers is omitted.
WORKER_ARGS=()
[ -n "$WORKERS" ] && WORKER_ARGS=(--workers "$WORKERS")

CONFIG_DIR=data/experiments-recruitment

if [ ! -d "$CONFIG_DIR" ]; then
  echo "no $CONFIG_DIR — run: node src/generate_recruitment_experiments.js" >&2
  exit 1
fi

available=$(ls "$CONFIG_DIR"/recruitment.*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$available" = "0" ]; then
  echo "no configs in $CONFIG_DIR — run: node src/generate_recruitment_experiments.js" >&2
  exit 1
fi

ran=0
for cfg in "$CONFIG_DIR"/recruitment.*.json; do
  n=$(basename "$cfg" .json); n=${n#recruitment.}
  if [ -n "$ONLY" ] && [ "$ONLY" != "$n" ]; then continue; fi
  out="results/recruitment.$n"
  mkdir -p "$out"
  echo
  echo "=== recruitment.$n ==="
  node src/batch_run.js --config "$cfg" \
    --out "$out/results.csv" \
    --summary-out "$out/results_summary.csv" \
    ${WORKER_ARGS[@]+"${WORKER_ARGS[@]}"}
  # batch_run writes the paired shortfall CSV to a fixed name in the working directory
  # rather than beside --out. Moved here so each experiment keeps its own.
  if [ -f results_shortfall.csv ]; then mv results_shortfall.csv "$out/results_shortfall.csv"; fi
  ran=$((ran + 1))
done

if [ "$ran" = "0" ]; then
  echo "nothing ran: no experiment matches \"$ONLY\"." >&2
  echo "available: $(ls "$CONFIG_DIR"/recruitment.*.json | sed 's/.*recruitment\.//;s/\.json//' | tr '\\n' ' ')" >&2
  exit 1
fi

echo
echo "done — $ran experiment(s) written under results/recruitment.*/"
echo "read systemCapability and activeFraction together; meanE is the wrong headline here."
echo "then: node src/build_recruitment_report.js"
