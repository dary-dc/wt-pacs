state: done (one blocker open; amendment 17 rows FAILED-FRAME-WITHHELD-FIX and -FIX-REVIEW appended)
started: 2026-11-23T10:27Z
heartbeat: 2026-11-23T10:51Z
outputs: PR 438 body §FAILED-FRAME-WITHHELD-REVIEW (reviewed at c319d4035); rows f777042ac here
## Resume
Done. Next: FAILED-FRAME-WITHHELD-FIX (a session that wrote neither PR 438 nor this review), then its re-review.
The line doc (claude/failed-frame-withheld docs/lines/client.md) was not updated: this row's output is the PR body,
and a push to the PR's branch was refused in this session. The fix row updates it.
## Result
* Holding: the three new tests fail on the merge base's code (37/40); six hand mutants (want filter, #paintable,
  refused's repaint, paint(null), the withheld emit, withhold undone) each killed; RESULTS-BRIEF §8.1 closed for
  refusals; the on-demand cancel cannot withhold.
* B1: downloader.js resume() fails every wanted frame and wire record after 5 failed re-dials ("could not be
  re-dialled"), never asked on any session; the controller now withholds them all for the session, though
  design.md §Decided owes a lost ask (its own re-dial failed) one more ask. *derived*, read in code: an outage over
  ~5-30 s blanks every frame not yet arrived until reload. PR body's "already re-asked" false for resume().
* m1: the browser-side null paint (paint-worker, Painter, view-worker, viewer handler) untested; m2: README and
  store.js comment repeat the claim; n1, n2.
* Gate --quick at c319d4035 green, skips named in the PR body; check_lab_absent and the client telemetry absence
  check green by hand; links 0 unresolved; budget ok. Playwright 1.56.1's browser builds linked to the container's.
* Fixtures: node unit tests (recording paint, fake client), one scratch script; no browser run of a withheld frame.
* Owner: none now; PR 438 does not merge until the re-review finds no blocker open.
