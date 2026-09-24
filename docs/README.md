# Docs

Product and ADRs stay here. This lane's campaign write-ups are on tag
`archive/transport-lab-2026-09`, not under `docs/transport/` on the tip.

| Path | What |
| ---- | ---- |
| [`WIRE.md`](WIRE.md) / [`CLIENTS.md`](CLIENTS.md) / [`FIXTURES.md`](FIXTURES.md) | Product contracts |
| [`adr-*.md`](adr-reject-server-ordering.md) | Accepted product ADRs |
| [`lanes/`](lanes/) / [`measurements/`](measurements/) | Stream-mode / L2 material already on `main` — not moved |
| [`telemetry/`](telemetry/) | Server/client telemetry (from `main`) |
| [`disk-access/`](disk-access/) | How frames are brought in |
| [`decode/`](decode/) | Codestream to pixels: the decoder, what it costs in memory, the BYOB read path |
| [`paint-floor.md`](paint-floor.md) | Pixels to the screen: a canvas-2D route against a WebGL2 one, what each costs, and whether they are the same image |
| [`../deploy/`](../deploy/) | nginx + the two images, and the check that they answer as the dev host did |
| [`proposal-nginx-and-images.md`](proposal-nginx-and-images.md) | Proposed: nginx in place of the dev host, and an image per project |
| [`proposal-udp-fallback.md`](proposal-udp-fallback.md) | Proposed: when UDP does not work — 4 s to rejection measured, the iOS 16 MB stall, and racing instead of detecting |
| [`proposal-session-survival.md`](proposal-session-survival.md) | Proposed: a session that dies is noticed from platform signals and resumed on the downloader's records |
| [`proposal-session-open.md`](proposal-session-open.md) | Two round trips off a cold open — the ask in the session URL (behind a flag), and SETTINGS at 0.5 RTT (built: a build-time `wtransport` patch, −1.0 round trip off the dial) |
| [`client-shape-plan.md`](client-shape-plan.md) | The production client shape: the transport seam, what sits above it, and the milestones that build it |
| [`thread-hops.md`](thread-hops.md) | What each thread hop costs a decoded frame on its way to the page, and what a copy costs instead of a transfer |
| [`handoff-2026-09-19.md`](handoff-2026-09-19.md) | Start here if you are a new session: where the branch is, what is settled, what to pick up; [`handoff-2026-09-16.md`](handoff-2026-09-16.md) §3–4 still hold for the container |
| [`cloud-queue.md`](cloud-queue.md) | What a cloud agent should pick up next, and how it claims and reports it |
| [`identification-sweep.md`](identification-sweep.md) | How to find levers nobody has written down: the steps, the investigator brief, and what reopens a closed area |
| [`cloud-lanes-2026-09-14.md`](cloud-lanes-2026-09-14.md) | Investigations that need no workstation, one brief per lane |
| [`transport/`](transport/) | This lane: conclusions, why, and the window-defaults ADR. Evidence/lab on tag `archive/transport-lab-2026-09` |
| [`serving-cells-and-run-variance.md`](serving-cells-and-run-variance.md) | The two serving cells, serve against session wall, and which statistic survives run-to-run |
| [`rig-limits.md`](rig-limits.md) | What this box cannot measure, and what would lift each limit |
