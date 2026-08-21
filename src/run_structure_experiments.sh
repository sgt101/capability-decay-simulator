#!/usr/bin/env bash
# Runs every data/experiments-structure/structure.N.json through src/batch_run.js and
# writes each one's three CSVs into results/structure.N/.
#
# The sibling of run_experiments.sh, kept separate rather than parameterised: the two
# sets have different config directories, different file-name stems and different
# results directories, and folding them into one script would mean three arguments
# every invocation to say which study you meant.
#
# Lives in src/ but operates on the REPO ROOT: it cd's one level up, so the paths
# below read the same as the layout does.
#
# Usage:
#   ./run_structure_experiments.sh                 # all structure.*.json
#   ./run_structure_experiments.sh 1 3 9           # just those numbers
#   ./run_structure_experiments.sh --workers 14    # all, with 14 worker threads
#   ./run_structure_experiments.sh --redo          # re-run even completed ones
#
# RESUME: an experiment is SKIPPED if its results_shortfall.csv already exists. That
# file is written last, and batch_run.js writes via temp-file + atomic rename, so its
# presence means all three CSVs completed. Interrupt and restart with the same command.
#
# Resume is per EXPERIMENT, not per run: batch_run.js buffers a whole experiment in
# memory and writes at the end, so interrupting mid-experiment loses that experiment's
# work and it is redone from the start. Nothing before it is lost.
set -eo pipefail
# (not nounset: this script expands possibly-empty bash arrays, and pre-4.4 bash —
# notably macOS's stock 3.2 — treats "${empty_array[@]}" as an unbound-variable error.)
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CFG_DIR="data/experiments-structure"
STEM="structure"

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

if [ ! -d "$CFG_DIR" ]; then
  echo "no $CFG_DIR — generate it first: node src/generate_structure_experiments.js" >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  NUMS=("$@")
else
  NUMS=()
  for f in "${CFG_DIR}/${STEM}."*.json; do
    [ -e "$f" ] || continue
    n="${f#${CFG_DIR}/${STEM}.}"; n="${n%.json}"
    NUMS+=("$n")
  done
  if [ "${#NUMS[@]}" -eq 0 ]; then
    echo "no ${STEM}.*.json in $CFG_DIR — generate it first: node src/generate_structure_experiments.js" >&2
    exit 1
  fi
  IFS=$'\n' NUMS=($(sort -n <<<"${NUMS[*]}")); unset IFS
fi

WORKER_ARGS=()
[ -n "$WORKERS" ] && WORKER_ARGS=(--workers "$WORKERS")

mkdir -p results
SKIPPED=0
DONE=0
for n in "${NUMS[@]}"; do
  cfg="${CFG_DIR}/${STEM}.${n}.json"
  if [ ! -f "$cfg" ]; then
    echo "skip: $cfg not found" >&2
    continue
  fi
  outdir="results/${STEM}.${n}"
  if [ "$REDO" -eq 0 ] && [ -f "${outdir}/results_shortfall.csv" ]; then
    echo "=== ${STEM}.${n}: already complete, skipping (--redo to force) ==="
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  mkdir -p "$outdir"
  # Clear .part files left by a previous interrupt, so a failed rename can't leave
  # stale fragments behind.
  rm -f "${outdir}"/*.part
  echo "=== ${cfg} -> ${outdir}/ ==="
  node src/batch_run.js --config "$cfg" "${WORKER_ARGS[@]}" \
    --out "${outdir}/results.csv" \
    --summary-out "${outdir}/results_summary.csv" \
    --shortfall-out "${outdir}/results_shortfall.csv"
  DONE=$((DONE + 1))
done
echo "done: ${DONE} run, ${SKIPPED} skipped as already complete — results in ./results/${STEM}.<n>/"
