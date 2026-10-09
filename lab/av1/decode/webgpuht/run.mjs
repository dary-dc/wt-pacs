// Every frame of every set through the WebGPU HT decoder on SwiftShader, one frame a dispatch and a batch
// a dispatch, with and without subgroups; exactness only. lab/av1/decode/webgpuht/README.md
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { tables } from "./tables.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../../../..");
const OJPH = arg("--openjph", path.join(ROOT, "lab/.openjph-build/src/src/core/coding"));
const FIXTURES = arg("--fixtures", path.join(ROOT, "lab/fixtures"));
const FRAMES = arg("--frames", path.join(ROOT, "lab/.av1-work/webgpuht"));
const SHAPES = arg("--shapes", "frame,batch").split(",");
const SUBGROUPS = arg("--subgroups", "0,1").split(",").map(Number);
const ONLY = arg("--sets", "");
const MUTATE = arg("--mutate", "");
const BUDGET = 256 * 2 ** 20;  // a batch's coefficient bytes
const FLAGS = ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader", "--enable-features=Vulkan"];

/** Broken on purpose: each takes its arms to 0 exact (a lifting constant, a block one row down, a scan made
 *  inclusive), or, `lanes`, makes every workgroup count a fault. */
const MUTANTS = {
  lift: ["ht.wgsl", "((h0 + h1 + 2i) >> 2u)", "((h0 + h1 + 1i) >> 2u)"],
  row: ["ht.wgsl", "planes[b.dst + y * b.stride + x]", "planes[b.dst + (y + 1u) * b.stride + x]"],
  scan: ["ht.mjs", "return vec2u(scan_buf[t] - c, scan_buf[31]);", "return vec2u(scan_buf[t], scan_buf[31]);"],
  scansub: ["ht.mjs", "return vec2u(before + incl - c, total);", "return vec2u(before + incl, total);"],
  lanes: ["ht.mjs", "subgroupBroadcastFirst(t) + lane != t", "subgroupBroadcastFirst(t) + lane == t"],
};

function sets() {
  const out = [];
  for (const d of readdirSync(FIXTURES).filter((d) => d.startsWith("decode_")).sort()) {
    const dir = path.join(FIXTURES, d), files = readdirSync(dir).filter((f) => f.endsWith(".j2c")).sort();
    if (!files.length) continue;
    const m = JSON.parse(readFileSync(path.join(dir, "metadata.json"), "utf8"));
    out.push({ name: d.slice(7), w: m.width, h: m.height, ch: m.channels, bits: m.bitsPerSample, signed: m.signed,
      frames: files.map((f) => ({ file: path.join(dir, f), truth: readFileSync(path.join(dir, f.replace(".j2c", ".sha256")), "utf8").trim() })) });
  }
  if (existsSync(path.join(FRAMES, "manifest.json")))
    for (const s of JSON.parse(readFileSync(path.join(FRAMES, "manifest.json"), "utf8")))
      out.push({ name: s.name, w: s.width, h: s.height, ch: s.channels, bits: s.bits, signed: s.signed,
        frames: s.frames.map((f, i) => ({ file: path.join(FRAMES, s.name, `${String(i).padStart(3, "0")}.htj2k`), truth: f.truth })) });
  return ONLY ? out.filter((s) => ONLY.split(",").includes(s.name)) : out;
}

const url = (f) => ({ url: `/f${f.file}`, truth: f.truth });
const cost = (s) => s.w * s.h * s.ch * 4;

/** Frames grouped so each group's coefficients stay within the budget. */
function batches(s, shape) {
  if (shape === "frame") return s.frames.map((f) => [url(f)]);
  const per = Math.max(1, Math.floor(BUDGET / cost(s))), out = [];
  for (let i = 0; i < s.frames.length; i += per) out.push(s.frames.slice(i, i + per).map(url));
  return out;
}

async function serve(page) {
  const table = tables(readFileSync(path.join(OJPH, "table0.h"), "utf8"), readFileSync(path.join(OJPH, "table1.h"), "utf8"));
  const text = (f) => {
    let t = readFileSync(path.join(HERE, f), "utf8");
    if (MUTANTS[MUTATE]?.[0] === f) {
      if (!t.includes(MUTANTS[MUTATE][1])) throw new Error(`mutant ${MUTATE} matches nothing`);
      t = t.replace(MUTANTS[MUTATE][1], MUTANTS[MUTATE][2]);
    }
    return t;
  };
  await page.route("http://localhost/**", (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname);
    if (p.startsWith("/f/")) return r.fulfill({ body: readFileSync(p.slice(2)) });
    if (p === "/tables.bin") return r.fulfill({ body: Buffer.from(table.buffer) });
    const f = p === "/" ? "index.html" : p.slice(1);
    const type = f.endsWith(".html") ? "text/html" : f.endsWith(".mjs") ? "text/javascript" : "text/plain";
    return r.fulfill({ body: text(f), contentType: type });
  });
}

const all = sets();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: FLAGS });
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error(m.text()));
await serve(page);
await page.goto("http://localhost/");
await page.waitForFunction(() => globalThis.ready);
const rows = [];
for (const subgroups of SUBGROUPS) {
  const adapter = await page.evaluate((o) => globalThis.setup(o), { subgroups: !!subgroups });
  const arms = SHAPES.map((shape) => ({ shape, sets: all.map((s) => ({ name: s.name, batches: batches(s, shape) })) }));
  if (!ONLY) {
    // L3-P2: frame k of every set, sizes and depths mixed, in one batch
    const mixed = [0, 1, 2, 3].map((k) => all.filter((s) => s.frames[k]).map((s) => url(s.frames[k])));
    arms.push({ shape: "mixed", sets: [{ name: `${all.length} sets`, batches: mixed }] });
  }
  for (const { shape, sets: ss } of arms) for (const s of ss) {
    const r = await page.evaluate((o) => globalThis.run(o), { batches: s.batches, subgroups: !!subgroups, flip: MUTATE === "sample" });
    const sum = (k) => r.reduce((a, x) => a + (Array.isArray(x[k]) ? x[k].reduce((p, q) => p + q, 0) : x[k]), 0);
    const row = { adapter, subgroups, shape, set: s.name, frames: sum("frames"), exact: sum("exact"),
      dispatches: sum("dispatches"), readbacks: sum("readbacks"), faults: sum("faults"), batches: r.length };
    rows.push(row);
    console.error(JSON.stringify(row));
  }
}
await browser.close();

console.log(`adapter ${rows[0]?.adapter}${MUTATE ? `; mutant ${MUTATE}` : ""}`);
console.log("subgroups | shape | set | exact | batches | dispatches a frame | read-backs a frame | faults");
for (const r of rows)
  console.log([r.subgroups ? "on" : "off", r.shape, r.set, `${r.exact}/${r.frames}`, r.batches,
    (r.dispatches / r.frames).toFixed(2), (r.readbacks / r.frames).toFixed(2), r.faults].join(" | "));
const total = (f) => rows.reduce((a, r) => a + r[f], 0);
console.log(`total ${total("exact")}/${total("frames")} exact, ${total("faults")} faults`);
