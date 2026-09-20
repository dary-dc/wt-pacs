/**
 * Drive page.js headless, interleaving the arms: every round runs both arms in each cell with the
 * arm order reversed on odd rounds, so a drift in the host lands on both alike. Prints median
 * [min … max] and the new arm's rounds-better out of n. docs/proposal-downloader.md §The first fill.
 *
 *   NODE_PATH=$(npm root -g) node lab/fill-at-start/run.mjs [--rounds 12] [--base http://127.0.0.1:8765]
 */
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 12));
const BASE = arg("--base", "http://127.0.0.1:8765");
const FILL = Number(arg("--fill", 20));
const ARMS = ["after", "start"];
const CELLS = [
  { block: 0, at: "call", label: "free" },
  { block: 300, at: "call", label: "blocked 300 ms from inside connect()'s own task" },
  { block: 300, at: "25", label: "blocked 300 ms from 25 ms in, the worker already alive" },
];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--disable-background-networking"],
});

async function runOne(arm, cell) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/lab/fill-at-start/index.html?arm=${arm}&block=${cell.block}&at=${cell.at}&fill=${FILL}`);
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 60000 });
  const result = await page.evaluate(() => globalThis.__wtpacsResult);
  await page.close();
  return { ...result, errors };
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const cell of CELLS) {
    const order = round % 2 ? [...ARMS].reverse() : ARMS;
    for (const arm of order) {
      const r = await runOne(arm, cell);
      rows.push({ round, ...r });
      const brief = r.error
        ? `ERROR ${r.error}`
        : `ask ${r.ask_ms?.toFixed(1)} first ${r.received_first_ms?.toFixed(1)} all ${r.received_all_ms?.toFixed(1)} delivered ${r.delivered_all_ms?.toFixed(1)} (${r.received}/${r.fill})`;
      console.log(`round ${round} ${cell.label.padEnd(42)} ${arm.padEnd(5)} ${brief}${r.errors.length ? ` pageerrors ${r.errors.length}` : ""}`);
    }
  }
}
await browser.close();

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (xs) => (xs.length ? `${median(xs).toFixed(0)} [${Math.min(...xs).toFixed(0)} … ${Math.max(...xs).toFixed(0)}]` : "—");
const pick = (cell, arm, key) => rows.filter((r) => r.block === cell.block && r.at === cell.at && r.arm === arm && r[key] != null && !r.error).map((r) => r[key]);
const inCell = (cell, round, arm) => rows.find((r) => r.round === round && r.block === cell.block && r.at === cell.at && r.arm === arm && !r.error);
const better = (cell, key) => {
  let n = 0;
  let wins = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const at = inCell(cell, round, "start")?.[key];
    const af = inCell(cell, round, "after")?.[key];
    if (at == null || af == null) continue;
    n += 1;
    if (at < af) wins += 1;
  }
  return `${wins}/${n}`;
};

const METRICS = [
  ["ask_ms", "the downloader has the fill (ms)"],
  ["received_first_ms", "first frame received in the worker (ms)"],
  ["received_all_ms", "all frames received in the worker (ms)"],
  ["delivered_all_ms", "all frames handed to the page (ms)"],
  ["started_ms", "`started` back at the page (ms)"],
];
console.log(`\n### ${ROUNDS} rounds, arm order reversed on odd rounds, fill of ${FILL} frames, from the page's call to connect()\n`);
for (const cell of CELLS) {
  console.log(`**main thread ${cell.label}**\n`);
  console.log(`| metric | after | start | start better |`);
  console.log(`| --- | --- | --- | --- |`);
  for (const [key, label] of METRICS) {
    console.log(`| ${label} | ${fmt(pick(cell, "after", key))} | ${fmt(pick(cell, "start", key))} | ${better(cell, key)} |`);
  }
  console.log("");
}
