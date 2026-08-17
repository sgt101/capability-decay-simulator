#!/usr/bin/env bash
# Runs every data/experiments/experiment.N.json through src/batch_run.js and
# writes each one's three CSVs into results/experiment.N/.
#
# Lives in src/ but operates on the REPO ROOT: it cd's one level up, so the paths
# below read the same as the layout does.
#
# Usage:
#   ./run_experiments.sh                    # all experiment.*.json
#   ./run_experiments.sh 3 7 12             # just experiments 3, 7, and 12
#   ./run_experiments.sh --workers 14       # all, with 14 worker threads
#   ./run_experiments.sh --workers 14 3 7   # both together, any order
#   ./run_experiments.sh --redo             # re-run even already-completed ones
#
# RESUME: by default an experiment is SKIPPED if its results_shortfall.csv
# already exists. That file is written last, and batch_run.js writes via
# temp-file + atomic rename, so its presence means all three CSVs for that
# experiment completed. An interrupted run can therefore just be restarted with
# the same command and it picks up where it stopped.
#
# Resume is per EXPERIMENT, not per run: batch_run.js buffers a whole experiment
# in memory and writes at the end, so interrupting mid-experiment loses that
# experiment's work (up to ~6.5 CPU-hours for the world-model set) and it will be
# redone from the start. Nothing before it is lost.
set -eo pipefail
# (not nounset: this script expands several possibly-empty bash arrays —
# ARGS/NUMS/WORKER_ARGS — and pre-4.4 bash, notably macOS's stock bash 3.2,
# treats "${empty_array[@]}" as an unbound-variable error under set -u.)
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORKERS=""
REDO=0
ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --workers) WORKERS="$2"; shift 2 ;;
    --redo) REDO=1; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]}"

if [ "$#" -gt 0 ]; then
  NUMS=("$@")
else
  NUMS=()
  for f in data/experiments/experiment.*.json; do
    [ -e "$f" ] || continue
    n="${f#data/experiments/experiment.}"; n="${n%.json}"
    NUMS+=("$n")
  done
  IFS=$'\n' NUMS=($(sort -n <<<"${NUMS[*]}")); unset IFS
fi

WORKER_ARGS=()
[ -n "$WORKERS" ] && WORKER_ARGS=(--workers "$WORKERS")

mkdir -p results
SKIPPED=0
DONE=0
for n in "${NUMS[@]}"; do
  cfg="data/experiments/experiment.${n}.json"
  if [ ! -f "$cfg" ]; then
    echo "skip: $cfg not found" >&2
    continue
  fi
  outdir="results/experiment.${n}"
  # results_shortfall.csv is written last, atomically — its presence means this
  # experiment finished completely.
  if [ "$REDO" -eq 0 ] && [ -f "${outdir}/results_shortfall.csv" ]; then
    echo "=== experiment.${n}: already complete, skipping (--redo to force) ==="
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  mkdir -p "$outdir"
  # Clear any .part files left by a previous interrupt, so a failed rename can't
  # leave stale fragments lying around.
  rm -f "${outdir}"/*.part
  echo "=== ${cfg} -> ${outdir}/ ==="
  node src/batch_run.js --config "$cfg" "${WORKER_ARGS[@]}" \
    --out "${outdir}/results.csv" \
    --summary-out "${outdir}/results_summary.csv" \
    --shortfall-out "${outdir}/results_shortfall.csv"
  DONE=$((DONE + 1))
done
echo "done: ${DONE} run, ${SKIPPED} skipped as already complete — results in ./results/experiment.<n>/"
