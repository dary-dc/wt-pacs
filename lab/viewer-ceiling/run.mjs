// Row 273: the largest series the product page fills, per engine, and its memory then.
// Protocol and results: docs/merge-readiness.md §273 VIEWERCEILING, docs/ARCHITECTURE.md §Open.
//
//   NODE_PATH=$(npm root -g) CHROME_PATH=... FIREFOX_PATH=... OJPH=<ingest build>/openjph PYTHON=... \
//     node lab/viewer-ceiling/run.mjs --work DIR --out rows.jsonl [--sizes 512x512,2048x2048,3328x4096] [--rounds 3]
import { execFileSync, spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const BIN = path.resolve(ROOT, process.env.CARGO_TARGET_DIR || "target", "release");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg("--work"));
const OUT = path.resolve(arg("--out"));
const SIZES = arg("--sizes", "512x512,2048x2048,3328x4096").split(",").map((s) => s.split("x").map(Number));
const ROUNDS = Number(arg("--rounds", 3));
const ENGINES = arg("--engines", "chromium,firefox").split(",");
const FIRST = Number(arg("--first", 64));
const LAST = Number(arg("--last", 4096));
// MiB of headroom() kept; below it the browser is stopped and the round is the host's, not the page's.
const GUARD_MIB = Number(arg("--guard", 1536));
const STALL_S = Number(arg("--stall", 120));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = new Set();
process.on("exit", () => { for (const c of children) try { process.kill(-c.pid, "SIGKILL"); } catch {} });

const meminfo = () => Object.fromEntries(readFileSync("/proc/meminfo", "utf8").trim().split("\n")
  .map((l) => l.split(/:\s+/)).map(([k, v]) => [k, parseInt(v, 10) / 1024]));

/** This process's memory cgroup (v1 or v2), whose limit can sit below the host's RAM. */
const CGROUP = (() => {
  const line = readFileSync("/proc/self/cgroup", "utf8").split("\n").find((l) => /^\d+:memory:/.test(l) || l.startsWith("0::"));
  const rel = line?.split(":")[2];
  for (const [dir, limit, usage, inactive] of [[`/sys/fs/cgroup/memory${rel}`, "memory.limit_in_bytes", "memory.usage_in_bytes", "total_inactive_file"],
    [`/sys/fs/cgroup${rel}`, "memory.max", "memory.current", "inactive_file"]]) {
    try {
      const max = Number(readFileSync(`${dir}/${limit}`, "utf8"));
      if (max > 0 && max < 2 ** 60) return { dir, max, usage, inactive };
    } catch {}
  }
  return null;
})();

/** MiB this process tree can still take: the host's available memory, or its cgroup's headroom when that is less. */
function headroom() {
  const host = meminfo().MemAvailable;
  if (!CGROUP) return host;
  const stat = readFileSync(`${CGROUP.dir}/memory.stat`, "utf8");
  const inactive = Number(new RegExp(`^${CGROUP.inactive} (\\d+)`, "m").exec(stat)?.[1] ?? 0);
  const used = Number(readFileSync(`${CGROUP.dir}/${CGROUP.usage}`, "utf8")) - inactive;
  return Math.min(host, (CGROUP.max - used) / 2 ** 20);
}

