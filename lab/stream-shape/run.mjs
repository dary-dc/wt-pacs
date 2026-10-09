/**
 * One stream or a stream per frame, in Chromium through the relay. Every run
 * starts its own server and relay; the variants are rotated inside every round. lab/stream-shape/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/stream-shape/run.mjs --cell loss1 [--rounds 7]
 *     [--variants "shared per-frame"] [--depth shared=3,per-frame=3 | --depth 3]
 *     [--fill 40] [--asks 30] [--frame-bytes 131072] [--out rows.jsonl]
 *   ... --sweep 1-6 --rounds 3      the asks alone at each depth, no loss: each variant's D_min
 *   ... --tax --rate 15000 --queue 50 --rtt 60 --variants "ws cc:cubic cc:bbr iw:38400"
 *       depth-1 asks on a fresh session, each variant's ask over RTT + size / rate; `ws` is the
 *       relay's TCP plane, an ideal-TCP floor (docs/rig-limits.md §3)
 *   ... --tun [--trace FILE]   inside `unshare -rn`: the relay at the packet layer, so `ws` is kernel
 *       TCP under the same loss as QUIC, `ws:<controller>` with that controller rather than the
 *       host's; cells ge0.5 ge1 ge2 ge4 are Gilbert-Elliott at that mean
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { order, leadsByPredecessor } from "../order.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CELL = arg("--cell", "loss0");
const ROUNDS = Number(arg("--rounds", 7));
const VARIANTS = arg("--variants", "shared per-frame").split(" ");
const FILL = Number(arg("--fill", 40));
const ASKS = Number(arg("--asks", 30));
const FRAME = Number(arg("--frame-bytes", 131072));
const SWEEP = arg("--sweep", "");
const OUT = arg("--out", "");
const TAX = process.argv.includes("--tax");
const TUN = process.argv.includes("--tun");
const TUN_SERVER = "10.77.0.2";
const RTT = Number(arg("--rtt", 80));
const RATE = Number(arg("--rate", 20000));
const LINK = ["--delay-ms", String(RTT / 2), "--rate-kbit", String(RATE), "--queue-pkts", arg("--queue", "200"),
  ...(TAX || TUN ? ["--self-timing"] : []), ...(arg("--trace") ? ["--trace", arg("--trace")] : [])];
const CELLS = { loss0: [], loss1: ["--loss", "1"], loss3: ["--loss", "3"], burst: ["--loss-model", "ge"] };
// Bursts of 3.5 packets, as the phone-link profiles: p is what puts the mean at the cell's percent.
for (const mean of [0.5, 1, 2, 4]) {
  CELLS[`ge${mean}`] = ["--loss-model", "ge", "--ge-r", "28.57", "--ge-p", String((mean * 28.57) / (100 - mean))];
}
if (!CELLS[CELL]) throw new Error(`unknown cell ${CELL}`);

/** `--depth 3` for every variant, or `variant=d,...` for each its own. */
function depthOf(variant) {
  const spec = arg("--depth", "3");
  if (!spec.includes("=")) return Number(spec);
  const d = Object.fromEntries(spec.split(",").map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]))[variant];
  if (!d) throw new Error(`no depth for ${variant} in --depth ${spec}`);
  return d;
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "hol1-"));
const kids = new Set();
const start = (cmd, args, log, env = {}) => {
  const k = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env },
    stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")] });
  kids.add(k);
  return k;
};
const stop = async (k) => {
  k.kill();
  await new Promise((r) => (k.exitCode !== null ? r() : k.once("exit", r)));
  kids.delete(k);
};
process.on("exit", () => {
  for (const k of kids) k.kill();
  fs.rmSync(T, { recursive: true, force: true });
});
process.on("SIGTERM", () => process.exit(143));
process.on("SIGINT", () => process.exit(130));
const sh = (cmd) => execFileSync("bash", ["-c", cmd], { cwd: ROOT }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = () => 30000 + ((Math.random() * 20000) | 0);
async function until(file, text, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(text)) return;
    await sleep(50);
  }
  throw new Error(`${path.basename(file)} never said ${text}`);
}

