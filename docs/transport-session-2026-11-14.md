# The transport session: its brief (prepared 2026-11-14)

For a local session the owner opens on transport, apart from the client's. The owner, 2026-11-14: "transport is
complicated and is a very important part in our value proposal, probably the biggest one. It might even be
interesting to use the only lossless htj2k approach for comparing transport against other TCP based approaches,
including websocket … Transport is an essential and whole topic by its own."

## Start here

1. `CLAUDE.md` (§Docs holds the documentation structure since PR 384), `docs/ARCHITECTURE.md` §The product.
2. `docs/transport/design.md` and `docs/transport/link-profiles.md` on `claude/docs-client` once TRANSPORT-INVENTORY
   and LINK-TARGETS (`docs/queue-client-2026-11-14.md`) are done; until then `docs/transport/`, `docs/WIRE.md`.
3. This file's questions, in order.

## The questions

1. **What the target links are**, and which of them a fill is wire-bound on (LINK-TARGETS' profiles and regimes).
   Every later comparison is run on those profiles, each labelled measured or assumed.
2. **WebTransport against the alternatives, codec fixed**: HTJ2K alone (the exact series), so only the transport
   varies. Arms: our WebTransport session (both clients, TS and WASM); HTTP/3 fetch; HTTP/2 fetch over TCP;
   WebSocket over TCP. Metrics, one per comparison (latency or throughput, not both): a fill's time, the first frame,
   an on-demand ask's latency during and after a fill; bytes; client and server CPU. Theory first, sourced: what each
   stack does with loss and RTT (head-of-line blocking, congestion control, connection setup), and a prediction per
   profile; a pre-registered protocol written by a session that will not run it; interleaved arms; the host's
   saturation stated.
3. **The decided defaults re-read against the profiles**: `cubic-restart` against BBR (BBR's claim held only for
   random loss; on the phone's Wi-Fi the loss was congestive and `cubic-restart` was faster), the initial window,
   host networking.
4. **Where a native client's raw QUIC changes the answer** (`docs/native/`), named only until 2 is answered.

## Rules for the session

`CLAUDE.md` §Agents and §Measurement; `docs/lines/coordination.md` §5's two-week rules (no merges except those the
owner names; one question, one branch, one draft PR). Cloud rows for research and container runs; the phone and the
owner's machine for what needs them. Documentation goes into `docs/transport/` in the structure of `CLAUDE.md` §Docs.
