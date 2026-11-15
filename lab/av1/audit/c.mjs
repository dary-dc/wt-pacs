// Protocol C's driver (docs/av1/audit-protocols.md §C amendment 1): one headless Chromium, every arm a fresh worker,
// rounds of (throttle, volume, arm) in Williams orders, one row per arm-run appended to ROWS; a rerun resumes.
//
//   TIP=<demo tip> STREAMS=<c_streams.sh OUT> node lab/av1/audit/c.mjs ROWS [ROUNDS]     ms on the worker's clock
//   TIP=... STREAMS=... node lab/av1/audit/c.mjs --smoke [VOLUME]                        one arm-run each, not kept
//   node lab/av1/audit/c.mjs --check                                                      the cores lever
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(import.meta.url)("playwright");
const TIP = process.env.TIP;
const STREAMS = process.env.STREAMS;
const FRAMES = 16;
const PORT = 8791;
// volume, the rule's Q, its stored depth less the view's 10 bits (Wb's shift)
const VOLUMES = [["dbts_a1", 6, 2], ["dbts_b1", 11, 0], ["dbts_c1", 7, 2]];
const THROTTLES = { "1x": [1], "4x": [4], "4x-cores1": [4, 1], "4x-cores2": [4, 2] };
const H_ARMS = ["Hp", "Hp2", "Hb", "Hk", "Hm"];
const W_ARMS = ["W", "Wb", "D"];

/** Each volume's arm-runs: the five H arms on its exact series, and W, Wb and D on each of its two streams. */
const runs = (volume, rule) => [
  ...H_ARMS.map((arm) => ({ arm, stream: "exact" })),
  ...[8, rule].flatMap((q) => W_ARMS.map((arm) => ({ arm, stream: `q${q}` }))),
];

const middle = (n) => Array.from({ length: FRAMES }, (_, k) => Math.floor((n - FRAMES) / 2) + k);

/** A stream's 16 frames as the page reads them, and the reference each frame is checked against. */
function prepare(volume, stream, shift) {
  const dir = path.join(STREAMS, stream === "exact" ? volume : `${volume}-${stream}-g1`);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json")));
  const ext = stream === "exact" ? "htj2k" : "av1";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(`.${ext}`)).sort();
  const at = middle(files.length);
  const exact = JSON.parse(fs.readFileSync(path.join(STREAMS, volume, "metadata.json")));
  const out = { dir, files: at.map((i) => files[i]), digests: at.map((i) => exact.digests.frames[i]), shift, av1: ext === "av1" };
  if (out.av1) out.sha256 = at.map((i) => nativeLuma(path.join(dir, files[i]), meta));
  // The checks' mutation: C_TAMPER=1 changes frame 3's reference, so every arm must report one miss.
  if (process.env.C_TAMPER) (out.sha256 ?? out.digests)[3] = "0".repeat(16);
  return out;
}

