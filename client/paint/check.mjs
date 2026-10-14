/**
 * Proves the painter against its CPU reference, runs its mutants, and times it. client/paint/README.md
 *
 *   NODE_PATH=$(npm root -g) node client/paint/check.mjs [check] [--renderer swiftshader|gl] [--zoom1]
 *   NODE_PATH=$(npm root -g) node client/paint/check.mjs mutants
 *   NODE_PATH=$(npm root -g) node client/paint/check.mjs bench [--rounds 10]
 *
 * Frames come from lab/scripts/gen_frame_pnm.py (numpy: PYTHON, else lab/av1/.venv, else python3),
 * checked against its checksum, into client/paint/frames/ (gitignored).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { order } from "../../lab/order.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith("--") && !/^\d/.test(a)) ?? "check";
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};
const RENDERERS = { swiftshader: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], gl: ["--use-angle=gl"] };

/** Odd width, not square, RGB, 8 and 16 bits, signed CT; the last two only for timing. */
const SETS = {
  grey8: { width: 64, height: 64, components: 1, bits: 8, signed: false, maxval: 255, mode: "field" },
  rgb8: { width: 61, height: 40, components: 3, bits: 8, signed: false, maxval: 255, mode: "cine" },
  u16: { width: 80, height: 48, components: 1, bits: 16, signed: false, maxval: 65535, mode: "field" },
  ct12s: { width: 64, height: 64, components: 1, bits: 12, signed: true, maxval: 4095, mode: "ct" },
  ct512: { width: 512, height: 512, components: 1, bits: 12, signed: true, maxval: 4095, mode: "ct", timing: true },
  big16: { width: 4096, height: 3072, components: 1, bits: 16, signed: false, maxval: 65535, mode: "ct", timing: true },
};

const PY = process.env.PYTHON ?? (fs.existsSync(path.join(ROOT, "lab/av1/.venv/bin/python")) ? path.join(ROOT, "lab/av1/.venv/bin/python") : "python3");
const FRAMES = path.join(HERE, "frames");

/** The generator's samples, checked against its checksum, then little-endian and level-shifted if signed. */
function make(name, s) {
  const out = path.join(FRAMES, `${name}.raw`);
  const stats = path.join(FRAMES, `${name}.json`);
  if (fs.existsSync(out) && fs.existsSync(stats)) return JSON.parse(fs.readFileSync(stats, "utf8"));
  fs.mkdirSync(FRAMES, { recursive: true });
  const pnm = path.join(FRAMES, `${name}.${s.components === 1 ? "pgm" : "ppm"}`);
  execFileSync(PY, [path.join(ROOT, "lab/scripts/gen_frame_pnm.py"), pnm, s.width, s.height, s.components, s.maxval, 0, 1, s.mode].map(String));
  const raw = fs.readFileSync(pnm);
  let at = 0;
  for (let lines = 0; lines < 3; at++) if (raw[at] === 0x0a) lines++;
  const body = raw.subarray(at);
  const wide = s.maxval > 255;
  const le = Buffer.alloc(body.length);
  if (wide) for (let i = 0; i < body.length; i += 2) le.writeUInt16LE(body.readUInt16BE(i), i);
  else body.copy(le);
  const want = fs.readFileSync(`${pnm}.sha256`, "utf8").trim();
  if (createHash("sha256").update(le).digest("hex") !== want) throw new Error(`${name}: not the generator's samples`);
  const values = [];
  for (let i = 0; i < le.length; i += wide ? 2 : 1) {
    const v = wide ? le.readUInt16LE(i) : le[i];
    values.push(s.signed ? v - (1 << (s.bits - 1)) : v);
    if (s.signed) le.writeInt16LE(v - (1 << (s.bits - 1)), i);
  }
  fs.writeFileSync(out, le);
  fs.rmSync(pnm);
  fs.rmSync(`${pnm}.sha256`);
  const sorted = values.sort((a, b) => a - b);
  const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  const st = { p10: q(0.1), p50: q(0.5), p90: q(0.9) };
  fs.writeFileSync(stats, JSON.stringify(st));
  return st;
}

