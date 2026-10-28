// The viewer spike's runner: each visit its own series-server, relay and headless Chromium. docs/viewer/architecture.md §The spike
//
//   NODE_PATH=$(npm root -g) node lab/viewer-spike/run.mjs --dbt DBT.sbnd --ffdm FFDM.sbnd --gate [--mutate sample|row] --out gate.jsonl
//   ... --rounds 10 [--first-round 0] --out rows.jsonl
//   ... --summary --out rows.jsonl
import { execFileSync, spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { order } from "../order.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const OUT = path.resolve(arg("--out", "rows.jsonl"));
const SERIES = { dbt: arg("--dbt"), ffdm: arg("--ffdm") };
const MUTATE = arg("--mutate", "");
const OPTIONS = arg("--options", "a,b").split(",");
// The rig of total-time: the relay alone on core 3, browser and server on 0–2.
const [RIG, BROWSER] = ["3", "0-2"];
const T = mkdtempSync(path.join(tmpdir(), "viewer-spike-"));
const children = new Set();
process.on("exit", () => { for (const c of children) try { process.kill(-c.pid, "SIGKILL"); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function own(cmd, args, opts = {}) {
  const c = spawn(cmd, args, { detached: true, cwd: ROOT, ...opts });
  children.add(c);
  c.once("exit", () => children.delete(c));
  return c;
}
const started = (child, re) => new Promise((resolve, reject) => {
  let out = "";
  const on = (d) => { out += d; const m = re.exec(out); if (m) resolve(m); };
  child.stdout.on("data", on);
  child.stderr?.on("data", on);
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});
async function udpPort() {
  const s = createSocket("udp4");
  await new Promise((r) => s.bind(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", `${T}/key.pem`, "-out", `${T}/cert.pem`,
  "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
const HASH = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: execFileSync("openssl", ["x509", "-in", `${T}/cert.pem`, "-outform", "DER"]) })
  .toString().split(" ")[0];
const CHROME = process.env.CHROME_PATH || createRequire(import.meta.url)("playwright").chromium.executablePath();
writeFileSync(`${T}/chrome.sh`, `#!/bin/sh\nexec taskset -c ${BROWSER} "${CHROME}" "$@"\n`, { mode: 0o755 });

/** The bundle's metadata, which the page reads at /series/metadata. */
function metadataOf(sbnd) {
  const b = readFileSync(sbnd);
  const at = 16 + 12 * b.readUInt32LE(12);
  return b.subarray(at, at + b.readUInt32LE(8));
}

/** One visit: server, relay on `relay` links, static host, browser; `work` runs against the page's `spike` object. */
async function visit({ option, series, link, round, work }) {
  const srv = await udpPort();
  const server = own("taskset", ["-c", BROWSER, path.join(ROOT, "target/release/series-server"), "--port", String(srv), "--bind", "127.0.0.1",
    "--series", SERIES[series], "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], { stdio: ["ignore", "pipe", "pipe"] });
  await started(server, /transport=/);
  let wt = srv;
  let relay = null;
  let relayLog = "";
  if (link === "r20000l2") {
    wt = await udpPort();
    relay = own("chrt", ["-f", "50", "taskset", "-c", RIG, "python3", "lab/scripts/link_impair.py", "--udp", `${wt}:${srv}`, "--seed", String(round),
      "--delay-ms", "20", "--rate-kbit", "20000", "--queue-pkts", "200", "--loss", "2", "--self-timing"], { stdio: ["ignore", "pipe", "pipe"] });
    relay.stdout.on("data", (d) => (relayLog += d));
    relay.stderr.on("data", (d) => (relayLog += d));
    await started(relay, /READY/);
  }
  writeFileSync(`${T}/metadata.json`, metadataOf(SERIES[series]));
  writeFileSync(`${T}/transport.json`, JSON.stringify({ wt_url: `https://127.0.0.1:${wt}/`, cert_sha256: HASH }));
  const http = own("python3", ["server/dev-server.py", "--port", "0", "--metadata", `${T}/metadata.json`, "--transport", `${T}/transport.json`],
    { stdio: ["ignore", "pipe", "inherit"] });
  const [, port] = await started(http, /port=(\d+)/);

  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch({ executablePath: `${T}/chrome.sh`, args: ["--enable-blink-features=ForceEagerMeasureMemory"] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const fetched = [];
  page.on("response", (r) => {
    const at = Date.now();
    if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
    fetched.push(r.body().then((b) => ({ url: new URL(r.url()).pathname, at, bytes: b.length >= 1024 ? gzipSync(b, { level: 6 }).length : b.length }), () => null));
  });
  await page.addInitScript(() => {
    globalThis.__long = [];
    new PerformanceObserver((l) => globalThis.__long.push(...l.getEntries().map((e) => [e.startTime, e.duration]))).observe({ type: "longtask", buffered: true });
  });
  const row = { round, option, series, link, mutate: MUTATE || undefined, browser: browser.version(), started: Date.now() };
  try {
    const q = MUTATE ? `?mutate=${MUTATE}` : "";
    await page.goto(`http://127.0.0.1:${port}/lab/viewer-spike/${option}/index.html${q}`);
    await page.waitForFunction(() => globalThis.spike, null, { timeout: 120000 });
    const first = await page.evaluate(() => Promise.race([spike.first, new Promise((_, no) => setTimeout(() => no(new Error("no first image in 240 s")), 240000))]));
    const { origin, long } = await page.evaluate(() => ({ origin: performance.timeOrigin, long: globalThis.__long }));
    // Each file once, as lab/page-open counts them: a worker's second fetch of one is not a second download.
    const before = [...new Map((await Promise.all(fetched)).filter((f) => f && f.at <= origin + first.ms).map((f) => [f.url, f])).values()];
    Object.assign(row, { firstMs: first.ms, openBytes: before.reduce((s, f) => s + f.bytes, 0), openFiles: before.length,
      longTaskMs: long.reduce((s, [t, d]) => s + Math.max(0, Math.min(d, first.ms - t)), 0) });
    if (work) Object.assign(row, await work(page));
  } catch (e) {
    row.error = String(e.message).split("\n")[0];
    row.exact = await page.evaluate(() => Promise.race([spike.summary.then((s) => s.exact), new Promise((r) => setTimeout(r, 60000))])).catch(() => undefined);
  }
  row.errors = errors.slice(0, 3);
  row.ended = Date.now();
  await browser.close().catch(() => {});
  if (relay) {
    const exited = new Promise((r) => relay.once("exit", r));
    process.kill(-relay.pid, "SIGTERM");
    await Promise.race([exited, sleep(5000)]);
    row.void = !/self-timing packets/.test(relayLog) || /VOID/.test(relayLog);
  }
  for (const c of [server, http]) try { process.kill(-c.pid, "SIGKILL"); } catch {}
  return row;
}

const MEMORY = async () => {
  const m = await performance.measureUserAgentSpecificMemory();
  const scope = {};
  for (const b of m.breakdown) for (const a of b.attribution.length ? b.attribution : [{ scope: "shared" }]) scope[a.scope] = (scope[a.scope] ?? 0) + b.bytes / Math.max(1, b.attribution.length);
  return { bytes: m.bytes, scope };
};

/** Loopback: the fill, then on DBT the scroll, then memory above the decoded bytes. */
const timed = (series) => async (page) => {
  const filled = await page.evaluate(() => spike.summary);
  const out = { exact: filled.exact, n: filled.n, frameErrors: filled.errors.slice(0, 2) };
  if (series === "dbt") {
    const t0 = Date.now();
    const s = await page.evaluate(() => spike.scroll());
    out.scrollSpan = [t0, Date.now()];
    out.scrollFps = s.fps;
    out.scrollInOrder = s.rendered.length === 3 * filled.n;
  }
  const m = await page.evaluate(MEMORY);
  return { ...out, memoryAboveDecodedMiB: (m.bytes - filled.decodedBytes) / 2 ** 20, windowMiB: ((m.scope.Window ?? 0) - filled.decodedBytes) / 2 ** 20,
    workersMiB: ((m.scope.DedicatedWorkerGlobalScope ?? 0)) / 2 ** 20 };
};

/** The gate: every frame exact, the readbacks at 1:1, and one sweep by the option's own cine. */
const gate = (series, option) => async (page) => {
  const filled = await page.evaluate(() => spike.summary);
  const out = { exact: filled.exact, n: filled.n, frameErrors: filled.errors.slice(0, 2), readbacks: [] };
  const frames = series === "dbt" ? [0, 25, 49] : [0, 1, 2, 3];
  for (const i of frames) for (const which of ["first", "identity"]) {
    out.readbacks.push({ i, which, ...(await page.evaluate(([i, which]) => spike.readback(i, which).catch((e) => ({ error: e.message })), [i, which])) });
  }
  if (series === "dbt") {
    const inOrder = (r) => r.length === filled.n && r.every((x, k) => x === k);
    for (const wait of option === "a" ? [true, false] : [true]) {
      const c = await page.evaluate((wait) => spike.cine({ wait }), wait);
      out[wait ? "cine" : "cineToday"] = { inOrder: inOrder(c.rendered), rendered: c.rendered.length, skipped: filled.n - new Set(c.rendered).size, ms: c.ms };
    }
  }
  return out;
};

const cells = ["dbt:loop", "dbt:r20000l2", "ffdm:loop", "ffdm:r20000l2"];
if (has("--gate")) {
  for (const series of ["dbt", "ffdm"]) for (const option of OPTIONS) {
    const row = await visit({ option, series, link: "loop", round: 0, work: gate(series, option) });
    appendFileSync(OUT, JSON.stringify(row) + "\n");
    console.log(JSON.stringify(row));
  }
} else if (!has("--summary")) {
  const first = Number(arg("--first-round", 0));
  for (let round = first; round < first + Number(arg("--rounds", 10)); round++) {
    for (const [k, cell] of order(cells, round).entries()) {
      const [series, link] = cell.split(":");
      for (const option of order(OPTIONS, round + k)) {
        const row = await visit({ option, series, link, round, work: link === "loop" && timed(series) });
        appendFileSync(OUT, JSON.stringify(row) + "\n");
        console.log(`${round} ${cell} ${option} first ${row.firstMs?.toFixed(0)} ms` + (row.scrollFps ? ` scroll ${row.scrollFps.toFixed(2)}/s` : "") +
          (row.memoryAboveDecodedMiB !== undefined ? ` mem+ ${row.memoryAboveDecodedMiB.toFixed(1)} MiB` : "") + ` open ${row.openBytes} B` +
          `${row.void ? " VOID" : ""}${row.error ? " " + row.error : ""}`);
      }
    }
  }
} else {
  const rows = readFileSync(OUT, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => !r.void && !r.error);
  const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const range = (v) => `${median(v).toFixed(1)} [${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}]`;
  for (const cell of cells) {
    const [series, link] = cell.split(":");
    const at = (o) => rows.filter((r) => r.series === series && r.link === link && r.option === o);
    const rounds = [...new Set(at("a").map((r) => r.round))].filter((r) => at("b").some((x) => x.round === r));
    console.log(`${cell}: ${rounds.length} kept pairs`);
    for (const k of ["firstMs", "scrollFps", "memoryAboveDecodedMiB", "windowMiB", "workersMiB", "openBytes", "longTaskMs"]) {
      const v = (o) => at(o).filter((r) => rounds.includes(r.round) && Number.isFinite(r[k])).map((r) => r[k]);
      if (!v("a").length) continue;
      const ratio = rounds.map((r) => at("b").find((x) => x.round === r)[k] / at("a").find((x) => x.round === r)[k]).filter(Number.isFinite);
      console.log(`  ${k}: A ${range(v("a"))} · B ${range(v("b"))} · B/A per round ${range(ratio.map((x) => x * 100))} %`);
    }
    const exact = (o) => at(o).every((r) => r.exact === undefined || r.exact === r.n) && at(o).every((r) => r.scrollInOrder !== false);
    console.log(`  every frame exact and every scroll in order: A ${exact("a")} · B ${exact("b")}`);
  }
}
