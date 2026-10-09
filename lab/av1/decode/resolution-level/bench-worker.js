/** Decode time a frame for bench.mjs: the whole codestream through the product's module, its level, and its prefix's level. */
import { order } from "/lab/order.mjs";
import { decodePreview, decodeWhole, init } from "./codec.js";

const OPENJPH = { glue: "/client/decode/wasm/vendor/openjph/openjphjs.js", wasm: "/client/decode/wasm/vendor/openjph/openjphjs.wasm", dir: "/client/decode/wasm/vendor/openjph" };
const ARMS = ["whole", "level", "prefix"];
const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

async function sha256(sab, mutate) {
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  if (mutate) copy[copy.length >> 1] ^= 1;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function run({ frames, sets, round, mutate }) {
  await init(OPENJPH);
  const rows = [];
  for (const [k, name] of order(sets, round).entries()) {
    const set = await (await fetch(`/${frames}/${name}/arms.json`)).json();
    const n = (i) => String(i).padStart(3, "0");
    const whole = await Promise.all([...Array(set.frames).keys()].map((i) => bytes(`/${frames}/${name}/${n(i)}.htj2k`)));
    const head = await Promise.all([...Array(set.frames).keys()].map((i) => bytes(`/${frames}/${name}/${n(i)}.res`)));
    const cells = Object.fromEntries(ARMS.map((a) => [a, { set: name, arm: a, ms: [], exact: 0, frames: 0 }]));
    for (let i = 0; i < set.frames; i++) {
      for (const arm of order(ARMS, round + k + i)) {
        const t0 = performance.now();
        const r = arm === "whole" ? decodeWhole(whole[i]) : decodePreview(arm === "level" ? whole[i] : head[i], set.level);
        cells[arm].ms.push(performance.now() - t0);
        const truth = arm === "whole" ? set.truth[i] : set.reducedTruth[i];
        cells[arm].frames++;
        if ((await sha256(r.sab, mutate)) === truth) cells[arm].exact++;
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
    postMessage({ error: String(err?.message ?? err) });
  }
};