/** Every cell for one set; `exact` cells are 1:1 on whole device pixels and must equal the reference to the code. */
function cells(name, s, st) {
  const spec = { width: s.width, height: s.height, components: s.components, bits: s.bits, signed: s.signed };
  const rgb = s.components === 3;
  const c = st.p50;
  const w = Math.max(2, st.p90 - st.p10);
  const span = s.signed ? 1 << s.bits : 1 << s.bits;
  const lo = s.signed ? -(1 << (s.bits - 1)) : 0;
  const windows = rgb
    ? { identity: { photometric: "RGB" }, invert: { photometric: "RGB", invert: true } }
    : {
      identity: { voi: { center: lo + span / 2, width: span, function: "LINEAR" } },
      tight: { voi: { center: c, width: w, function: "LINEAR" } },
      half: { voi: { center: c, width: 510, function: "LINEAR_EXACT" } },
      exact: { voi: { center: c, width: w, function: "LINEAR_EXACT" } },
      sigmoid: { voi: { center: c, width: w, function: "SIGMOID" } },
      mono1: { photometric: "MONOCHROME1", voi: { center: c, width: w, function: "LINEAR" } },
      invert: { invert: true, voi: { center: c, width: w, function: "LINEAR" } },
      rescaled: { rescale: { slope: 2, intercept: -1024 }, voi: { center: 2 * c - 1024, width: 2 * w, function: "LINEAR" } },
    };
  const base = rgb ? windows.identity : windows.tight;
  const one = { fit: false, zoom: 1 };
  const views = {
    "1:1": one,
    r90: { ...one, rotate: 90 }, r180: { ...one, rotate: 180 }, r270: { ...one, rotate: 270 },
    flipH: { ...one, flipH: true }, flipV: { ...one, flipV: true }, "r90+flipH": { ...one, rotate: 90, flipH: true },
    pan: { ...one, panX: 3, panY: -2 },
  };
  const fractional = {
    "pan 0.3,0.6": { ...one, panX: 0.3, panY: 0.6 }, fit: { fit: true }, "zoom 2": { fit: false, zoom: 2 },
    "zoom 0.5": { fit: false, zoom: 0.5 }, "zoom 1.37": { fit: false, zoom: 1.37 },
  };
  const out = [];
  for (const [wn, d] of Object.entries(windows)) out.push({ name: `${name} ${wn} 1:1`, set: name, spec, exact: true, display: { ...d, view: one } });
  for (const [vn, v] of Object.entries(views)) if (vn !== "1:1") out.push({ name: `${name} ${vn}`, set: name, spec, exact: true, display: { ...base, view: v } });
  for (const [vn, v] of Object.entries(fractional)) out.push({ name: `${name} ${vn}`, set: name, spec, exact: false, display: { ...base, view: v } });
  return out;
}

const port = 30000 + ((Math.random() * 20000) | 0);
const server = spawn("python3", ["server/dev-server.py", "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => server.kill());
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH,
  args: ["--no-sandbox", "--ignore-gpu-blocklist", ...RENDERERS[flag("renderer", "swiftshader")]],
});
const CSS = { w: 100, h: 72 };
const ISOLATED = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" };

async function run(dpr, all, patches = {}) {
  const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 400, height: 300 } });
  for (const [file, edits] of Object.entries(patches)) {
    const original = fs.readFileSync(path.join(HERE, file), "utf8");
    let text = original;
    for (const [from, to] of edits) {
      if (!text.includes(from)) throw new Error(`mutant: ${file} has no ${from.slice(0, 60)}`);
      text = text.split(from).join(to);
    }
    await context.route(`**/client/paint/${file}`, (r) => r.fulfill({ body: text, contentType: "text/javascript", headers: ISOLATED }));
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
  await page.goto(`http://127.0.0.1:${port}/client/paint/check.html`);
  await page.waitForFunction(() => globalThis.ready);
  const r = await page.evaluate(([c, css]) => globalThis.check(c, css), [all, CSS]);
  await context.close();
  return r;
}

