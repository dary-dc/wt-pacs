state: done
started: 2026-11-20T14:18Z
heartbeat: 2026-11-20T15:27Z
outputs: claude/engines e92d24c9 (docs/decode/engines.md §Measured; docs/decode/engines-smoke/ raw rows); PR 410
## Resume
Done. Nothing left for this row.
## Result
engines.md §Measured: the seven cloud cells run by a session that wrote none of the matrix (Firefox 160.0.1, 159.0.1,
163.0a1; Chromium 153, 158, 159, 160; WebKitGTK 2.52.6; dbts_a1 with its Q 8 G 16 and G 1 views; one round each).
Held: cell 1 (demo-check both views, the refusal lever), 4, 5 (four cache arms exact in both engines), 6 (three
report carriers deliver at D1 in Chromium and Firefox), 7 (WebKitGTK: no SharedArrayBuffer, no OPFS, no AV1).
Missed: cell 2's command cannot serve a pair (check.mjs hosts one series); run through demo-pair.sh instead, the
pair holds in Firefox via dav1d, both views. run_firefox.sh dispatch fails 17/781 on 160 and 18 on 159 (Chromium
789/789): the 8-bit G = 8 groups come back inexact once Firefox's VideoDecoder takes them; cause not traced.
Cell 3: every build negotiates draft-02 (no Chromium offers -07); getStats() from Chromium 160, Firefox resolves it.
One pre-existing unresolved path fixed (engines.md cloud cell 7). check_links and comment budget green; gate not run
(docs-only). Line doc docs/lines/client.md updated.
Owner: nothing asked here; ENGINE-REVIEW and ENGINES-PAGE carry whether the Firefox G = 8 failure is traced.
