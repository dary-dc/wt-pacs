#!/usr/bin/env bash
# Which R6 cells need a fixture or trace other than the default — as a CHECK, not a comment.
#
# `FIXTURE` and `TRACE` are chosen once per invocation, but two cells are *defined* by
# varying one of them:
#
#   X3L  is X3 at 250 KB frames   -> needs FIXTURE=frames_500x250k
#   X3S  is X3 under the scroll trace -> needs TRACE=.../r6_scrub_500.json
#
# Until this file existed, nothing enforced that. `r6_campaign.sh` carried the requirement
# in prose — `# Requires FIXTURE=frames_500x250k` — and `r6_campaign_cloud.sh` did not
# carry it at all. So `CELLS="X3L" r6_campaign_cloud.sh 3` ran to completion against the
# 64 KB fixture, emitted nine admissible-looking rows, and measured the one thing X3L
# exists to vary. Nothing downstream could catch it: the TSV has no frame-size column, the
# verdicts would all read ADM, and the p95 values would look plausible.
#
# That is the failure this project has already made five times in different costumes
# (`docs/HANDOFF.md` §5): **the rig quietly removes the condition under test.** A guard
# that is a comment is not a guard.
#
# Sourced by `r6_campaign.sh` and `r6_campaign_cloud.sh`. Call `r6_require_cell_inputs`
# after FIXTURE/TRACE/CELLS are set and *before* anything is uploaded or started.

# Fixture a cell requires, or empty for the default.
r6_cell_fixture() {
  case "$1" in
    X3L) echo "frames_500x250k" ;;
    *)   echo "" ;;
  esac
}

# Trace basename (without .json) a cell requires, or empty for the default.
r6_cell_trace() {
  case "$1" in
    X3S) echo "r6_scrub_500" ;;
    *)   echo "" ;;
  esac
}

# r6_require_cell_inputs — refuse to run if CELLS and FIXTURE/TRACE disagree.
#
# Reads CELLS, FIXTURE, TRACE from the environment. Exits 2 on mismatch: a hard stop, not
# a warning, because the whole point is that the resulting rows would look fine.
r6_require_cell_inputs() {
  local cell want_fix want_tr
  local need_fix="" need_fix_cell="" need_tr="" need_tr_cell=""
  local plain_cells=""

  for cell in $CELLS; do
    want_fix="$(r6_cell_fixture "$cell")"
    want_tr="$(r6_cell_trace "$cell")"

    if [[ -n "$want_fix" ]]; then
      if [[ -n "$need_fix" && "$need_fix" != "$want_fix" ]]; then
        echo "REFUSING: cells $need_fix_cell and $cell need different fixtures" >&2
        echo "  ($need_fix vs $want_fix), and FIXTURE is set once per invocation." >&2
        echo "  Run them as separate invocations." >&2
        exit 2
      fi
      need_fix="$want_fix"; need_fix_cell="$cell"
    else
      plain_cells="$plain_cells $cell"
    fi

    if [[ -n "$want_tr" ]]; then
      if [[ -n "$need_tr" && "$need_tr" != "$want_tr" ]]; then
        echo "REFUSING: cells $need_tr_cell and $cell need different traces" >&2
        echo "  ($need_tr vs $want_tr), and TRACE is set once per invocation." >&2
        echo "  Run them as separate invocations." >&2
        exit 2
      fi
      need_tr="$want_tr"; need_tr_cell="$cell"
    fi
  done

  # A cell that needs a non-default fixture cannot share an invocation with one that
  # needs the default: the fixture is uploaded once, before the cell loop.
  if [[ -n "$need_fix" && -n "${plain_cells// /}" ]]; then
    echo "REFUSING: cell $need_fix_cell needs FIXTURE=$need_fix, but this run also" >&2
    echo "  includes${plain_cells} — cells that use the default fixture. One fixture" >&2
    echo "  is uploaded per invocation, so one side would silently run on the wrong" >&2
    echo "  frame size. Run them as separate invocations." >&2
    exit 2
  fi

  if [[ -n "$need_fix" && "${FIXTURE:-}" != "$need_fix" ]]; then
    echo "REFUSING: cell $need_fix_cell requires FIXTURE=$need_fix, got '${FIXTURE:-unset}'." >&2
    echo "  $need_fix_cell exists to vary frame size. On any other fixture it measures" >&2
    echo "  nothing, and the rows it emits would look admissible." >&2
    echo "  Re-run with: FIXTURE=$need_fix ..." >&2
    exit 2
  fi

  if [[ -n "$need_tr" && "$(basename "${TRACE:-}" .json)" != "$need_tr" ]]; then
    echo "REFUSING: cell $need_tr_cell requires TRACE=.../$need_tr.json," >&2
    echo "  got '$(basename "${TRACE:-unset}" .json)'." >&2
    echo "  $need_tr_cell exists to vary the reading pattern; on the jump trace it is" >&2
    echo "  simply cell X3 run again under a different name." >&2
    echo "  Re-run with: TRACE=\$ROOT/lab/traces/$need_tr.json ..." >&2
    exit 2
  fi
}
