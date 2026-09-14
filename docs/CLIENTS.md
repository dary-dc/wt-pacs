# Client transports

| Path | Role |
|------|------|
| `client/transport-wasm/` | Rust WASM via `web_sys::WebTransport` |
| `client/transport-ts/` | TypeScript / browser ESM (`session.ts` + `wire.ts`; `build.sh` → gitignored `dist/`) |

Same Media-complete wire as the server: FoD on one bidi control stream, envelope payloads on server uni streams.

The TypeScript client keeps an optional ask window (2026-09-14): `connect(url, hash,
{ window: { depth: 4 } })` holds `requestExactFrame` to a fixed depth in ask order, and
`{ depth: "auto", initial: 2 }` re-derives the depth from the link every eight frames —
`D = ceil(0.95 × (1 + RTT / Tf))`, RTT from the browser's `getStats().smoothedRtt`, `Tf` the median
time between arrivals, or from asks sent into an idle window where the browser has no `getStats`
(Chromium 141 has none; two are needed, so a reader that never pauses holds `initial`). Without a window,
`requestExactFrame` is one ask and depth is whatever the caller leaves outstanding, which is
still the WASM client's only shape. Fill is `startStreamFrames` (one `StreamFrames`). The window
ADR is [`adr-client-window-depth.md`](adr-client-window-depth.md); which depth ships is L2's
question ([`lanes/L2-ask-policy.md`](lanes/L2-ask-policy.md)); the rest of the open work is
[`transport/NEXT.md`](transport/NEXT.md).

## ACK frequency, by browser

The server can ask its peer for a smaller `max_ack_delay`
(`--ack-frequency-max-delay-ms`), which is the 25 ms half of the depth-1 tail
([`lanes/T7-tail-and-ack-frequency.md`](lanes/T7-tail-and-ack-frequency.md)). quinn only uses
the extension where the peer advertises `min_ack_delay`, and the frames it sends are counted in
`frame_tx.ack_frequency`, logged as `session transport ack_frequency=` when a session ends.

Measured 2026-09-14 on this VM, 32 KB fixture, `ondemand`, three cells:

| peer | `--ack-frequency-max-delay-ms 5` | `ack_frequency` |
| --- | --- | --- |
| quinn (`window-harness`) | yes | **1** |
| quinn (`window-harness`) | no | 0 |
| **headless Chromium 141** | yes | **0** |

The two quinn cells are the controls: the count follows the flag, so the zero against Chromium
is Chromium's and not the wiring. **Headless Chromium 141 does not advertise `min_ack_delay`**,
so nothing this server sets shortens its ACK delay. The rule closes the item on that evidence
unless Chromium 148 differs — it is one run of the same cell on the browser rig, and it is the
only thing T7 still waits on.
