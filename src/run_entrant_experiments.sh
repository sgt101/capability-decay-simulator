#!/usr/bin/env bash
# Runs the entrant-expertise set: the distribution new arrivals are drawn from, crossed
# with the two AI dials that act on them.
#
#   ./src/run_entrant_experiments.sh                  # all six
#   ./src/run_entrant_experiments.sh --workers 16     # ... with 16 worker threads
#   ./src/run_entrant_experiments.sh 3                # just entrant.3
#   ./src/run_entrant_experiments.sh --redo 3         # re-run it even if results exist
#
# Generate the configs first if they are not present:
#   node src/generate_entrant_experiments.js
#
# 6 experiments x 121 cells x 3 replicates x 2 arms = 4,356 runs at horizon 1440.
#
# Completed experiments are SKIPPED by default, so an interrupted run can be restarted
# without repeating what it already finished. --redo forces one.
set -uo pipefail
cd "$(dirname "$0")/.."

# Flags parsed properly rather than read off $1: a bare positional is the experiment
# number, so `--workers 16` taken as one would match nothing and skip everything while
# still reporting success. See run_recruitment_experiments.sh, where that happened.
WORKERS=""
ONLY=""
REDO=0
while [ $# -gt 0 ]; do
  case "$1" in
    --workers) WORKERS="$2"; shift 2 ;;
    --workers=*) WORKERS="${1#*=}"; shift ;;
    --redo) REDO=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; echo "usage: $0 [--workers N] [--redo] [EXPERIMENT_NUMBER]" >&2; exit 2 ;;
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

CONFIG_DIR=data/experiments-entrant
if [ ! -d "$CONFIG_DIR" ] || [ -z "$(ls "$CONFIG_DIR"/entrant.*.json 2>/dev/null)" ]; then
  echo "no configs in $CONFIG_DIR — run: node src/generate_entrant_experiments.js" >&2
  exit 1
fi

ran=0
skipped=0
matched=0
for cfg in "$CONFIG_DIR"/entrant.*.json; do
  n=$(basename "$cfg" .json); n=${n#entrant.}
  if [ -n "$ONLY" ] && [ "$ONLY" != "$n" ]; then continue; fi
  matched=$((matched + 1))
  out="results/entrant.$n"
  if [ "$REDO" = "0" ] && [ -f "$out/results_shortfall.csv" ]; then
    echo "=== entrant.$n — already done, skipping (--redo to force) ==="
    skipped=$((skipped + 1))
    continue
  fi
  mkdir -p "$out"
  echo
  echo "=== entrant.$n ==="
  node src/batch_run.js --config "$cfg" \
    --out "$out/results.csv" \
    --summary-out "$out/results_summary.csv" \
    ${WORKER_ARGS[@]+"${WORKER_ARGS[@]}"} || { echo "  -> entrant.$n FAILED" >&2; continue; }
  # batch_run writes the paired shortfall CSV to a fixed name in the working directory
  # rather than beside --out, so two sets must never be run concurrently from this repo.
  # Moved here so each experiment keeps its own.
  if [ -f results_shortfall.csv ]; then mv results_shortfall.csv "$out/results_shortfall.csv"; fi
  ran=$((ran + 1))
done

if [ "$matched" = "0" ]; then
  echo "nothing ran: no experiment matches \"$ONLY\"." >&2
  echo "available: $(ls "$CONFIG_DIR"/entrant.*.json | sed 's/.*entrant\.//;s/\.json//' | tr '\n' ' ')" >&2
  exit 1
fi

echo
echo "done — $ran run, $skipped already complete, under results/entrant.*/"
echo "next: node src/build_entrant_report.js"
