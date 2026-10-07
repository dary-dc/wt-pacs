/**
 * Row COLDRTT: navigation → config → session → the first exact frame, by codec, on high-RTT links,
 * cold and warm. Every arm is the same 64×48 source, so one checksum judges each decode and the
 * frame's own transfer is one flight. lab/page-open/README.md §Cold round trips by codec
 *
 *   BEFORE=<rev> NODE_PATH=$(npm root -g) node lab/page-open/coldrtt.mjs FRAMES_DIR [rounds]
 *
 * FRAMES_DIR is coldrtt_frames.py's output. BEFORE is the commit whose client/downloader the
 * `-before` arms load. RTTS= (default 0,100,200,300), ONLY=arm,…, RELAY_ARGS=, THROTTLE=N, ROWS=FILE.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { order } from "../order.mjs";
import { throttleTree } from "../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const FRAMES_DIR = path.resolve(process.argv[2] ?? "");
const ROUNDS = Number(process.argv[3] || 10);
const RTTS = (process.env.RTTS || "0,100,200,300").split(",").map(Number);
const THROTTLE = Number(process.env.THROTTLE || 1);
const RELAY_ARGS = (process.env.RELAY_ARGS ?? "--rate-kbit 100000 --queue-pkts 1000").split(" ").filter(Boolean);
const BEFORE = process.env.BEFORE;
if (!BEFORE || !fs.existsSync(path.join(FRAMES_DIR, "g12.sha256"))) {
  throw new Error("usage: BEFORE=<rev> node lab/page-open/coldrtt.mjs FRAMES_DIR [rounds] (coldrtt_frames.py writes FRAMES_DIR)");
}
const TREE = "/lab/page-open/.coldrtt";

// arm: [study, page query]; `-before` loads BEFORE's client/downloader, `-pre` adds the page's AV1 preloads.
const ARMS = {
  htj2k: ["g12-htj2k", { codec: "htj2k" }],
  "wc-before": ["g10-av1", { codec: "av1", tree: TREE }],
  "wc-after": ["g10-av1", { codec: "av1" }],
  "wc-pre": ["g10-av1", { codec: "av1", pre: 1 }],
  "dav1d-before": ["g12-av1", { codec: "av1", tree: TREE }],
  "dav1d-after": ["g12-av1", { codec: "av1" }],
  "dav1d-pre": ["g12-av1", { codec: "av1", pre: 1 }],
};
for (const arm of Object.keys(ARMS)) if (process.env.ONLY && !process.env.ONLY.split(",").includes(arm)) delete ARMS[arm];
const PROFILES = ["cold", "warm"];
const sha = (study) => fs.readFileSync(path.join(FRAMES_DIR, `${study.split("-")[0]}.sha256`), "utf8").trim();

const port = () => 30000 + ((Math.random() * 20000) | 0);
const TCP_SRV = port();
const TCP_IN = port();
const T = fs.mkdtempSync(path.join(os.tmpdir(), "coldrtt-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];
const start = (cmd, args, log) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", log, log] });
  kids.push(p);
  return p;
};
process.on("exit", () => {
  for (const p of kids) p.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  fs.rmSync(path.join(ROOT, TREE.slice(1)), { recursive: true, force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

// An hour old or more, as deployed files are: one written seconds ago is revalidated (rig-limits.md §6).
const age = (f) => fs.utimesSync(f, new Date(Date.now() - 7200e3), new Date(Date.now() - 7200e3));
const before = path.join(ROOT, TREE.slice(1), "client/downloader");
fs.mkdirSync(before, { recursive: true });
for (const f of execFileSync("git", ["ls-tree", "--name-only", `${BEFORE}:client/downloader`], { cwd: ROOT }).toString().split("\n")) {
  if (f.endsWith(".js")) fs.writeFileSync(path.join(before, f), execFileSync("git", ["show", `${BEFORE}:client/downloader/${f}`], { cwd: ROOT }));
}
for (const dir of [before, "client/downloader", "client/transport-ts/dist", "lab/.av1-build/out", "lab/decode-bench/vendor/openjph"]) {
  for (const f of fs.readdirSync(path.resolve(ROOT, dir))) age(path.resolve(ROOT, dir, f));
}
age(path.join(ROOT, "lab/page-open/codec.html"));

execFileSync("cargo", ["build", "-q", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
const BIN = path.join(ROOT, process.env.CARGO_TARGET_DIR || "target", "debug");
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout ${T}/key.pem -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null \
  && mkdir -p ${T}/home/.pki/nssdb && certutil -N -d sql:${T}/home/.pki/nssdb --empty-password \
  && certutil -A -d sql:${T}/home/.pki/nssdb -n page -t P,, -i ${T}/cert.pem`]);
const hash = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`]).toString().trim();

const SERVERS = {};
for (const study of new Set(Object.values(ARMS).map(([s]) => s))) {
  const s = (SERVERS[study] = { srv: port(), inn: port() });
  execFileSync(path.join(BIN, "pack-study"), ["--metadata", path.join(FRAMES_DIR, study, "metadata.json"),
    "--frames", path.join(FRAMES_DIR, study, "frames"), "--output", path.join(T, `${study}.sbnd`)]);
  start(path.join(BIN, "exact-server"), ["--port", String(s.srv), "--study", path.join(T, `${study}.sbnd`),
    "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem")], fs.openSync(path.join(T, `${study}.log`), "a"));
}
// The deploy template's nginx over TLS and HTTP/2, as lab/page-open/run.mjs's HOST=h2.
const site = fs.readFileSync(path.join(ROOT, "deploy/nginx/wt-pacs.conf.template"), "utf8")
  .replace(/\$\{STUDY\}/g, "us_cine_smoke").replace(/\/srv\/wt-pacs/g, ROOT)
  .replace(/listen\s+8765;/, `listen 127.0.0.1:${TCP_SRV} ssl http2;\n    ssl_certificate ${T}/cert.pem;\n    ssl_certificate_key ${T}/key.pem;`);
fs.writeFileSync(path.join(T, "site.conf"), site);
fs.mkdirSync(path.join(T, "ngx"));
fs.writeFileSync(path.join(T, "nginx.conf"), `pid ${T}/nginx.pid;\nerror_log ${T}/nginx-error.log error;\nevents {}\nhttp {\n  access_log off;\n` +
  ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((d) => `  ${d}_temp_path ${T}/ngx;\n`).join("") + `  include ${T}/site.conf;\n}\n`);
start("nginx", ["-c", path.join(T, "nginx.conf"), "-g", "daemon off;"], fs.openSync(path.join(T, "static.log"), "a"));
await new Promise((r) => setTimeout(r, 2000));

function pointAt(s) {
  fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${s.inn}/`, cert_sha256: hash }) + "\n");
  age(CFG);
}

function browserPid(dir) {
  for (const p of fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, "utf8");
      if (cmd.includes(`--user-data-dir=${dir}`) && !cmd.includes("--type=")) return Number(p);
    } catch { /* exited while listed */ }
  }
  throw new Error(`no browser on ${dir}`);
}

