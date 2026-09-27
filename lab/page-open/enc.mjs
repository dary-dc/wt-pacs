/**
 * ENC: the lab's page served by nginx over TLS and HTTP/2 from precompressed files — identity, gzip,
 * brotli, zstd — on loopback, at each CPU throttle, the arms rotated inside every round.
 * lab/page-open/README.md §What an encoding costs on loopback
 *
 *   NODE_PATH=$(npm root -g) node lab/page-open/enc.mjs [rounds]
 *   THROTTLES=1,4 ARMS=identity,gzip,br,zstd TRANSPORT=wasm|ts TRACE=0 ROWS=FILE DUMP=PREFIX
 */
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { throttleTree } from "../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 10);
const THROTTLES = (process.env.THROTTLES || "1,4").split(",").map(Number);
const TRANSPORT = process.env.TRANSPORT || "wasm";
/** The trace decomposes the open and loads the browser doing it, so the headline runs without it. */
const TRACE = process.env.TRACE !== "0";
const FRAMES = 12;
/** Each encoding as the deploy would precompress it once, and the token the browser must advertise. */
const ENCODERS = {
  identity: null,
  gzip: ["gzip", ["-6", "-n", "-c"]],
  br: ["brotli", ["-q", "11", "-c"]],
  zstd: ["zstd", ["-19", "-q", "-c"]],
};
const ARMS = (process.env.ARMS || Object.keys(ENCODERS).join(",")).split(",");
/** What the page fetches of the types the template compresses (its `gzip_types`). */
const ASSETS = [
  "client/downloader/consumer.js", "client/downloader/downloader.js", "client/downloader/decoder.js",
  "client/transport-ts/dist/session.js",
  "client/transport-wasm/session-adapter.js", "client/transport-wasm/pkg/transport_wasm.js",
  "client/transport-wasm/pkg/transport_wasm_bg.wasm",
  "lab/decode-bench/vendor/openjph/openjphjs.js", "lab/decode-bench/vendor/openjph/openjphjs.wasm",
  "lab/page-open/metadata.json",
];

const T = fs.mkdtempSync(path.join(os.tmpdir(), "enc-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];
const start = (cmd, args) => {
  const out = fs.openSync(path.join(T, `${path.basename(cmd)}.log`), "a");
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", out, out] });
  kids.push(p);
  return p;
};
process.on("exit", () => {
  for (const p of kids) p.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  fs.rmSync(path.join(ROOT, "lab/page-open/metadata.json"), { force: true });
  fs.rmSync(T, { recursive: true, force: true });
});
const port = () => 30000 + ((Math.random() * 20000) | 0);

/** A study's per-frame metadata, synthetic: its size and its mix of numbers and UIDs, not a real series'. */
function metadata(frames = 300) {
  let seed = 1;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const uid = () => "1.2.826.0.1.3680043.8.498." + Array.from({ length: 5 }, () => String((rand() * 1e9) | 0)).join(".");
  const series = uid();
  return JSON.stringify({
    seriesInstanceUid: series, modality: "US", rows: 512, columns: 512, bitsAllocated: 8, samplesPerPixel: 3,
    photometricInterpretation: "RGB", frameCount: frames,
    frames: Array.from({ length: frames }, (_, i) => ({
      index: i, sopInstanceUid: uid(), instanceNumber: i + 1,
      imagePositionPatient: [-120.5, -98.25 + rand(), 40 + i * 0.625].map((v) => +v.toFixed(4)),
      imageOrientationPatient: [1, 0, 0, 0, 1, 0], pixelSpacing: [0.4688, 0.4688], sliceThickness: 0.625,
      windowCenter: 40 + ((rand() * 20) | 0), windowWidth: 400, rescaleIntercept: -1024, rescaleSlope: 1,
      acquisitionTime: `1030${String(i % 60).padStart(2, "0")}.${String((rand() * 1e6) | 0).padStart(6, "0")}`,
      frameBytes: 60000 + ((rand() * 40000) | 0),
    })),
  });
}
fs.writeFileSync(path.join(ROOT, "lab/page-open/metadata.json"), metadata());

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
const BIN = path.join(ROOT, process.env.CARGO_TARGET_DIR || "target", "release");
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout ${T}/key.pem -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null \
  && mkdir -p ${T}/home/.pki/nssdb && certutil -N -d sql:${T}/home/.pki/nssdb --empty-password \
  && certutil -A -d sql:${T}/home/.pki/nssdb -n page -t P,, -i ${T}/cert.pem`]);
const hash = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`])
  .toString().trim();

