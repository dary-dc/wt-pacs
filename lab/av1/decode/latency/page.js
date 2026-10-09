/**
 * WebCodecs' AV1 decoder, a unit at a time: flushed after each (the product today), with
 * `optimizeForLatency` and no flush, the same flushed before each keyframe, or with neither. Each unit's frame is awaited up to a deadline,
 * timed from decode() to the output callback, and every frame's planes hashed against the encoder's
 * input. run.mjs drives it. lab/av1/decode/latency/README.md
 */
import { order } from "../../../order.mjs";

const CONFIG = {
  flush: { flush: true },
  latency: { optimizeForLatency: true },
  keyflush: { optimizeForLatency: true, before: true },
  hold: {},
};

function units(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let at = view.getUint16(6, true); at < bytes.length; ) {
    const size = view.getUint32(at, true);
    out.push(bytes.subarray(at + 12, at + 12 + size));
    at += 12 + size;
  }
  return out;
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The frame's planes hashed; 4:0:0 comes back as I420 with mid-grey chroma, so its Y plane only. */
async function hashes(frame, planes, mutate) {
  const buf = new Uint8Array(frame.allocationSize());
  const layout = await frame.copyTo(buf);
  if (mutate) buf[layout[0].offset] ^= 1;
  const out = [];
  for (let p = 0; p < planes; p++) {
    const end = p + 1 < layout.length ? layout[p + 1].offset : buf.length;
    out.push(await sha256(buf.subarray(layout[p].offset, end)));
  }
  return out;
}

async function stream(cell, arm, { dir, mutate, waitMs }) {
  const bytes = new Uint8Array(await (await fetch(`${dir}/${cell.name}.ivf`)).arrayBuffer());
  const planes = cell.layout === "mono" ? 1 : 3;
  const row = { stream: cell.name, arm, ms: [], perUnit: 0, frames: 0, exact: 0, expected: cell.frames, errors: [] };
  const got = new Map();
  let waiting = null;
  const decoder = new VideoDecoder({
    output: (f) => {
      const at = performance.now();
      got.set(f.timestamp, { at, done: hashes(f, planes, mutate).finally(() => f.close()) });
      waiting?.(f.timestamp);
    },
    error: (e) => row.errors.push(`${e.name}: ${e.message}`),
  });
  const { flush, before, ...extra } = CONFIG[arm];
  try {
    decoder.configure({ codec: cell.codec, hardwareAcceleration: "prefer-software", ...extra });
    for (const [i, unit] of units(bytes).entries()) {
      const out = new Promise((resolve) => {
        waiting = (t) => t === i && resolve(true);
        setTimeout(() => resolve(false), waitMs);
      });
      const t0 = performance.now();
      // The product's guard: a keyframe decodes alone, never against the frame before it.
      if (before && i > 0 && i % cell.gop === 0) await decoder.flush();
      decoder.decode(new EncodedVideoChunk({ type: i % cell.gop ? "delta" : "key", timestamp: i, data: unit }));
      if (flush) await decoder.flush();
      if (got.has(i) || (await out)) {
        row.perUnit++;
        row.ms.push(got.get(i).at - t0);
        await got.get(i).done;
      }
    }
    await decoder.flush();
  } catch (e) {
    row.errors.push(`${e.name}: ${e.message}`);
  }
  for (const [t, { done }] of got) {
    row.frames++;
    const h = await done;
    if (h.every((x, p) => x === cell.truth[t][p])) row.exact++;
  }
  if (decoder.state !== "closed") decoder.close();
  return row;
}

globalThis.run = async ({ dir, names, arms, round, mutate, waitMs }) => {
  const manifest = (await (await fetch(`${dir}/manifest.json`)).json()).filter((c) => !names || names.includes(c.name));
  const rows = [];
  for (const cell of order(manifest, round)) {
    for (const arm of order(arms, round)) rows.push({ ...(await stream(cell, arm, { dir, mutate, waitMs })), tiles: cell.tiles, bytes: cell.bytes });
  }
  return rows;
};
globalThis.ready = true;