/** SHA-256 of native dav1d's luma for one payload's top unit, cached beside it. */
function nativeLuma(file, meta) {
  const cached = `${file}.luma.sha256`;
  if (fs.existsSync(cached)) return fs.readFileSync(cached, "utf8").trim();
  const unit = execFileSync("node", [path.join(HERE, "c_unit.mjs"), TIP, file]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c-ref-"));
  fs.writeFileSync(`${tmp}/u.obu`, unit);
  execFileSync(`${TIP}/ingest/.build/dav1d/bin/dav1d`, ["-q", "--demuxer", "section5", "-i", `${tmp}/u.obu`, "-o", `${tmp}/u.yuv`]);
  const yuv = fs.readFileSync(`${tmp}/u.yuv`);
  const w = meta.columns ?? meta.width;
  const h = meta.rows ?? meta.height;
  const bytes = yuv.subarray(0, w * h * 2);
  fs.rmSync(tmp, { recursive: true });
  const sum = createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(cached, sum + "\n");
  return sum;
}

// Cross-origin isolated, as the viewer is served: the decoders' pictures are SharedArrayBuffers.
const SERVE = `import http.server as h
class H(h.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin"); self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()
    def log_message(self, *a): pass
h.ThreadingHTTPServer(("127.0.0.1", ${PORT}), lambda *a: H(*a, directory="/")).serve_forever()`;

async function launch() {
  const host = spawn("python3", ["-c", SERVE], { stdio: "ignore" });
  process.on("exit", () => host.kill("SIGKILL"));
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  for (let t = Date.now(); Date.now() - t < 10000; await new Promise((r) => setTimeout(r, 100))) {
    if (await page.goto(`http://127.0.0.1:${PORT}${HERE}/`).then(() => true, () => false)) break;
  }
  return { browser: server, page, pid: server.process().pid, version: browser.version() };
}

/** One arm-run on the page: a fresh worker, its frames posted, its reply. */
const armRun = (page, s, arm) =>
  page.evaluate(async ({ s, arm, tip, worker }) => {
    const cache = (globalThis.units ??= {});
    if (!cache[s.dir]) {
      const { parsePayload, units } = await import(`${tip}/client/decode/av1-payload.js`);
      cache[s.dir] = await Promise.all(s.files.map(async (f) => {
        const bytes = new Uint8Array(await (await fetch(`${s.dir}/${f}`)).arrayBuffer());
        if (!s.av1) return bytes;
        const p = parsePayload(bytes);
        return units(p.frames[0], p.split)[0].slice();
      }));
    }
    const w = new Worker(worker, { type: "module" });
    const reply = new Promise((r) => (w.onmessage = (e) => r(e.data)));
    w.postMessage({ arm, tip, frames: cache[s.dir], digests: s.digests, sha256: s.sha256, shift: s.shift });
    const out = await reply;
    w.terminate();
    return out;
  }, { s, arm, tip: TIP, worker: `${HERE}/c_arm.js` });

const done = (rows) => {
  const per = new Map();
  for (const r of rows) per.set(r.round, (per.get(r.round) ?? 0) + 1);
  return per;
};
const PER_ROUND = Object.keys(THROTTLES).length * VOLUMES.reduce((n, [v, q]) => n + runs(v, q).length, 0);

async function campaign(rowsPath, rounds) {
  const rows = fs.existsSync(rowsPath) ? fs.readFileSync(rowsPath, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
  const per = done(rows);
  const partial = [...per].filter(([, n]) => n < PER_ROUND).map(([r]) => r);
  if (partial.length) {
    const keep = rows.filter((r) => !partial.includes(r.round));
    fs.appendFileSync(path.join(path.dirname(rowsPath), "c-stopped.jsonl"), rows.filter((r) => partial.includes(r.round)).map((r) => JSON.stringify(r) + "\n").join(""));
    fs.writeFileSync(rowsPath, keep.map((r) => JSON.stringify(r) + "\n").join(""));
    for (const r of partial) per.delete(r);
  }
  const streams = {};
  for (const [v, q, shift] of VOLUMES) for (const st of ["exact", "q8", `q${q}`]) streams[`${v}/${st}`] = prepare(v, st, shift);
  const { browser, page, pid, version } = await launch();
  try {
    for (let round = 0; round < rounds; round++) {
      if (per.has(round)) continue;
      for (const throttle of order(Object.keys(THROTTLES), round)) {
        const [rate, cores] = THROTTLES[throttle];
        const stop = throttleTree(pid, rate, { cores });
        try {
          for (const [v, q] of order(VOLUMES, round)) {
            for (const { arm, stream } of order(runs(v, q), round)) {
              const r = await armRun(page, streams[`${v}/${stream}`], arm);
              const row = { round, throttle, volume: v, stream, arm, ...r, chromium: version, at: new Date().toISOString() };
              fs.appendFileSync(rowsPath, JSON.stringify(row) + "\n");
              if (r.error || r.ok.includes(false)) console.error(`round ${round} ${throttle} ${v} ${stream} ${arm}: ${r.error ?? "hash miss"}`);
            }
          }
        } finally {
          stop();
        }
      }
      console.log(`round ${round} done ${new Date().toISOString()}`);
    }
  } finally {
    await browser.close();
  }
}

async function smoke(only) {
  const { browser, page, version } = await launch();
  console.log(version);
  try {
    for (const [v, q, shift] of VOLUMES.filter(([v]) => !only || v === only)) {
      for (const { arm, stream } of runs(v, q)) {
        const r = await armRun(page, prepare(v, stream, shift), arm);
        const sum = r.ms ? r.ms.reduce((a, b) => a + b, 0).toFixed(0) : "-";
        console.log(v, stream, arm, sum, "ms", r.error ?? (r.ok.every(Boolean) ? "ok" : `misses ${r.ok.filter((x) => !x).length}`));
      }
    }
  } finally {
    await browser.close();
  }
}

/** Four worker loops at once under 4×, with and without a core cap, against 1×. */
async function check() {
  const server = await chromium.launchServer();
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  const pid = server.process().pid;
  const loops = () => page.evaluate(async () => {
    const src = "onmessage = () => { const t = performance.now(); let x = 0; for (let i = 0; i < 2e8; i++) x += i % 7; postMessage(performance.now() - t + x * 0); }";
    const url = URL.createObjectURL(new Blob([src]));
    const ws = [0, 1, 2, 3].map(() => new Worker(url));
    const t = performance.now();
    await Promise.all(ws.map((w) => new Promise((r) => ((w.onmessage = r), w.postMessage(0)))));
    ws.forEach((w) => w.terminate());
    return performance.now() - t;
  });
  const base = await loops();
  console.log(`1x: four loops ${base.toFixed(0)} ms`);
  for (const [name, cores] of [["4x", undefined], ["4x-cores2", 2], ["4x-cores1", 1]]) {
    const stop = throttleTree(pid, 4, { cores });
    const t = await loops();
    stop();
    console.log(`${name}: ${t.toFixed(0)} ms, ${(t / base).toFixed(2)}x of 1x`);
  }
  await server.close();
}

const [arg, rounds] = process.argv.slice(2);
if (arg === "--check") await check();
else if (arg === "--smoke") await smoke(rounds);
else await campaign(arg, Number(rounds ?? 15));
process.exit(0);
