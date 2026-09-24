/**
 * M1: a fill of 80 frames under Chromium's CPU throttle, the downloader's page side against its
 * worker side. From the trace of each fill: collections (MinorGC, MajorGC) and top-level task time
 * per thread, the page's main thread against every worker thread. From the page, a sampled
 * allocation profile, summed by function, which says what the page allocates per frame.
 * Throttles and arms rotate inside every round. docs/proposal-downloader.md §Under a throttled CPU
 *
 *   NODE_PATH=$(npm root -g) node lab/downloader-campaign/throttle.mjs [rounds]   [THROTTLES=1,4,6] [ARMS=Dw,Dd]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 5);
const THROTTLES = (process.env.THROTTLES || "1,4,6").split(",").map(Number);
// H, the TS client on the page, is the control that the trace sees collections at all.
const ARMS = (process.env.ARMS || "H,Dw,Dd").split(",");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "m1-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];
const port = () => 30000 + ((Math.random() * 20000) | 0);
process.on("exit", () => {
  for (const k of kids) k.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  else fs.rmSync(CFG, { force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
const src = path.join(ROOT, "lab/fixtures/decode_c512");
fs.mkdirSync(path.join(T, "frames"));
for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".j2c"))) {
  fs.copyFileSync(path.join(src, f), path.join(T, "frames", f.replace(".j2c", ".htj2k")));
}
execFileSync(path.join(ROOT, "target/release/pack-study"), ["--metadata", path.join(src, "metadata.json"),
  "--frames", path.join(T, "frames"), "--output", path.join(T, "c512.sbnd")]);
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem \
  -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' 2>/dev/null`]);
const hash = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`])
  .toString().trim();
const wt = port();
const http = port();
kids.push(spawn(path.join(ROOT, "target/release/exact-server"), ["--port", String(wt), "--bind", "127.0.0.1",
  "--study", path.join(T, "c512.sbnd"), "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], { stdio: "ignore" }));
kids.push(spawn("python3", ["server/dev-server.py", "--port", String(http)], { cwd: ROOT, stdio: "ignore" }));
fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${wt}/`, cert_sha256: hash }) + "\n");
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || chromium.executablePath() });

// One event per collection; every other `V8.GC_*` event is a phase of one of these.
const COLLECTIONS = new Set(["V8.GC_SCAVENGER", "V8.GC_MINOR_MARK_SWEEPER", "V8.GC_MARK_COMPACTOR"]);

/** Per thread: collections and their pause, and the time its top-level tasks took. Worker threads
 *  are summed as one: the downloader's and its decoders'. The page's time is also split: the
 *  product's — message dispatch and code under /client/ — against this lab page's own. */
function byThread(events) {
  const names = new Map();
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(e.tid, e.args?.name ?? "?");
  const out = { page: { gcs: 0, gc_ms: 0, task_ms: 0, product_ms: 0, lab_ms: 0 }, workers: { gcs: 0, gc_ms: 0, task_ms: 0 } };
  for (const e of events) {
    const name = names.get(e.tid);
    const t = name === "CrRendererMain" ? out.page : name === "DedicatedWorker thread" ? out.workers : null;
    if (!t || e.ph !== "X") continue;
    if (COLLECTIONS.has(e.name)) {
      t.gcs += 1;
      t.gc_ms += (e.dur ?? 0) / 1000;
    }
    if (e.name === "ThreadControllerImpl::RunTask") t.task_ms += (e.dur ?? 0) / 1000;
    if (t !== out.page) continue;
    const url = e.args?.data?.url ?? "";
    if (e.name === "SimpleWatcher::OnHandleReady" || (e.name === "FunctionCall" && url.includes("/client/"))) {
      t.product_ms += (e.dur ?? 0) / 1000;
    } else if (e.name === "TimerFire" || (e.name === "FunctionCall" && url.includes("/lab/"))) t.lab_ms += (e.dur ?? 0) / 1000;
  }
  return out;
}