const stats = Object.fromEntries(Object.entries(SETS).filter(([, s]) => mode === "bench" || !s.timing).map(([n, s]) => [n, make(n, s)]));
const ALL = Object.entries(SETS).filter(([, s]) => !s.timing).flatMap(([n, s]) => cells(n, s, stats[n]));
const zoom1 = argv.includes("--zoom1");

if (mode === "check") {
  const want = ALL.filter((c) => !zoom1 || c.exact);
  let bad = 0;
  for (const dpr of [1, 2]) {
    const { renderer, out } = await run(dpr, want);
    console.log(`renderer ${renderer}, DPR ${dpr}`);
    for (const r of out) {
      const failed = r.error || (r.exact && r.worst > 0);
      bad += failed ? 1 : 0;
      const what = r.error ? `ERROR ${r.error}` : `max |Δ| ${r.worst}, ${(100 * r.differ / r.samples).toFixed(2)} % of samples differ`;
      console.log(`  ${failed ? "FAIL" : r.exact ? "ok  " : "    "} ${r.name.padEnd(26)} ${r.exact ? "exact" : "fractional, reported"}  ${what}`);
    }
  }
  console.log(bad ? `NOT EQUAL: ${bad} cells` : "every 1:1 whole-pixel cell equals the reference to the code");
  process.exit(bad ? 1 : 0);
}

if (mode === "mutants") {
  const AFTER = `const PLACE_AFTER = (sampler) => \`#version 300 es
precision highp float;
precision highp int;
precision highp \${sampler};
precision highp usampler2D;
uniform \${sampler} samples;
uniform usampler2D table;
uniform int offset;
in vec2 uv;
out vec4 frag;
void main() {
  ivec2 n = textureSize(samples, 0);
  vec2 t = uv * vec2(n) - 0.5;
  ivec2 i = ivec2(floor(t));
  vec2 f = t - floor(t);
  float a = float(texelFetch(samples, clamp(i, ivec2(0), n - 1), 0).r);
  float b = float(texelFetch(samples, clamp(i + ivec2(1, 0), ivec2(0), n - 1), 0).r);
  float c = float(texelFetch(samples, clamp(i + ivec2(0, 1), ivec2(0), n - 1), 0).r);
  float d = float(texelFetch(samples, clamp(i + ivec2(1, 1), ivec2(0), n - 1), 0).r);
  int s = int(floor(mix(mix(a, b, f.x), mix(c, d, f.x), f.y) + 0.5)) + offset;
  float g = float(texelFetch(table, ivec2(s & 255, s >> 8), 0).r) / 255.0;
  frag = vec4(vec3(g), 1.0);
}\`;
let placeSampler = "usampler2D";
let placeOffset = 0;
`;
  const MUTANTS = {
    "NEAREST for LINEAR": { "paint-worker.js": [["picture = texture(gl.RGBA8, frame.width, frame.height, gl.LINEAR);", "picture = texture(gl.RGBA8, frame.width, frame.height, gl.NEAREST);"]] },
    "the quad moved by 1/512 px": { "paint-worker.js": [["const x0 = Math.floor((width - s * dw) / 2) + v.panX * dpr;", "const x0 = Math.floor((width - s * dw) / 2) + v.panX * dpr + 1 / 512;"]] },
    "the window after the filter": { "paint-worker.js": [
      ["let gl = null;", `${AFTER}let gl = null;`],
      ["const f = format(frame);", "const f = format(frame);\n    placeSampler = f.sampler;\n    placeOffset = tableShape(frame).offset;"],
      ['const { p, at } = program("place", VERT_QUAD, PLACE);', 'const { p, at } = program("after" + placeSampler, VERT_QUAD, PLACE_AFTER(placeSampler));'],
      ['gl.uniform1i(at("picture"), 0);', 'gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, source); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tableTex);\n  gl.uniform1i(at("samples"), 1); gl.uniform1i(at("table"), 2); gl.uniform1i(at("offset"), placeOffset);'],
    ] },
    "the signed offset dropped": { "paint-worker.js": [['gl.uniform1i(at("offset"), offset);', 'gl.uniform1i(at("offset"), 0);']] },
    "rounding turned the other way": { "voi.js": [["Math.floor(y + 0.5)", "Math.ceil(y - 0.5)"]] },
    "MONOCHROME1 not inverted": { "voi.js": [['const flip = (photometric === "MONOCHROME1") !== Boolean(invert);', "const flip = Boolean(invert);"]] },
    "LINEAR and LINEAR_EXACT swapped": { "voi.js": [['if (fn === "LINEAR") {', 'if (fn === "LINEAR_EXACT_") {'], ['if (fn === "LINEAR_EXACT") {', 'if (fn === "LINEAR" || fn === "LINEAR_EXACT") {']] },
    "the −0.5 of LINEAR dropped": { "voi.js": [["(x - (c - 0.5)) / (w - 1)", "(x - c) / (w - 1)"]] },
  };
  const grey = ALL.filter((c) => c.spec.components === 1 && (!c.spec.signed || true));
  const clean = await run(1, ALL);
  const base = new Map(clean.out.map((r) => [r.name, r]));
  for (const [name, patches] of Object.entries(MUTANTS)) {
    const { out } = await run(1, name === "the window after the filter" ? grey.filter((c) => !c.spec.signed) : ALL, patches);
    const exactCaught = out.filter((r) => r.exact && (r.error || r.worst > 0)).map((r) => r.name);
    const fracMoved = out.filter((r) => !r.exact && !r.error && (r.worst > base.get(r.name).worst || r.differ > base.get(r.name).differ))
      .map((r) => `${r.name} (|Δ| ${base.get(r.name).worst} → ${r.worst}, differ ${base.get(r.name).differ} → ${r.differ})`);
    console.log(`${name}: ${exactCaught.length ? `caught by ${exactCaught.length} exact cells, e.g. ${exactCaught[0]}` : "no exact cell catches it"}` +
      `${fracMoved.length ? `; moves ${fracMoved.length} fractional cells, e.g. ${fracMoved[0]}` : ""}`);
  }
  process.exit(0);
}

