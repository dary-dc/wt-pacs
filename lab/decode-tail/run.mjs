/**
 * The decode tail, split: after a fill's last byte, is the pool finishing a backlog it could not
 * have avoided (throughput), or work it left waiting while a decoder sat idle (scheduling)? Each set
 * is served by its own server on loopback; pages are driverless, sets rotated every round.
 * docs/decode/README.md §The decode tail
 *
 *   NODE_PATH=$(npm root -g) node lab/decode-tail/run.mjs --rounds 7 --sets c512,g512
 *     [--arms name=decoderDir,...]    another decoder build, same page
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 7));
const SETS = arg("--sets", "c512,g512").split(",");
/** `name=decoderDir[/glue.js][@decoderWorker]`: another decoder build, or another worker around it. */
const ARMS = arg("--arms", "package=/lab/decode-bench/vendor/openjph").split(",").map((a) => a.split("="));
const DECODERS = Number(arg("--decoders", 3));
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const ROOT = new URL("../..", import.meta.url).pathname;
const T = fs.mkdtempSync(path.join(os.tmpdir(), "tail-"));
const kids = [];
process.on("exit", () => { for (const k of kids) k.kill(); fs.rmSync(T, { recursive: true, force: true }); });

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem \
  -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null`]);
const HASH = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`]).toString().trim();

/** A fixture set as a study: its `NNN.j2c` frames under the names pack-study wants. */
const servers = {};
let port = 30000 + ((Math.random() * 10000) | 0);
for (const set of SETS) {
  const src = path.join(ROOT, "lab/fixtures", `decode_${set}`);
  const frames = fs.readdirSync(src).filter((f) => f.endsWith(".j2c")).sort();
  const d = path.join(T, set);
  fs.mkdirSync(d);
  frames.forEach((f, i) => fs.copyFileSync(path.join(src, f), path.join(d, `${String(i).padStart(3, "0")}.htj2k`)));
  fs.writeFileSync(path.join(T, `${set}.json`), JSON.stringify({ frameCount: frames.length }));
  execFileSync(path.join(ROOT, "target/release/pack-study"), ["--metadata", path.join(T, `${set}.json`),
    "--frames", d, "--output", path.join(T, `${set}.sbnd`)]);
  const p = port++;
  kids.push(spawn(path.join(ROOT, "target/release/exact-server"), ["--port", String(p), "--bind", "127.0.0.1",
    "--study", path.join(T, `${set}.sbnd`), "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem")],
    { stdio: "ignore" }));
  servers[set] = { url: `https://127.0.0.1:${p}/`, frames: frames.length };
}
const HTTP = port++;
kids.push(spawn("python3", ["server/dev-server.py", "--port", String(HTTP)], { cwd: ROOT, stdio: "ignore" }));

let report;
const sink = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => { res.writeHead(204, { "access-control-allow-origin": "*" }); res.end(); report?.(JSON.parse(body)); });
});
await new Promise((r) => sink.listen(0, "127.0.0.1", r));
await new Promise((r) => setTimeout(r, 1500));

async function page(set, [arm, spec]) {
  const [where, worker] = spec.split("@");
  const [dir, glue] = where.endsWith(".js") ? [path.dirname(where), path.basename(where)] : [where, undefined];
  const profile = fs.mkdtempSync(path.join(T, "p-"));
  const got = new Promise((r) => (report = r));
  const u = new URLSearchParams({ set, arm, fill: servers[set].frames, decoders: DECODERS, decoderDir: dir,
    wt: servers[set].url, hash: HASH, report: sink.address().port, ...(worker ? { decoderWorker: worker } : {}),
    ...(glue ? { glue, wasm: glue.replace(/\.js$/, ".wasm") } : {}) });
  // CHROME_FLAGS passes flags through; CHROME_LOG keeps what the browser prints.
  const log = process.env.CHROME_LOG ? fs.openSync(process.env.CHROME_LOG, "a") : "ignore";
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--no-first-run", "--disable-background-networking",
    ...(process.env.CHROME_FLAGS ?? "").split(" ").filter(Boolean),
    `--user-data-dir=${profile}`, `http://127.0.0.1:${HTTP}/lab/decode-tail/index.html?${u}`], { stdio: ["ignore", log, log] });
  const out = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 90000))]);
  chrome.kill();
  await new Promise((r) => setTimeout(r, 500));
  return out;
}