execFileSync("cargo", ["build", "-q", "--release", "-p", "series-server"], { cwd: ROOT });
execFileSync("cargo", ["build", "-q", "-p", "pack-series"], { cwd: ROOT });
execFileSync("bash", ["client/transport/ts/build.sh"], { cwd: ROOT, stdio: "ignore" });
execFileSync("cc", ["-shared", "-fPIC", "-o", `${T}/tcp_cc.so`, "lab/stream-shape/tcp_cc.c", "-ldl"], { cwd: ROOT });
const frames = FILL + ASKS;
fs.mkdirSync(`${T}/frames`);
for (let i = 0; i < frames; i++) fs.writeFileSync(`${T}/frames/${String(i).padStart(3, "0")}.htj2k`, crypto.randomBytes(FRAME));
fs.writeFileSync(`${T}/m.json`, JSON.stringify({ frameCount: frames }));
sh(`target/debug/pack-series --metadata ${T}/m.json --frames ${T}/frames --output ${T}/series.sbnd`);
sh(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem -out ${T}/cert.pem \
  -days 2 -nodes -subj '/CN=localhost' -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${TUN_SERVER}' 2>/dev/null`);
const hash = sh(`openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`);
// A WebSocket cannot pin by hash: Chromium trusts this one key instead.
const spki = sh(`openssl x509 -in ${T}/cert.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64`);
const http = port();
start("python3", ["server/dev-server.py", "--port", String(http)], `${T}/http.log`);
await sleep(500);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: [`--ignore-certificate-errors-spki-list=${spki}`, "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});

/** A stream mode, or `ws` (the WebSocket, through the relay's TCP plane), `cc:<controller>`, `iw:<bytes>`. */
function serverArgs(variant) {
  if (variant.startsWith("ws")) return ["--websocket"];
  if (variant.startsWith("cc:")) return ["--congestion", variant.slice(3)];
  if (variant.startsWith("iw:")) return ["--initial-window-bytes", variant.slice(3)];
  return ["--stream-mode", variant];
}

async function one(round, variant, depth, fill) {
  const [srv, relayPort] = [port(), port()];
  const planes = TUN ? ["--tun"] : ["--udp", `${relayPort}:${srv}`, ...(variant === "ws" ? ["--tcp", `${relayPort}:${srv}`] : [])];
  if (variant.startsWith("ws:") && !TUN) throw new Error(`${variant} sets a controller only inside --tun's namespace`);
  const relay = start("python3", ["lab/scripts/link_impair.py", ...planes, "--seed", String(round),
    ...LINK, ...CELLS[CELL]], `${T}/relay.log`);
  // Through the tun the server lives in the relay's namespace for it, and is dialled directly.
  let netns = [];
  if (TUN) {
    await until(`${T}/relay.log`, "READY");
    netns = ["nsenter", `--net=${fs.readFileSync(`${T}/relay.log`, "utf8").match(/server_netns=(\S+)/)[1]}`];
  }
  const [cmd, ...pre] = [...netns, process.env.EXACT_SERVER || "target/release/series-server"];
  const server = start(cmd, [...pre, "--port", String(srv), "--bind", TUN ? TUN_SERVER : "127.0.0.1",
    "--series", `${T}/series.sbnd`, "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`,
    ...serverArgs(variant)], `${T}/server.log`,
    variant.startsWith("ws:") ? { LD_PRELOAD: `${T}/tcp_cc.so`, WTPACS_TCP_CC: variant.slice(3) } : {});
  let row;
  try {
    await until(`${T}/server.log`, "wt_url=");
    await until(`${T}/relay.log`, "READY");
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${http}/lab/stream-shape/index.html`);
    await page.waitForFunction(() => globalThis.__ready);
    const r = await page.evaluate((a) => globalThis.runVariant(a), {
      url: TUN ? `https://${TUN_SERVER}:${srv}/` : `https://127.0.0.1:${relayPort}/`, hash, fill, asks: ASKS, depth, limitMs: 300000, ws: variant.startsWith("ws"),
    });
    await page.close();
    row = { cell: CELL, round, variant, depth, ...r };
  } finally {
    await stop(relay);
    await stop(server);
  }
  // --self-timing: a relay that sent late was the instrument's jitter, not the link's.
  return { ...row, void: fs.readFileSync(`${T}/relay.log`, "utf8").includes("VOID") };
}

