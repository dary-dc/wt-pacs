// Performance by counts, not clocks: the product's downloader against the release server, on a synthetic series,
// each count against scripts/perf_counts.baseline. README.md §Quick start, step 5.
//   node scripts/perf_counts.mjs   needs strace and the TS bundles (client/transport/ts/build.sh)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(process.env.CARGO_TARGET_DIR ?? path.join(ROOT, "target"), "release");
const N = 24;
const T = mkdtempSync(path.join(tmpdir(), "perf-counts-"));
let server = null;
// The group, not strace alone: a tracer killed leaves its tracee serving.
process.on("exit", () => { if (server) process.kill(-server.pid, "SIGKILL"); rmSync(T, { recursive: true, force: true }); });

execFileSync("cargo", ["build", "-q", "--release", "-p", "series-server", "-p", "pack-series"], { cwd: ROOT, stdio: "inherit" });
mkdirSync(`${T}/frames`);
for (let i = 0; i < N; i++) writeFileSync(`${T}/frames/${String(i).padStart(3, "0")}.htj2k`, Buffer.alloc(100_000 + 1_000 * i, i));
writeFileSync(`${T}/metadata.json`, JSON.stringify({ frameCount: N }));
const sbnd = `${T}/series.sbnd`;
execFileSync(`${BIN}/pack-series`, ["--metadata", `${T}/metadata.json`, "--frames", `${T}/frames`, "--output", sbnd], { stdio: "ignore" });
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", `${T}/key.pem`,
  "-out", `${T}/cert.pem`, "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });

// Every read of the bundle, by its path; a forced miss makes each one a syscall, whatever the page cache holds.
const port = 20000 + ((Math.random() * 25000) | 0);
server = spawn("strace", ["-f", "-qq", "-y", "-e", "trace=read,readv,pread64,preadv,preadv2", "-o", `${T}/syscalls`,
  `${BIN}/series-server`, "--port", String(port), "--bind", "127.0.0.1", "--series", sbnd, "--cert-pem", `${T}/cert.pem`,
  "--key-pem", `${T}/key.pem`, "--websocket", "--force-pool-reads"], { stdio: ["ignore", "pipe", "inherit"], detached: true });
await new Promise((resolve, reject) => {
  let out = "";
  server.stdout.on("data", (d) => (out += d) && /^transport=/m.test(out) && resolve());
  server.once("exit", (c) => reject(new Error(`the server exited ${c}: ${out}`)));
});
const reads = () => readFileSync(`${T}/syscalls`, "utf8").split("\n").filter((l) => l.includes(`<${sbnd}>`)).length;

// The client's side of the wire: the WebSocket carries the same asks and envelopes as QUIC's shared stream. docs/WIRE.md
const wire = { asks: 0, bytes: 0 };
globalThis.WebSocket = class extends WebSocket {
  constructor(url) {
    super(url);
    if (new URL(url).searchParams.has("ask")) wire.asks++;
    this.addEventListener("message", (e) => typeof e.data !== "string" && (wire.bytes += e.data.byteLength));
  }
  send(text) {
    if (["request_frame", "stream_frames"].includes(JSON.parse(text).op)) wire.asks++;
    super.send(text);
  }
};
// The server is on loopback, on a cert made above.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
globalThis.onmessage ??= null;
globalThis.addEventListener ??= () => {};
const arrived = new Set();
globalThis.postMessage = (m) => m.kind === "frame" && arrived.add(m.index);
const frame = async (i) => { while (!arrived.has(i)) await new Promise((r) => setTimeout(r, 2)); };

/** One downloader, one session: what it asked, what the server read for it, what came back. */
async function counts(name, config, drive) {
  const readsBefore = reads();
  Object.assign(wire, { asks: 0, bytes: 0 });
  arrived.clear();
  await import(`${pathToFileURL(path.join(ROOT, "client/transport/downloader.js"))}?${name}`);
  const transport = pathToFileURL(path.join(ROOT, "client/transport/ts/dist/ws-session.js")).href;
  await onmessage({ data: { kind: "start", config: { decode: false, survival: false, frameCount: N, transport, ...config } } });
  await onmessage({ data: { kind: "dial", url: `https://127.0.0.1:${port}/`, certHash: "" } });
  await drive();
  for (let i = 0; i < N; i++) await frame(i);
  await onmessage({ data: { kind: "close" } });
  return { [`${name}: client asks`]: wire.asks, [`${name}: server reads`]: reads() - readsBefore, [`${name}: bytes on the wire`]: wire.bytes };
}

const order = [...Array(N).keys()];
const got = {
  ...(await counts("fill", { fill: order }, async () => {})),
  // A cine on demand: each frame asked once the one before it is shown.
  ...(await counts("cine", {}, async () => {
    for (const i of order) {
      onmessage({ data: { kind: "ask", index: i } });
      await frame(i);
    }
  })),
  // Steps that jump, each frame stepped to twice at once.
  ...(await counts("on demand", {}, async () => {
    for (const i of order.map((k) => (k * 7) % N)) {
      onmessage({ data: { kind: "ask", index: i } });
      onmessage({ data: { kind: "ask", index: i } });
      await frame(i);
    }
  })),
};

const baselinePath = path.join(ROOT, "scripts/perf_counts.baseline");
const baseline = Object.fromEntries(readFileSync(baselinePath, "utf8").split("\n").filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split(/\t+/)).map(([k, v]) => [k, Number(v)]));
const changed = [...new Set([...Object.keys(baseline), ...Object.keys(got)])].filter((k) => baseline[k] !== got[k]);
for (const k of changed) console.log(`FAIL: ${k} was ${baseline[k] ?? "absent"}, now ${got[k] ?? "absent"}`);
console.log(changed.length ? `perf counts: ${changed.length} changed; a change is a reviewed line in scripts/perf_counts.baseline`
  : `perf counts: ${Object.keys(got).length} as in the baseline, on ${N} frames`);
process.exit(changed.length ? 1 : 0);
