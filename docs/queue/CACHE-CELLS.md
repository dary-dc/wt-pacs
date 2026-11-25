state: started
started: 2026-11-25T12:07Z
heartbeat: 2026-11-25T12:14Z
by: Nbp96Zk8
outputs: claude/cache-arms (rows); claude/page-runs (page-runs.md §Cache)
## Resume
Done (claude/cache-arms): 5766cfc53 OPFS-ASYNC one sync handle a group (item 4); dbccc29d3 verify's per-index record (item 3);
8f2110c83 PSS by process, the PSS A/A VOID rule, the none-errored VOID line (item 1, cache item 3). Each with its test, mutants killed.
Firefox: fetching 159.0.1 from archive.mozilla.org was refused in this container (the tool's permission check), so the Firefox cells are
not run here; the row will name them blocked with local commands.
Next: smoke `node lab/cache-arms/run.mjs --engine chromium --cell L --size 512 --rounds 1 --arms none,opfs-sync,opfs-sync-aa,opfs-async --pilot lab/cache-arms/pilot-chromium.json --out lab/cache-arms/work/smoke.jsonl`
(NODE_PATH=$(npm root -g)); then mutants.sh chromium for the run's arms; then page-runs.md §5 Amendment on claude/page-runs before the first counted row; then the counted cells under lab/cache-arms/rows/chromium-1125/.
## Result