async function visit(ctx, arm) {
  const [study, query] = ARMS[arm];
  const page = await ctx.newPage();
  let err = null;
  page.on("pageerror", (e) => (err = e.message));
  await page.goto(`https://127.0.0.1:${TCP_IN}/lab/page-open/codec.html?${new URLSearchParams({ ...query, sha: sha(study) })}`, { waitUntil: "commit" });
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 120000 * THROTTLE });
  const out = await page.evaluate(() => ({
    page: Math.round(performance.getEntriesByType("navigation")[0].responseEnd),
    ...globalThis.__wtpacsOpen,
    error: globalThis.__wtpacsError ?? null,
  }));
  await page.close();
  if (out.error || err) throw new Error(out.error || err);
  return out;
}

// A relay per visit: its self-timing tally is the visit's, and a visit it was late for is VOID.
async function relayUp(rtt, s, tag) {
  const log = path.join(T, `relay-${tag}.log`);
  const p = start("chrt", ["-f", "50", "python3", "lab/scripts/link_impair.py", "--self-timing",
    "--udp", `${s.inn}:${s.srv}`, "--tcp", `${TCP_IN}:${TCP_SRV}`, "--delay-ms", String(rtt / 2), ...RELAY_ARGS], fs.openSync(log, "a"));
  await new Promise((r) => setTimeout(r, 1000));
  return async () => {
    await new Promise((r) => (p.exitCode != null ? r() : (p.once("exit", r), p.kill())));
    return fs.readFileSync(log, "utf8").includes("VOID");
  };
}

