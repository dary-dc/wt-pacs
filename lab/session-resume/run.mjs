/**
 * RS1: what Chrome does on its second WebTransport dial to the same server — resume the TLS session,
 * send 0-RTT, or neither — and what the dial costs each way. Per round, RTT and server, arms
 * interleaved: a fresh browser context dials twice from one page, then once from a second page.
 * Whether each dial offered a PSK, and whether the server took it, is read from a capture of the
 * Initial packets (`lab/scripts/client_hello.py`). docs/ARCHITECTURE.md §Resumption and 0-RTT
 *
 * Modes: `hashes` dials with `serverCertificateHashes`; `ca` without, the certificate signed by a
 * throwaway CA only this browser's NSS store trusts (needs `certutil`). The host is `rs1.test`,
 * mapped to loopback: a hostname, not an IP literal.
 *
 *   NODE_PATH=$(npm root -g) node lab/session-resume/run.mjs [rounds]   [RTTS=0,40,80] [SERVERS=a=BIN,b=BIN]
 *     [MODES=hashes,ca] [ROWS=FILE] [DEBUG=1] [HOLD=ms open per session] [NETLOG=FILE for the run]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 6);
const RTTS = (process.env.RTTS || "0,40,80").split(",").map(Number);
const KINDS = ["cold", "same page", "new page"];
const MODES = (process.env.MODES || "hashes,ca").split(",");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "rs1-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];
let nextPort = 30000 + ((Math.random() * 20000) | 0);
const port = () => nextPort++;

const start = (cmd, args, log) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", fs.openSync(path.join(T, log), "a"), "inherit"] });
  kids.push(p);
  return p;
};
process.on("exit", () => {
  for (const p of kids) p.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  else fs.rmSync(CFG, { force: true });
  fs.rmSync(T, { recursive: true, force: true });
});
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server"], { cwd: ROOT });
const SERVERS = (process.env.SERVERS || `shipped=${path.join(ROOT, "target/release/exact-server")}`)
  .split(",").map((s) => ({ name: s.split("=")[0], bin: s.split("=")[1], srv: port() }));
execFileSync("bash", ["-c", `cd ${T} && openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout ca-key.pem -out ca.pem -days 2 -nodes -subj '/CN=rs1 lab CA' 2>/dev/null \
  && openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout key.pem -out leaf.csr -nodes \
  -subj '/CN=localhost' 2>/dev/null \
  && printf 'basicConstraints=critical,CA:FALSE\\nkeyUsage=critical,digitalSignature\\nextendedKeyUsage=serverAuth\\nsubjectAltName=DNS:localhost,DNS:rs1.test,IP:127.0.0.1\\n' > leaf.ext \
  && openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 2 -extfile leaf.ext -out cert.pem 2>/dev/null \
  && mkdir -p home/.pki/nssdb && certutil -N -d sql:home/.pki/nssdb --empty-password \
  && certutil -A -d sql:home/.pki/nssdb -n rs1 -t C,, -i ca.pem`]);
const hash = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`])
  .toString().trim();

const relays = {};
for (const s of SERVERS) {
  start(s.bin, ["--port", String(s.srv), "--bind", "127.0.0.1", "--study", "lab/fixtures/frames_250k/frames_250k.sbnd",
    "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], `server-${s.name}.log`);
  for (const rtt of RTTS) {
    const inn = port();
    start("python3", ["lab/scripts/link_impair.py", "--udp", `${inn}:${s.srv}`, "--control-port", String(port()),
      "--delay-ms", String(rtt / 2)], `relay-${s.name}-${rtt}.log`);
    relays[`${s.name}/${rtt}`] = inn;
  }
}
const HTTP = port();
start("python3", ["server/dev-server.py", "--port", String(HTTP)], "static.log");
// Captured in front of the relays: behind them every dial shares the relay's one upstream port.
const filter = Object.values(relays).map((p) => `udp port ${p}`).join(" or ");
const dump = start("tcpdump", ["-i", "lo", "-U", "-w", `${T}/dials.pcap`, filter], "tcpdump.log");
await new Promise((r) => setTimeout(r, 2000));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  env: { ...process.env, HOME: `${T}/home` },
  // WebTransport otherwise wants a root Chrome ships, which a lab CA cannot be.
  args: ["--webtransport-developer-mode", "--host-resolver-rules=MAP rs1.test 127.0.0.1", "--no-proxy-server",
    ...(process.env.NETLOG ? [`--log-net-log=${path.resolve(process.env.NETLOG)}`, "--net-log-capture-mode=Everything"] : [])],
});
async function dials(ctx, n, mode) {
  const page = await ctx.newPage();
  if (process.env.DEBUG) page.on("console", (m) => console.log(`  [page] ${m.text()}`));
  await page.goto(`http://127.0.0.1:${HTTP}/lab/session-resume/index.html?dials=${n}&hashes=${mode === "hashes" ? 1 : 0}&hold=${process.env.HOLD || 0}`);
  await page.waitForFunction(() => globalThis.__done, null, { timeout: 60000 });
  const r = await page.evaluate(() => ({ ready: globalThis.__ready, error: globalThis.__error }));
  if (r.error) throw new Error(r.error);
  return r.ready;
}

const rows = [];
const ARMS = SERVERS.flatMap((s) => MODES.map((mode) => ({ s, mode })));
for (let round = 0; round < ROUNDS; round++) {
  for (const rtt of RTTS) {
    for (const { s, mode } of ARMS.map((_, k) => ARMS[(k + round) % ARMS.length])) {
      fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://rs1.test:${relays[`${s.name}/${rtt}`]}/`, cert_sha256: hash }) + "\n");
      const ctx = await browser.newContext();
      const ready = [...(await dials(ctx, 2, mode)), ...(await dials(ctx, 1, mode))];
      await ctx.close();
      ready.forEach((ms, k) => rows.push({ round, rtt, server: s.name, mode, kind: KINDS[k], ms }));
      console.log(`round ${round} rtt ${rtt} ${s.name.padEnd(8)} ${mode.padEnd(6)} ready ${ready.join(" / ")} ms`);
    }
  }
}
await browser.close();
await new Promise((r) => setTimeout(r, 1000));
dump.kill("SIGINT");
await new Promise((r) => dump.on("exit", r));

// The capture lists each relay's connections in dial order, which is the order `rows` holds them.
for (const [key, inn] of Object.entries(relays)) {
  const hellos = execFileSync("python3", ["lab/scripts/client_hello.py", `${T}/dials.pcap`, String(inn)]).toString()
    .trim().split("\n").map((l) => Object.fromEntries(l.split(" ").map((kv) => kv.split("="))));
  rows.filter((r) => `${r.server}/${r.rtt}` === key).forEach((r, k) => Object.assign(r, hellos[k] ?? {}));
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log("\nready ms, median [min–max]; what the ClientHello offered and the server took");
for (const { s, mode } of ARMS) for (const rtt of RTTS) for (const kind of KINDS) {
  const rs = rows.filter((r) => r.server === s.name && r.mode === mode && r.rtt === rtt && r.kind === kind);
  const ms = rs.map((r) => r.ms);
  const count = (k) => Object.entries(rs.reduce((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {}))
    .map(([v, n]) => `${v} ${n}`).join(", ");
  console.log(`${s.name.padEnd(8)} ${mode.padEnd(6)} ${String(rtt).padStart(3)} ms  ${kind.padEnd(9)} ${median(ms)} [${Math.min(...ms)}–${Math.max(...ms)}]` +
    `  psk: ${count("psk")}  early_data: ${count("early_data")}  0-RTT packets: ${count("zero_rtt_packets")}`);
}
if (process.env.ROWS) fs.writeFileSync(process.env.ROWS, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
process.exit(0);