fs.mkdirSync(path.join(T, "frames"));
const src = path.join(ROOT, "lab/fixtures/decode_c512");
const codestreams = fs.readdirSync(src).filter((f) => f.endsWith(".j2c")).sort();
for (let i = 0; i < FRAMES; i++) {
  fs.copyFileSync(path.join(src, codestreams[i % codestreams.length]), path.join(T, "frames", `${String(i).padStart(3, "0")}.htj2k`));
}
fs.writeFileSync(path.join(T, "study.json"), JSON.stringify({ frameCount: FRAMES }));
execFileSync(path.join(BIN, "pack-study"), ["--metadata", path.join(T, "study.json"), "--frames", path.join(T, "frames"),
  "--output", path.join(T, "study.sbnd")]);
const WT = port();
start(path.join(BIN, "exact-server"), ["--port", String(WT), "--study", path.join(T, "study.sbnd"),
  "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem")]);
fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${WT}/`, cert_sha256: hash }) + "\n");

// Each encoding is its own server block: a precompressed copy where one exists and the browser
// advertises the token, else the file itself. `add_header` in a location replaces the server's,
// so the isolation headers are repeated there.
const bytes = {};
const ISOLATION = `add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    add_header Cross-Origin-Resource-Policy same-origin always;`;
const servers = {};
for (const arm of ARMS) {
  const dir = path.join(T, `www-${arm}`);
  for (const a of ASSETS) {
    const raw = fs.readFileSync(path.join(ROOT, a));
    const enc = ENCODERS[arm] ? execFileSync(ENCODERS[arm][0], [...ENCODERS[arm][1], path.join(ROOT, a)], { maxBuffer: 1 << 26 }) : raw;
    (bytes[a] ??= {})[arm] = enc.length;
    if (!ENCODERS[arm]) continue;
    if (arm === "gzip" && !zlib.gunzipSync(enc).equals(raw)) throw new Error(`${a}: gzip does not round-trip`);
    fs.mkdirSync(path.dirname(path.join(dir, a)), { recursive: true });
    fs.writeFileSync(path.join(dir, a), enc);
    // Its source's age, so its Last-Modified: a copy seconds old gets no heuristic freshness and every worker's fetch revalidates.
    const { atime, mtime } = fs.statSync(path.join(ROOT, a));
    fs.utimesSync(path.join(dir, a), atime, mtime);
  }
  servers[arm] = port();
}
const conf = ARMS.map((arm) => `
  server {
    listen 127.0.0.1:${servers[arm]} ssl http2;
    ssl_certificate ${T}/cert.pem;
    ssl_certificate_key ${T}/key.pem;
    root ${ROOT};
    ${ISOLATION}
    types { }
    include /etc/nginx/mime.types;
    types { application/wasm wasm; text/javascript js mjs; application/json json; }
    location = /wt/dev-transport.json { alias ${CFG}; }
    ${ENCODERS[arm] ? `location / {
      root ${T}/www-${arm};
      ${ISOLATION}
      add_header Content-Encoding ${arm} always;
      add_header Vary Accept-Encoding always;
      error_page 418 = @file;
      if ($http_accept_encoding !~* "\\b${arm}\\b") { return 418; }
      try_files $uri @file;
    }
    location @file { }` : ""}
  }`).join("\n");
fs.writeFileSync(path.join(T, "nginx.conf"), `pid ${T}/nginx.pid;\nerror_log ${T}/nginx-error.log error;\nevents {}\n` +
  `http {\n  access_log off;\n  gzip off;\n` +
  ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((d) => `  ${d}_temp_path ${T};\n`).join("") + conf + "\n}\n");
start("nginx", ["-c", path.join(T, "nginx.conf"), "-g", "daemon off;"]);
await new Promise((r) => setTimeout(r, 1500));

// A client that does not advertise an arm's token must get the file itself, never bytes it cannot decode.
const get = (arm, accept) => new Promise((ok, fail) => https.get({
  host: "127.0.0.1", port: servers[arm], path: `/${ASSETS[0]}`, ca: fs.readFileSync(path.join(T, "cert.pem")),
  headers: { "accept-encoding": accept },
}, (res) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c)).on("end", () => ok({ encoding: res.headers["content-encoding"], length: Buffer.concat(chunks).length }));
}).on("error", fail));
for (const arm of ARMS.filter((a) => ENCODERS[a])) {
  const plain = await get(arm, "identity");
  const taken = await get(arm, `gzip, deflate, ${arm}`);
  if (plain.encoding || plain.length !== bytes[ASSETS[0]].identity) throw new Error(`${arm}: no fallback — ${JSON.stringify(plain)}`);
  if (taken.encoding !== arm || taken.length !== bytes[ASSETS[0]][arm]) throw new Error(`${arm}: not served — ${JSON.stringify(taken)}`);
}

console.log("bytes on the wire, per encoding");
console.log(`${"asset".padEnd(48)} ${ARMS.map((a) => a.padStart(9)).join(" ")}`);
for (const a of ASSETS) console.log(`${a.padEnd(48)} ${ARMS.map((arm) => String(bytes[a][arm]).padStart(9)).join(" ")}`);
const total = (arm) => ASSETS.reduce((s, a) => s + bytes[a][arm], 0);
console.log(`${"total".padEnd(48)} ${ARMS.map((arm) => String(total(arm)).padStart(9)).join(" ")}`);

const server = await chromium.launchServer({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--disable-background-networking"],
  env: { ...process.env, HOME: `${T}/home` },
});
const browser = await chromium.connect(server.wsEndpoint());
const cdp = await browser.newBrowserCDPSession();

/** The trace's events for one visit, every process and thread. */
async function traced(fn) {
  const events = [];
  const collect = (d) => events.push(...(d.value ?? []));
  cdp.on("Tracing.dataCollected", collect);
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,v8.wasm,disabled-by-default-v8.wasm.detailed,blink.user_timing,loading,netlog,v8.execute",
    transferMode: "ReportEvents",
  });
  const out = await fn();
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", collect);
  return { out, events };
}

/** The milestones the trace alone has, in ms from navigation: every thread's clock is the trace's. */
function milestones(events) {
  const t0 = events.find((e) => e.name === "navigationStart" && e.args?.data?.documentLoaderURL)?.ts;
  const ms = (us) => (us - t0) / 1000;
  const sent = new Map();
  for (const e of events) if (e.name === "ResourceSendRequest") sent.set(e.args.data.requestId, { url: new URL(e.args.data.url).pathname, tid: e.tid });
  const finished = events.filter((e) => e.name === "ResourceFinish" && sent.has(e.args.data.requestId))
    .map((e) => ({ ...sent.get(e.args.data.requestId), end: e.args.data.finishTime * 1000 - t0 / 1000 }));
  const first = (url) => Math.min(...finished.filter((f) => f.url === url).map((f) => f.end));
  const out = {};
  for (const [key, url] of Object.entries(SHORT)) out[key] = first(`/${url}`);
  // The transport's is the one streamed compile; the decoders compile from a buffer (decoder.js).
  const start = events.find((e) => e.name === "wasm.StartStreamingCompilation");
  const done = (tid) => events.filter((e) => e.name === "wasm.OnCompilationSucceeded" && e.tid === tid).map((e) => ms(e.ts + e.dur));
  if (start) {
    out.transportCompiled = Math.min(...done(start.tid));
    out.transportStreamLag = out.transportCompiled -
      Math.max(...finished.filter((f) => f.tid === start.tid && f.url.endsWith("_bg.wasm")).map((f) => f.end));
  }
  const decoders = events.filter((e) => e.name === "wasm.AsyncCompile").map((e) => e.tid);
  out.decoderCompiled = Math.min(...decoders.flatMap(done));
  return out;
}

const SHORT = {
  bundle: "client/downloader/consumer.js", transportWasm: "client/transport-wasm/pkg/transport_wasm_bg.wasm",
  decoderWasm: "lab/decode-bench/vendor/openjph/openjphjs.wasm", meta: "lab/page-open/metadata.json",
};

/** CPU ms each of the browser's processes has spent, exited threads included; the kernel samples it per 10 ms tick. */
function cpu() {
  const out = Object.fromEntries(Object.keys(PROCESSES).map((k) => [k, 0]));
  const tree = [server.process().pid];
  for (let i = 0; i < tree.length; i++) {
    for (const t of fs.readdirSync(`/proc/${tree[i]}/task`)) {
      try { tree.push(...fs.readFileSync(`/proc/${tree[i]}/task/${t}/children`, "utf8").split(" ").filter(Boolean).map(Number)); } catch { /* exited */ }
    }
  }
  for (const pid of tree) {
    try {
      const kind = Object.keys(PROCESSES).find((k) => PROCESSES[k].test(fs.readFileSync(`/proc/${pid}/cmdline`, "utf8")));
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const [utime, stime] = stat.slice(stat.lastIndexOf(")") + 2).split(" ").slice(11, 13).map(Number);
      if (kind) out[kind] += (utime + stime) * 10;
    } catch { /* exited */ }
  }
  return out;
}
const PROCESSES = { cpuNet: /network\.mojom\.NetworkService/, cpuRenderer: /--type=renderer/, cpuBrowser: /^(?![^]*--type=)/ };

async function visit(arm, throttle) {
  const unthrottle = throttleTree(server.process().pid, throttle);
  const page = await browser.newPage();
  let err = null;
  page.on("pageerror", (e) => (err = e.message));
  const url = `https://127.0.0.1:${servers[arm]}/lab/page-open/downloader.html?meta=/lab/page-open/metadata.json` +
    (TRANSPORT === "wasm" ? "&transport=wasm" : "");
  let spent;
  const run = async () => {
    const before = cpu();
    await page.goto(url, { waitUntil: "commit" });
    await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 120000 * throttle, polling: 100 });
    const after = cpu();
    spent = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]));
    return page.evaluate(() => ({
      open: globalThis.__wtpacsOpen,
      error: globalThis.__wtpacsError ?? null,
      resources: performance.getEntriesByType("resource").map((r) => ({
        name: new URL(r.name).pathname.slice(1), end: r.responseEnd, encoded: r.encodedBodySize,
      })),
    }));
  };
  const { out, events } = await (TRACE ? traced(run) : run().then((o) => ({ out: o })))
    .finally(async () => { await page.close(); unthrottle(); });
  if (err || out.error) throw new Error(err || out.error);
  if (process.env.DUMP && TRACE) fs.writeFileSync(`${process.env.DUMP}-${arm}-${throttle}x.json`, JSON.stringify(events));
  // A control that must be able to fail: each asset came as this arm's bytes, or the arm is void.
  for (const r of out.resources.filter((r) => bytes[r.name] && r.encoded)) {
    if (r.encoded !== bytes[r.name][arm]) throw new Error(`${r.name}: ${r.encoded} bytes on the wire, ${bytes[r.name][arm]} expected`);
  }
  const { script, config, session, frame, meta } = out.open;
  const ends = Object.fromEntries(Object.entries(SHORT).map(([k, url]) => [k, out.resources.find((r) => r.name === url)?.end]));
  return { script, config, session, frame, metaParsed: meta, ...spent, ...(TRACE ? milestones(events) : ends) };
}

