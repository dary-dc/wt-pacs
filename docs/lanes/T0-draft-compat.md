# T0 — Draft compatibility: the server must establish sessions with every stable browser

**Status:** open, **gating** · **Needs:** the three browsers · **Size:** a day for the matrix; the
negotiation change depends on upstream

## Question

`wtransport` 0.7.2 (August 2026, the newest release) negotiates WebTransport with the
draft-02..07-era codepoints: `SETTINGS_ENABLE_WEBTRANSPORT` 0x2b603742,
`WEBTRANSPORT_MAX_SESSIONS` 0xc671706a, upgrade token `webtransport`. draft-16 uses
`SETTINGS_WT_ENABLED`, the `webtransport-h3` token, and an opt-in session flow control
(`SETTINGS_WT_INITIAL_MAX_DATA` / `_MAX_STREAMS_*`, `WT_MAX_DATA` capsules). Firefox's neqo moved
to draft-15 negotiation and the new token in August–September 2026; Chromium 141 and 148 still
accepted the old codepoints when this repository's browser cells ran. The day a stable browser
stops accepting them, no session establishes, and no item in `NEXT.md` matters.

## Decision rule

A stable Chromium, Firefox and Safari 26.4 each establish a session and receive one frame.
A browser that fails is a release blocker; there is no performance trade here.

## Steps

1. **Matrix, today.** Against `exact-server` on the dev cert, the harness `refuse` cell
   (`ts.html?cell=refuse&autorun=1`: session + one refused ask, no media) and one `ondemand`
   frame, in stable Chromium, Firefox and Safari. Record per browser: version, the upgrade
   token and the SETTINGS the browser sent (`chrome://net-export` for Chromium; `MOZ_LOG=neqo_http3::*:5` for Firefox; `RUST_LOG=wtransport=trace` on the server prints what it received),
   session established yes/no.
2. **Upstream.** Read `BiagioFesta/wtransport` for draft-15/16 work (issues, PRs, `master`); on
   2026-09-14 its tracker showed none. If it appears, upgrade and re-run the matrix. If not, the
   change is dual negotiation: send both
   the old and the new SETTINGS, accept either token, prefer the new — the `webtransport-proto`
   `settings.rs` and the CONNECT handling in `driver/`. Contribute it upstream; a fork is the
   fallback, pinned like the quinn patch.
3. **Session flow control, when speaking draft-16.** The limits apply only if both ends send a
   non-zero flow-control SETTING; the trap is partial opt-in (a stream limit, `WT_INITIAL_MAX_DATA`
   left at 0). Decision for this server: do not advertise any WT flow-control SETTING, so only
   quinn's two windows apply, as today; revisit only if a browser refuses sessions without it.
   If it is ever advertised, credit `WT_MAX_DATA` proactively as data is consumed, never on a
   `WT_DATA_BLOCKED`.
4. Add the matrix to the gate as a manual pre-release check (a checklist line in
   `docs/disk-access/DEPLOYMENT.md`'s before-shipping list), and note the wtransport version pin.

## Report

One table: browser, version, token, SETTINGS seen, session, frame. Filed in
`docs/CLIENTS.md` under a "Browsers established" heading with the date.

## Stop conditions

Any stable browser failing step 1 stops everything else in this list until step 2 lands.
