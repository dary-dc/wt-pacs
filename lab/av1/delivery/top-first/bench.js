/**
 * Stage 1.5 of docs/av1/top-first.md §4: d_T, the top-only payload, and d_X, the whole shipped payload, through the
 * product's av1.js in one worker, the two interleaved frame by frame after an untimed pass. bench.mjs drives it.
 *
 *   ?set=NAME&frames=i,j,…&first=T|X&post=URL[&mutate=sample]
 */
const q = new URLSearchParams(location.search);
const dir = `/lab/.av1-work/top-first/${q.get("set")}`;
const meta = await (await fetch(`${dir}/variants.json`)).json();
const frames = q.get("frames").split(",").map(Number);
const worker = new Worker(`/lab/av1/delivery/top-first/bench-worker.js?mutate=${q.get("mutate") ?? ""}`, { type: "module" });
let reply = null;
worker.onmessage = (e) => reply(e.data);
const call = (m, transfer) => new Promise((r) => { reply = r; worker.postMessage(m, transfer); });
const bytes = async (i, kind) => new Uint8Array(await (await fetch(kind === "T" ? `${dir}/${String(i).padStart(3, "0")}.tfs.av1`
  : `${dir}/${String(i).padStart(3, "0")}.k2.av1`)).arrayBuffer());
await call({ kind: "init", decoder: { codec: "av1" } });
const post = (path, body) => fetch(`${q.get("post")}${path}`, { method: "POST", body: JSON.stringify(body ?? {}) });
await post("hello");
const run = async (i, kind) => {
  const b = await bytes(i, kind);
  return call({ kind: "decode", which: kind, bytes: b, split: meta.variants["tf-series"].split }, [b.buffer]);
};
for (const i of frames.slice(0, 1)) for (const k of ["T", "X"]) await run(i, k);
const rows = [];
for (const [n, i] of frames.entries()) {
  const order = (n % 2 === 0) === (q.get("first") === "T") ? ["T", "X"] : ["X", "T"];
  for (const k of order) {
    const r = await run(i, k);
    const want = k === "T" ? meta.variants["tf-series"].previewTruth[i] : meta.truth[i];
    rows.push({ i, which: k, ms: r.ms, path: r.path, exact: r.sha === want, error: r.error });
  }
}
await post("result", rows);
