// The sink: one record in, one acknowledgement after the append, and the counters every receiver reports alike
// (report-plan.md §7.1). Also serves the rig's pages, cross-origin isolated, so every carrier is same-origin.
// node lab/report-arms/sink.mjs --port 8790 --dir out/ [--statics .] [--mutant ack-before-write]
import { createServer } from "node:http";
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";

const MAX_BODY = 16 * 1024;
const KINDS = ["load", "safety"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
                ".wasm": "application/wasm", ".bin": "application/octet-stream" };

export function counters() {
  return { received: 0, appended: 0, acknowledged: 0, duplicates: 0, byKind: { load: 0, safety: 0 },
           refused: { notObject: 0, tooLarge: 0, path: 0 } };
}

export async function startSink({ dir, port = 8790, statics = null, mutant = null, host = "127.0.0.1" }) {
  const c = counters();
  const seen = new Set();
  const isolated = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
                     "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store" };
  const answer = (res, status, headers = {}, body) => { res.writeHead(status, { ...isolated, ...headers }); res.end(body); };

  const record = (req, res, kind) => {
    const chunks = [];
    let size = 0;
    req.on("data", (b) => { size += b.length; if (size <= MAX_BODY) chunks.push(b); });
    req.on("end", () => {
      c.received++;
      if (size > MAX_BODY) return c.refused.tooLarge++, answer(res, 413);
      let r;
      try { r = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { r = null; }
      if (r === null || typeof r !== "object" || Array.isArray(r)) return c.refused.notObject++, answer(res, 400);
      if (r.reportId != null) seen.has(r.reportId) ? c.duplicates++ : seen.add(r.reportId);
      c.byKind[kind]++;
      if (mutant === "ack-before-write") return c.acknowledged++, answer(res, 204);
      appendFileSync(join(dir, `${kind}.jsonl`), JSON.stringify({ t: Date.now(), r }) + "\n");
      c.appended++;
      c.acknowledged++;
      answer(res, 204);
    });
  };

  const file = (req, res) => {
    const root = resolve(statics);
    const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    let body;
    try { if (!path.startsWith(root + "/") || !statSync(path).isFile()) throw 0; body = readFileSync(path); }
    catch { return answer(res, 404); }
    answer(res, 200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }, body);
  };

  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/report/counters") return answer(res, 200, { "Content-Type": "application/json" }, JSON.stringify(c));
    const kind = path.startsWith("/report/") ? path.slice(8) : null;
    if (kind !== null && req.method !== "POST") return answer(res, 405);
    if (kind !== null && !KINDS.includes(kind)) return req.resume(), c.received++, c.refused.path++, answer(res, 404);
    if (kind !== null) return record(req, res, kind);
    if (statics) return file(req, res);
    answer(res, 404);
  });
  await new Promise((ok) => server.listen(port, host, ok));
  return { port: server.address().port, counters: c, close: () => new Promise((ok) => server.close(ok)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "8790" }, dir: { type: "string" },
    statics: { type: "string" }, mutant: { type: "string" }, host: { type: "string", default: "127.0.0.1" } } });
  const s = await startSink({ ...values, port: Number(values.port) });
  console.log(`READY ${s.port}`);
}
