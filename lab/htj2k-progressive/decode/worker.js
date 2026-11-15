/**
 * Stage 2's decodes, one frame at a time through the lab decoder: the whole codestream twice (A, A′), each level's
 * prefix alone at (r, r) and (r, 0), and ladder sequences from scratch ending exact. Every picture's sha256 against
 * ladder.json's witness or the source's. lab/htj2k-progressive/README.md §Stage 2
 */
import { order } from "/lab/order.mjs";

const GLUE = "/lab/.openjph-build/wasm/levels.js";
export const SEQUENCES = { s10: [1, 0], s20: [2, 0], s210: [2, 1, 0], s543210: [5, 4, 3, 2, 1, 0] };
const ARMS = ["A", "A2", ...[1, 2, 3, 4, 5].flatMap((r) => [`p${r}`, `f${r}`]), ...Object.keys(SEQUENCES)];
const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
let dec = null;

async function sha256(px, mutate) {
  const copy = px.slice();
  if (mutate) copy[copy.length >> 1] ^= 1;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One decode from scratch: level r of the bytes at (r, r), or (r, 0) when `full`; r = 0 the whole frame. */
function decode(bytes, r, full) {
  dec.getEncodedBuffer(bytes.length).set(bytes);
  dec.readHeader();
  if (r) dec.decodeLevel(r, full ? 0 : r);
  else dec.decode();
  return dec.getDecodedBuffer();
}

/** The steps of an arm: [level, full size, prefix level] each; its pictures are checked after the clock stops. */
function steps(arm) {
  if (arm === "A" || arm === "A2") return [[0, false, 0]];
  if (arm[0] === "p" || arm[0] === "f") { const r = Number(arm.slice(1)); return [[r, arm[0] === "f", r]]; }
  return SEQUENCES[arm].map((r) => [r, false, r]);
}

async function run({ frames, sets, round, perSet, mutate }) {
  const src = await (await fetch(GLUE)).text();
  const factory = new Function(`${src}\nreturn OpenJPHModule;`).call(globalThis);
  const M = await factory({ locateFile: (f) => GLUE.replace(/[^/]*$/, f), wasmBinary: await (await fetch(GLUE.replace(/js$/, "wasm"))).arrayBuffer() });
  dec = new M.HTJ2KDecoder();
  const rows = [];
  for (const [k, name] of order(sets, round).entries()) {
    const set = await (await fetch(`/${frames}/${name}/ladder.json`)).json();
    const cuts = await (await fetch(`/${frames}/${name}/cuts.json`)).json();
    const n = Math.min(perSet, set.frames);
    const cells = Object.fromEntries(ARMS.map((a) => [a, { set: name, arm: a, ms: [], exact: 0, pictures: 0 }]));
    for (let i = 0; i < n; i++) {
      const whole = await bytes(`/${frames}/${name}/${String(i).padStart(3, "0")}.htj2k`);
      const cut = (r) => (r ? whole.subarray(0, cuts[i].levels[r].prefix) : whole);
      const truth = (r, full) => (r ? set.witness[r][full ? "full" : "reduced"][i] : set.truth[i]);
      for (const arm of order(ARMS, round + k + i)) {
        const got = [];
        let ms = 0;
        for (const [r, full, p] of steps(arm)) {
          const input = cut(p).slice();
          const t0 = performance.now();
          const px = decode(input, r, full);
          ms += performance.now() - t0;
          got.push([px.slice(), r, full]);
        }
        cells[arm].ms.push(ms);
        for (const [px, r, full] of got) {
          cells[arm].pictures++;
          if ((await sha256(px, mutate)) === truth(r, full)) cells[arm].exact++;
        }
      }
    }
    rows.push(...Object.values(cells));
  }
  return rows;
}

onmessage = async (e) => {
  try {
    postMessage({ rows: await run(e.data) });
  } catch (err) {
    postMessage({ error: String(err?.stack ?? err) });
  }
};
