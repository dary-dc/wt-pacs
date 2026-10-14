// TILEMEASURE (docs/decode/README.md §Not yet tried, P-TILE): a frame stored as k = 2 or 3 horizontal tiles, each
// its own codestream, decoded by k idle OpenJPH workers into one frame, against the whole frame on one.
// lab/av1/decode/tile/README.md
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
const FRAMES = arg("--frames", "lab/.av1-work/tile");
const SETS = arg("--sets", null)?.split(",");
const MUTATE = arg("--mutate", null); // flip: one sample of every output; shift: every piece but the last one row down; swap: tiles 0 and 1 traded
const OUT = arg("--out", "tile.jsonl");
const ROOT = new URL("../../../..", import.meta.url).pathname;
const BUILT = "lab/.av1-build/region";
const LARGE = 1914 * 2572;
// A frame's files in the order every worker holds them: the whole codestream, then t2's and t3's tiles.
const SLOTS = ["", "t2-0", "t2-1", "t3-0", "t3-1", "t3-2"];
const slot = (f, name) => f * SLOTS.length + SLOTS.indexOf(name);

const manifest = JSON.parse(readFileSync(`${ROOT}/${FRAMES}/manifest.json`, "utf8")).filter((s) => !SETS || SETS.includes(s.name));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const rows = (H, k, j) => [Math.round((H * j) / k), Math.round((H * (j + 1)) / k)];

// Each arm a list of pieces; a piece names its worker, the file it decodes and the rows it fills.
function arms(s) {
  const { width: W, height: H } = s;
  const tiles = (k, workers) => (f) => Array.from({ length: k }, (_, j) => {
    const [y0, y1] = rows(H, k, j);
    return { worker: workers[j], i: slot(f, `t${k}-${j}`), x0: 0, y0, x1: W, y1, at: y0 * W };
  });
  const a = {
    ref: (f) => [{ worker: "ref0", i: slot(f, ""), x0: 0, y0: 0, x1: W, y1: H, at: 0 }],
    t2: tiles(2, ["ref0", "ref1"]),
    t3: tiles(3, ["ref0", "ref1", "ref2"]),
    t2one: tiles(2, ["ref0", "ref0"]),
    t3one: tiles(3, ["ref0", "ref0", "ref0"]),
  };
  if (W * H >= LARGE) {
    a.stripes3 = (f) => Array.from({ length: 3 }, (_, j) => {
      const [y0, y1] = rows(H, 3, j);
      return { worker: `oh${j}`, i: slot(f, ""), x0: 0, y0, x1: W, y1, at: y0 * W };
    });
  }
  return a;
}

function mutated(pieces, W) {
  if (MUTATE === "shift" && pieces.length > 1) return pieces.map((p, j) => (j < pieces.length - 1 ? { ...p, at: p.at + W } : p));
  if (MUTATE === "swap" && pieces.length > 1) return pieces.map((p, j) => ({ ...p, i: pieces[j ^ (j < 2 ? 1 : 0)].i }));
  return pieces;
}

const PORT = 30000 + ((Math.random() * 10000) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const WRAPPED = path.join(mkdtempSync(path.join(tmpdir(), "tile-")), "chrome.sh");
writeFileSync(WRAPPED, `#!/bin/sh\nexec taskset -c 0-${CORES - 1} "${CHROME}" "$@"\n`, { mode: 0o755 });
const http = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1000));

// Each piece's truth is its rows of the encoder's input, which must itself be the set's checksum.
const plan = manifest.map((s) => {
  const a = arms(s);
  const raws = s.frames.map((f, i) => {
    const raw = readFileSync(`${ROOT}/${FRAMES}/${s.name}/${String(i).padStart(3, "0")}.raw`);
    if (sha(raw) !== f.truth) throw new Error(`${s.name} ${i}: the input is not its checksum`);
    return raw;
  });
  const truth = (i, p) => sha(raws[i].subarray(p.y0 * s.width * 2, p.y1 * s.width * 2));
  return { s, a, truth };
});
const builds = Object.fromEntries(["ref", "ohtj"].map((b) => [b, sha(readFileSync(`${ROOT}/${BUILT}/${b}.wasm`)).slice(0, 16)]));

async function inChromium(throttle, round) {
  const server = await chromium.launchServer({ executablePath: WRAPPED });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${BASE}/lab/av1/decode/tile/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const glue = (b) => `${BASE}/${BUILT}/${b}.js`;
  const err = await page.evaluate((g) => globalThis.setup(g), { ref0: glue("ref"), ref1: glue("ref"), ref2: glue("ref"),
    oh0: glue("ohtj"), oh1: glue("ohtj"), oh2: glue("ohtj") });
  if (err) throw new Error(err);
  const settings = { chromium: browser.version(), cores: CORES, throttle, passes: PASSES, builds };
  const stop = throttleTree(server.process().pid, throttle, { cores: CORES });
  const out = [];
  for (const { s, a, truth } of order(plan, round)) {
    await page.evaluate((u) => globalThis.load(u), s.frames.flatMap((_, i) => SLOTS.map((t) =>
      `${BASE}/${FRAMES}/${s.name}/${String(i).padStart(3, "0")}${t ? `.${t}` : ""}.htj2k`)));
    for (const arm of order(Object.keys(a), round)) {
      let exact = 0;
      const ms = [];
      for (let p = 0; p <= PASSES; p++) for (let i = 0; i < s.frames.length; i++) {
        const pieces = a[arm](i);
        const r = await page.evaluate(([q, n, c, m]) => globalThis.ask(q, n, c, m),
          [mutated(pieces, s.width), s.width * s.height, p === 0, MUTATE === "flip"]);
        if (r.error && !MUTATE) throw new Error(`${s.name} ${arm}: ${r.error}`);
        if (p === 0) {
          if (!r.error && r.whole === s.frames[i].truth && r.hashes.every((h, j) => h === truth(i, pieces[j]))) exact++;
        } else ms.push(r.ms);
      }
      out.push({ round, throttle, set: s.name, arm, frames: s.frames.length, exact, ms, settings });
      if (exact !== s.frames.length) console.error(`round ${round} ${throttle}x ${s.name} ${arm}: ${exact}/${s.frames.length} exact`);
    }
  }
  stop();
  await browser.close();
  await server.close();
  return out;
}

const cells = THROTTLES.map((throttle) => ({ throttle }));
for (let round = FIRST; round < FIRST + ROUNDS; round++) {
  for (const { throttle } of order(cells, round)) {
    const got = await inChromium(throttle, round);
    writeFileSync(OUT, got.map((r) => JSON.stringify(r)).join("\n") + "\n", { flag: "a" });
    console.error(`round ${round} ${throttle}x done`);
  }
}
process.exit(0);
