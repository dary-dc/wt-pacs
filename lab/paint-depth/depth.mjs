/**
 * The paint-depth readback check: a reduced-depth preview painted at its own depth equals, code for code, the
 * CPU path (shown() to full scale, then the window table), on SwiftShader. docs/decode/paint-depth.md
 *
 *   lab/av1/.venv/bin/python lab/paint-depth/frames.py lab/av1/data lab/paint-depth/frames
 *   NODE_PATH=$(npm root -g) node lab/paint-depth/depth.mjs [--mutate shift|bias] [--renderer swiftshader|gl]
 *   NODE_PATH=$(npm root -g) node lab/paint-depth/depth.mjs --bench --rounds 30 --renderer gl --out rows.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { order } from "../order.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const RENDERERS = { swiftshader: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], gl: ["--use-angle=gl"] };
const ISOLATED = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" };

const HEAD = "const { shift = 0, bias = 0 } = frame.reduced ?? {};";
const MUTANTS = {
  shift: "const { shift = 0, bias = 0 } = frame.reduced ? { ...frame.reduced, shift: frame.reduced.shift + 1 } : {};",
  bias: "const { shift = 0 } = frame.reduced ?? {}; const bias = 0;",
};

const RAMPS = [
  { key: "ramp 10-bit k2", bits: 10, shift: 2, bias: 0, fullBits: 12, fullSigned: false },
  { key: "ramp 10-bit k0", bits: 10, shift: 0, bias: 0, fullBits: 10, fullSigned: false },
  { key: "ramp 8-bit k2", bits: 8, shift: 2, bias: 0, fullBits: 10, fullSigned: false },
  { key: "ramp 10-bit k2 bias 37", bits: 10, shift: 2, bias: 37, fullBits: 16, fullSigned: true },
];

const server = spawn("python3", ["server/dev-server.py", "--port", "0"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
process.on("exit", () => server.kill());
const port = await new Promise((resolve, reject) => {
  let out = "";
  server.stdout.on("data", (d) => { out += d; const m = /port=(\d+)/.exec(out); if (m) resolve(m[1]); });
  server.once("exit", (c) => reject(new Error(`dev-server.py exited ${c}`)));
});
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH,
  args: ["--no-sandbox", "--ignore-gpu-blocklist", ...RENDERERS[flag("renderer", "swiftshader")]],
});
const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 400, height: 300 } });
const mutant = flag("mutate", null);
if (mutant) {
  const text = fs.readFileSync(path.join(ROOT, "client/paint/voi.js"), "utf8");
  if (!text.includes(HEAD)) throw new Error("voi.js has no reduced-depth line to mutate");
  await context.route("**/client/paint/voi.js", (r) => r.fulfill({ body: text.replace(HEAD, MUTANTS[mutant]), contentType: "text/javascript", headers: ISOLATED }));
}
const page = await context.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`http://127.0.0.1:${port}/lab/paint-depth/depth.html`);
await page.waitForFunction(() => globalThis.ready);

const cases = JSON.parse(fs.readFileSync(path.join(HERE, "frames/cases.json"), "utf8"));
if (argv.includes("--bench")) await bench();
let bad = 0;
const t0 = Date.now();
for (const [kind, c] of [...RAMPS.map((c) => ["ramp", c]), ...cases.map((c) => ["dbt", c])]) {
  const r = await page.evaluate(([k, x]) => globalThis[k](x), [kind, c]);
  if (!bad && kind === "ramp" && c === RAMPS[0]) console.log(`renderer ${r.renderer}`);
  bad += r.reducedBad + r.fullBad;
  const where = kind === "dbt" ? `frame ${c.frame}, ${c.width}×${c.height}, ${c.stored}-bit stored, top ${c.bits} bits (k = ${c.shift})` : "every code";
  console.log(`${r.key.padEnd(24)} ${where}: ${r.windows} windows × ${r.samples} samples; ` +
    `reduced ≠ CPU in ${r.reducedBad} windows, full ≠ CPU in ${r.fullBad}` + (r.worstWindow ? `; first: ${JSON.stringify(r.worstWindow)}` : ""));
}
console.log(`${mutant ? `mutant ${mutant}: ` : ""}${bad ? `NOT EQUAL in ${bad} (case, path, window)s` : "every window equal to the code"} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
await browser.close();
process.exit(mutant ? (bad ? 0 : 1) : bad ? 1 : 0);

/** Arms cpu and gpu on every case, a new frame each paint, Williams-ordered per round; rows written after every round. */
async function bench() {
  const rounds = Number(flag("rounds", 30));
  const out = flag("out", path.join(HERE, "frames/bench.json"));
  const css = { w: 1024, h: 1024 };
  const units = cases.flatMap((c) => ["cpu", "gpu"].map((arm) => ({ c, arm })));
  const rows = [];
  let toggle = 0;
  let renderer = null;
  for (let round = -1; round < rounds; round++) {
    for (const { c, arm } of order(units, Math.max(round, 0))) {
      const hi = (c.max << c.shift) - c.bias;
      const display = { voi: { center: hi / 2 + (toggle++ % 2), width: hi / 2, function: "LINEAR" }, view: { fit: true } };
      const t = await page.evaluate(([x, a, d, s]) => globalThis.time(x, a, d, s), [c, arm, display, css]);
      renderer ??= t.renderer;
      if (round >= 0) rows.push({ round, key: c.key, arm, roundTrip: t.roundTrip, prep: t.prep, worker: t.worker });
    }
    if (round >= 0) fs.writeFileSync(out, JSON.stringify(rows));
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  console.log(`renderer ${renderer}; ms a paint, median over ${rounds} rounds; ratio gpu ÷ cpu paired by round`);
  for (const c of cases) {
    const of = (arm) => rows.filter((r) => r.key === c.key && r.arm === arm);
    const cpu = of("cpu");
    const gpu = of("gpu");
    const ratios = gpu.map((g, i) => g.roundTrip / cpu[i].roundTrip);
    const faster = ratios.filter((r) => r < 1).length;
    console.log(`${c.key.padEnd(12)} cpu ${med(cpu.map((r) => r.roundTrip)).toFixed(2)} (prep ${med(cpu.map((r) => r.prep)).toFixed(2)})` +
      `  gpu ${med(gpu.map((r) => r.roundTrip)).toFixed(2)} (prep ${med(gpu.map((r) => r.prep)).toFixed(2)})` +
      `  ratio ${med(ratios).toFixed(3)} [${Math.min(...ratios).toFixed(3)}–${Math.max(...ratios).toFixed(3)}], gpu faster ${faster}/${ratios.length}`);
  }
  await browser.close();
  process.exit(0);
}