const rows = [];
const cells = THROTTLES.flatMap((t) => ARMS.map((a) => [t, a]));
for (let round = 0; round < ROUNDS; round++) {
  for (let k = 0; k < cells.length; k++) {
    const [throttle, arm] = cells[(round + k) % cells.length];
    try {
      rows.push({ round, arm, throttle, ...(await visit(arm, throttle)) });
    } catch (e) {
      process.stderr.write(`${arm} ${throttle}x round ${round}: ${e.message.split("\n")[0]}\n`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  process.stderr.write(`round ${round} done\n`);
}
if (process.env.ROWS) fs.writeFileSync(process.env.ROWS, JSON.stringify(rows));

const KEYS = ["bundle", "script", "meta", "metaParsed", "config", "transportWasm", "transportCompiled", "transportStreamLag",
  "decoderWasm", "decoderCompiled", "session", "frame", ...Object.keys(PROCESSES)];
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
console.log(`\nms from navigation: median [min-max], and rounds each arm beat ${ARMS[0]} in`);
for (const throttle of THROTTLES) {
  console.log(`\n${throttle}x ${"milestone".padEnd(18)} ${ARMS.map((a) => a.padEnd(26)).join("")}`);
  for (const key of KEYS) {
    const cells = ARMS.map((arm) => {
      const mine = rows.filter((r) => r.arm === arm && r.throttle === throttle && Number.isFinite(r[key]));
      if (!mine.length) return "-".padEnd(26);
      const v = mine.map((r) => r[key]).sort((x, y) => x - y);
      const ref = new Map(rows.filter((r) => r.arm === ARMS[0] && r.throttle === throttle).map((r) => [r.round, r[key]]));
      const won = mine.filter((r) => ref.has(r.round) && r[key] < ref.get(r.round)).length;
      return `${median(v).toFixed(1)} [${v[0].toFixed(0)}-${v.at(-1).toFixed(0)}] ${arm === ARMS[0] ? "" : `${won}/${mine.length}`}`.padEnd(26);
    });
    console.log(`   ${key.padEnd(18)} ${cells.join("")}`);
  }
}

// What an arm costs on loopback is paid back once the bytes it saves take that long on the link.
console.log(`\nbreak-even: the rate below which each arm's saved bytes outweigh its loopback cost on the first frame`);
const saved = (arm) => total(ARMS[0]) - total(arm);
for (const throttle of THROTTLES) {
  for (const arm of ARMS.slice(1)) {
    const of = (a) => median(rows.filter((r) => r.arm === a && r.throttle === throttle).map((r) => r.frame));
    const cost = of(arm) - of(ARMS[0]);
    const rate = cost > 0 ? `${((saved(arm) * 8) / cost / 1000).toFixed(0)} Mbit/s` : "none: no loopback cost";
    console.log(`${throttle}x ${arm.padEnd(9)} saves ${saved(arm)} B, costs ${cost.toFixed(1)} ms -> ${rate}`);
  }
}
process.exit(0);
