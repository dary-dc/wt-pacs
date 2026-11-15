// node lab/report-arms/sink.test.mjs — the sink appends one line per record before its 204, refuses what is not one
// JSON object or is over 16 KiB, counts each outcome and each second copy of a reportId, and its ack-before-write
// mutant leaves appended below acknowledged.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { startSink } from "./sink.mjs";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

async function withSink(opts, body) {
  const dir = mkdtempSync(join(tmpdir(), "sink-"));
  const sink = await startSink({ dir, port: 0, ...opts });
  const url = (p) => `http://127.0.0.1:${sink.port}${p}`;
  const post = (p, b) => fetch(url(p), { method: "POST", body: b });
  try { await body({ dir, post, url, sink }); } finally { await sink.close(); }
}

await withSink({}, async ({ dir, post, url }) => {
  const r = await post("/report/load", JSON.stringify({ kind: "load", reportId: "a", load: "L" }));
  check(r.status === 204, `a record answers 204, got ${r.status}`);
  const lines = readFileSync(join(dir, "load.jsonl"), "utf8").trim().split("\n");
  check(lines.length === 1 && JSON.parse(lines[0]).r.reportId === "a", "one line, the record under r");
  check(typeof JSON.parse(lines[0]).t === "number", "the line carries the sink's receipt time");
  await post("/report/safety", JSON.stringify({ kind: "safety", reportId: "s" }));
  check(existsSync(join(dir, "safety.jsonl")), "the kind in the path files the record by kind");
  await post("/report/load", JSON.stringify({ kind: "load", reportId: "a" }));
  check((await post("/report/load", "[1,2]")).status === 400, "an array is refused, 400");
  check((await post("/report/load", "not json")).status === 400, "not JSON is refused, 400");
  check((await post("/report/load", JSON.stringify({ pad: "x".repeat(16 * 1024) }))).status === 413, "over 16 KiB, 413");
  check((await post("/report/other", "{}")).status === 404, "another kind, 404");
  check((await fetch(url("/report/load"))).status === 405, "a GET on a record path, 405");
  const c = await (await fetch(url("/report/counters"))).json();
  check(c.received === 7 && c.appended === 3 && c.acknowledged === 3, `received 7, appended 3, acked 3: ${JSON.stringify(c)}`);
  check(c.refused.notObject === 2 && c.refused.tooLarge === 1 && c.refused.path === 1, "each refusal counted by why");
  check(c.duplicates === 1 && c.byKind.load === 2 && c.byKind.safety === 1, "a reportId's second copy counted, kinds");
});

await withSink({ mutant: "ack-before-write" }, async ({ post, url }) => {
  check((await post("/report/load", JSON.stringify({ reportId: "a" }))).status === 204, "the mutant still answers 204");
  const c = await (await fetch(url("/report/counters"))).json();
  check(c.acknowledged === 1 && c.appended === 0, `ack-before-write: appended below acknowledged ${JSON.stringify(c)}`);
});

await withSink({ statics: new URL(".", import.meta.url).pathname }, async ({ url, sink }) => {
  const r = await fetch(url("/report-fields.json"));
  check(r.status === 200 && r.headers.get("cross-origin-embedder-policy") === "require-corp", "statics served isolated");
  const raw = await new Promise((ok) => get({ port: sink.port, path: "/" + "..%2F".repeat(12) + "etc%2Fpasswd" }, ok));
  check(raw.statusCode === 404, `no path outside the static root, got ${raw.statusCode}`);
});

if (failed) process.exit(1);
console.log("report-arms: the sink's contract and counters hold");