if (mode === "bench") {
  const ROUNDS = Number(flag("rounds", 10));
  const big = { w: 768, h: 576 };
  const variants = [
    { variant: "512² new frame", set: "ct512", css: { w: 512, h: 512 }, newFrame: true },
    { variant: "512² window change", set: "ct512", css: { w: 512, h: 512 }, newFrame: false },
    { variant: "4096×3072 new frame", set: "big16", css: big, newFrame: true },
    { variant: "4096×3072 window change", set: "big16", css: big, newFrame: false },
  ];
  const rows = Object.fromEntries(variants.map((a) => [a.variant, []]));
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/client/paint/check.html`);
  await page.waitForFunction(() => globalThis.ready);
  let toggle = 0;
  for (let round = -1; round < ROUNDS; round++) {
    for (const a of order(variants, Math.max(round, 0))) {
      const s = SETS[a.set];
      const spec = { width: s.width, height: s.height, components: 1, bits: s.bits, signed: s.signed };
      const st = stats[a.set];
      const display = { voi: { center: st.p50 + (toggle++ % 2), width: Math.max(2, st.p90 - st.p10), function: "LINEAR" }, view: { fit: true } };
      const t = await page.evaluate(([set, sp, d, css, nf]) => globalThis.time(set, sp, d, css, nf), [a.set, spec, display, a.css, a.newFrame]);
      if (round >= 0) rows[a.variant].push(t);
    }
  }
  const renderer = await page.evaluate(() => globalThis.check([], { w: 1, h: 1 }).then((r) => r.renderer));
  const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[s.length >> 1]; };
  const span = (xs) => `${med(xs).toFixed(2)} [${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)}]`;
  console.log(`renderer ${renderer}; ms, median [min–max] of ${ROUNDS} interleaved rounds`);
  for (const a of variants) {
    const r = rows[a.variant];
    console.log(`${a.variant.padEnd(26)} worker ${span(r.map((x) => x.worker))}  page ${span(r.map((x) => x.page))}  round trip ${span(r.map((x) => x.roundTrip))}  uploaded ${r.filter((x) => x.uploaded).length}/${r.length}`);
  }
  process.exit(0);
}
