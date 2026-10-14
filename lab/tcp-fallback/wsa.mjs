/**
 * WSA: the opening ask in the WebSocket upgrade's URL against the same fill asked on the socket,
 * through the relay's TCP plane, variants Williams-ordered, a self-timed relay per visit.
 * lab/tcp-fallback/README.md §The opening ask in the upgrade's URL
 *
 *   NODE_PATH=$(npm root -g) node lab/tcp-fallback/wsa.mjs [--rounds 12] [--rtts "40 80 160"]
 *     [--rate 20000] [--frame-bytes 250000] [--frames 4] [--server target/release/series-server]
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
const ROUNDS = Number(arg("--rounds", 12));
const RTTS = arg("--rtts", "40 80 160").split(" ").map(Number);
const RATE = Number(arg("--rate", 20000));
const FRAME = Number(arg("--frame-bytes", 250000));
const FRAMES = Number(arg("--frames", 4));
const SERVER = arg("--server", "target/release/series-server");
const VARIANTS = ["ws", "ask"];

const T = fs.mkdtempSync(path.join(os.tmpdir(), "wsa-"));
const kids = new Set();
const start = (cmd, args, log) => {
  const k = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")] });
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

if (SERVER === "target/release/series-server") execFileSync("cargo", ["build", "-q", "--release", "-p", "series-server"], { cwd: ROOT });
execFileSync("cargo", ["build", "-q", "-p", "pack-series"], { cwd: ROOT });
execFileSync("bash", ["client/transport/ts/build.sh"], { cwd: ROOT, stdio: "ignore" });
fs.mkdirSync(`${T}/frames`);
const expected = [];
for (let i = 0; i < FRAMES; i++) {
  const bytes = crypto.randomBytes(FRAME);
  fs.writeFileSync(`${T}/frames/${String(i).padStart(3, "0")}.htj2k`, bytes);
  expected.push(crypto.createHash("sha256").update(bytes).digest("hex"));
}
fs.writeFileSync(`${T}/m.json`, JSON.stringify({ frameCount: FRAMES }));
sh(`target/debug/pack-series --metadata ${T}/m.json --frames ${T}/frames --output ${T}/series.sbnd`);
sh(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem -out ${T}/cert.pem \
  -days 2 -nodes -subj '/CN=localhost' -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null`);
// A WebSocket cannot pin by hash: Chromium trusts this one key instead.
const spki = sh(`openssl x509 -in ${T}/cert.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64`);
const http = port();
start("python3", ["server/dev-server.py", "--port", String(http)], `${T}/http.log`);
await sleep(500);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: [`--ignore-certificate-errors-spki-list=${spki}`, "--disable-background-networking",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});

/** A random port can be taken: a server or relay that never comes up is retried on fresh ports. */
async function one(round, rtt, variant) {
  for (let tries = 1; ; tries++) {
    try {
      return await visit(round, rtt, variant);
    } catch (e) {
      if (tries === 3 || !/never said/.test(e.message)) throw e;
    }
  }
}

async function visit(round, rtt, variant) {
  const [srv, relayPort] = [port(), port()];
  const server = start(SERVER, ["--port", String(srv), "--bind", "127.0.0.1", "--websocket", "--opening-ask",
    "--series", `${T}/series.sbnd`, "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], `${T}/server.log`);
  const relay = start("python3", ["lab/scripts/link_impair.py", "--tcp", `${relayPort}:${srv}`, "--seed", String(round),
    "--delay-ms", String(rtt / 2), "--rate-kbit", String(RATE), "--queue-pkts", "200", "--self-timing"], `${T}/relay.log`);
  let r;
  try {
    await until(`${T}/server.log`, "wt_url=");
    await until(`${T}/relay.log`, "READY");
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${http}/lab/tcp-fallback/wsa.html`);
    await page.waitForFunction(() => globalThis.__ready);
    r = await page.evaluate((a) => globalThis.runVariant(a), {
      variant, url: `https://127.0.0.1:${relayPort}/`, from: 0, to: FRAMES - 1, expected, limitMs: 10000,
    });
    await page.close();
  } finally {
    await stop(relay);
    await stop(server);
  }
  // --self-timing: a relay that sent late was the instrument's jitter, not the link's.
  return { ...r, void: fs.readFileSync(`${T}/relay.log`, "utf8").includes("VOID") };
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const f1 = (v) => (v === null || v === undefined ? "—" : v.toFixed(1));
let wrong = 0;
const summary = [];
for (const rtt of RTTS) {
  const runs = [];
  for (let round = 0; round < ROUNDS; round++) {
    let prev = null;
    for (const variant of order(VARIANTS, round)) {
      const r = await one(round, rtt, variant);
      if (r.exact !== FRAMES) wrong += 1;
      console.log(`${rtt} ms round ${round} ${variant.padEnd(4)} first ${f1(r.first)} fill ${f1(r.fill)} ms, ` +
        `${r.exact}/${FRAMES} bit-exact${r.void ? "  VOID" : ""}`);
      if (!r.void && r.fill !== null) runs.push({ round, unit: variant, prev, v: r.first, fill: r.fill });
      prev = variant;
    }
  }
  const of = (variant, k) => runs.filter((x) => x.unit === variant).map((x) => x[k]);
  const pairs = (k) => runs.filter((x) => x.unit === "ask")
    .flatMap((x) => runs.filter((b) => b.unit === "ws" && b.round === x.round).map((b) => x[k] - b[k]));
  const lead = (k) => {
    const d = pairs(k);
    return `${median(d) >= 0 ? "+" : ""}${f1(median(d))} ms = ${(median(d) / rtt).toFixed(2)} RTT (${d.filter((x) => x < 0).length}/${d.length} faster)`;
  };
  summary.push(`${rtt} ms: first frame ws ${f1(median(of("ws", "v")))} (${of("ws", "v").length}), ask ${f1(median(of("ask", "v")))} ` +
    `(${of("ask", "v").length}); ask − ws ${lead("v")}; fill ${lead("fill")}`);
  for (const line of leadsByPredecessor(runs, VARIANTS, [["ask", "ws"]], 1)) summary.push(line);
}
console.log(`\n${FRAMES} × ${FRAME} B, ${RATE} kbit, the relay's TCP plane, ${ROUNDS} rounds; VOID and missing runs dropped`);
for (const line of summary) console.log(line);
if (wrong) console.log(`${wrong} visit(s) not bit-exact`);
await browser.close();
process.exit(0);
