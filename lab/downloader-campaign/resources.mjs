/**
 * RC1: what the product path holds and burns, per process and per thread, by decoder count, with
 * the browser confined to 2 or 4 cores and every thread slowed or not. One fresh browser per visit;
 * decoders, cores, throttles and scenarios rotate inside every round. docs/proposal-downloader.md §Resources
 *
 *   NODE_PATH=$(npm root -g) node lab/downloader-campaign/resources.mjs [rounds]
 *     [DECODERS=1,2,3] [CORES=2,4] [THROTTLES=1,4] [SCENARIOS=fill,ask]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { throttleTree } from "../scripts/cpu_throttle.mjs";
import { sampleTree } from "../scripts/proc_sampler.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 7);
const list = (k, d) => (process.env[k] || d).split(",");
const DECODERS = list("DECODERS", "1,2,3").map(Number);
const CORES = list("CORES", "2,4").map(Number);
const THROTTLES = list("THROTTLES", "1,4").map(Number);
const SCENARIOS = list("SCENARIOS", "fill,ask");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "rc1-"));
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

// The browser and everything it starts inherit the affinity it is launched with.
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
for (const n of CORES) {
  fs.writeFileSync(path.join(T, `chrome-${n}`), `#!/bin/sh\nexec taskset -c 0-${n - 1} "${CHROME}" "$@"\n`, { mode: 0o755 });
}

async function visit(decoders, cores, throttle, scenario) {
  const server = await chromium.launchServer({ executablePath: path.join(T, `chrome-${cores}`),
    args: ["--disable-background-networking", "--enable-blink-features=ForceEagerMeasureMemory"] });
  const unthrottle = throttleTree(server.process().pid, throttle, { cores });
  try {
    const browser = await chromium.connect(server.wsEndpoint());
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await page.goto(`http://127.0.0.1:${http}/lab/downloader-campaign/index.html?arm=Dd&scenario=${scenario}&decoders=${decoders}`);
    // Not the default: polling on every animation frame is main-thread work the visit would be charged.
    const wait = (f) => page.waitForFunction(f, null, { timeout: 300000, polling: 200 });
    await wait(() => globalThis.__wtpacsReady || globalThis.__wtpacsDone);
    const task = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;
    const before = await task();
    const sampler = sampleTree(server.process().pid);
    await page.evaluate(() => { globalThis.__wtpacsGo = true; });
    await wait(() => globalThis.__wtpacsScenarioDone || globalThis.__wtpacsDone);
    const sampled = sampler.stop();
    const mainMs = (await task() - before) * 1000;
    await page.evaluate(() => { globalThis.__wtpacsMeasure = true; });
    await wait(() => globalThis.__wtpacsDone);
    const r = await page.evaluate(() => globalThis.__wtpacsResult);
    await browser.close();
    return { decoders, cores, throttle, scenario, ms: scenario === "ask" ? r.ask_ms : r.last_frame_ms,
      delivered: r.delivered, mainMs, jsMb: r.memory_bytes / 1048576, workersMb: r.memory_workers_bytes / 1048576, ...sampled };
  } finally {
    await server.close();
    unthrottle();
  }
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  const cells = THROTTLES.flatMap((t) => CORES.flatMap((c) => SCENARIOS.flatMap((s) => DECODERS.map((d) => [d, c, t, s]))));
  for (let k = 0; k < cells.length; k++) {
    const r = await visit(...cells[(k + round) % cells.length]);
    rows.push({ round, ...r });
    process.stderr.write(`round ${round} ${r.scenario} ${r.decoders} decoders ${r.cores} cores ${r.throttle}x: ${Math.round(r.ms)} ms\n`);
  }
}
if (process.env.OUT) fs.writeFileSync(process.env.OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const kindOf = (r, k) => r.kinds[k] ?? { pss_mb: 0, threads: 0 };
const cpu = (r, re) => Object.entries(r.threads).filter(([k]) => re.test(k)).reduce((s, [, v]) => s + v.cpu_ms, 0);
console.log("medians; memory is each process's peak PSS over the scenario, summed by kind");
console.log("| scenario | throttle | cores | decoders | time | page main thread | renderer PSS | GPU PSS | browser PSS | " +
  "renderer threads | worker CPU | network CPU | JS heaps (measureUserAgentSpecificMemory), of it workers |");
console.log("| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |");
for (const s of SCENARIOS) for (const t of THROTTLES) for (const c of CORES) for (const d of DECODERS) {
  const rs = rows.filter((r) => r.scenario === s && r.throttle === t && r.cores === c && r.decoders === d);
  const m = (f) => med(rs.map(f));
  console.log(`| ${s} | ${t}× | ${c} | ${d} | ${m((r) => r.ms).toFixed(0)} ms | ${m((r) => r.mainMs).toFixed(0)} ms | ` +
    `${m((r) => kindOf(r, "renderer").pss_mb).toFixed(0)} MB | ${m((r) => kindOf(r, "gpu-process").pss_mb).toFixed(0)} | ` +
    `${m((r) => kindOf(r, "browser").pss_mb).toFixed(0)} | ${m((r) => kindOf(r, "renderer").threads)} | ` +
    `${m((r) => cpu(r, /DedicatedWorker/)).toFixed(0)} ms | ${m((r) => cpu(r, /NetworkService/)).toFixed(0)} ms | ` +
    `${m((r) => r.jsMb).toFixed(1)} MB, ${m((r) => r.workersMb).toFixed(1)} | n=${rs.length}`);
}
process.exit(0);
