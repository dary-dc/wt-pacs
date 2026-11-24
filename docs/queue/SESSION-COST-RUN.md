state: started
started: 2026-11-24T18:27Z
heartbeat: 2026-11-24T18:34Z
by: G2bMnvtP
outputs: claude/session-cost (rows; session-cost.md §Results); the rig on claude/session-cost-rig
## Resume
Rig pushed: claude/session-cost-rig 9c42f3d22 = origin/claude/session-cost (b059388b6 + the protocol) with, as files
(no merge): claude/delivery's lab/delivery, claude/phone-run-2's lab/devices, lab/viewer, head.js, dev-server.py,
claude/delivery's client/paint window read-back; new lab/delivery/session-page.js and --session in run.mjs/plan.mjs.
client/view and client/transport are b059388b6's, so §3's T1 holds unchanged.
Next: setup (scratchpad setup.sh: iproute2, dockerd, meson, venv, cargo release, ingest/tools.sh), then
`lab/delivery/series.sh S` (+ usb_cine HTJ2K), smoke one session per arm on CLEAN, the three mutants
(--mutate sampler-relay|skip-step|tally-dropped), §9 amendment (server pair per session, not per form) pushed to
claude/session-cost before counted rows; then `node lab/delivery/run.mjs --session --cell CLEAN --series S --rounds 8`
and `--cell CR --rounds 4`, rows to lab/delivery/rows/session-<CELL>.jsonl, copied to claude/session-cost.
## Result
