/**
 * FILL: a whole series filled through the downloader with today's three decoders, HTJ2K against
 * AV1 (and WebCodecs on the 8-bit series), the real server behind the relay, headless Chromium at
 * 1× and 4×. Every visit is its own server, relay and browser; (set × rate × throttle) cells run in
 * a Williams order each round and the arms inside each cell the same way. lab/av1/fill/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/fill/run.mjs [--rounds 10] [--rates 20000,50000]
 *     [--throttles 1,4] [--rtt 40] [--sets a,b] [--frames lab/.av1-work/fill] [--mutate sample|truth]
 *     [--first-round 0] [--out rows.jsonl] [--arms htj2k,av1,av1-t4@2/3] [--cores 3]
 *
 * An arm `EXT[@T][/D]` is the frames NNN.EXT on dav1d-WASM, threaded with T threads (the simd-mt build)
 * and D decoders (default 3); `htj2k` and `webcodecs` are as above. lab/av1/decspeed/README.md
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
/** Carries a campaign on in its Williams order; with `--out`, the summary reads every row the file holds. */
const FIRST = Number(arg("--first-round", 0));
const RATES = arg("--rates", "20000,50000").split(",").map(Number);
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const RTT = Number(arg("--rtt", 40));
const FRAMES = arg("--frames", "lab/.av1-work/fill");
const MUTATE = arg("--mutate", "");
const OUT = arg("--out", null);
const ARMS = arg("--arms", null)?.split(",");
/** With it, 4× is that many slowed cores for the whole browser, not a quarter-core for each thread. */
const CORES = arg("--cores", null) && Number(arg("--cores"));
const ext = (arm) => (arm === "webcodecs" ? "av1" : arm.split(/[@/]/)[0]);
const ROOT = new URL("../../..", import.meta.url).pathname;
const T = mkdtempSync(path.join(tmpdir(), "av1-fill-"));
const port = () => 20000 + ((Math.random() * 25000) | 0);
/** The relay times the link and anything that preempts it reads as jitter: it has a core to itself. */
const RIG_CORE = arg("--rig-core", "3");
const BROWSER_CORES = arg("--browser-cores", "0-2");

const manifest = JSON.parse(readFileSync(path.join(ROOT, FRAMES, "manifest.json"), "utf8"));
const SETS = arg("--sets", manifest.map((s) => s.name).join(",")).split(",");

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server"], { cwd: ROOT, stdio: "inherit" });
execFileSync("cargo", ["build", "-q", "--release", "-p", "pack-study"], { cwd: ROOT, stdio: "inherit" });
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
  "-keyout", `${T}/key.pem`, "-out", `${T}/cert.pem`, "-days", "2", "-nodes", "-subj", "/CN=localhost",
  "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
const der = execFileSync("openssl", ["x509", "-in", `${T}/cert.pem`, "-outform", "DER"]);
const HASH = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: der }).toString().split(" ")[0];

/** One study per (set × codec): the store holds a frame's bytes whatever codec made them. */
function pack(set, ext) {
  const dir = `${T}/${set.name}-${ext}`;
  mkdirSync(dir);
  set.frames.forEach((_, i) => {
    const n = String(i).padStart(3, "0");
    symlinkSync(path.join(ROOT, FRAMES, set.name, `${n}.${ext}`), `${dir}/${n}.htj2k`);
  });
  writeFileSync(`${dir}.json`, JSON.stringify({ frameCount: set.frames.length, codec: ext }));
  execFileSync(path.join(ROOT, "target/release/pack-study"),
    ["--metadata", `${dir}.json`, "--frames", dir, "--output", `${dir}.sbnd`], { stdio: "ignore" });
  return `${dir}.sbnd`;
}

const CHROME = process.env.CHROME_PATH || chromium.executablePath();
writeFileSync(`${T}/chrome.sh`, `#!/bin/sh\nexec taskset -c ${BROWSER_CORES} "${CHROME}" "$@"\n`, { mode: 0o755 });

const sets = manifest.filter((s) => SETS.includes(s.name)).map((s) => ({
  ...s,
  arms: ARMS?.filter((a) => a !== "webcodecs" || s.webcodecs) ?? (s.webcodecs ? ["htj2k", "av1", "webcodecs"] : ["htj2k", "av1"]),
  truth: s.frames.map((f) => (MUTATE === "truth" ? f.truth.replace(/^./, (c) => (c === "0" ? "1" : "0")) : f.truth)),
}));
for (const s of sets) s.studies = Object.fromEntries([...new Set(s.arms.map(ext))].map((e) => [e, pack(s, e)]));

