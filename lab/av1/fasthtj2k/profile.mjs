// Where an HTJ2K frame's decode goes, by stage, on real series in headless Chromium at 1× and 4×:
// a source build with names kept, V8's sampling profiler, every frame checked. lab/av1/fasthtj2k/README.md
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";
import { throttleTree } from "../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 5));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const PASSES = Number(arg("--passes", 6));
const FRAMES = arg("--frames", "lab/.av1-work/fasthtj2k");
const ARM = arg("--arm", "profweb");
const MUTATE = process.argv.includes("--mutate");
const OUT = arg("--out", null);
const ROOT = new URL("../../..", import.meta.url).pathname;
const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const manifest = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8"));

/** Self time lands in the first stage whose pattern the function's name matches; order matters. */
export const STAGES = [
  ["inverse wavelet", /rev_horz|rev_vert|horz_syn|vert_syn|vert_step|irv_/],
  ["colour transform", /rct_|ict_/],
  ["code-block to line", /tx_from_cb|subband::pull_line/],
  ["HT block decode", /ojph_decode_codeblock|mel_|frwd_|rev_fetch|rev_init|rev_read|rev_advance|uvlc|vlc/],
  ["wrapper pack", /HTJ2KDecoder::decode\(\)/],
  ["memset, memcpy", /^(memset|memcpy|memmove|__memcpy|.*mem_clear)/],
  ["line plumbing", /pull_line|pull\(|convert|line_buf/],
  ["parse, set-up", /parse|read_|restart|alloc|finalize|precinct|tile|codestream|param_/],
  ["copy out (JS)", /^globalThis\.time$/],
];

const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

function stages(profile) {
  const dt = new Map();
  profile.samples.forEach((id, k) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[k] ?? 0)));
  const by = Object.fromEntries([...STAGES.map(([s]) => [s, 0]), ["JS and other", 0], ["idle", 0]]);
  const fns = {};
  for (const n of profile.nodes) {
    const name = n.callFrame.functionName || n.callFrame.url || "(anonymous)";
    const us = dt.get(n.id) ?? 0;
    const s = /^\((idle|program|garbage collector)\)$/.test(name) ? "idle" : (STAGES.find(([, re]) => re.test(name))?.[0] ?? "JS and other");
    by[s] += us;
    fns[name] = (fns[name] ?? 0) + us;
  }
  return { by, fns };
}

async function inChromium(throttle) {
  const server = await chromium.launchServer({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/fasthtj2k/index.html`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  const stop = throttleTree(server.process().pid, throttle, { cores: 1 });
  const rows = [];
  for (const s of order(manifest, 0)) {
    const truth = s.frames.map((f) => f.truth);
    await page.evaluate((o) => globalThis.load(o), { glue: `${BASE}/lab/.openjph-build/wasm/${ARM}.js`, dir: `${BASE}/${FRAMES}`, set: s.name, n: truth.length });
    const exact = await page.evaluate(([t, m]) => globalThis.check(t, m), [truth, MUTATE]);
    const ms = await page.evaluate((p) => globalThis.time(p), PASSES);
    await cdp.send("Profiler.start");
    await page.evaluate((p) => globalThis.time(p), PASSES);
    const { profile } = await cdp.send("Profiler.stop");
    rows.push({ set: s.name, frames: truth.length, exact, ...ms, ...stages(profile) });
    console.error(`  ${throttle}x ${s.name} ${exact}/${truth.length} ${ms.dec.toFixed(1)} ms`);
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const rows = [];
const cells = THROTTLES.map((throttle) => ({ throttle }));
for (let round = 0; round < ROUNDS; round++) {
  for (const { throttle } of order(cells, round)) {
    for (const r of await inChromium(throttle)) {
      rows.push({ round, throttle, ...r });
      if (r.exact !== r.frames) console.error(`round ${round} ${throttle}x ${r.set}: ${r.exact}/${r.frames} exact`);
    }
    console.error(`round ${round} ${throttle}x done`);
    if (OUT) writeFileSync(OUT, JSON.stringify(rows));
  }
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const names = [...STAGES.map(([s]) => s), "JS and other"];
console.log(`ms a frame (decode, copy out) and % of the decode's busy samples by stage, median of ${ROUNDS} rounds [range]`);
console.log(["throttle", "set", "exact", "decode ms", "copy ms", ...names].join(" | "));
for (const { throttle } of cells) for (const s of manifest) {
  const rs = rows.filter((r) => r.throttle === throttle && r.set === s.name);
  const share = (r, n) => 100 * r.by[n] / names.reduce((a, k) => a + r.by[k], 0);
  const cell = (v) => `${med(v).toFixed(1)} [${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}]`;
  console.log([`${throttle}×`, s.name, `${rs.reduce((a, r) => a + r.exact, 0)}/${rs.reduce((a, r) => a + r.frames, 0)}`,
    cell(rs.map((r) => r.dec)), cell(rs.map((r) => r.copy)), ...names.map((n) => cell(rs.map((r) => share(r, n))))].join(" | "));
}
if (process.argv.includes("--top")) for (const s of manifest) {
  const r = rows.find((x) => x.set === s.name && x.throttle === 1);
  const tot = Object.values(r.fns).reduce((a, b) => a + b, 0);
  console.log(s.name, Object.entries(r.fns).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([f, us]) => `${(100 * us / tot).toFixed(1)}% ${f.slice(0, 60)}`).join("\n  "));
}
