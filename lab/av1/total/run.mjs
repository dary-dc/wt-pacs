/**
 * TOTAL: a whole series filled through the downloader, wire plus decode, every arm of a series on
 * the same link and CPU: HTJ2K, AV1 intra through dav1d-WASM and WebCodecs, the splits, one group,
 * a lossy preview, row LLSIZE's codings (TOTAL2). Fixed rates and phone-like profiles behind the relay, headless Chromium at 1× and
 * 4×. Every visit is its own server, relay and browser; (set × link × throttle) cells in a Williams
 * order each round, the arms inside each cell the same way. lab/av1/total/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs [--rounds 10] [--first-round 0]
 *     [--links r5000,r20000,r50000,lte-good,wifi-home] [--throttles 1,4] [--sets a,b] [--arms a,b]
 *     [--frames lab/.av1-work/total] [--mutate sample|truth] [--out rows.jsonl] [--summary]
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const FIRST = Number(arg("--first-round", 0));
const LINKS = arg("--links", "r5000,r20000,r50000,lte-good,wifi-home").split(",");
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const FRAMES = arg("--frames", "lab/.av1-work/total");
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const ROOT = new URL("../../..", import.meta.url).pathname;
const T = mkdtempSync(path.join(tmpdir(), "av1-total-"));
const port = () => 20000 + ((Math.random() * 25000) | 0);
/** The relay times the link and anything that preempts it reads as jitter: it has a core to itself. */
const RIG_CORE = arg("--rig-core", "3");
const BROWSER_CORES = arg("--browser-cores", "0-2");
const TRACES = process.env.TRACES ?? path.join(homedir(), ".cache/wtpacs-traces");

/** Mahimahi's trace, fetched for local use only (GPL-3.0); its hash as PROF recorded it. */
const LTE = { file: "TMobile-LTE-short.down", sha256: "4f33dce8dd811b5702272af64aaf64d3913719919abd776edf1e0f7c0965da43" };
/** Gilbert–Elliott in percent, bursts of 3.5 packets on average, as profile_cells.sh. */
const ge = (mean) => { const r = 100 / 3.5, m = mean / 100; return ["--loss-model", "ge", "--ge-p", (m * r / (1 - m)).toFixed(5), "--ge-r", r.toFixed(4)]; };
/** One way ms and the relay's link: PROF's profiles without their neighbour or outage. */
function link(name) {
  if (name.startsWith("r")) return [20, ["--rate-kbit", name.slice(1), "--queue-pkts", "200"]];
  if (name === "lte-good") return [25, ["--trace", path.join(TRACES, LTE.file), ...ge(0.01), "--queue-ms", "500"]];
  if (name === "wifi-home") return [15, ["--trace", `${T}/wifi-home.trace`, ...ge(0.5), "--queue-ms", "300"]];
  throw new Error(`unknown link ${name}`);
}

const sha256 = (file) => new Promise((resolve) => {
  const h = createHash("sha256");
  createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex")));
});
if (LINKS.includes("lte-good")) {
  mkdirSync(TRACES, { recursive: true });
  const file = path.join(TRACES, LTE.file);
  if (!existsSync(file)) execFileSync("curl", ["-sSfL", "-o", file, `https://raw.githubusercontent.com/ravinet/mahimahi/master/traces/${LTE.file}`]);
  if ((await sha256(file)) !== LTE.sha256) throw new Error(`${file}: not the trace PROF measured`);
}
writeFileSync(`${T}/wifi-home.trace`, execFileSync("python3", [path.join(ROOT, "lab/scripts/gen_step_trace.py"),
  "15000:12000", "40000:12000", "10000:12000", "30000:12000", "15000:12000"]));

const DAV1D = { codec: "av1", glue: "/lab/.av1-build/out/simd.js", wasm: "/lab/.av1-build/out/simd.wasm", dir: "/lab/.av1-build/out" };
const OPENJPH = { glue: "/lab/decode-bench/vendor/openjph/openjphjs.js", wasm: "/lab/decode-bench/vendor/openjph/openjphjs.wasm", dir: "/lab/decode-bench/vendor/openjph" };
/** What the store holds for an arm, and what connect is told: the product's own decoder choice. */
function arm(set, name) {
  const a = set.arms[name];
  const ext = a.ext ?? (name === "wc" ? "av1" : name);
  if (name === "htj2k") return { ext, opts: { decoder: OPENJPH } };
  const decoder = { ...DAV1D, ...(a.split && { split: a.split }), ...(a.depth && { depth: a.depth }), ...(a.offset && { offset: a.offset }),
    ...(a.rct && { rct: true }) };
  return { ext, opts: { decoder, ...(a.group && { groupLength: a.group, frameCount: set.frames }) }, truth: a.truth };
}