const rows = [];
let voided = 0;
let failed = 0;
const CELLS = Object.keys(ARMS);
for (const rtt of RTTS) {
  for (let round = 0; round < ROUNDS; round++) {
    let prev = null;
    for (const arm of order(CELLS, round)) {
      const s = SERVERS[ARMS[arm][0]];
      pointAt(s);
      const relayDown = await relayUp(rtt, s, `${arm}-${rtt}-${round}`);
      // A fresh profile is what makes the cold visit cold: no HTTP cache, no compiled-code cache.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coldrttp-"));
      const ctx = await chromium.launchPersistentContext(dir, {
        headless: true,
        executablePath: process.env.CHROME_PATH || chromium.executablePath(),
        args: ["--disable-background-networking"],
        env: { ...process.env, HOME: `${T}/home` },
      });
      const unthrottle = THROTTLE > 1 ? throttleTree(browserPid(dir), THROTTLE) : () => {};
      const visits = [];
      try {
        for (const profile of PROFILES) visits.push({ rtt, round, arm, prev, profile, ...(await visit(ctx, arm)) });
      } catch (e) {
        failed++;
        process.stderr.write(`rtt=${rtt} ${arm}: ${e.message.split("\n")[0]}\n`);
      }
      unthrottle();
      await ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
      if (await relayDown()) {
        voided++;
        process.stderr.write(`rtt=${rtt} ${arm} round ${round}: VOID, the relay was late\n`);
      } else rows.push(...visits);
      prev = arm;
    }
  }
  process.stderr.write(`rtt ${rtt} done\n`);
}
if (process.env.ROWS) fs.writeFileSync(process.env.ROWS, JSON.stringify(rows));

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const cell = (arm, profile, rtt, key) => rows.filter((r) => r.arm === arm && r.profile === profile && r.rtt === rtt && r[key] != null);
function slope(arm, profile, key) {
  const pts = RTTS.map((rtt) => [rtt, cell(arm, profile, rtt, key)]).filter(([, v]) => v.length).map(([x, v]) => [x, median(v.map((r) => r[key]))]);
  if (pts.length < 2) return null;
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  return pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
}
// Each AV1 arm against its path's `-before`, HTJ2K against nothing.
const ref = (arm) => (arm.endsWith("-before") || arm === "htj2k" ? null : arm.replace(/-(after|pre)$/, "-before"));
console.log(`\ncpu ${THROTTLE}x, ${voided} visits VOID and dropped, ${failed} failed`);
console.log("round trips (slope over the RTTs) and ms at each: median [min-max], rounds won against the arm's -before");
for (const profile of PROFILES) {
  for (const key of ["config", "session", "frame"]) {
    for (const arm of CELLS) {
      const cells = RTTS.map((rtt) => {
        const mine = cell(arm, profile, rtt, key);
        if (!mine.length) return "-";
        const v = mine.map((r) => r[key]).sort((x, y) => x - y);
        const base = ref(arm) && new Map(cell(ref(arm), profile, rtt, key).map((r) => [r.round, r[key]]));
        const won = base ? ` ${mine.filter((r) => base.has(r.round) && r[key] < base.get(r.round)).length}/${mine.filter((r) => base.has(r.round)).length}` : "";
        return `${median(v).toFixed(0)} [${v[0].toFixed(0)}-${v.at(-1).toFixed(0)}]${won}`;
      });
      const s = slope(arm, profile, key);
      console.log(`${profile.padEnd(5)} ${key.padEnd(8)} ${arm.padEnd(13)} ${s == null ? "  -  " : s.toFixed(2).padStart(5)}   ${cells.join("   ")}`);
    }
  }
}
process.exit(0);
