# Client transports

| Path | Role |
|------|------|
| `client/transport-wasm/` | Rust WASM via `web_sys::WebTransport` |
| `client/transport-ts/` | TypeScript / browser ESM (`session.ts` + `wire.ts`; `build.sh` → gitignored `dist/`) |

Same Media-complete wire as the server: FoD on one bidi control stream, envelope payloads on server uni streams.

`client/conformance/` runs the surface's clauses against both, in Node with no browser;
`docs/proposal-conformance-suite.md` says how.

## A closed session is noticed at once

A request against a session the server had already closed used to wait the full
`FRAME_TIMEOUT_MS` (15 s) before failing. **Both implementations did this**, not only the WASM one
— the brief for this work named one, and the first thing the conformance harness showed was that
the TypeScript client behaved identically.

It stops being a benchmark annoyance in the product: the session is opened when the user picks a
series and used when the viewer mounts, perhaps minutes later, so a session that died in the gap is
the normal path rather than a corner case.

**The shape.** A session has one piece of new state — the reason it is gone, unset while it is
alive — and two things set it:

* the session object's own `closed`, watched from `connect()`; and
* the media stream ending, which the TS client already noticed and used to report on its own.

Whichever arrives first wins and the other is a no-op, because they are the same event seen twice.
Setting it fails every armed waiter with that reason, so a request in flight wakes at once. A
request arriving *after* it is set fails without arming a waiter at all — that is the product case,
and without it the fix only helps sessions that were already waiting.

`FRAME_TIMEOUT_MS` keeps the job it exists for: a frame that never arrives on a session that is
still alive. That path is untouched and still takes the full 15 s.

**Measured**, on the conformance fake (container, but these are wall-clock gaps of milliseconds
against seconds, not a timing claim):

| | before | after |
| --- | --- | --- |
| request against an already-closed session | 15.01 s | **0.8 ms** |
| request in flight when the close lands | 15.01 s | woken within the test's 30 ms settle |
| frame never arrives, session alive | 15.01 s | 15.01 s, unchanged |

Both arms, same numbers. Four clauses now run against both implementations; three mutants were run
against the new one and all three failed as they should — dropping the `closed` watch, dropping the
fast-fail, and dropping the WASM guard and its waiter clearing — with the control clean.

**Two things this turned up.**

`close()` on the WASM handle took `self` by value, so wasm-bindgen tried to take ownership of a
handle that an in-flight `&self` request still borrowed, and threw *"attempted to take ownership of
Rust value while it was borrowed"*. Closing a session mid-fill is ordinary — the user navigates
away — and the TS client's `close()` does not consume. It now takes `&self`, which is what makes
the two implementations agree.

A cancelled fill still leaves its waiters armed until `FRAME_TIMEOUT_MS`; `endStream()` stops the
server sending but settles nothing on the client. Nothing here fixes that — it needs a decision
about what a cancelled waiter should reject with — and the conformance suite tolerates the stray
rejections rather than pretending they are not there.
