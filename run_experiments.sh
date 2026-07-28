#!/usr/bin/env bash
# Runs every experiments/experiment.N.json through batch_run.js and
# writes each one's three CSVs into results/experiment.N/.
#
# Usage:
#   ./run_experiments.sh                    # all experiment.*.json
#   ./run_experiments.sh 3 7 12             # just experiments 3, 7, and 12
#   ./run_experiments.sh --workers 14       # all, with 14 worker threads
#   ./run_experiments.sh --workers 14 3 7   # both together, any order
set -eo pipefail
# (not nounset: this script expands several possibly-empty bash arrays —
# ARGS/NUMS/WORKER_ARGS — and pre-4.4 bash, notably macOS's stock bash 3.2,
# treats "${empty_array[@]}" as an unbound-variable error under set -u.)
cd "$(dirname "${BASH_SOURCE[0]}")"

WORKERS=""
ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --workers) WORKERS="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]}"

if [ "$#" -gt 0 ]; then
  NUMS=("$@")
else
  NUMS=()
  for f in experiments/experiment.*.json; do
    [ -e "$f" ] || continue
    n="${f#experiments/experiment.}"; n="${n%.json}"
    NUMS+=("$n")
  done
  IFS=$'\n' NUMS=($(sort -n <<<"${NUMS[*]}")); unset IFS
fi

WORKER_ARGS=()
[ -n "$WORKERS" ] && WORKER_ARGS=(--workers "$WORKERS")

mkdir -p results
for n in "${NUMS[@]}"; do
  cfg="experiments/experiment.${n}.json"
  if [ ! -f "$cfg" ]; then
    echo "skip: $cfg not found" >&2
    continue
  fi
  outdir="results/experiment.${n}"
  mkdir -p "$outdir"
  echo "=== experiments/experiment.${n}.json -> ${outdir}/ ==="
  node batch_run.js --config "$cfg" "${WORKER_ARGS[@]}" \
    --out "${outdir}/results.csv" \
    --summary-out "${outdir}/results_summary.csv" \
    --shortfall-out "${outdir}/results_shortfall.csv"
done
echo "done: results in ./results/experiment.<n>/"
