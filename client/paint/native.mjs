/**
 * The native painter (client/native/src/paint.rs on wgpu) against the browser suite's cells and CPU reference.
 * docs/native/README.md §6 M1
 *
 *   node client/paint/native.mjs [--zoom1]
 *   node client/paint/native.mjs mutants
 *
 * The adapter is wgpu's first: VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json picks Mesa lavapipe.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CSS, FRAMES, SETS, cells, make } from "./cells.mjs";
import { paintReference } from "./reference.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const argv = process.argv.slice(2);
const sets = Object.entries(SETS).filter(([, s]) => !s.timing);
const ALL = sets.flatMap(([n, s]) => cells(n, s, make(n, s)));

function samples(cell) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FRAMES, `${cell.set}.raw`)));
  const s = cell.spec;
  const View = s.components === 3 || s.bits <= 8 ? Uint8Array : s.signed ? Int16Array : Uint16Array;
  return new View(bytes.buffer);
}

/** Each cell painted natively at `dpr`, against the reference: the largest |Δ| and how many samples differ. */
function run(dpr, all) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-paint-"));
  try {
    const width = Math.round(CSS.w * dpr);
    const height = Math.round(CSS.h * dpr);
    const jobs = all.map((c) => ({ raw: path.join(FRAMES, `${c.set}.raw`), spec: c.spec, display: c.display, width, height, dpr }));
    fs.writeFileSync(path.join(dir, "cells.json"), JSON.stringify(jobs));
    const renderer = execFileSync("cargo", ["run", "-q", "-p", "native-client", "--features", "paint", "--example", "paint-check", "--",
      path.join(dir, "cells.json"), dir], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const out = all.map((cell, i) => {
      const error = path.join(dir, `${i}.error`);
      if (fs.existsSync(error)) return { name: cell.name, exact: cell.exact, error: fs.readFileSync(error, "utf8") };
      const pixels = fs.readFileSync(path.join(dir, `${i}.rgba`));
      const ref = paintReference({ ...cell.spec, samples: samples(cell) }, cell.display, width, height, dpr);
      let worst = 0;
      let differ = 0;
      for (let k = 0; k < ref.length; k++) {
        const d = Math.abs(ref[k] - pixels[k]);
        if (d) differ++;
        if (d > worst) worst = d;
      }
      return { name: cell.name, exact: cell.exact, worst, differ, samples: ref.length };
    });
    return { renderer, out };
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

if (argv[0] !== "mutants") {
  const want = ALL.filter((c) => !argv.includes("--zoom1") || c.exact);
  let bad = 0;
  for (const dpr of [1, 2]) {
    const { renderer, out } = run(dpr, want);
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

const WGSL = "client/native/src/paint.wgsl";
const RUST = "client/native/src/paint.rs";
const MUTANTS = {
  "NEAREST for LINEAR": { [WGSL]: [["let i = vec2<i32>(floor(t));", "let i = vec2<i32>(floor(t + 0.5));"], ["let f = t - floor(t);", "let f = vec2<f32>(0.0);"]] },
  "the quad moved by 1/512 px": { [RUST]: [["let x0 = ((width - s * dw) / 2.0).floor() + v.pan_x * dpr;", "let x0 = ((width - s * dw) / 2.0).floor() + v.pan_x * dpr + 1.0 / 512.0;"]] },
  "the window after the filter": { [WGSL]: [
    ["let a = lookup(sample(i, n, c));", "let a = f32(sample(i, n, c));"],
    ["let b = lookup(sample(i + vec2<i32>(1, 0), n, c));", "let b = f32(sample(i + vec2<i32>(1, 0), n, c));"],
    ["let d = lookup(sample(i + vec2<i32>(0, 1), n, c));", "let d = f32(sample(i + vec2<i32>(0, 1), n, c));"],
    ["let e = lookup(sample(i + vec2<i32>(1, 1), n, c));", "let e = f32(sample(i + vec2<i32>(1, 1), n, c));"],
    ["rgb[k] = floor(mix(mix(a, b, f.x), mix(d, e, f.x), f.y) + 0.5) / 255.0;", "rgb[k] = lookup(u32(floor(mix(mix(a, b, f.x), mix(d, e, f.x), f.y) + 0.5))) / 255.0;"],
  ] },
  "the signed offset dropped": { [RUST]: [["place.extend((offset as u32).to_le_bytes());", "place.extend(0u32.to_le_bytes());"]] },
  "the shader's rounding dropped": { [WGSL]: [["f.y) + 0.5) / 255.0;", "f.y)) / 255.0;"]] },
  "rounding turned the other way": { [RUST]: [["+ intercept) + 0.5).floor()", "+ intercept) - 0.5).ceil()"]] },
  "MONOCHROME1 not inverted": { [RUST]: [["let flip = (display.photometric == Photometric::Monochrome1) != display.invert;", "let flip = display.invert;"]] },
  "LINEAR and LINEAR_EXACT swapped": { [RUST]: [["Function::Linear => {", "Function::LinearExact => {"], ["Function::LinearExact => {\n            ensure!(w > 0.0", "Function::Linear => {\n            ensure!(w > 0.0"]] },
  "the −0.5 of LINEAR dropped": { [RUST]: [["((x - (c - 0.5)) / (w - 1.0) + 0.5)", "((x - c) / (w - 1.0) + 0.5)"]] },
};

/** Runs `all` with `edits` applied to the sources, which are restored whatever happens. */
function mutated(edits, all) {
  const originals = Object.fromEntries(Object.keys(edits).map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
  try {
    for (const [file, pairs] of Object.entries(edits)) {
      let text = originals[file];
      for (const [from, to] of pairs) {
        if (text.split(from).length !== 2) throw new Error(`mutant: ${file} has not exactly one ${from.slice(0, 60)}`);
        text = text.replace(from, to);
      }
      fs.writeFileSync(path.join(ROOT, file), text);
    }
    return run(1, all);
  } finally {
    for (const [file, text] of Object.entries(originals)) fs.writeFileSync(path.join(ROOT, file), text);
  }
}

const base = new Map(run(1, ALL).out.map((r) => [r.name, r]));
for (const [name, edits] of Object.entries(MUTANTS)) {
  const { out } = mutated(edits, ALL);
  const exactCaught = out.filter((r) => r.exact && (r.error || r.worst > 0)).map((r) => r.name);
  const fracMoved = out.filter((r) => !r.exact && (r.error || r.worst > base.get(r.name).worst || r.differ > base.get(r.name).differ))
    .map((r) => `${r.name} (|Δ| ${base.get(r.name).worst} → ${r.worst}, differ ${base.get(r.name).differ} → ${r.differ})`);
  console.log(`${name}: ${exactCaught.length ? `caught by ${exactCaught.length} exact cells, e.g. ${exactCaught[0]}` : "no exact cell catches it"}` +
    `${fracMoved.length ? `; moves ${fracMoved.length} fractional cells, e.g. ${fracMoved[0]}` : ""}`);
}
