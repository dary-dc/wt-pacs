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
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { order } from "../../lab/order.mjs";
import { CSS, SETS, cells, make } from "./cells.mjs";

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