/** PSS of a process and its descendants, MiB: shared pages counted once across the browser's processes. */
function treePss(root) {
  const kids = new Map();
  for (const p of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const ppid = readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1];
      kids.set(ppid, [...(kids.get(ppid) ?? []), p]);
    } catch {}
  }
  let mib = 0;
  for (const todo = [String(root)]; todo.length;) {
    const p = todo.pop();
    todo.push(...(kids.get(p) ?? []));
    try { mib += parseInt(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${p}/smaps_rollup`, "utf8"))[1], 10) / 1024; } catch {}
  }
  return mib;
}

const started = (child, stream, re) => new Promise((resolve, reject) => {
  let out = "";
  child[stream].on("data", (d) => { out += d; const m = re.exec(out); if (m) resolve(m); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});

function own(cmd, args, opts = {}) {
  const c = spawn(cmd, args, { detached: true, ...opts });
  children.add(c);
  c.once("exit", () => children.delete(c));
  return c;
}

/** A series served as client/viewer/check.mjs serves it: the server on a fresh cert, the static host told both files. */
async function host(sbnd, dir) {
  const [key, cert] = [`${dir}/key.pem`, `${dir}/cert.pem`];
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", key, "-out", cert,
    "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const hash = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: execFileSync("openssl", ["x509", "-in", cert, "-outform", "DER"]) })
    .toString().split(" ")[0];
  const s = createSocket("udp4");
  await new Promise((r) => s.bind(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  const server = own(`${BIN}/series-server`, ["--port", String(port), "--bind", "127.0.0.1", "--series", sbnd, "--cert-pem", cert, "--key-pem", key],
    { stdio: ["ignore", "pipe", "inherit"] });
  await started(server, "stdout", /transport=/);
  const b = readFileSync(sbnd);
  const at = 16 + 12 * b.readUInt32LE(12);
  writeFileSync(`${dir}/metadata.json`, b.subarray(at, at + b.readUInt32LE(8)));
  writeFileSync(`${dir}/transport.json`, JSON.stringify({ wt_url: `https://127.0.0.1:${port}/`, cert_sha256: hash }));
  const http = own("python3", [path.join(ROOT, "server/dev-server.py"), "--port", "0", "--metadata", `${dir}/metadata.json`,
    "--transport", `${dir}/transport.json`], { stdio: ["ignore", "pipe", "inherit"] });
  const [, p] = await started(http, "stdout", /port=(\d+)/);
  return { url: `http://127.0.0.1:${p}/`, stop: () => { for (const c of [server, http]) process.kill(-c.pid, "SIGKILL"); } };
}

/** Headless Chromium through playwright, as the viewer check opens it. */
async function chromium(url) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const before = new Set(readdirSync("/proc"));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const pid = readdirSync("/proc").find((p) => !before.has(p) && /^\d+$/.test(p) &&
    readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1] === String(process.pid));
  const tab = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  let gone = null;
  tab.on("crash", () => (gone = "the page crashed"));
  browser.on("disconnected", () => (gone ??= "the browser exited"));
  await tab.goto(url);
  return {
    version: `Chromium ${browser.version()}`, pid: Number(pid), gone: () => gone,
    evaluate: (expr) => tab.evaluate(`(${expr})()`),
    close: () => browser.close().catch(() => {}),
  };
}

/** A stock headless Firefox driven over WebDriver BiDi, which it serves itself. */
async function firefox(url, dir) {
  const profile = mkdtempSync(path.join(dir, "ff-"));
  writeFileSync(path.join(profile, "user.js"), ['user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("webgl.force-enabled", true);', 'user_pref("webgl.disabled", false);'].join("\n") + "\n");
  const ff = own(process.env.FIREFOX_PATH, ["--headless", "--window-size=1024,768", "--no-remote", "--profile", profile,
    "--remote-debugging-port", "0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let gone = null;
  ff.once("exit", (c, s) => (gone = `the browser exited (${c ?? s})`));
  const [, ws] = await started(ff, "stderr", /WebDriver BiDi listening on (ws:\/\/\S+)/);
  const sock = new WebSocket(`${ws}/session`);
  await new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = reject; });
  let id = 0;
  const waiting = new Map();
  sock.onmessage = (m) => {
    const r = JSON.parse(m.data);
    if (r.type === "event") {
      if (r.method === "browsingContext.contextDestroyed" || r.method === "log.entryAdded" && /crash/i.test(r.params.text)) gone ??= r.method;
      return;
    }
    const w = waiting.get(r.id);
    waiting.delete(r.id);
    if (w) r.type === "error" ? w.reject(new Error(`${r.error}: ${r.message}`)) : w.resolve(r.result);
  };
  sock.onclose = () => (gone ??= "the BiDi socket closed");
  const send = (method, params) => new Promise((resolve, reject) => {
    waiting.set(++id, { resolve, reject });
    sock.send(JSON.stringify({ id, method, params }));
  });
  const { capabilities } = await send("session.new", { capabilities: {} });
  const context = (await send("browsingContext.getTree", {})).contexts[0].context;
  await send("browsingContext.navigate", { context, url, wait: "complete" });
  return {
    version: `Firefox ${capabilities.browserVersion}`, pid: ff.pid, gone: () => gone,
    async evaluate(expr) {
      const r = await send("script.evaluate", { expression: `(async () => JSON.stringify(await (${expr})()))()`,
        target: { context }, awaitPromise: true });
      if (r.type === "exception") throw new Error(r.exceptionDetails.text);
      return JSON.parse(r.result.value);
    },
    close: () => { try { process.kill(-ff.pid, "SIGKILL"); } catch {} },
  };
}

const STATUS = "() => document.getElementById('status')?.textContent ?? ''";
const MEMORY = `async () => {
  if (!globalThis.crossOriginIsolated) return { missing: "the page is not cross-origin isolated" };
  if (!performance.measureUserAgentSpecificMemory) return { missing: "no performance.measureUserAgentSpecificMemory" };
  const m = await performance.measureUserAgentSpecificMemory();
  const byScope = {};
  for (const b of m.breakdown) {
    const to = b.attribution.length ? b.attribution.map((a) => a.scope) : ["shared"];
    for (const s of to) byScope[s] = (byScope[s] ?? 0) + b.bytes / to.length;
  }
  return { bytes: m.bytes, byScope, types: [...new Set(m.breakdown.flatMap((b) => b.types))] };
}`;

