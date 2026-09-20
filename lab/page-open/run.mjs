/**
 * R2: navigation → config → session → first frame, on a real round trip, for the harness on both
 * clients and for the downloader. Cold and warm profile, through lab/scripts/link_impair.py.
 *
 * Each milestone is fitted against the link's round trip across 0 / 40 / 80 ms, so the slope is
 * the serial round trips the page spends and the intercept is everything that is not the network.
 * lab/page-open/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/page-open/run.mjs [rounds]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 3);
const RTTS = (process.env.RTTS || "0,40,80").split(",").map(Number);
const FRAMES = 12;

// STAGES swaps the three clients for the first-byte ladder: one rung of README.md per arm, on a
// cold profile only, since a warm visit spends none of what the ladder cuts.
const STAGES = process.env.STAGES?.split(",");
const ARMS = STAGES
  ? Object.fromEntries(
      STAGES.map((s) => [s, (base) => `${base}/lab/page-open/first-byte.html?stage=${s}&frames=${FRAMES}`]),
    )
  : {
      ts: (base) => `${base}/harness/ts.html?autorun=1&n=1&frames=${FRAMES}`,
      wasm: (base) => `${base}/harness/index.html?autorun=1&n=1&frames=${FRAMES}`,
      downloader: (base) => `${base}/lab/page-open/downloader.html`,
    };
const PROFILES = STAGES ? ["cold"] : ["cold", "warm"];

// HOST=dev (default) is server/dev-server.py, plaintext HTTP/1.1; h1 and h2 are nginx on the deploy
// template over TLS, without and with HTTP/2 — the handshakes a real host charges the page half.
const HOST = process.env.HOST || "dev";
const port = () => 30000 + ((Math.random() * 20000) | 0);
const UDP_SRV = port();
const UDP_IN = port();
const TCP_SRV = port();
const TCP_IN = port();
const T = fs.mkdtempSync(path.join(os.tmpdir(), "r2-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];

function start(cmd, args, out) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", out, out] });
  kids.push(p);
  return p;
}

function stop() {
  for (const p of kids) p.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  fs.rmSync(T, { recursive: true, force: true });
}
process.on("exit", stop);

// A real study: the downloader arm decodes what it gets, so random bytes would not do.
execFileSync("cargo", ["build", "-q", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
const BIN = path.join(ROOT, process.env.CARGO_TARGET_DIR || "target", "debug");
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout ${T}/key.pem -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null`]);
const hash = execFileSync("bash", [
  "-c",
  `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`,
]).toString().trim();

fs.mkdirSync(path.join(T, "frames"));
const src = path.join(ROOT, "lab/fixtures/decode_c512");
const codestreams = fs.readdirSync(src).filter((f) => f.endsWith(".j2c")).sort();
if (!codestreams.length) throw new Error(`no codestreams in ${src} — lab/scripts/gen_htj2k_fixtures.sh`);
for (let i = 0; i < FRAMES; i++) {
  fs.copyFileSync(
    path.join(src, codestreams[i % codestreams.length]),
    path.join(T, "frames", `${String(i).padStart(3, "0")}.htj2k`),
  );
}
fs.writeFileSync(path.join(T, "metadata.json"), JSON.stringify({ frameCount: FRAMES }));
execFileSync(path.join(BIN, "pack-study"), [
  "--metadata", path.join(T, "metadata.json"),
  "--frames", path.join(T, "frames"),
  "--output", path.join(T, "study.sbnd"),
]);

const srvLog = fs.openSync(path.join(T, "server.log"), "a");
start(path.join(BIN, "exact-server"), [
  "--port", String(UDP_SRV), "--study", path.join(T, "study.sbnd"),
  "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem"),
  // Inert for an arm that sends no `?ask=`, so every arm runs on one server. R1's arm needs it.
  "--open-ask",
], srvLog);
if (HOST === "dev") {
  start("python3", ["server/dev-server.py", "--port", String(TCP_SRV)], fs.openSync(path.join(T, "static.log"), "a"));
} else {
  const site = fs.readFileSync(path.join(ROOT, "deploy/nginx/wt-pacs.conf.template"), "utf8")
    .replace(/\$\{STUDY\}/g, "us_cine_smoke")
    .replace(/\/srv\/wt-pacs/g, ROOT)
    .replace(/listen\s+8765;/, `listen 127.0.0.1:${TCP_SRV} ssl${HOST === "h2" ? " http2" : ""};\n` +
      `    ssl_certificate ${T}/cert.pem;\n    ssl_certificate_key ${T}/key.pem;`);
  fs.writeFileSync(path.join(T, "site.conf"), site);
  fs.mkdirSync(path.join(T, "ngx"));
  fs.writeFileSync(path.join(T, "nginx.conf"),
    `pid ${T}/nginx.pid;\nerror_log ${T}/nginx-error.log error;\nevents {}\nhttp {\n  access_log off;\n` +
    ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((d) => `  ${d}_temp_path ${T}/ngx;\n`).join("") +
    `  include ${T}/site.conf;\n}\n`);
  start("nginx", ["-c", path.join(T, "nginx.conf"), "-g", "daemon off;"], fs.openSync(path.join(T, "static.log"), "a"));
}
fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${UDP_IN}/`, cert_sha256: hash }) + "\n");
await new Promise((r) => setTimeout(r, 2000));

const base = `${HOST === "dev" ? "http" : "https"}://127.0.0.1:${TCP_IN}`;
const rows = [];

async function visit(ctx, arm) {
  const page = await ctx.newPage();
  let err = null;
  page.on("pageerror", (e) => (err = e.message));
  await page.goto(ARMS[arm](base), { waitUntil: "commit" });
  await page.waitForFunction(() => globalThis.__wtpacsDone || globalThis.__wtpacsError, null, {
    timeout: 120000,
  });
  const out = await page.evaluate(() => ({
    open: globalThis.__wtpacsOpen,
    error: globalThis.__wtpacsError ?? null,
  }));
  await page.close();
  if (out.error || err) throw new Error(out.error || err);
  return out.open;
}

for (const rtt of RTTS) {
  const relay = start("python3", [
    "lab/scripts/link_impair.py",
    "--udp", `${UDP_IN}:${UDP_SRV}`,
    "--tcp", `${TCP_IN}:${TCP_SRV}`,
    "--delay-ms", String(rtt / 2),
  ], fs.openSync(path.join(T, `relay-${rtt}.log`), "a"));
  await new Promise((r) => setTimeout(r, 1000));

  for (let round = 0; round < ROUNDS; round++) {
    for (const arm of Object.keys(ARMS)) {
      // A fresh profile is what makes the cold arm cold: no HTTP cache, no compiled-code cache.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2p-"));
      const ctx = await chromium.launchPersistentContext(dir, {
        headless: true,
        executablePath: process.env.CHROME_PATH || chromium.executablePath(),
        args: ["--disable-background-networking", "--ignore-certificate-errors-spki-list",
          ...(HOST === "dev" ? [] : ["--ignore-certificate-errors"])],
      });
      try {
        for (const profile of PROFILES) rows.push({ rtt, arm, profile, ...(await visit(ctx, arm)) });
      } catch (e) {
        process.stderr.write(`rtt=${rtt} ${arm}: ${e.message.split("\n")[0]}\n`);
      }
      await ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  relay.kill();
  await new Promise((r) => setTimeout(r, 500));
  process.stderr.write(`rtt ${rtt} done\n`);
}

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
function fit(arm, profile, key) {
  const xs = [];
  const ys = [];
  for (const rtt of RTTS) {
    const v = rows.filter((r) => r.arm === arm && r.profile === profile && r.rtt === rtt && r[key] != null);
    if (!v.length) return null;
    xs.push(rtt);
    ys.push(median(v.map((r) => r[key])));
  }
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  const slope =
    xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return { slope, fixed: my - slope * mx, at: Object.fromEntries(xs.map((x, i) => [x, ys[i]])) };
}

console.log(
  `\nhost ${HOST}\n${"arm".padEnd(11)} ${"profile".padEnd(8)} ${"milestone".padEnd(10)} ` +
    `${"round trips".padStart(11)} ${"fixed ms".padStart(9)}  ` +
    RTTS.map((r) => `${r} ms`.padStart(8)).join(" "),
);
for (const arm of Object.keys(ARMS)) {
  for (const profile of PROFILES) {
    for (const key of ["config", "session", "frame"]) {
      const f = fit(arm, profile, key);
      if (!f) continue;
      console.log(
        `${arm.padEnd(11)} ${profile.padEnd(8)} ${key.padEnd(10)} ` +
          `${f.slope.toFixed(2).padStart(11)} ${f.fixed.toFixed(0).padStart(9)}  ` +
          RTTS.map((r) => f.at[r].toFixed(0).padStart(8)).join(" "),
      );
    }
  }
}

// The server, the static host and the browser all hold handles open; the report is the work.
process.exit(0);
