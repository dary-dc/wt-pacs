/**
 * A cold WebTransport dial in Chrome with a blink at a chosen offset into it, for two or more
 * server binaries, interleaved inside every round. Each offset says which flight the blink eats;
 * `swallow` eats exactly the server's first flight, wherever it falls. docs/proposal-session-open.md §Lever 2.
 *
 *   SERVERS=a=BIN,b=BIN [OFFSETS=none,0,20,…] [LOSS=1] [RTT=80] [BLINK_MS=150] [PORT_BASE=N] [ROWS=FILE] \
 *     NODE_PATH=$(npm root -g) node lab/page-open/dial-blink.mjs [rounds]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dgram from "node:dgram";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 5);
const OFFSETS = (process.env.OFFSETS || "none,0,20,40,60,80,100,120,140,160,180,200").split(",");
const RTT = Number(process.env.RTT || 80);
let nextPort = Number(process.env.PORT_BASE || 30000 + ((Math.random() * 20000) | 0));
const T = fs.mkdtempSync(path.join(os.tmpdir(), "blink-"));
const kids = [];
process.on("exit", () => {
  for (const k of kids) k.kill();
  fs.rmSync(T, { recursive: true, force: true });
});

execFileSync("cargo", ["build", "-q", "-p", "pack-study"], { cwd: ROOT });
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout ${T}/key.pem -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null`]);
const hash = execFileSync("bash", ["-c",
  `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`]).toString().trim();
fs.mkdirSync(path.join(T, "frames"));
fs.writeFileSync(path.join(T, "frames/000.htj2k"), Buffer.alloc(1024));
fs.writeFileSync(path.join(T, "metadata.json"), JSON.stringify({ frameCount: 1 }));
execFileSync(path.join(ROOT, process.env.CARGO_TARGET_DIR || "target", "debug", "pack-study"), [
  "--metadata", path.join(T, "metadata.json"), "--frames", path.join(T, "frames"),
  "--output", path.join(T, "study.sbnd")]);

const servers = process.env.SERVERS.split(",").map((s) => {
  const [name, bin] = s.split("=");
  const p = { name, srv: nextPort++, front: nextPort++, ctrl: nextPort++ };
  kids.push(spawn(bin, ["--port", String(p.srv), "--bind", "127.0.0.1", "--study", path.join(T, "study.sbnd"),
    "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem")], { stdio: "ignore" }));
  kids.push(spawn("python3", ["lab/scripts/link_impair.py", "--udp", `${p.front}:${p.srv}`,
    "--delay-ms", String(RTT / 2), "--control-port", String(p.ctrl), "--loss", process.env.LOSS || "0"],
    { cwd: ROOT, stdio: "ignore" }));
  return p;
});
// A page from a loopback server, so the dial passes Chrome's local-network checks.
const PAGE = nextPort++;
fs.writeFileSync(path.join(T, "index.html"), "<html></html>");
kids.push(spawn("python3", ["-m", "http.server", String(PAGE), "--bind", "127.0.0.1", "--directory", T],
  { stdio: "ignore" }));
await new Promise((r) => setTimeout(r, 1500));

const control = dgram.createSocket("udp4");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH,
  args: ["--disable-background-networking"] });
const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const o of OFFSETS) {
    for (const s of servers) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${PAGE}/`);
      if (o === "swallow") {
        await new Promise((r) => control.send(Buffer.from(`swallow ${process.env.SWALLOW_MS || 50}`), s.ctrl, "127.0.0.1", r));
      }
      const dial = page.evaluate(async ({ url, hash }) => {
        const value = new Uint8Array(hash.match(/../g).map((h) => parseInt(h, 16)));
        const t0 = performance.now();
        const wt = new WebTransport(url, { serverCertificateHashes: [{ algorithm: "sha-256", value }] });
        await wt.ready;
        wt.close();
        return performance.now() - t0;
      }, { url: `https://127.0.0.1:${s.front}/`, hash });
      if (o !== "none" && o !== "swallow") {
        const blink = Buffer.from(`blackout ${process.env.BLINK_MS || 150}`);
        setTimeout(() => control.send(blink, s.ctrl, "127.0.0.1"), Number(o));
      }
      rows.push({ round, o, server: s.name, ms: await dial });
      await ctx.close();
      // Past the blink, so it cannot reach the next dial.
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
await browser.close();
control.close();
if (process.env.ROWS) fs.writeFileSync(process.env.ROWS, JSON.stringify(rows));

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
console.log(`ready ms at ${RTT} ms round trip: median [min-max], and rounds each server beat ${servers[0].name} in`);
for (const o of OFFSETS) {
  const of = (name) => rows.filter((r) => r.o === o && r.server === name);
  const ref = new Map(of(servers[0].name).map((r) => [r.round, r.ms]));
  console.log(`blink at ${o.padEnd(5)} ` + servers.map((s) => {
    const v = of(s.name).map((r) => r.ms).sort((x, y) => x - y);
    const won = of(s.name).filter((r) => r.ms < ref.get(r.round)).length;
    return `${s.name} ${median(v).toFixed(0)} [${v[0].toFixed(0)}-${v.at(-1).toFixed(0)}] ${won}/${v.length}`;
  }).join("   "));
}
process.exit(0);
