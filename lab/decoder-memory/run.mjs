/**
 * One cell per page, interleaved: every round runs every arm at every decoder count with the
 * order rotated, and samples the renderer's RSS beside the run. The per-worker resident cost is
 * the slope in the decoder count, paired inside a round.
 * docs/decode/README.md §What a decoder worker costs, resident
 *
 *   NODE_PATH=$(npm root -g) CHROME_PATH=... node lab/decoder-memory/run.mjs --rounds 6
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 6));
const ARMS = arg("--arms", "prod,perdec1,twin,fresh,share").split(",");
const COUNTS = arg("--counts", "1,3").split(",").map(Number);
/** Ring sizes to compare, interleaved like the arms: `0` is one wire buffer per frame. */
const WIRES = arg("--wire", "").split(",").filter((w) => w !== "");
const EXTRA = arg("--query", "");
const OUT = arg("--out", "");
const PORT = Number(process.env.PORT || 8771);

const ROOT = new URL("../..", import.meta.url).pathname;
const server = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => server.kill());
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  // A spare renderer would be a second fresh process to tell ours apart from.
  args: ["--disable-background-networking", "--disable-component-update", "--no-default-browser-check",
    "--disable-features=SpareRendererForSitePerProcess",
    "--enable-blink-features=ForceEagerMeasureMemory"],
});

function readOr(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }
function rssKib(pid) { return Number(/VmRSS:\s+(\d+)/.exec(readOr(`/proc/${pid}/status`))?.[1] ?? 0); }
/** The kernel's own high-water for the process: a peak no sampling interval can miss. */
function hwmKib(pid) { return Number(/VmHWM:\s+(\d+)/.exec(readOr(`/proc/${pid}/status`))?.[1] ?? 0); }

/** The browser names its own renderers, so no other Chromium on the box can be mistaken for ours. */
const browserCdp = await browser.newBrowserCDPSession();
async function renderers() {
  const { processInfo } = await browserCdp.send("SystemInfo.getProcessInfo");
  return new Set(processInfo.filter((p) => p.type === "renderer").map((p) => String(p.id)));
}