/** One round: the page opened in fill mode, watched until every frame is in or the fill stops. */
async function round(engine, url, n, dir) {
  const t0 = Date.now();
  const b = await (engine === "chromium" ? chromium(url) : firefox(url, dir));
  let status = "", received = 0, progressAt = Date.now(), peakPss = 0, minAvail = Infinity, outcome = null;
  try {
    while (!outcome) {
      await sleep(1000);
      const avail = headroom();
      minAvail = Math.min(minAvail, avail);
      peakPss = Math.max(peakPss, treePss(b.pid));
      if (avail < GUARD_MIB) outcome = "host saturated";
      else if (b.gone()) outcome = b.gone();
      else {
        status = await Promise.race([b.evaluate(STATUS), sleep(30000).then(() => { throw new Error("no answer in 30 s"); })]).catch((e) => (outcome = `unreadable: ${e.message}`, status));
        const r = Number(/received (\d+)/.exec(status)?.[1] ?? 0);
        if (r > received) [received, progressAt] = [r, Date.now()];
        if (r === n) outcome = "complete";
        else if (status.includes("error: connect")) outcome = "did not connect";
        else if (Date.now() - progressAt > STALL_S * 1000) outcome = `stalled ${STALL_S} s`;
      }
    }
    const memory = outcome !== "complete" ? null : await Promise.race([
      b.evaluate(MEMORY).catch((e) => ({ error: e.message })),
      sleep(180000).then(() => ({ error: "no measurement in 180 s" })),
    ]);
    return { engine: b.version, outcome, received, status, fillMs: Number(/fill (\d+) ms/.exec(status)?.[1] ?? NaN) || null,
      uaMemory: memory, pssEndMiB: Math.round(treePss(b.pid)), pssPeakMiB: Math.round(peakPss),
      headroomMinMiB: Math.round(minAvail), wallS: Math.round((Date.now() - t0) / 1000) };
  } finally {
    await b.close();
    await sleep(2000);
  }
}

const memTotal = Math.round(Math.min(meminfo().MemTotal, (CGROUP?.max ?? Infinity) / 2 ** 20));
console.log(`host: MemTotal ${Math.round(meminfo().MemTotal)} MiB, cgroup limit ${CGROUP ? Math.round(CGROUP.max / 2 ** 20) + " MiB" : "none"}, ` +
  `headroom ${Math.round(headroom())} MiB`);
const OJPH = process.env.OJPH;
for (const [w, h] of SIZES) {
  const going = new Set(ENGINES);
  const cache = path.join(WORK, `cs-${w}x${h}`);
  for (let n = FIRST; n <= LAST && going.size; n *= 2) {
    const decodedMiB = (n * w * h * 2) / 2 ** 20;
    const cell = { w, h, n, decodedMiB, memLimitMiB: memTotal };
    if (decodedMiB > memTotal) {
      appendFileSync(OUT, JSON.stringify({ ...cell, outcome: "not run: decoded series exceeds the memory this host gives the run" }) + "\n");
      break;
    }
    const dir = mkdtempSync(path.join(WORK, "cell-"));
    const sbnd = path.join(dir, "s.sbnd");
    execFileSync(process.env.PYTHON || "python3", ["-I", path.join(ROOT, "lab/viewer-ceiling/make_series.py"), OJPH, `${BIN}/pack-series`,
      cache, sbnd, String(w), String(h), String(n)], { stdio: "inherit" });
    const served = await host(sbnd, dir);
    const failed = new Set();
    for (let r = 0; r < ROUNDS; r++) {
      const order = [...going];
      if (r % 2) order.reverse();
      for (const engine of order) {
        const row = { ...cell, round: r, at: new Date().toISOString(), ...(await round(engine, served.url, n, dir)) };
        appendFileSync(OUT, JSON.stringify(row) + "\n");
        console.log(`${w}x${h} n=${n} (${decodedMiB} MiB) ${row.engine} r${r}: ${row.outcome}, received ${row.received}, ` +
          `ua ${row.uaMemory?.bytes ? Math.round(row.uaMemory.bytes / 2 ** 20) + " MiB" : JSON.stringify(row.uaMemory)}, pss end ${row.pssEndMiB} peak ${row.pssPeakMiB}, headroom min ${row.headroomMinMiB}`);
        if (row.outcome !== "complete") failed.add(engine);
      }
    }
    for (const e of failed) going.delete(e);
    served.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(cache, { recursive: true, force: true });
}
