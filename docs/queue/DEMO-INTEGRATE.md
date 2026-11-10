state: done
started: 2026-11-10 21:23
heartbeat: 2026-11-10 22:35
outputs: claude/demo-fixes-0 618e13c8, draft PR #355 into claude/core
## Resume
Done. Demo tip was claude/core-next-fixes 9eee7181. Merges on claude/demo-fixes-0: f224e45e gate-cloud,
afd2e18b double-decode-check, 2d566c67 demo-e2e-2; line note 618e13c8 (docs/lines/optimal-quality.md).
Gate setup in a cloud session: dockerd, pip install meson==1.9.1, ingest/tools.sh, client/transport/wasm/build.sh,
client/decode/wasm/fetch_openjph.sh, the README venv as PYTHON; client/decode/wasm/build/build.sh was refused by
Docker Hub (429), the committed decoders used.
## Result
* Already in the tip: oq-ingest-fixes, oq-depth-cut (unmoved since 04:08), oq-depth-cut-fixes, phone-setup-fixes,
  phone-pair. Merged --no-ff: gate-cloud (README, coordination.md conflicts, both kept), double-decode-check
  (the tip already had #299's identical check; its test added, mutant `if (!rec) return;` killed), demo-e2e-2.
* gate.yml already runs on PRs into claude/core (O1).
* DEMO-E2E-2 recorded one failure (certificate renewal), already fixed on its branch and now merged; no other.
* Full gate on 2d566c67: GATE OK in 375 s; skipped lavapipe painter/window, GL-display viewer arm and Firefox,
  nginx. CI on 2d566c67: gate and deploy green; 618e13c8 is docs only.
* The README's cloud lines miss client/transport/wasm/build.sh and fetch_openjph.sh; the gate names both.
* Fixtures: dbts_a1, dbts_b1, dbts_c1 from one dataset; no ultrasound cine; 4-core cloud host, no GPU.
* Owner decision: merge words on #355 (it carries #351, #341, #349); still open from CORE-NEXT: view/clock.js
  missing from the web image (?view=worker only).
