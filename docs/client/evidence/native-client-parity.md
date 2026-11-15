# The native client's parity with the browser core

**Question:** Which of the browser core's functions does the native window have, each proved by a test, and where
does it depart?

*Folded 2026-11-14 from `claude/native-parity:docs/native/README.md` §Parity with the browser core and its two
proposals (36a41fd7, 2ae45b73, e3a4fc21, 6a7df309, 02e298ef), word for word but for relative paths. A bare §N is a
section of [`../../native/README.md`](../../native/README.md); the *native design run* is the view-worker design run natively,
pre-registered there and never run. The code and tests named are on that branch (PR #277), not reviewed as product.
Nothing here is timed: each row is a test, not a measurement. The two proposals are for review, nothing built.*


*On `claude/native-parity`. The owner's scope: the "basic" shape (§7, decision 2) and the simple cine
([`core-against-main.md`](core-against-main.md) §The core, assembled) — parity means the browser core's functions, not
a richer viewer. The browser client is unchanged. Nothing here is timed.*

## The table

One row a capability; "browser" is the core as `client/viewer/` and `client/view/` build it, "native" is
`native-window` on every paint thread unless the row says otherwise; the last column is the test that proves the
native side. A row reading *not yet* is open.

| capability | browser | native | proved by |
| --- | --- | --- | --- |
| survive a dead path: no stream byte for `stallMs` while frames are owed, the wait doubled by each stall | `downloader.js` `watch`, 3 s | `resume.rs`, 3 s, on the count of STREAM frames received | `resume::tests::a_slow_frame_is_not_a_stall_and_idle_is_not_silence`, `view::tests::a_silent_path_is_resumed_and_the_fill_completes` |
| re-dial: `tries` 5, `redialMs` 1 s apart, each dial within `dialMs` 5 s; the count reset by a frame | `resume` | `ResumingSession::resume` | `resume::tests::a_session_that_cannot_be_redialled_is_lost_then_dialled_afresh` |
| re-ask what is owed, nothing that arrived | `reaskOwed` | `Asking::resumed`: the owed frames back at the want's head, in the order asked | `view::tests::a_resume_asks_again_for_what_was_owed` |
| every re-dial failed: what is owed fails by name; the next ask dials afresh | `resume`, `live` | `Heard::Lost`, `Asking::lost` | `view::tests::a_lost_session_fails_what_it_owed`, the resume test above |
| end a fill no longer wanted | `cancel` sends `end_stream` | `Wire::End` once the want holds none of the fill's owed frames, and when the view closes | `view::tests::a_fill_the_want_has_left_is_ended`, `view::tests::a_view_that_closes_mid_fill_ends_the_fill` |
| a cache write that fails: the frame is still painted, the failure reported | the cache is a lab lever there (`?writer=`), off by default | `--cache`, every paint thread: `failed scope=cache` printed, and in the title under `ui`; `native-fill` too (#209) | `load::tests::a_cache_that_cannot_write_does_not_stop_the_load` |
| the cache read before the wire, a copy failing its check removed and fetched again | `client/view/cache.js` under `?view=worker` | every paint thread; under `ui` since this branch (`load.rs`) | `load::tests::the_cache_is_read_and_a_flipped_entry_comes_from_the_wire` |
| step: arrows, PageUp/PageDown, the wheel | `viewer.js` `KEYS`, `wheel`; wraps at the ends | the same keys; stops at the ends | `look::tests::each_control_moves_what_the_browsers_moves`; `client/paint/window.mjs` |
| Home, End | first, last frame | the same | `look::tests::each_control_moves_what_the_browsers_moves`; `window.mjs` *End*, *Home* |
| window and level: a primary drag, a window's width per 256 px, from where it was grabbed | `pointermove` | `Intent::Drag` | `look::tests::a_drag_moves_from_where_it_was_grabbed`; `window.mjs` *a drag* |
| pan: a secondary or shift drag, in CSS px | `pointermove` with `pan` | `View::pan_x`, `pan_y` | the drag test; `window.mjs` *a secondary drag pans* |
| zoom: `+`/`=` ×1.25, `-` ×0.8, ctrl+wheel ×1.1 | `zoom` | `View::zoom` | `look::tests::each_control_moves_what_the_browsers_moves`; `window.mjs` *+, zoomed* |
| rotate a quarter turn (`r`), flip (`h`, `v`), invert (`i`) | `pose`, `invert` | `View::rotate`, `flip_h`, `flip_v`, `Display::invert` | the same unit test; `window.mjs`, each paint held to the CPU reference with its pose |
| reset (`0`) | `0`, Escape: fitted, the series' window | `0`: the opening display — 1:1, the series' window — on the same frame | `look::tests::reset_returns_to_the_opening_display_and_keeps_the_frame`; `window.mjs` *0, reset* |
| status: the frame, its check, the last failure | the status line and the NOT EXACT mark | the window's title: `wt-pacs · frame i of n · exact` / `unchecked` / `NOT EXACT…` / `refused: …`, then `· error: frame j: …` | `look::tests::the_title_says_the_frame_its_check_and_the_last_failure`; `window.mjs` *open*, *End*, *Home* read the title |
| cine: Space starts and stops it; one frame forward each period, looping; a late tick not made up | `View.play`, `setInterval` at `1000 / cineFps` | `clock::Play` on the thread that paints, under every paint thread | `clock::tests::the_product_cine_steps_once_a_period_and_does_not_make_up_a_late_tick`; `window.mjs` *Space, a second of cine*: frames forward, wrapping, stopped once paused |
| the cine's period: the series' `frameTimeMs`, else `1000 / cineRate`, else 100 ms | `cineFps` | `Play::period`, from the bundle's metadata | the same unit test |
| the series' metadata from the deployment | `/series/metadata` from the web host | *not yet*: a local `--bundle`; §Proposed: the series' metadata from the server | — |
| held to `client/contract`'s clauses | every client, `scripts/gate.sh` | *not yet*: §Proposed: `client/contract`'s clauses against native | `transport::tests::the_native_client_gets_webtransports_bytes` holds the bytes only |

## Where it departs

* **Silence is counted in STREAM frames, not bytes.** quinn's `ConnectionStats::frame_rx.stream` moves whenever a
  stream frame of any envelope arrives, which is the browser's `lastByteAt` at frame granularity; a 256 KiB frame over
  a relay passing a packet each 10 ms takes several stalls' length and is not condemned.
* **The clock also restarts at each event handed on**, since a full credit window stops the session's readers and
  with them the wire: the downloader's own back-pressure is not silence.
* **`native-fill` stays single-session.** It measures one session's timing; a re-dial would fold two into one row.
  Its loss stays fatal.
* **Under `--paint-thread ui`** the loader (`load.rs`, moved out of the binary to be tested) resumes by the same records
  (`Asking`) and `ResumingSession`: `load::tests::the_ui_loader_survives_a_silent_path`.
* **The `ui` arm changed under `--cache`.** The native design run's N0 wrote the cache and never read it; it now reads it first. Its
  write still comes before the hand-off, as N0's design has it.
* **Controls not taken from the browser, and kept.** F toggles fitted and 1:1 (native's own); Escape closes the window,
  as the lab's runner relies on, so reset is `0` alone. A step stops at the ends, as `window.mjs` has always held it;
  the browser wraps.
* **Not taken:** the browser's status line also counts frames received, exact, not exact and unchecked, names the
  decoders, codec and renderer and the fill's time; the title carries only what the task named. A frame that fails
  its check is never painted natively (the browser paints it under the mark), so its title line reads NOT EXACT over
  the last frame painted. Under `view` and `core` the title changes with each paint or failure, which carries it: a step
  to a frame not yet held shows the new number once that frame is painted. A failed cache write under `view` and
  `core` is printed, not put in the title.
* **Two cines.** The product's (Space) steps from the frame shown, as the browser's does; the lab's `--cine-hz` shows
  the frame due by the clock from the window's opening and counts late frames, for the native design run. Neither drives the other.
* **No recycle.** The browser's recycle before a byte budget (`recycleAtBytes`) is a lab setting there, off by
  default; not built.

## Proposed: the series' metadata from the server (2026-10-30)

*A proposal for review; nothing built. Structural: it changes what `wt-pacs/1` carries.*

**Today.** `native-window` and `native-fill` read the metadata (shape, display, frame digests, version) from a local
`.sbnd` named by `--bundle`. The browser fetches `/series/metadata` over HTTP from the web host (`server/dev-server.py`,
`deploy/nginx`), not from the QUIC server; both read the same bundle the server serves.

**Options.**

1. **Fetch `/series/metadata` from the web host**, as the page does. Same source and bytes as the browser. Costs an
   HTTPS client in the crate (hyper and rustls, or reqwest), a second origin to name and trust (web PKI there, a pinned
   hash on QUIC), and a second round trip before the first ask.
2. **A FoD op, `{"op":"metadata"}`, answered on the control stream.** No new origin. `MAX_FOD_LEN` is 64 KiB; at about
   20 bytes of digest a frame, a series past ~3 000 frames does not fit, so the answer needs its own framing anyway.
3. **On `wt-pacs/1` only, the server sends the metadata at accept, on the first uni stream it opens, before any
   frame:** a 4-byte length and the JSON. The client reads that stream before it reads media. No new op, no round trip,
   no second origin, and the WebTransport path is untouched (§8.5's rule). Every dial pays the bytes, a resume included.
   That is also a gain: a resumed session whose metadata `version` differs from the one held has met a restarted server
   on another series, which the page learns only from its transport file.

**Recommendation: 3.** The server already holds the metadata (`series_bundle::read_layout`); the change is one stream
at accept in `serve_raw`, a reader in `transport::connect`, `WIRE.md` §The raw QUIC mapping and §8.2's table, and
`--bundle` kept as a lab setting for `native-fill`'s byte comparison. *Not measured:* the time to the first frame with
the metadata ahead of it; a `wt-pacs/1` dial today has nothing ahead of it.

**Trust is unchanged.** The digests come from the deployment that serves the frames, under the same pinned
certificate; the browser takes them from the same deployment's web host. A check against digests from the same source
proves the decode, not the source ([`../../adr/exactness-in-production.md`](../../adr/exactness-in-production.md)).

## Proposed: `client/contract`'s clauses against native (2026-10-30)

*A proposal for review; nothing built. Structural: a second rig and a fake server.*

**Today.** The clauses (`client/contract/clauses.ts`) drive a `ConformantSession` — `requestExactFrame`,
`fillFrames`, `endStream`, `stats`, `close` — over a fake WebTransport or WebSocket installed in the Node process, and
steer the fake through a `FakeHandle` (`pushFrame`, `pushOnOneStream`, `pushTruncatedFrame`, `trickleFrame`,
`serverClose`, `controlMessages`, `didClose`, dials counted). Native is Rust over raw QUIC: neither the JS surface nor
the fakes reach it. What holds native to the browser today is
`transport::tests::the_native_client_gets_webtransports_bytes`, against the real server.

**The adapter.**

* **`native-session`**, a test binary: `transport::Session` behind a line protocol on stdin and stdout — each call a
  JSON line, each frame and refusal an event line (the body as a file path, not inline). The Node adapter in
  `adapters.ts` turns it into a `ConformantSession`, as `sessionImpl` does for a bundle.
* **A fake server on `wt-pacs/1`**, Rust, steered over the same kind of line protocol: the `FakeHandle`'s eight
  operations on real QUIC streams, so a truncated envelope, a trickle and a server close are what quinn delivers, not a
  JS model of them.
* **Two rigs.** The session's (`closure: "fail"`) wraps `transport::Session`; the downloader's (`closure: "redial"`)
  wraps `ResumingSession` with `Asking`, which is native's downloader.

**What maps, and what does not.** Mapped: `noticesClose`, `bothStreamModes`, `reportsStats` (`inFlight`; `mediaReads`
is optional), `oneDialServesLaterAsks`, `pushedFill`, `aTruncatedFrameIsAFailure`, `aDeadSessionNamesWhatItOwed`,
`aLaterFailureIsNotTheFillsOne`, `redialsAfterClosure` (downloader rig), `aSlowFrameHoldsNoOther`,
`aFrameIsLateOnlyWhenTheSessionGoesQuiet`, `endStreamIsAPromise`, `cancellable`, `anAskIsOnTheWireBeforeItReturns`,
`aDialThatNeverSettlesIsClosedAtItsDeadline`. Not mapped, each reported by name as the WebSocket's `oneStream` reports
its own: `workerSafe` and `transferable` (a JS worker and `ArrayBuffer` transfer), `onHeadRunsBeforeTheBody` and
`anOnHeadThatThrowsFailsItsAsk` (native has no head callback), the ring (`releaseWireBuffer`),
`anOpeningFillRidesTheUrl` (raw QUIC has no URL; an opening ask would be a FoD message after the handshake) and
`anEmptyHashDialsUnpinned` (native always pins).

**Cost and risk.** Estimated, not counted from a build: ~250 lines for the fake, ~150 for `native-session`, ~100 for
the adapter. A second fake to keep in step with `fake-transport.ts` whenever a clause adds a `FakeHandle` operation.
The clauses that time silence (`aFrameIsLateOnlyWhenTheSessionGoesQuiet`, the 16 s trickle) cross two processes; their
margins were set for one.

**Recommendation.** Build it, the failure clauses first — truncation, a dead session, a slow frame, silence — since
those are what native's survival (§Parity) rests on and what the current byte-equivalence test does not touch.
