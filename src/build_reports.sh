#!/usr/bin/env bash
# Rebuilds every report browser under doc/ from whatever is in results/.
#
#   ./src/build_reports.sh                 # every set that has results
#   ./src/build_reports.sh --published     # rewrite links for the Pages layout
#
# WHY REBUILD. The reports are single self-contained HTML files: report.template.html is
# baked into each one at build time, so a change to the template -- a new button, a new
# axis label, a corrected metric -- reaches a page only when that page is rebuilt. An old
# doc/report.html keeps whatever template it was built with, indefinitely and silently.
#
# The sets are OPTIONAL. Each is built from results/ (2.1 GB of CSV that is not in the
# repository), so a fresh clone legitimately has none of them. A set with no results is
# reported and skipped, not treated as a failure -- otherwise a clone could never run
# this at all.
set -uo pipefail
cd "$(dirname "$0")/.."

# The published Pages layout puts the simulator at the site root; on disk it is ../src/.
# build_report.js defaults to the on-disk form because that is how these pages are opened
# most of the time. build_pages.js rewrites the value when it copies them, so this flag is
# only for building a set of pages that will be served from the site root directly.
SIM_ARGS=()
if [ "${1:-}" = "--published" ]; then SIM_ARGS=(--simulator-href simulator.html); fi

built=0
skipped=0
failed=0

# "builder-script  label". Each builder already knows its own manifest, stem, output name
# and metric set, and already fails helpfully when its results are absent -- so this loop
# stays a list of names rather than a table of flags that would drift from the builders.
BUILDERS="\
src/build_report.js|AI parameter sweeps|--metrics all --out report.html
src/build_acl_report.js|assisted-learning scenarios|
src/build_structure_report.js|structure sweeps|
src/build_recruitment_report.js|recruitment shock|
src/build_entrant_report.js|entrant expertise|"

while IFS='|' read -r script label extra; do
  [ -z "$script" ] && continue
  if [ ! -f "$script" ]; then
    echo "  skipping $label — $script is missing" >&2
    skipped=$((skipped + 1))
    continue
  fi
  echo
  echo "=== $label ==="
  # shellcheck disable=SC2086 -- $extra is a deliberate word-split of fixed flags
  if node "$script" $extra "${SIM_ARGS[@]+"${SIM_ARGS[@]}"}"; then
    built=$((built + 1))
  else
    # A builder exits non-zero both when its results are absent (normal on a fresh clone,
    # and it says so) and when it actually breaks. Counted separately from a missing
    # script so the summary below cannot report success for a run that built nothing.
    echo "  -> not built (see the message above)" >&2
    failed=$((failed + 1))
  fi
done <<EOF
$BUILDERS
EOF

echo
echo "built $built report(s); $failed not built; $skipped builder(s) missing"
if [ "$built" = "0" ]; then
  echo "nothing was rebuilt — the pages under doc/ still carry their previous template." >&2
  exit 1
fi
# cell-index.js is SHARED: every builder rewrites data/cell-index.{js,json} with its own
# set's codes, so only the last one to run is resolvable from the simulator afterwards.
# Said out loud because the file is committed and the churn looks like an unrelated diff.
echo "note: data/cell-index.js now holds the codes of the LAST set built."
echo "next: node src/build_pages.js   (assembles site/ for GitHub Pages)"
