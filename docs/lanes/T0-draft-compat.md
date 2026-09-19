# T0 — Draft compatibility: the server must establish sessions with every stable browser

**Status:** open, **gating**, reported green today and unverified here · **Needs:** the three
browsers · **Size:** a day for the matrix; the negotiation change depends on upstream

## Question

`wtransport` 0.7.2 (August 2026, the newest release) negotiates WebTransport with the legacy
draft-02 setting (`SETTINGS_ENABLE_WEBTRANSPORT` 0x2b603742) and draft-07's
(`WEBTRANSPORT_MAX_SESSIONS` 0xc671706a), upgrade token `webtransport`. What the three browsers
speak, from source trees and interop reports (14 September 2026, unverified on this project):

| Browser | Advertises | What that means for this server |
| --- | --- | --- |
| Chromium | legacy draft-02 and draft-07; no draft-15 codepoint in public interop reports | works as shipped |
| Firefox (neqo) | draft-07 today; PR #3847 adds draft-15 with the `webtransport-h3` token and keeps draft-07 decode-only | works as shipped, and will keep working through draft-07 until that is dropped |
| Safari 26.4–26.6 | draft-07 **and** draft-14 (0x14e9cd29) with `WT_INITIAL_MAX_DATA` 8 MiB and 100 streams; no draft-15 | works on draft-07 alone (confirmed with wtransport 0.7 in hyperium/h3 #363); **if the server ever advertises draft-14 it must send `WT_MAX_DATA` and `WT_MAX_STREAMS_*` capsules after the 2xx or the session's streams never become usable** |

draft-16 uses `SETTINGS_WT_ENABLED` (0x2c7cf000), the `webtransport-h3` token, and a session
flow control that applies only when both ends send a non-zero flow-control SETTING. So the
shipped dialect is, by report, accepted by all three browsers today, and the risk is forward:
the day a stable browser drops draft-07, no session establishes and no item in `NEXT.md`
matters. Two Safari facts change the test setup: `serverCertificateHashes` handshakes fail in
26.5.2 and 26.6.2 against servers Chromium accepts, so Safari needs a trust-store certificate,
never the dev pin; and Safari has no pooling, like Chromium.

## Decision rule

A stable Chromium, Firefox and Safari 26.4 each establish a session and receive one frame.
A browser that fails is a release blocker; there is no performance trade here.

## Steps

1. **Matrix, today.** Against `exact-server`, the harness `refuse` cell
   (`ts.html?cell=refuse&autorun=1`: session + one refused ask, no media) and one `ondemand`
   frame, in stable Chromium, Firefox and Safari — Safari with a certificate in its trust
   store, the other two on the dev pin. Record per browser: version, the upgrade token and the
   SETTINGS the browser sent (`chrome://net-export` for Chromium; `MOZ_LOG=neqo_http3::*:5` for
   Firefox; `RUST_LOG=wtransport=trace` on the server prints what it received), and from the
   server's view of the transport parameters `initial_max_data`, `initial_max_stream_data_*`,
   `max_udp_payload_size` and whether `min_ack_delay` is present — the one capture that also
   answers T7 and T9's packet-size step. Session established yes/no, frame yes/no.
2. **Upstream.** Read `BiagioFesta/wtransport` for draft-15/16 work (issues, PRs, `master`); on
   2026-09-14 its tracker showed none. If it appears, upgrade and re-run the matrix. If not, the
   change is dual negotiation: send both
   the old and the new SETTINGS, accept either token, prefer the new — the `webtransport-proto`
   `settings.rs` and the CONNECT handling in `driver/`. Contribute it upstream; a fork is the
   fallback, pinned like the quinn patch.
3. **Session flow control.** draft-16's limits apply only if both ends send a non-zero
   flow-control SETTING; the trap is partial opt-in (a stream limit, `WT_INITIAL_MAX_DATA` left
   at 0), and Safari's draft-14 has the capsule rule above. Decision for this server: advertise
   neither draft-14 nor any WT flow-control SETTING, so only quinn's two windows apply, as
   today; revisit only if a browser refuses sessions without it. If it is ever advertised,
   set the initial data window to at least twice the worst-case bandwidth-delay product and
   credit `WT_MAX_DATA` proactively as data is consumed, never on a `WT_DATA_BLOCKED`.
4. Add the matrix to the gate as a manual pre-release check (a checklist line in
   `docs/disk-access/DEPLOYMENT.md`'s before-shipping list), and note the wtransport version pin.

## Report

One table: browser, version, token, SETTINGS seen, session, frame. Filed in
`docs/CLIENTS.md` under a "Browsers established" heading with the date.

## Stop conditions

Any stable browser failing step 1 stops everything else in this list until step 2 lands.