const sets = readdirSync(path.join(ROOT, FRAMES)).filter((d) => existsSync(path.join(ROOT, FRAMES, d, "arms.json")))
  .map((d) => JSON.parse(readFileSync(path.join(ROOT, FRAMES, d, "arms.json"), "utf8")))
  .filter((s) => arg("--sets", s.name).split(",").includes(s.name));
const ARMS = arg("--arms", null)?.split(",");
for (const s of sets) s.armNames = Object.keys(s.arms).filter((a) => !ARMS || ARMS.includes(a));

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT, stdio: "inherit" });
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
  "-keyout", `${T}/key.pem`, "-out", `${T}/cert.pem`, "-days", "2", "-nodes", "-subj", "/CN=localhost",
  "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
const der = execFileSync("openssl", ["x509", "-in", `${T}/cert.pem`, "-outform", "DER"]);
const HASH = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: der }).toString().split(" ")[0];

/** One study per (set × stored form): the store holds a frame's bytes whatever made them. */
function pack(set, ext) {
  const dir = `${T}/${set.name}-${ext}`;
  if (existsSync(`${dir}.sbnd`)) return `${dir}.sbnd`;
  mkdirSync(dir);
  for (let i = 0; i < set.frames; i++) {
    const n = String(i).padStart(3, "0");
    symlinkSync(path.join(ROOT, FRAMES, set.name, `${n}.${ext}`), `${dir}/${n}.htj2k`);
  }
  writeFileSync(`${dir}.json`, JSON.stringify({ frameCount: set.frames, codec: ext === "htj2k" ? "htj2k" : "av1" }));
  execFileSync(path.join(ROOT, "target/release/pack-study"),
    ["--metadata", `${dir}.json`, "--frames", dir, "--output", `${dir}.sbnd`], { stdio: "ignore" });
  return `${dir}.sbnd`;
}

const CHROME = process.env.CHROME_PATH || chromium.executablePath();
writeFileSync(`${T}/chrome.sh`, `#!/bin/sh\nexec taskset -c ${BROWSER_CORES} "${CHROME}" "$@"\n`, { mode: 0o755 });

