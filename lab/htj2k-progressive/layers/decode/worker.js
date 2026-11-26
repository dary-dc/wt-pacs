/**
 * Stage 2's decodes for the quality shapes, one frame at a time through the layered lab decoder: today's codestream
 * twice (A, A′), each shape's layer-1 prefix alone, and each shape's sequence from scratch — layer 1, then the whole.
 * Every picture's sha256 against stage1.py's layer-1 or source digest, after the clock. layers/README.md
 */
import { order } from "/lab/order.mjs";

const GLUE = "/lab/.openjph-build/wasm/layered.js";
const SHAPES = ["oneset", ...[1, 2, 3, 4, 5, 6, 7].map((p) => `twosets${p}`)];
export const ARMS = ["A", "A2", ...SHAPES.flatMap((s) => [`${s}.l1`, `${s}.seq`])];
const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());
let dec = null;

async function sha256(px, mutate) {
  const copy = px.slice();
  if (mutate) copy[copy.length >> 1] ^= 1;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function decode(input) {
  dec.getEncodedBuffer(input.length).set(input);
  dec.readHeader();
  dec.decode();
  return dec.getDecodedBuffer();
}

async function run({ frames, sets, round, perSet, mutate }) {
  const src = await (await fetch(GLUE)).text();
  const factory = new Function(`${src}\nreturn OpenJPHModule;`).call(globalThis);
  const M = await factory({ locateFile: (f) => GLUE.replace(/[^/]*$/, f), wasmBinary: await (await fetch(GLUE.replace(/js$/, "wasm"))).arrayBuffer() });
  dec = new M.HTJ2KDecoder();
  const rows = [];
  for (const [k, name] of order(sets, round).entries()) {
    const items = await (await fetch(`/${frames}/${name}/items.json`)).json();
    const ids = [...new Set(items.map((it) => it.file.split("/")[0]))].slice(0, perSet);
    const cells = Object.fromEntries(ARMS.map((a) => [a, { set: name, arm: a, ms: [], steps: [], exact: 0, pictures: 0 }]));
    for (const [i, id] of ids.entries()) {
      const today = await bytes(`/${frames}/${name}/${id}/today.j2c`);
      const shapes = {};
      for (const it of items.filter((x) => x.file.startsWith(`${id}/`))) {
        const cs = await bytes(`/${frames}/${name}/${it.file}`);
        shapes[it.shape] = { cs, prefix: cs.subarray(0, it.header + it.layer1), it };
      }
      const source = Object.values(shapes)[0].it.source;
      for (const arm of order(ARMS, round + k + i)) {
        const [shape, kind] = arm.split(".");
        const s = shapes[shape];
        const plan = !kind ? [[today, source]] : kind === "l1" ? [[s.prefix, s.it.want1]] : [[s.prefix, s.it.want1], [s.cs, s.it.source]];
        const got = [];
        const steps = [];
        for (const [input, want] of plan) {
          const copy = input.slice();
          const t0 = performance.now();
          const px = decode(copy);
          steps.push(performance.now() - t0);
          got.push([px.slice(), want]);
        }
        cells[arm].ms.push(steps.reduce((a, b) => a + b, 0));
        cells[arm].steps.push(steps);
        for (const [px, want] of got) {
          cells[arm].pictures++;
          if ((await sha256(px, mutate)) === want) cells[arm].exact++;
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
