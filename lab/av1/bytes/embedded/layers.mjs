/**
 * EMBED's previews, found with the WASM decoders the timing runs: for each layered J2K frame the
 * smallest prefix holding each lossy layer, and for each JPEG XL frame the smallest prefix libjxl
 * draws a picture from and the picture at each layer's bytes; bytes, PSNR against the source and
 * max |Δ| of each. Every whole codestream
 * is decoded here too and must match the series' checksum. lab/av1/bytes/embedded/README.md
 *
 *   node lab/av1/bytes/embedded/layers.mjs [--work lab/.av1-work/embed] [--data lab/av1/data] [--mutate prefix]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createJxl, createOpj } from "./codecs.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = new URL("../../../..", import.meta.url).pathname;
const WORK = `${ROOT}/${arg("--work", "lab/.av1-work/embed")}`;
const DATA = `${ROOT}/${arg("--data", "lab/av1/data")}`;
const MUTATE = arg("--mutate", "") === "prefix";
const require = createRequire(import.meta.url);
const opj = await createOpj(require(`${ROOT}/lab/.av1-build/out/openjpeg.js`));
const jxl = await createJxl(require(`${ROOT}/lab/.av1-build/out/jxl.js`));
const { rates, sets } = JSON.parse(readFileSync(`${WORK}/manifest.json`, "utf8"));

const sha = (b) => createHash("sha256").update(b).digest("hex");
const pad = (i) => String(i).padStart(3, "0");

/** Decoded samples (coded values, 1 or 2 bytes) to the stored layout the checksums are of. */
function stored(set, samples) {
  if (set.stored <= 8) return samples;
  const v = new Uint16Array(samples.buffer, samples.byteOffset, samples.length / 2);
  const out = set.signed ? new Int16Array(v.length) : new Uint16Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - set.shift;
  return new Uint8Array(out.buffer);
}

function quality(set, src, samples) {
  const a = set.stored <= 8 ? src : new Uint16Array(src.buffer, src.byteOffset, src.length / 2);
  const b = set.stored <= 8 ? samples : new Uint16Array(samples.buffer, samples.byteOffset, samples.length / 2);
  let se = 0;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    se += d * d;
    if (d > max) max = d;
  }
  return { psnr: 10 * Math.log10((set.peak * set.peak) / (se / a.length || 1e-10)), max };
}

/** The smallest n for which reached(n) holds, reached being monotone in n and true at hi. */
function smallest(hi, reached) {
  let lo = 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reached(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const same = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0;
const out = [];
for (const set of sets) {
  const row = { name: set.name, rates, exact: {}, layers: [], jxl: { jxl: [], "jxl-prog": [] } };
  for (const c of ["j2k", "j2k-layers", "jxl", "jxl-prog"]) row.exact[c] = 0;
  for (let i = 0; i < set.frames; i++) {
    const raw = readFileSync(`${DATA}/${set.name}/${pad(i)}.raw`);
    if (sha(raw) !== set.truth[i]) throw new Error(`${set.name} ${i}: source is not its checksum`);
    const coded = set.stored <= 8 ? raw : (() => {
      const s = set.signed ? new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2) : new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
      const u = new Uint16Array(s.length);
      for (let k = 0; k < s.length; k++) u[k] = s[k] + set.shift;
      return new Uint8Array(u.buffer);
    })();
    const file = (c) => readFileSync(`${WORK}/${set.name}/${c}/${pad(i)}.${c.split("-")[0]}`);

    for (const c of ["j2k", "j2k-layers"]) row.exact[c] += sha(stored(set, opj(file(c), 0).samples)) === set.truth[i];
    const layered = file("j2k-layers");
    row.layers[i] = rates.map((_, l) => {
      const want = opj(layered, l + 1).samples;
      const n = smallest(layered.length, (n) => {
        const got = opj(layered.subarray(0, n), l + 1);
        return got.status === 0 && same(got.samples, want);
      }) - (MUTATE ? 1 : 0);
      const asIs = opj(layered.subarray(0, n), 0);
      return { bytes: n, prefixDecodesAsLayer: asIs.status === 0 && same(asIs.samples, want), digest: sha(stored(set, want)),
        ...quality(set, coded, want) };
    });

    for (const c of ["jxl", "jxl-prog"]) {
      const bytes = file(c);
      row.exact[c] += sha(stored(set, jxl(bytes).samples)) === set.truth[i];
      const picture = (n) => {
        const got = jxl(bytes.subarray(0, n));
        return got.status === 0 ? { bytes: n, digest: sha(stored(set, got.samples)), ...quality(set, coded, got.samples) }
          : { bytes: n, none: got.status };
      };
      const first = smallest(bytes.length, (n) => jxl(bytes.subarray(0, n)).status >= 0) - (MUTATE ? 1 : 0);
      row.jxl[c][i] = { first: picture(first), atLayers: row.layers[i].map((l) => picture(l.bytes)) };
    }
  }
  out.push(row);
  const bad = Object.entries(row.exact).filter(([, n]) => n !== set.frames);
  const notPrefix = row.layers.flat().filter((l) => !l.prefixDecodesAsLayer).length;
  const failed = Object.values(row.jxl).flat().filter((f) => f.first.none !== undefined).length;
  console.log(`${set.name}: whole codestreams exact ${JSON.stringify(row.exact)} of ${set.frames}; ` +
    `layer prefixes not decoding as their layer ${notPrefix}; first-picture prefixes not decoding ${failed}`);
  if (bad.length || notPrefix || failed) process.exitCode = 1;
}
writeFileSync(`${WORK}/layers.json`, JSON.stringify(out));
