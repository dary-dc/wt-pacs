## Fix review (MERGE-B-FIX-REVIEW, 2026-11-16)

A session that wrote neither MERGE-B nor MERGE-B-FIX reviewed `claude/unified` at `e2357b13`. **No blocker. The loop closes.** The logs are in `claude/work-ledger:docs/queue/MERGE-B-FIX-REVIEW/`.

* **The blocker is closed.** `git diff fb864a8f e2357b13` changes two files. In `scripts/gate.sh`, it adds step "lab: row 258's verdict rule" and the filters `with_fill_resumes with_an_ask_stream`, and both match `merge-a-server` `1597e37c60` exactly. The other file is `docs/lines/coordination.md` Open 8. Nothing else changed.
* **Each restored line fails when its code is broken.** These mutants are this review's own, not the fix's (`mut.log`), and each tree was restored afterwards:

  | mutant | result |
  | --- | --- |
  | `exec_gap_summary.py:39`, `med < 0` changed to `med > 0` | the step fails (`a_lower_co_tenant_p99…lands_the_arm`) |
  | `exec_gap_summary.py:39`, `abs(med) <= res` changed to `abs(med) < 0` | the step fails |
  | `server.rs:198`, the session's `fill_resumes` no longer read from the lever | `with_fill_resumes_an_ask_goes_first_and_the_fill_still_completes` fails |
  | `link.rs:74`, the ask stream ignored (`match None::<i32>`) | `with_an_ask_stream_an_ask_is_read_past_the_unread_fill` fails |

  The gate's lab-levers line runs 12 tests unmutated (11 + 1), as the fix says.
* **The body's corrections are in place:** B2's "adds no step the tip lacks", and item 3's `link/tests.rs`.
* **The full gate at `e2357b13`: OK in 584 s, 58 steps.** The recap's one skip is the viewer's cross-codec arm and Firefox, the same as the fix's `gate.log`. It ran after README's cloud lines: wasm-pack 0.15.0, the decoders, the transport clients, `ingest/tools.sh`, the `.venv` from `ingest/requirements.txt`, and lavapipe, Xvfb, xdotool and nginx.
* **Earlier runs, kept as logs:**
  * gate-0 and gate-1 stopped before their checks. The transport WASM was not yet built for gate-0, and the venv was missing for gate-1.
  * gate-2 was OK in 736 s, with 4 skips. The extra 3 were host packages that were not yet installed.
* **Not run again:** `demo-check.mjs` and the deploy images. This fix touches only the gate.

**Fixtures and limits.** The gate used the repository's committed fixtures. The host was one 4-core cloud host with no GPU, headless Chromium (Playwright 1.63.0) and no Firefox.