/** The split, from the stamps alone: a sweep over every boundary, counting busy decoders and waiting frames. */
function split(r) {
  const f = r.frames.filter((x) => !x.error);
  const t0 = r.askAt;
  const wireEnd = Math.max(...f.map((x) => x.lastByte));
  const end = Math.max(...f.map((x) => x.decodeEnd));
  const cuts = [...new Set(f.flatMap((x) => [x.lastByte, x.decodeStart, x.decodeEnd]).concat([t0, wireEnd, end]))].sort((a, b) => a - b);
  const idle = { ownInbox: 0, queue: 0, otherInbox: 0 };
  let busyInWire = 0;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    const mid = (a + b) / 2;
    const busy = new Set(f.filter((x) => x.decodeStart <= mid && mid < x.decodeEnd).map((x) => x.decoder));
    const waiting = f.filter((x) => x.lastByte <= mid && mid < x.decodeStart);
    const inbox = (d) => waiting.some((x) => x.dispatched <= mid && x.decoder === d);
    const queued = waiting.some((x) => mid < x.dispatched);
    const elsewhere = waiting.some((x) => x.dispatched <= mid && busy.has(x.decoder));
    // An idle decoder with work in reach is charged to the nearest reason: its own inbox, the queue, a busy one's inbox.
    for (let d = 0; d < DECODERS; d++) {
      if (busy.has(d)) continue;
      if (inbox(d)) idle.ownInbox += b - a;
      else if (queued) idle.queue += b - a;
      else if (elsewhere) idle.otherInbox += b - a;
    }
    if (b <= wireEnd) busyInWire += busy.size * (b - a);
  }
  const work = f.map((x) => x.decodeEnd - x.decodeStart);
  // Between two frames of one decoder when the second was already in its inbox: the decoder's own overhead.
  const gaps = [];
  for (let d = 0; d < DECODERS; d++) {
    const mine = f.filter((x) => x.decoder === d).sort((x, y) => x.decodeStart - y.decodeStart);
    for (let k = 1; k < mine.length; k++) {
      if (mine[k].dispatched <= mine[k - 1].decodeEnd) gaps.push(mine[k].decodeStart - mine[k - 1].decodeEnd);
    }
  }
  gaps.sort((x, y) => x - y);
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  return {
    frames: f.length, failed: r.frames.length - f.length,
    wireMs: wireEnd - t0, doneMs: end - t0, tailMs: end - wireEnd,
    decodeMs: med(work), workPerDecoderMs: work.reduce((s, x) => s + x, 0) / DECODERS,
    busyShareInWire: busyInWire / (DECODERS * (wireEnd - t0)),
    idleWithWorkMs: idle.ownInbox + idle.queue + idle.otherInbox,
    gapMs: gaps[gaps.length >> 1], gapP90Ms: gaps[Math.floor(gaps.length * 0.9)], gapMaxMs: gaps.at(-1),
    idleOwnInboxMs: idle.ownInbox, idleQueueMs: idle.queue, idleOtherInboxMs: idle.otherInbox,
    startedAfterWire: f.filter((x) => x.decodeStart >= wireEnd).length,
  };
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  const cells = SETS.flatMap((s) => ARMS.map((a) => [s, a]));
  for (let k = 0; k < cells.length; k++) {
    const [set, arm] = cells[(k + round) % cells.length];
    const r = await page(set, arm);
    if (r && process.env.DUMP) fs.appendFileSync(process.env.DUMP, JSON.stringify(r) + "\n");
    const row = r ? { round, set, arm: arm[0], ...split(r) } : { round, set, arm: arm[0], lost: true };
    rows.push(row);
    console.log(JSON.stringify(row, (k2, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
  }
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log("\nmedians over rounds, ms from the fill's ask");
for (const set of SETS) for (const [arm] of ARMS) {
  const rs = rows.filter((r) => r.set === set && r.arm === arm && !r.lost);
  const m = (k) => med(rs.map((r) => r[k]));
  console.log(`${set} ${arm}: wire ${m("wireMs").toFixed(0)}  decoded ${m("doneMs").toFixed(0)}  tail ${m("tailMs").toFixed(0)}` +
    `  decode/frame ${m("decodeMs").toFixed(2)}  work/decoder ${m("workPerDecoderMs").toFixed(0)}` +
    `  busy in wire ${(100 * m("busyShareInWire")).toFixed(0)} %  idle-with-work ${m("idleWithWorkMs").toFixed(0)} decoder-ms` +
    ` (own inbox ${m("idleOwnInboxMs").toFixed(0)}, queue ${m("idleQueueMs").toFixed(0)}, a busy one's inbox ${m("idleOtherInboxMs").toFixed(0)})` +
    `  gap between a decoder's frames ${m("gapMs").toFixed(2)} [p90 ${m("gapP90Ms").toFixed(2)}, max ${m("gapMaxMs").toFixed(1)}]` +
    `  started after wire ${m("startedAfterWire")}  n=${rs.length}` + (arm === ARMS[0][0] ? "" :
      `  done sooner than ${ARMS[0][0]} in ${rs.filter((r) => r.doneMs < rows.find((b) => b.round === r.round && b.set === set && b.arm === ARMS[0][0])?.doneMs).length}/${rs.length}`));
}
process.exit(0);