const rows = [];
const emit = (row) => {
  rows.push(row);
  if (OUT) fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
};
const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const rotate = (list, k) => [...list.slice(k % list.length), ...list.slice(0, k % list.length)];

if (TAX) {
  const floor = RTT + (FRAME * 8) / RATE;
  const runs = [];
  for (let round = 0; round < ROUNDS; round++) {
    let prev = null;
    for (const variant of order(VARIANTS, round)) {
      const r = await one(round, variant, 1, 0);
      emit(r);
      const steady = median(r.latencies.slice(1));
      if (!r.void && r.latencies.length === ASKS) runs.push({ round, unit: variant, prev, v: steady, first: r.latencies[0] });
      console.log(`round ${round} ${variant.padEnd(16)} first ${r.latencies[0]?.toFixed(1)} steady ${steady.toFixed(1)} ms` +
        `${r.void ? "  VOID" : ""}${r.latencies.length < ASKS ? `  ${ASKS - r.latencies.length} asks failed` : ""}`);
      prev = variant;
    }
  }
  console.log(`\n${FRAME} B asks, depth 1, ${RATE} kbit, ${RTT} ms: floor RTT + size/rate = ${floor.toFixed(1)} ms`);
  console.log("variant               runs   first ask   steady ask   tax ms   tax %   paired vs " + VARIANTS[0]);
  for (const variant of VARIANTS) {
    const mine = runs.filter((x) => x.unit === variant);
    const st = median(mine.map((x) => x.v));
    const pairs = mine.flatMap((x) => runs.filter((b) => b.unit === VARIANTS[0] && b.round === x.round).map((b) => x.v - b.v));
    console.log(`${variant.padEnd(17)} ${String(mine.length).padStart(4)} ${median(mine.map((x) => x.first)).toFixed(1).padStart(11)}` +
      ` ${st.toFixed(1).padStart(12)} ${(st - floor).toFixed(1).padStart(8)} ${((st / floor - 1) * 100).toFixed(1).padStart(7)}` +
      `   ${variant === VARIANTS[0] ? "" : `${median(pairs).toFixed(1)} (${pairs.filter((d) => d < 0).length}/${pairs.length} lower)`}`);
  }
  for (const line of leadsByPredecessor(runs, VARIANTS, VARIANTS.slice(1).map((a) => [a, VARIANTS[0]]), 1)) console.log(line);
} else if (SWEEP) {
  const [lo, hi] = SWEEP.split("-").map(Number);
  for (let round = 1; round <= ROUNDS; round++) {
    for (const variant of rotate(VARIANTS, round)) {
      for (let depth = lo; depth <= hi; depth++) {
        const r = await one(round, variant, depth, 0);
        emit(r);
        console.log(`sweep round ${round} ${variant.padEnd(9)} depth ${depth}: ${(r.latencies.length / r.asksMs * 1000).toFixed(2)} asks/s`);
      }
    }
  }
} else {
  for (let round = 1; round <= ROUNDS; round++) {
    for (const variant of rotate(VARIANTS, round)) {
      const r = await one(round, variant, depthOf(variant), FILL);
      emit(r);
      const got = r.arrived.filter((t) => t !== null).length;
      console.log(`${CELL} round ${round} ${variant.padEnd(9)} d=${r.depth}: fill ${got}/${FILL} in ${r.fillMs.toFixed(0)} ms, ` +
        `asks ${r.latencies.length}/${ASKS} (${r.failures} failed) in ${r.asksMs.toFixed(0)} ms`);
    }
  }
}
await browser.close();
process.exit(0);
