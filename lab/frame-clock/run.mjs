/**
 * The frame clock's cells: each arm a fresh navigation, interleaved by lab/order.mjs, one browser per cell, throttled
 * as a tree. lab/frame-clock/README.md
 *
 *   node lab/frame-clock/run.mjs [--browser chromium|firefox] [--rounds 14] [--seconds 10] [--cells s512/60/busy/1,…]
 *   node lab/frame-clock/run.mjs --summary lab/frame-clock/runs/<file>.jsonl
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { order } from "../order.mjs";
import { throttleTree } from "../scripts/cpu_throttle.mjs";
import { ARMS } from "./arms.js";
import { median, rule, score, verdict, voidRun } from "./measure.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};

export const CELLS = ["s512", "mammo"].flatMap((series) => [30, 60].flatMap((fps) => ["quiet", "busy"].flatMap((page) =>
  [1, 4].map((rate) => ({ name: `${series}/${fps}/${page}/${rate}`, series, fps, busy: page === "busy", rate })))));

const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");

function summarise(rows) {
  const cells = [];
  for (const cell of CELLS) {
    const runs = rows.filter((r) => r.cell === cell.name && !r.error);
    if (!runs.length) continue;
    const kept = runs.filter((r) => !voidRun(r));
    const v = { ...cell, ...verdict(kept.map((r) => ({ round: r.round, arm: r.arm, ...r.score })), { period: 1000 / cell.fps, busy: cell.busy }) };
    cells.push(v);
    const flags = [v.void && "VOID", v.saturated && "SATURATED: nothing claimed", runs.length > kept.length && `${runs.length - kept.length} void runs`].filter(Boolean);
    console.log(`\n${cell.name}  rounds ${v.rounds}  A/A late ${fmt(v.aa.late)} pts, gap ${fmt(v.aa.gap)} ms  ${flags.join("  ")}`);
    for (const arm of ARMS) {
      const a = kept.filter((r) => r.arm === arm).map((r) => r.score);
      if (!a.length) continue;
      const m = (k) => median(a.map((s) => s[k]));
      console.log(`  ${arm.padEnd(15)} late ${fmt(m("latePct")).padStart(5)} %  gap p99 ${fmt(m("gapP99")).padStart(6)} ms  draw p99 ${fmt(m("drawP99"), 2).padStart(6)} ms${
        v.arms[arm] ? `  ${v.arms[arm].passes ? "passes" : "fails"}` : ""}`);
    }
  }
  const r = rule(cells);
  console.log(`\nrule: ${r.clock ?? "no verdict"}${r.why ? ` (${r.why})` : ""}${r.reversed ? `; reversed in ${r.reversed.join(", ")}` : ""}`);
}

if (argv.includes("--summary")) {
  summarise(fs.readFileSync(flag("summary"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  process.exit(0);
}

const engine = flag("browser", "chromium");
if (engine === "firefox" && !process.env.DISPLAY) throw new Error("Firefox runs headed for WebGL2 in a worker: xvfb-run -a node lab/frame-clock/run.mjs --browser firefox");
const ROUNDS = Number(flag("rounds", 14));
const SECONDS = Number(flag("seconds", 10));
const wanted = flag("cells", null)?.split(",");
const cells = CELLS.filter((c) => !wanted || wanted.includes(c.name));
const playwright = createRequire(import.meta.url)("playwright");

if (cells.some((c) => c.rate > 1)) {
  console.log("throttle check:");
  execFileSync(process.execPath, [path.join(ROOT, "lab/scripts/cpu_throttle.mjs"), "--check", [...new Set(cells.map((c) => c.rate))].join(",")], { stdio: "inherit" });
}

const port = 30000 + ((Math.random() * 20000) | 0);
const host = spawn("python3", ["server/dev-server.py", "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => host.kill());
await new Promise((r) => setTimeout(r, 700));

fs.mkdirSync(path.join(HERE, "runs"), { recursive: true });
const out = path.join(HERE, "runs", `${engine}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const rows = [];
for (const cell of cells) {
  const server = await playwright[engine].launchServer(engine === "firefox"
    ? { headless: false, firefoxUserPrefs: { "webgl.force-enabled": true } }
    : { channel: "chromium", args: ["--ignore-gpu-blocklist"] });
  const browser = await playwright[engine].connect(server.wsEndpoint());
  const stop = throttleTree(server.process().pid, cell.rate);
  for (let round = 0; round < ROUNDS; round++) {
    for (const [k, arm] of order(ARMS, round).entries()) {
      const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
      const q = new URLSearchParams({ series: cell.series, fps: cell.fps, busy: cell.busy ? 1 : 0, arm, seconds: SECONDS });
      await page.goto(`http://127.0.0.1:${port}/lab/frame-clock/index.html?${q}`);
      const run = await page.evaluate(() => globalThis.__run);
      await page.close();
      const row = { cell: cell.name, engine, version: browser.version(), round, arm, prev: k ? order(ARMS, round)[k - 1] : null, busy: cell.busy, ...run };
      if (!run.error) row.score = score(run);
      rows.push(row);
      fs.appendFileSync(out, `${JSON.stringify({ ...row, draws: undefined, vsyncs: undefined, drawLog: run.draws?.length })}\n`);
      const s = row.score;
      console.log(`${cell.name} r${round} ${arm.padEnd(15)} ${run.error ?? `late ${fmt(s.latePct)} %  gap p99 ${fmt(s.gapP99)}  draw p99 ${fmt(s.drawP99, 2)}  tasks ${
        run.tasks.length ? `≥ ${fmt(Math.min(...run.tasks))} ms` : "none"}  ${run.failures.length ? `FAILURES ${run.failures[0]}` : ""}`}`);
      if (round === 0 && k === 0) console.log(`  renderer ${run.renderer}, ${engine} ${browser.version()}`);
    }
  }
  stop();
  await server.close();
}
console.log(`\nrows: ${out}`);
summarise(rows);
process.exit(0);
