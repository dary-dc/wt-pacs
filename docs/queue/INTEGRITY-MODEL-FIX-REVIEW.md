state: done
started: 2026-11-22T18:46Z
heartbeat: 2026-11-22T18:50Z
outputs: PR 429's body §Re-review; `claude/integrity-model` `aa0e6b909` (`docs/lines/client.md`)
## Resume
Done. Nothing to continue. Next: INTEGRITY-PAGE (its needs now met: this re-review with no blocker open, I2-RUN done).
No row appended; nothing scheduled.
## Result
Read only, of `claude/integrity-model` `9278dc84b..39d8a8837`; code at `origin/claude/unified` `4a2b4277f` and
`origin/claude/oq-integrity-build` `a59aa4310`, not run. Docs only: `check_links.py` 0 unresolved, comment budget ok,
the gate not run. No fixture used; the numbers quoted are earlier rows' (4-core x86 cloud hosts, no GPU, SwiftShader;
four HTJ2K series, three DBT volumes of one dataset; no phone, no hardware decoder, no US cine).
* B1 closed: the refused-frame re-ask traced on both refs (take/refused -> store.failed -> next want sent; a fill
  frame's failure via client/transport/consumer.js onError, wired in view-worker.js and viewer.js); §1, §5, §6, §8
  cell 12, §9 match the code.
* m1-m11 closed at their lines. EuroSys'11 re-fetched (sha256 matches its pin; Fig. 2 1 in 2700 / 1 in 1700) and
  WebCodecs §7.9 re-fetched, verbatim; ADR l. 419, 580-583, 657-658 verbatim.
* Two nits, no blocker: bare `consumer.js`/`downloader.js` paths (client/transport/); §1 item 3's "for a phone".
Owner: nothing new beyond the model's §9.
