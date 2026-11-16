// node lab/report-arms/nginx/nginx.test.mjs — needs nginx ≥ 1.31.5 (NGINX_BIN=<binary>) and cargo, for RECEIVER.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startNginx, nginxCounters } from "./nginx.mjs";
import { startSink } from "../sink.mjs";
import { readLines } from "../read.mjs";

const ROOT = new URL("../../..", import.meta.url).pathname;
let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));
let nextPort = 18800 + Math.floor(Math.random() * 400);

async function withNginx(receiver, body) {
  const dir = mkdtempSync(join(tmpdir(), "nginx-"));
  const pages = await startSink({ dir: mkdtempSync(join(tmpdir(), "pages-")), port: 0, statics: join(ROOT, "lab/report-arms") });
  const port = nextPort++;
  const n = await startNginx({ dir, port, pages: pages.port, receiver });
  const post = (p, b) => fetch(`http://127.0.0.1:${port}${p}`, { method: "POST", body: b,
    headers: { "Content-Type": "application/json" } }).then((r) => r.status);
  try { await body({ dir, post, port }); } finally { await n.close(); await pages.close(); }
}

// NGINX writes its line after the answer.
const settle = () => new Promise((r) => setTimeout(r, 200));
const files = (dir, re) => readdirSync(dir).filter((f) => re.test(f));
const lines = (dir, re) => files(dir, re).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean));
const day = new Date().toISOString().slice(0, 10);

/** NGINX: each record is one access line in its kind's file of the UTC day, its body a JSON string that parses back
 * to the record (quotes, backslashes and newlines included), with no client address. */
await withNginx("nginx", async ({ dir, post }) => {
  const record = { v: 1, kind: "load", reportId: "a", load: "L", errors: [{ message: 'q"\\\n' }] };
  check(await post("/report/load", JSON.stringify(record)) === 204, "a load record answers 204");
  check(await post("/report/safety", JSON.stringify({ kind: "safety", reportId: "s", load: "L" })) === 204, "safety 204");
  await settle();
  check(existsSync(join(dir, `load-${day}.jsonl`)) && existsSync(join(dir, `safety-${day}.jsonl`)),
    "one file per kind and UTC day");
  const load = lines(dir, /^load-/);
  check(load.length === 1, `one line per request, got ${load.length}`);
  check(JSON.stringify(readLines(load).records[0]) === JSON.stringify(record), "the line's r parses back to the record");
  check(!load[0].includes("127.0.0.1"), "no client address in the line");
  check(nginxCounters(dir).appended === 2 && nginxCounters(dir).byKind.safety === 1, "the counters read the lines");
});

/** NGINX refuses a body over 16 KiB with 413 before any line (counted from its error log), and any method but POST. */
await withNginx("nginx", async ({ dir, post, port }) => {
  check(await post("/report/load", JSON.stringify({ kind: "load", b: "x".repeat(17000) })) === 413, "over 16 KiB: 413");
  await settle();
  check(lines(dir, /^load-/).length === 0, "no line for a refused body");
  check((await fetch(`http://127.0.0.1:${port}/report/load`)).status === 403, "a GET is refused");
  await settle();
  const c = nginxCounters(dir);
  check(c.refused.tooLarge === 1 && c.refused.method === 1 && c.appended === 0, `refusals counted: ${JSON.stringify(c.refused)}`);
});

/** NGINX limits a client's load reports (429 past the burst) and never its safety reports. */
await withNginx("nginx", async ({ dir, post }) => {
  const body = (kind, i) => JSON.stringify({ kind, reportId: `${kind}${i}` });
  const load = await Promise.all(Array.from({ length: 40 }, (_, i) => post("/report/load", body("load", i))));
  const safety = await Promise.all(Array.from({ length: 40 }, (_, i) => post("/report/safety", body("safety", i))));
  await settle();
  check(load.includes(429), "load reports past the burst are refused 429");
  check(safety.every((s) => s === 204), "every safety report is taken");
  check(nginxCounters(dir).refused.rate === load.filter((s) => s === 429).length, "the rate refusals counted");
});

/** The rig's pages pass through nginx from the sink, cross-origin isolated. */
await withNginx("nginx", async ({ port }) => {
  const r = await fetch(`http://127.0.0.1:${port}/report-fields.json`);
  check(r.status === 200 && r.headers.get("cross-origin-embedder-policy") === "require-corp", "pages proxied, isolated");
});

const target = process.env.CARGO_TARGET_DIR ?? join(ROOT, "target");
execFileSync("cargo", ["build", "-q", "-p", "report-receiver"], { cwd: ROOT, stdio: "inherit" });
async function startReceiver(dir) {
  const p = spawn(join(target, "debug/report-receiver"), ["--port", "0", "--dir", dir, "--fields",
    join(ROOT, "lab/report-arms/report-fields.json")], { stdio: ["ignore", "pipe", "ignore"] });
  const port = await new Promise((ok) => p.stdout.on("data", (b) => ok(Number(String(b).split(" ")[1]))));
  return { port, close: () => p.kill() };
}

/** In front of RECEIVER: a record reaches RECEIVER's file and nothing reaches the fallback log; with RECEIVER down
 * the answer is 502 and the body is kept in `report-fallback.log`, in NGINX's line form. */
{
  const rdir = mkdtempSync(join(tmpdir(), "receiver-"));
  const rec = await startReceiver(rdir);
  await withNginx(rec.port, async ({ dir, post, port }) => {
    check(await post("/report/safety", JSON.stringify({ kind: "safety", reportId: "s" })) === 204, "RECEIVER up: 204");
    check(lines(rdir, /^safety-/).length === 1, "the record in RECEIVER's file");
    await settle();
    check(lines(dir, /^report-fallback\.log$/).length === 0, "no fallback line on a 2xx");
    const c = await fetch(`http://127.0.0.1:${port}/report/counters`).then((r) => r.json());
    check(c.appended === 1, "RECEIVER's counters reached through nginx");
    rec.close();
    await new Promise((r) => setTimeout(r, 200));
    check(await post("/report/load", JSON.stringify({ kind: "load", reportId: "f" })) === 502, "RECEIVER down: 502");
    await settle();
    const fallback = lines(dir, /^report-fallback\.log$/);
    check(fallback.length === 1 && readLines(fallback).records[0]?.reportId === "f", "the body kept in the fallback log");
  });
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("nginx: OK");