async function runOne(arm, decoders, wire) {
  const before = await renderers();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/lab/decoder-memory/index.html?arm=${arm}&decoders=${decoders}${wire === undefined ? "" : `&wire=${wire}`}${EXTRA}`);
  await page.waitForFunction(() => globalThis.__wtpacsReady || globalThis.__wtpacsDone, null, { timeout: 300000 });
  // The page has its fixtures and its workers by now, so among the processes this run started it
  // is the largest by a wide margin; `runner_up_kib` is what says the margin was wide.
  const fresh = [...(await renderers())].filter((p) => !before.has(p)).map((p) => [p, rssKib(p)]);
  fresh.sort((a, b) => b[1] - a[1]);
  if (!fresh.length) { await context.close(); return { arm, decoders, error: "no fresh renderer" }; }
  const [pid, atReady] = fresh[0];

  const samples = [atReady];
  const sampler = setInterval(() => { const k = rssKib(pid); if (k) samples.push(k); }, 25);
  await page.waitForFunction(() => globalThis.__wtpacsDecoded || globalThis.__wtpacsDone, null, { timeout: 300000 });
  const peak = Math.max(...samples, 0);
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 400));
  const settled = rssKib(pid);
  const hwm = hwmKib(pid);
  clearInterval(sampler);
  const result = await page.evaluate(() => globalThis.__wtpacsResult);
  await context.close();
  return { ...result, arm, decoders, wire, pid: Number(pid), rss_peak_kib: peak, rss_hwm_kib: hwm, rss_settled_kib: settled,
    rss_ready_kib: atReady, runner_up_kib: fresh[1]?.[1] ?? 0, renderers: fresh.length, errors };
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  const arms = ARMS.map((_, i) => ARMS[(i + round) % ARMS.length]);
  const counts = COUNTS.map((_, i) => COUNTS[(i + round) % COUNTS.length]);
  const wires = WIRES.length ? WIRES.map((_, i) => WIRES[(i + round) % WIRES.length]) : [undefined];
  for (const arm of arms) {
    for (const decoders of counts) {
      for (const wire of wires) {
        const r = await runOne(arm, decoders, wire);
        rows.push({ round, ...r });
        const mb = (k) => (k / 1024).toFixed(1);
        console.log(`round ${round} ${arm.padEnd(8)} D=${decoders} ${wire === undefined ? "" : `wire=${wire} `}` +
          (r.error ? `ERROR ${r.error}` :
            `rss hwm ${mb(r.rss_hwm_kib)} settled ${mb(r.rss_settled_kib)} MB  ` +
            `workers ${(r.memory_workers_bytes / 1048576).toFixed(1)} MB (${r.memory_worker_entries}) ` +
            `frames ${r.checked}/${r.frames} mism ${r.mismatches} ${r.decode_wall_ms?.toFixed(0)} ms`) +
          (r.errors?.length ? ` pageerrors ${r.errors.length}` : ""));
      }
    }
  }
}
await browser.close();
server.kill();
if (OUT) fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (xs, d = 1) => (xs.length ? `${median(xs).toFixed(d)} [${Math.min(...xs).toFixed(d)}–${Math.max(...xs).toFixed(d)}]` : "—");
const cell = (arm, decoders, key) => rows.filter((r) => r.arm === arm && r.decoders === decoders && !r.error && r[key] != null).map((r) => r[key]);
/** Paired inside a round: the two counts of one arm ran next to each other. */
function slope(arm, key, lo, hi) {
  const out = [];
  for (let round = 0; round < ROUNDS; round++) {
    const a = rows.find((r) => r.round === round && r.arm === arm && r.decoders === lo && !r.error)?.[key];
    const b = rows.find((r) => r.round === round && r.arm === arm && r.decoders === hi && !r.error)?.[key];
    if (a != null && b != null) out.push((b - a) / (hi - lo));
  }
  return out;
}
const [lo, hi] = [Math.min(...COUNTS), Math.max(...COUNTS)];
console.log(`\n### ${ROUNDS} rounds, arm and count order rotated each round, D=${lo} against D=${hi}\n`);
console.log(`| arm | RSS D=${lo} MB | RSS D=${hi} MB | per-worker resident MB | at init | peak | JS+WASM | n |`);
console.log(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
for (const arm of ARMS) {
  const i = slope(arm, "rss_ready_kib", lo, hi).map((k) => k / 1024);
  const s = slope(arm, "rss_settled_kib", lo, hi).map((k) => k / 1024);
  const p = slope(arm, "rss_hwm_kib", lo, hi).map((k) => k / 1024);
  const h = slope(arm, "memory_workers_bytes", lo, hi).map((b) => b / 1048576);
  console.log(`| ${arm} | ${fmt(cell(arm, lo, "rss_settled_kib").map((k) => k / 1024))} | ` +
    `${fmt(cell(arm, hi, "rss_settled_kib").map((k) => k / 1024))} | **${fmt(s)}** | ${fmt(i)} | ${fmt(p)} | ${fmt(h)} | ${s.length} |`);
}
if (WIRES.length) {
  console.log(`\n### the wire-buffer ring: the renderer's peak at each size\n`);
  console.log(`| arm | D | wire | peak VmHWM MB | settled MB | decode wall ms | n |`);
  console.log(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const arm of ARMS) {
    for (const decoders of COUNTS) {
      for (const wire of WIRES) {
        const at = (key) => rows.filter((r) => r.arm === arm && r.decoders === decoders &&
          r.wire === wire && !r.error && r[key] != null).map((r) => r[key]);
        const peak = at("rss_hwm_kib").map((k) => k / 1024);
        console.log(`| ${arm} | ${decoders} | ${wire} | **${fmt(peak)}** | ` +
          `${fmt(at("rss_settled_kib").map((k) => k / 1024))} | ${fmt(at("decode_wall_ms"), 0)} | ${peak.length} |`);
      }
    }
  }
}

const bad = rows.filter((r) => r.error || r.mismatches > 0 || r.checked !== r.frames);
console.log(`\nframes checked against the fixture in every cell; cells not clean: ${bad.length}/${rows.length}`);
for (const r of bad.slice(0, 8)) console.log(`  ${r.arm} D=${r.decoders} ${r.error ?? `${r.checked}/${r.frames} checked, ${r.mismatches} mismatches`}`);
