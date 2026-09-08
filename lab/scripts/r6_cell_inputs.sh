#!/usr/bin/env bash
# Which fixture and trace each R6 cell is defined by, as a CHECK rather than a comment.
# Both directions: a cell without special needs requires the defaults, explicitly.
# Why it is a hard stop: docs/why-these-changes.md §6 and §7.
# Source this, then call r6_require_cell_inputs BEFORE anything is uploaded or started.

R6_DEFAULT_FIXTURE="frames_500x64k"
R6_DEFAULT_TRACE="radiologist_review_500"

# Fixture this cell is defined by.
r6_cell_fixture() {
  case "$1" in
    X3L) echo "frames_500x250k" ;;
    *)   echo "$R6_DEFAULT_FIXTURE" ;;
  esac
}

# Trace basename (without .json) this cell is defined by.
r6_cell_trace() {
  case "$1" in
    X3S) echo "r6_scrub_500" ;;
    *)   echo "$R6_DEFAULT_TRACE" ;;
  esac
}

# Refuse to run unless CELLS, FIXTURE and TRACE agree. Exits 2: the rows would look fine.
r6_require_cell_inputs() {
  if [[ "${R6_ALLOW_NONSTANDARD_INPUTS:-0}" == "1" ]]; then
    echo "WARNING: R6_ALLOW_NONSTANDARD_INPUTS=1 — cell/fixture/trace agreement not checked." >&2
    echo "  Rows from this run are exploratory. Say so wherever they are reported." >&2
    return 0
  fi

  local cell want_fix want_tr
  local fix_cell="" fix_want="" tr_cell="" tr_want=""
  local have_fix have_tr
  have_fix="${FIXTURE:-unset}"
  have_tr="$(basename "${TRACE:-unset}" .json)"

  for cell in $CELLS; do
    want_fix="$(r6_cell_fixture "$cell")"
    want_tr="$(r6_cell_trace "$cell")"

    # Cells in one invocation must agree with each other: the fixture is uploaded once,
    # before the cell loop, and the trace is read once.
    if [[ -n "$fix_want" && "$fix_want" != "$want_fix" ]]; then
      echo "REFUSING: cells $fix_cell and $cell are defined by different fixtures" >&2
      echo "  ($fix_want vs $want_fix), and FIXTURE is set once per invocation." >&2
      echo "  Run them as separate invocations." >&2
      exit 2
    fi
    if [[ -n "$tr_want" && "$tr_want" != "$want_tr" ]]; then
      echo "REFUSING: cells $tr_cell and $cell are defined by different traces" >&2
      echo "  ($tr_want vs $want_tr), and TRACE is set once per invocation." >&2
      echo "  Run them as separate invocations." >&2
      exit 2
    fi
    fix_want="$want_fix"; fix_cell="$cell"
    tr_want="$want_tr";  tr_cell="$cell"
  done

  # ...and they must agree with what was actually passed, in both directions: a cell that
  # needs a special input must get it, and a cell that does not must not be handed one.
  if [[ "$have_fix" != "$fix_want" ]]; then
    echo "REFUSING: cell $fix_cell is defined by FIXTURE=$fix_want, got '$have_fix'." >&2
    if [[ "$fix_want" == "$R6_DEFAULT_FIXTURE" ]]; then
      echo "  $fix_cell is a default-fixture cell. Running it on '$have_fix' measures a" >&2
      echo "  different cell and records it under $fix_cell's name — if you meant the" >&2
      echo "  250 KB cell, that cell is X3L." >&2
    else
      echo "  $fix_cell exists to vary frame size. On any other fixture it measures" >&2
      echo "  nothing, and the rows it emits would look admissible." >&2
    fi
    echo "  Re-run with FIXTURE=$fix_want, or set R6_ALLOW_NONSTANDARD_INPUTS=1 to" >&2
    echo "  declare this an exploratory run." >&2
    exit 2
  fi

  if [[ "$have_tr" != "$tr_want" ]]; then
    echo "REFUSING: cell $tr_cell is defined by TRACE=.../$tr_want.json, got '$have_tr'." >&2
    if [[ "$tr_want" == "$R6_DEFAULT_TRACE" ]]; then
      echo "  $tr_cell is a jump-trace cell. Under a different trace it strands by a" >&2
      echo "  different mechanism and is a different cell — if you meant the scroll" >&2
      echo "  variant, that cell is X3S." >&2
    else
      echo "  $tr_cell exists to vary the reading pattern; on the jump trace it is" >&2
      echo "  simply cell X3 run again under a different name." >&2
    fi
    echo "  Re-run with TRACE=\$ROOT/lab/traces/$tr_want.json, or set" >&2
    echo "  R6_ALLOW_NONSTANDARD_INPUTS=1 to declare this an exploratory run." >&2
    exit 2
  fi
}
