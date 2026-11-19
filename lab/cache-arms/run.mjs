// The cache arms, one cell at a time: cache-plan.md §8. README.md says what each cell's steps are.
//
//   NODE_PATH=$(npm root -g) node lab/cache-arms/run.mjs --cell L|W|R-idle|R-busy|B|O|E|K|Q|T|P --size 512|2560|3328
//     [--engine chromium|firefox] [--throttle 1|4] [--rounds N] [--arms none,stub,stub-aa] [--mutant NAME] [--pilot piece=BYTES] [--out rows.jsonl]
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromiumAt, chromiumPath, firefoxAt, parent, staticHost, tree, treePss } from "../opfs-cache/browser.mjs";
import { order, williams } from "../order.mjs";
import { throttleTree } from "../scripts/cpu_throttle.mjs";
import { checks, E_STEPS, keptOnReopen, lBars, pageQuery, params, pilotOf, pssGrowth, sameSet, SIZES } from "./cells.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const WORK = path.join(HERE, "work");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CELL = arg("--cell");
const ENGINE = arg("--engine", "chromium");
const SIZE = arg("--size", "512");
const THROTTLE = Number(arg("--throttle", 1));
const MUTANT = arg("--mutant", "");
const PILOT = arg("--pilot", "").endsWith(".json") ? JSON.parse(readFileSync(arg("--pilot"), "utf8")) : arg("--pilot", "");
const ARMS = arg("--arms", ["O", "E", "K", "Q", "T", "R-idle", "R-busy"].includes(CELL) ? "stub,stub-aa" : "none,stub,stub-aa").split(",");
const OUT = path.resolve(arg("--out", path.join(WORK, `${CELL}-${ENGINE}-${SIZE}-${THROTTLE}x.jsonl`)));
const MiB = 2 ** 20;
const CALL_MS = 600000;
mkdirSync(WORK, { recursive: true });
mkdirSync(path.dirname(OUT), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { chromium } = createRequire(import.meta.url)("playwright");
const CHROMIUM_ARGS = ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

/** A browser on `profile`; `quotaMiB` overrides the origin's quota, `priv` opens a private window. */
async function browser(profile, { quotaMiB = 0, priv = false } = {}) {
  if (ENGINE === "firefox") {
    const prefs = { "browser.cache.disk.enable": false, "browser.sessionstore.resume_from_crash": false, "browser.privatebrowsing.autostart": priv };
    if (quotaMiB) prefs["dom.quotaManager.temporaryStorage.fixedLimit"] = quotaMiB * 5 * 1024;
    return firefoxAt(profile, prefs);
  }
  if (!priv) return chromiumAt(profile, CHROMIUM_ARGS);
  const before = new Set(execFileSync("ls", ["/proc"]).toString().split("\n"));
  const b = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const pid = Number(execFileSync("ls", ["/proc"]).toString().split("\n").find((p) => !before.has(p) && /^\d+$/.test(p) && parent(p) === String(process.pid)));
  const context = await b.newContext();
  return { pid, context: { newPage: () => context.newPage(), close: () => b.close() }, page: await context.newPage() };
}

/** Chromium's quota by DevTools, Gecko's a launch pref (a group limit, five times a site's). Chromium 153's
 *  `estimate()` does not show the override, so the check is a refusal: half of it taken, 16 MiB over it refused. */
async function quotaHolds(b, origin, quotaMiB) {
  await b.page.goto(`${origin}/lab/cache-arms/blank.html?mib=${quotaMiB}`);
  if (ENGINE === "chromium") await (await b.context.newCDPSession(b.page)).send("Storage.overrideQuotaForOrigin", { origin, quotaSize: quotaMiB * MiB });
  const probe = await b.page.evaluate(async () => {
    const w = new Worker("quota-probe.js");
    const mib = Number(new URLSearchParams(location.search).get("mib"));
    return new Promise((resolve) => ((w.onmessage = ({ data }) => resolve(data)), w.postMessage({ mib })));
  });
  return { quotaMiB, ...probe, holds: probe.under === "ok" && probe.over === "QuotaExceededError" };
}

async function load(page, origin, p, timeoutMs = CALL_MS) {
  const qs = new URLSearchParams(pageQuery(p, MUTANT, pilotOf(PILOT, p.arm)));
  await page.goto(`${origin}/lab/cache-arms/index.html?${qs}`);
  // Polled, not awaited: Marionette ends a script after its own timeout, shorter than a cell.
  for (const t0 = Date.now(); Date.now() - t0 < timeoutMs; await sleep(500)) {
    const row = await page.evaluate(() => globalThis.row);
    if (row) return row;
  }
  return { error: "timed out" };
}
const progress = (page) => page.evaluate(() => globalThis.progress());
const killTree = (pid) => { for (const p of tree(pid).reverse()) try { process.kill(Number(p), "SIGKILL"); } catch {} };

/** One arm's run of the cell, on a fresh profile unless the cell keeps one. */
async function once(origin, arm, round) {
  const p = params(CELL, SIZE, arm);
  const dir = mkdtempSync(path.join(WORK, "profile-"));
  const fresh = (opts) => browser(dir, opts);
  let b = null;
  try {
    if (CELL === "O") {
      b = await fresh();
      const fill = await load(b.page, origin, p);
      const warmPage = await b.context.newPage();
      const warm = await load(warmPage, origin, { ...p, mode: "reopen" });
      await b.context.close();
      b = await fresh();
      const cold = await load(b.page, origin, { ...p, mode: "reopen" });
      return { fill, warm, cold, checks: { ran: !cold.error, exact: [warm, cold].every((r) => r.verify?.notOk === 0 && r.read?.hits === p.n) } };
    }
    if (CELL === "E") {
      const quotaMiB = 1300;
      b = await fresh({ quotaMiB });
      const quota = await quotaHolds(b, origin, quotaMiB);
      if (!quota.holds) return { quota, error: "the quota lever does not hold: E not run" };
      const tabs = { 1: b.page, 2: await b.context.newPage() };
      const steps = [];
      for (const s of E_STEPS) {
        if (s.afterClosing) await tabs[s.afterClosing].close();
        const r = await load(tabs[s.tab], origin, { ...p, series: s.series, hold: s.hold ? 1 : "" });
        const onDisk = (r.list ?? []).map((x) => x.series);
        steps.push({ ...s, onDisk, holds: sameSet(onDisk, s.expect), exact: r.verify?.notOk === 0, evicted: r.store?.evicted, error: r.error });
      }
      return { quota, steps, checks: { ran: true, sets: steps.every((s) => s.holds), exact: steps.every((s) => s.exact) } };
    }
    if (CELL === "K") {
      b = await fresh();
      const filling = load(b.page, origin, p).catch(() => null);
      let at = { written: 0 };
      for (const t0 = Date.now(); at.written < 32 && Date.now() - t0 < CALL_MS; await sleep(20)) at = await progress(b.page).catch(() => at);
      killTree(b.pid);
      await Promise.race([filling, sleep(2000)]);
      for (const stale of ["MarionetteActivePort", "lock", ".parentlock"]) rmSync(path.join(dir, stale), { force: true });
      b = null;
      b = await fresh();
      const damage = round % 2 ? await load(b.page, origin, { ...p, damage: 0 }) : null;
      const reopened = await load(b.page, origin, { ...p, mode: "reopen", rest: 1 });
      const row = { atKill: at, damage, ...reopened, damagedAsked: damage?.damaged ?? undefined };
      return { ...row, checks: { ...checks("K", row), kept: keptOnReopen(at, reopened.opened?.present ?? 0, pilotOf(PILOT, arm)) } };
    }
    if (CELL === "Q") {
      const quotaMiB = Math.ceil((p.n * p.w * p.h * 2) / MiB) + 64;
      b = await fresh({ quotaMiB });
      const quota = await quotaHolds(b, origin, quotaMiB);
      if (!quota.holds) return { quota, error: "the quota lever does not hold: Q not run" };
      const fill = await load(b.page, origin, p);
      const reopened = await load(await b.context.newPage(), origin, { ...p, mode: "reopen", ballast: "" });
      return { quota, fill, reopened, checks: { ...checks("Q", fill), reopenExact: reopened.verify?.notOk === 0,
        reopenKept: (reopened.opened?.present ?? 0) >= (fill.store?.written ?? 0) } };
    }
    if (CELL === "T") {
      b = await fresh();
      const one = load(b.page, origin, p);
      const two = await b.context.newPage();
      await sleep(500);
      for (const t0 = Date.now(); ((await progress(b.page).catch(() => null))?.written ?? 0) < 20 && Date.now() - t0 < CALL_MS; ) await sleep(20);
      const second = await load(two, origin, { ...p, mode: "reopen", all: 1, rest: 1 });
      const first = await one;
      return { first, second, checks: { tab1: checks("T", first), tab2: checks("T", second), tab2Reads: second.opened?.writer === false } };
    }
    b = await fresh({ priv: CELL === "P" });
    const unthrottle = throttleTree(b.pid, THROTTLE);
    try {
      const { row: r, pssGrowthMiB } = await pssGrowth({ load: () => load(b.page, origin, p), floorDone: () => b.page.evaluate(() => globalThis.floorDone === true),
        pss: () => treePss(b.pid) });
      return { ...r, pssGrowthMiB, checks: checks(CELL, r) };
    } finally {
      unthrottle();
    }
  } catch (e) {
    return { error: String(e?.message ?? e) };
  } finally {
    await b?.context.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

const write = (row) => { appendFileSync(OUT, JSON.stringify(row) + "\n"); console.log(JSON.stringify(row).slice(0, 400)); };
const version = () => execFileSync(ENGINE === "firefox" ? process.env.FIREFOX_PATH : chromiumPath(), ["--version"]).toString().trim();
const host = () => ({ browser: version(), cpus: readFileSync("/proc/cpuinfo", "utf8").match(/^processor/gm).length,
  memMiB: Math.round(Number(/MemTotal:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))[1]) / 1024) });

if (!SIZES[SIZE] || !params(CELL, SIZE, "none")) throw new Error(`no cell ${CELL} at ${SIZE}`);
const origin = await staticHost();
const ROUNDS = Number(arg("--rounds", williams(ARMS.length).length));
write({ settings: true, cell: CELL, engine: ENGINE, size: SIZE, throttle: THROTTLE, mutant: MUTANT || null, pilot: PILOT, at: new Date().toISOString(), host: host(),
  arms: Object.fromEntries(ARMS.map((a) => [a, params(CELL, SIZE, a)])) });
const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  let prev = null;
  for (const unit of order(ARMS, round)) {
    const r = await once(origin, unit, round);
    const { config, ...rest } = r;
    const row = { cell: CELL, engine: ENGINE, size: SIZE, throttle: THROTTLE, round, unit, prev, mutant: unit === "none" ? null : MUTANT || null, ...rest };
    write(row);
    rows.push(row);
    prev = unit;
  }
}
if (CELL === "L" && ARMS.includes("none")) write({ summary: true, cell: CELL, bars: lBars(rows, { frameBytes: SIZES[SIZE][0] * SIZES[SIZE][1] * 2, pilot: PILOT }) });
process.exit(0);