const HTTP = port();
const http = spawn("python3", ["server/dev-server.py", "--port", String(HTTP)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const started = (child, re) => new Promise((resolve, reject) => {
  let out = "";
  child.stdout.on("data", (d) => { out += d; if (re.test(out)) resolve(); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});

async function visit(set, armName, linkName, throttle, round) {
  const a = arm(set, armName);
  const truth = (a.truth ?? set.truth).map((t) => (MUTATE === "truth" ? t.replace(/^./, (c) => (c === "0" ? "1" : "0")) : t));
  const srv = port();
  const relayPort = port();
  const server = spawn("taskset", ["-c", BROWSER_CORES, path.join(ROOT, "target/release/exact-server"), "--port", String(srv), "--bind", "127.0.0.1",
    "--study", pack(set, a.ext), "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], { stdio: "ignore" });
  const [oneWay, linkArgs] = link(linkName);
  const relay = spawn("chrt", ["-f", "50", "taskset", "-c", RIG_CORE, "python3", "lab/scripts/link_impair.py", "--udp", `${relayPort}:${srv}`,
    "--seed", String(round), "--delay-ms", String(oneWay), ...linkArgs, "--self-timing"], { cwd: ROOT });
  let relayLog = "";
  relay.stdout.on("data", (d) => (relayLog += d));
  relay.stderr.on("data", (d) => (relayLog += d));
  await new Promise((r) => setTimeout(r, 500));
  if (!/READY/.test(relayLog)) await started(relay, /READY/);

  const browser = await chromium.launchServer({ executablePath: `${T}/chrome.sh` });
  const client = await chromium.connect(browser.wsEndpoint());
  const page = await client.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stop = throttleTree(browser.process().pid, throttle);
  const q = new URLSearchParams({ opts: JSON.stringify(a.opts), fill: set.frames, wt: `https://127.0.0.1:${relayPort}/`, hash: HASH,
    ...(MUTATE === "sample" ? { mutate: "sample" } : {}) });
  let r = null;
  try {
    await page.goto(`http://127.0.0.1:${HTTP}/lab/av1/total/index.html?${q}`);
    await page.waitForFunction(() => globalThis.__result, null, { timeout: 600000, polling: 200 });
    r = await page.evaluate(() => globalThis.__result);
    if (r.error) throw new Error(r.error);
  } catch (e) {
    errors.push(String(e.message).split("\n")[0]);
    r = null;
  }
  stop();
  await client.close();
  await browser.close();
  const exited = new Promise((res) => relay.once("exit", res));
  relay.kill("SIGTERM");
  await exited;
  server.kill();

  const late = relayLog.match(/self-timing packets \d+ late p50 [\d.]+ p99 ([\d.]+)/g)?.pop();
  const row = { round, set: set.name, arm: armName, link: linkName, throttle, errors, relayP99: late ? Number(late.split(" p99 ")[1]) : null,
    void: !late || /VOID/.test(relayLog) };
  if (!r?.frames.length) return { ...row, frames: 0, exact: 0, failure: r?.failures[0]?.reason };
  const t = (k, f) => f(...r.frames.map((x) => x[k])) - r.issuedAt;
  return {
    ...row,
    frames: r.frames.length,
    failures: r.failures.length,
    failure: r.failures[0]?.reason,
    exact: r.frames.filter((f) => r.sha[f.i] === truth[f.i]).length,
    firstMs: Math.round(t("page", Math.min)),
    receivedMs: Math.round(t("lastByte", Math.max)),
    decodedMs: Math.round(t("page", Math.max)),
  };
}

const cells = sets.flatMap((s) => LINKS.flatMap((l) => THROTTLES.map((throttle) => ({ set: s.name, link: l, throttle }))));
const rows = [];
for (let round = FIRST; round < FIRST + ROUNDS && !process.argv.includes("--summary"); round++) {
  for (const [k, { set: name, link: l, throttle }] of order(cells, round).entries()) {
    const set = sets.find((s) => s.name === name);
    let prev = null;
    for (const a of order(set.armNames, round + k)) {
      const row = { ...(await visit(set, a, l, throttle, round)), prev };
      prev = a;
      rows.push(row);
      if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.error(`round ${round} ${name} ${l} ${throttle}x ${a}: first ${row.firstMs} received ${row.receivedMs} decoded ${row.decodedMs} ms,` +
        ` exact ${row.exact}/${set.frames}, relay p99 ${row.relayP99}${row.void ? " VOID" : ""}${row.errors.length ? " " + row.errors[0] : ""}${row.failure ? " " + row.failure : ""}`);
    }
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const span = (a) => `${med(a).toFixed(0)} [${Math.min(...a)}–${Math.max(...a)}]`;
if (OUT) rows.splice(0, rows.length, ...readFileSync(OUT, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
const kept = rows.filter((r) => !r.void && r.frames);
console.log("ms from the fill's issue: first frame on the page, every frame on the page — median [min–max], n kept; " +
  "÷ HTJ2K on every frame, median of rounds paired; frames exact over every visit");
for (const { set: name, link: l, throttle } of cells) {
  const set = sets.find((s) => s.name === name);
  const of = (a, from = kept) => from.filter((r) => r.set === name && r.link === l && r.throttle === throttle && r.arm === a);
  const ref = new Map(of("htj2k").map((r) => [r.round, r.decodedMs]));
  const parts = set.armNames.map((a) => {
    const rs = of(a);
    const all = of(a, rows);
    const exact = `${all.reduce((n, r) => n + r.exact, 0)}/${all.length * set.frames}`;
    if (!rs.length) return `${a} none kept, exact ${exact}`;
    let s = `${a} first ${span(rs.map((r) => r.firstMs))} all ${span(rs.map((r) => r.decodedMs))} n=${rs.length} exact ${exact}`;
    const d = rs.filter((r) => a !== "htj2k" && ref.has(r.round)).map((r) => r.decodedMs / ref.get(r.round));
    if (d.length) s += ` ×${med(d).toFixed(2)} (slower ${d.filter((x) => x > 1).length}/${d.length})`;
    return s;
  });
  console.log(`${name} ${l} ${throttle}x: ${parts.join(" · ")}`);
}
console.log(`VOID, dropped: ${rows.filter((r) => r.void).length} of ${rows.length}`);
process.exit(0);
