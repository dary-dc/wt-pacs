// REGIONDECODE (docs/decode/levers-protocol.md §L2, the container half): a 1:1 viewport decoded alone, and one
// asked frame in stripes across idle decoder workers, against the whole frame. lab/av1/decode/region/README.md
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 10));
const FIRST = Number(arg("--first-round", 0));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const PASSES = Number(arg("--passes", 3));
const CORES = Number(arg("--cores", 4));
const FRAMES = arg("--frames", "lab/.av1-work/region");
const SETS = arg("--sets", null)?.split(",");
const MUTATE = arg("--mutate", null); // flip: one sample of every output; shift: every region and stripe one row down
const OUT = arg("--out", "region.jsonl");
const ROOT = new URL("../../../..", import.meta.url).pathname;
const BUILT = "lab/.av1-build/region";
const VIEW = { w: 1080, h: 2400 };
const LARGE = 1914 * 2572;

const manifest = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8")).filter((s) => !SETS || SETS.includes(s.name));
const sha = (b) => createHash("sha256").update(b).digest("hex");

// The arms a set runs, each an ask of rectangles; `worker` names the decoder a rectangle goes to.
function arms(s) {
  const { width: W, height: H } = s;
  const whole = (worker) => [{ worker, x0: 0, y0: 0, x1: W, y1: H, at: 0 }];
  const view = (x0, y0) => {
    const w = Math.min(VIEW.w, W), h = Math.min(VIEW.h, H);
    return [{ worker: "oh0", x0, y0, x1: x0 + w, y1: y0 + h, at: 0, view: true }];
  };
  const stripes = (k) => Array.from({ length: k }, (_, j) => {
    const y0 = Math.round((H * j) / k), y1 = Math.round((H * (j + 1)) / k);
    return { worker: `oh${j}`, x0: 0, y0, x1: W, y1, at: y0 * W };
  });
  const a = { ref: whole("ref"), oh: whole("oh0"), k2: stripes(2), k3: stripes(3) };
  if (W * H >= LARGE) a.pool = whole("pool");
  if (W >= 900 && H >= 2100) {
    const w = Math.min(VIEW.w, W), h = Math.min(VIEW.h, H);
    a.centre = view(((W - w) >> 1) & ~1, ((H - h) >> 1) & ~1);
    a.corner = view(0, 0);
  }
  return a;
}

// Each rectangle's hash from the encoder's input, which must itself be the set's checksum.
function truths(s, a) {
  return s.frames.map((f, i) => {
    const raw = readFileSync(`${ROOT}/${FRAMES}/${s.name}/${String(i).padStart(3, "0")}.raw`);
    if (sha(raw) !== f.truth) throw new Error(`${s.name} ${i}: the input is not its checksum`);
    const rect = ({ x0, y0, x1, y1 }) => {
      const rows = [];
      for (let y = y0; y < y1; y++) rows.push(raw.subarray((y * s.width + x0) * 2, (y * s.width + x1) * 2));
      return sha(Buffer.concat(rows));
    };
    return Object.fromEntries(Object.entries(a).map(([k, rs]) => [k, rs.map(rect)]));
  });
}

const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const WRAPPED = path.join(mkdtempSync(path.join(tmpdir(), "region-")), "chrome.sh");
writeFileSync(WRAPPED, `#!/bin/sh\nexec taskset -c 0-${CORES - 1} "${CHROME}" "$@"\n`, { mode: 0o755 });
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

const plan = manifest.map((s) => { const a = arms(s); return { s, a, truth: truths(s, a) }; });

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: WRAPPED });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/decode/region/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const glue = (b) => `${BASE}/${BUILT}/${b}.js`;
  const err = await page.evaluate((g) => globalThis.setup(g),
    { ref: glue("ref"), pool: glue("pool"), oh0: glue("ohtj"), oh1: glue("ohtj"), oh2: glue("ohtj") });
  if (err) throw new Error(err);
  const stop = throttleTree(server.process().pid, throttle, { cores: CORES });
  const rows = [];
  for (const { s, a, truth } of order(plan, round)) {
    await page.evaluate((u) => globalThis.load(u),
      s.frames.map((_, i) => `${BASE}/${FRAMES}/${s.name}/${String(i).padStart(3, "0")}.htj2k`));
    for (const arm of order(Object.keys(a), round)) {
      const viewSamples = a[arm][0].view ? (a[arm][0].x1 - a[arm][0].x0) * (a[arm][0].y1 - a[arm][0].y0) : 0;
      const samples = viewSamples || s.width * s.height;
      const asks = (i) => a[arm].map((r) => {
        const d = MUTATE === "shift" && arm !== "ref" && arm !== "oh" && arm !== "pool" ? 1 : 0;
        const y1 = Math.min(r.y1 + d, s.height);
        return { ...r, i, y0: r.y0 + d, y1, at: r.at + (r.view ? 0 : d * s.width) };
      });
      let exact = 0, blockBytes = 0;
      const ms = [], workerMs = [];
      for (let p = 0; p <= PASSES; p++) for (let i = 0; i < s.frames.length; i++) {
        const r = await page.evaluate(([q, n, c, m]) => globalThis.ask(q, n, c, m), [asks(i), samples, p === 0, MUTATE === "flip"]);
        if (r.error) throw new Error(`${s.name} ${arm}: ${r.error}`);
        if (p === 0) {
          const whole = viewSamples ? true : r.whole === s.frames[i].truth;
          if (whole && r.hashes.every((h, j) => h === truth[i][arm][j])) exact++;
          blockBytes += r.blockBytes.reduce((x, y) => x + (y ?? 0), 0);
        } else {
          ms.push(r.ms);
          workerMs.push(r.workerMs);
        }
      }
      rows.push({ round, throttle, set: s.name, arm, frames: s.frames.length, exact, ms, workerMs, blockBytes,
        codestream: s.frames.reduce((x, f) => x + f.htj2k, 0) });
      if (exact !== s.frames.length) console.error(`round ${round} ${throttle}x ${s.name} ${arm}: ${exact}/${s.frames.length} exact`);
    }
  }
  stop();
  await browser.close();
  await server.close();
  return rows;
}

const cells = THROTTLES.map((throttle) => ({ throttle }));
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const { throttle } of order(cells, round)) {
    const rows = await inChromium(throttle, round);
    writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", { flag: "a" });
    console.error(`round ${round} ${throttle}x done`);
  }
}
process.exit(0);