const HTTP = port();
const http = spawn("python3", ["server/dev-server.py", "--port", String(HTTP)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const started = (child, re) => new Promise((resolve, reject) => {
  let out = "";
  child.stdout.on("data", (d) => { out += d; if (re.test(out)) resolve(); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});

async function visit(set, arm, rate, throttle, round) {
  const srv = port();
  const relayPort = port();
  const server = spawn("taskset", ["-c", BROWSER_CORES, path.join(ROOT, "target/release/exact-server"), "--port", String(srv), "--bind", "127.0.0.1",
    "--study", set.studies[ext(arm)], "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`],
  { stdio: "ignore" });
  const relay = spawn("chrt", ["-f", "50", "taskset", "-c", RIG_CORE, "python3", "lab/scripts/link_impair.py", "--udp", `${relayPort}:${srv}`, "--seed", String(round),
    "--delay-ms", String(RTT / 2), "--rate-kbit", String(rate), "--queue-pkts", "200", "--self-timing"], { cwd: ROOT });
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
  const stop = throttleTree(browser.process().pid, throttle, CORES ? { cores: CORES } : {});
  const q = new URLSearchParams({ arm, fill: set.frames.length, wt: `https://127.0.0.1:${relayPort}/`, hash: HASH,
    ...(arm === "webcodecs" ? { wc: set.webcodecs } : {}), ...(MUTATE === "sample" ? { mutate: "sample" } : {}) });
  let r = null;
  try {
    await page.goto(`http://127.0.0.1:${HTTP}/lab/av1/fill/index.html?${q}`);
    await page.waitForFunction(() => globalThis.__result, null, { timeout: 300000, polling: 200 });
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
  const row = { round, set: set.name, arm, rate, throttle, errors, relayP99: late ? Number(late.split(" p99 ")[1]) : null,
    void: !late || /VOID/.test(relayLog) };
  if (!r) return { ...row, frames: 0, exact: 0 };
  const t = (k) => Math.max(...r.frames.map((f) => f[k])) - r.issuedAt;
  return {
    ...row,
    frames: r.frames.length,
    failures: r.failures.length,
    exact: r.frames.filter((f) => r.sha[f.i] === set.truth[f.i]).length,
    receivedMs: Math.round(t("lastByte")),
    decodedMs: Math.round(t("page")),
    // Decoding the frames after the last byte: what the decoders add to the fill once the wire is done.
    decodeMs: Math.round(r.frames.reduce((n, f) => n + f.decodeEnd - f.decodeStart, 0)),
    decoderReadyMs: Math.round(Math.max(...r.frames.map((f) => f.decoderReady)) - r.issuedAt),
  };
}

const cells = SETS.flatMap((set) => RATES.flatMap((rate) => THROTTLES.map((throttle) => ({ set, rate, throttle }))));
const rows = [];
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const [k, { set: name, rate, throttle }] of order(cells, round).entries()) {
    const set = sets.find((s) => s.name === name);
    let prev = null;
    for (const arm of order(set.arms, round + k)) {
      const row = { ...(await visit(set, arm, rate, throttle, round)), prev };
      prev = arm;
      rows.push(row);
      if (OUT) appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.error(`round ${round} ${name} ${rate / 1000} Mbit ${throttle}x ${arm}: received ${row.receivedMs} decoded ${row.decodedMs} ms,` +
        ` exact ${row.exact}/${set.frames.length}, relay p99 ${row.relayP99}${row.void ? " VOID" : ""}${row.errors.length ? " " + row.errors[0] : ""}`);
    }
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const span = (a) => `${med(a).toFixed(0)} [${Math.min(...a)}–${Math.max(...a)}]`;
if (OUT) rows.splice(0, rows.length, ...readFileSync(OUT, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
const kept = rows.filter((r) => !r.void && r.frames);
console.log(`ms from the fill's issue: all received, all decoded — median [min–max]; AV1 − HTJ2K on decoded, paired by round; exact frames`);
for (const { set: name, rate, throttle } of cells) {
  const set = sets.find((s) => s.name === name);
  const of = (arm) => kept.filter((r) => r.set === name && r.rate === rate && r.throttle === throttle && r.arm === arm);
  const ref = new Map(of("htj2k").map((r) => [r.round, r.decodedMs]));
  const parts = set.arms.map((arm) => {
    const rs = of(arm);
    const all = rows.filter((r) => r.set === name && r.rate === rate && r.throttle === throttle && r.arm === arm);
    const exact = `${all.reduce((n, r) => n + r.exact, 0)}/${all.length * set.frames.length}`;
    if (!rs.length) return `${arm} none kept, exact ${exact}`;
    let s = `${arm} received ${span(rs.map((r) => r.receivedMs))} decoded ${span(rs.map((r) => r.decodedMs))} n=${rs.length} exact ${exact}`;
    if (arm !== "htj2k") {
      const d = rs.filter((r) => ref.has(r.round)).map((r) => r.decodedMs - ref.get(r.round));
      if (d.length) s += `, ${d.length ? `${med(d) >= 0 ? "+" : ""}${med(d).toFixed(0)} ms, slower ${d.filter((x) => x > 0).length}/${d.length}` : ""}`;
    }
    return s;
  });
  console.log(`${name} ${rate / 1000} Mbit ${throttle}x: ${parts.join(" · ")}`);
}
console.log(`VOID, dropped: ${rows.filter((r) => r.void).length} of ${rows.length}`);
process.exit(0);