/** Sampled bytes allocated by function on the page's heap; one entry per `function url:line`. */
function allocations(profile) {
  const out = new Map();
  const walk = (n) => {
    const f = n.callFrame;
    const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber + 1}`;
    out.set(key, (out.get(key) ?? 0) + n.selfSize);
    for (const c of n.children ?? []) walk(c);
  };
  walk(profile.head);
  return out;
}

async function runOne(arm, throttle) {
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on("Tracing.dataCollected", (d) => events.push(...(d.value ?? [])));
  await page.goto(`http://127.0.0.1:${http}/lab/downloader-campaign/index.html?arm=${arm}&scenario=fill`);
  await page.waitForFunction(() => globalThis.__wtpacsReady || globalThis.__wtpacsDone, null, { timeout: 60000 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await cdp.send("HeapProfiler.enable");
  // Garbage is the question, so what was collected counts too, not only what is still live.
  await cdp.send("HeapProfiler.startSampling", {
    samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
  });
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,toplevel,disabled-by-default-v8.gc,__metadata",
    transferMode: "ReportEvents",
  });
  await page.evaluate(() => { globalThis.__wtpacsGo = true; });
  // Not the default: polling on every animation frame is main-thread work the fill would be charged.
  await page.waitForFunction(() => globalThis.__wtpacsScenarioDone || globalThis.__wtpacsDone, null, { timeout: 300000, polling: 200 });
  const traced = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  await traced;
  const { profile } = await cdp.send("HeapProfiler.stopSampling");
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(events));
  await page.evaluate(() => { globalThis.__wtpacsMeasure = true; });
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 60000 });
  const result = await page.evaluate(() => globalThis.__wtpacsResult ?? {});
  await page.close();
  return { arm, throttle, fillMs: result.last_frame_ms, delivered: result.delivered, threads: byThread(events), alloc: allocations(profile) };
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const throttle of THROTTLES.map((_, k) => THROTTLES[(k + round) % THROTTLES.length])) {
    for (const arm of ARMS.map((_, k) => ARMS[(k + round) % ARMS.length])) {
      const r = await runOne(arm, throttle);
      rows.push(r);
      const { page: p, workers: w } = r.threads;
      console.log(`round ${round} ${arm} ${throttle}x  fill ${Math.round(r.fillMs)} ms ${r.delivered} frames  ` +
        `page: ${p.gcs} gcs ${p.gc_ms.toFixed(1)} ms paused, ${Math.round(p.task_ms)} ms of tasks  ` +
        `workers: ${w.gcs} gcs ${w.gc_ms.toFixed(1)} ms paused, ${Math.round(w.task_ms)} ms of tasks`);
    }
  }
}
await browser.close();

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
console.log("\nmedian per fill: page main thread against the worker threads; allocation sampled on the page");
for (const arm of ARMS) {
  for (const throttle of THROTTLES) {
    const rs = rows.filter((r) => r.arm === arm && r.throttle === throttle);
    const m = (side, k) => median(rs.map((r) => r.threads[side][k]));
    const kib = median(rs.map((r) => [...r.alloc.values()].reduce((a, b) => a + b, 0))) / 1024;
    console.log(`${arm} ${throttle}x  fill ${Math.round(median(rs.map((r) => r.fillMs)))} ms  ` +
      `page ${m("page", "gcs")} gcs ${m("page", "gc_ms").toFixed(1)} ms paused ${Math.round(m("page", "task_ms"))} ms tasks ` +
      `(product ${Math.round(m("page", "product_ms"))}, lab ${Math.round(m("page", "lab_ms"))}), ` +
      `${kib.toFixed(0)} KiB sampled  workers ${m("workers", "gcs")} gcs ${m("workers", "gc_ms").toFixed(1)} ms paused ` +
      `${Math.round(m("workers", "task_ms"))} ms tasks  n=${rs.length}`);
    const total = new Map();
    for (const r of rs) for (const [k, v] of r.alloc) total.set(k, (total.get(k) ?? 0) + v / rs.length);
    const top = [...total].filter(([k]) => /consumer\.js|session\.js|page\.js/.test(k))
      .sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [k, v] of top) console.log(`    ${(v / 1024).toFixed(0).padStart(7)} KiB  ${k}`);
  }
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(rows.map((r) => ({ ...r, alloc: Object.fromEntries(r.alloc) }))));
process.exit(0);
