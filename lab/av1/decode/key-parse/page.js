/**
 * One browser's share of a round, run by the page so any engine that opens a URL can take it: the product's decoder
 * worker under each arm, flushed after every unit or under `keyParse`, timing every frame of every stream or sending
 * every mutation. run.mjs serves and drives it. lab/av1/decode/key-parse/README.md
 */
import { order } from "/lab/order.mjs";

const post = (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) });
const ARMS = { flush: false, keyParse: true };
/** Past this a send has outlasted the product's 2 s stall timer and its flush: a stall. */
const SEND_MS = 30000;

async function sha256(sab, flip) {
  // SubtleCrypto refuses a view on shared memory.
  const copy = new Uint8Array(sab.byteLength);
  copy.set(new Uint8Array(sab));
  if (flip) copy[copy.length >> 1] ^= 1;
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A decoder worker as the downloader drives one: init, then one frame in flight; each send settles as a frame or a failure. */
async function start(decoder, groupLength, digests) {
  const worker = new Worker("worker.js", { type: "module" });
  const { port1, port2 } = new MessageChannel();
  let frame = null;
  let reply = null;
  worker.onmessage = ({ data: m }) => reply?.(m);
  worker.onerror = (e) => reply?.({ kind: "failed", reason: `worker: ${e.message}` });
  port2.onmessage = ({ data: m }) => m.kind === "frame" && !m.preview && frame?.(m);
  const ready = new Promise((r) => (reply = r));
  worker.postMessage({ kind: "init", toConsumer: port1, decoder, groupLength, digests }, [port1]);
  const r = await ready;
  if (r.kind !== "ready") throw new Error(r.reason);
  return {
    async send(bytes, index, key) {
      const f = new Promise((res) => (frame = res));
      const done = new Promise((res) => (reply = res));
      const copy = bytes.slice();
      worker.postMessage({ kind: "decode", index, gen: 0, key, bytes: copy, stamps: {} }, [copy.buffer]);
      const timeout = new Promise((res) => setTimeout(() => res({ kind: "stalled" }), SEND_MS));
      const m = await Promise.race([done, timeout]);
      if (m.kind !== "done") return { m };
      return { m, f: await f };
    },
    close: () => (worker.terminate(), port2.close()),
  };
}

const decoderOf = (keyParse) => {
  const dir = `${location.origin}/client/decode/wasm/built/dav1d`;
  return { codec: "av1", glue: `${dir}/dav1d.js`, wasm: `${dir}/dav1d.wasm`, dir, keyParse };
};
const fetched = (dir, set, file) => fetch(`/${dir}/${set}/${file}`).then((x) => x.arrayBuffer()).then((b) => new Uint8Array(b));
const tally = (paths, p) => (paths[p] = (paths[p] ?? 0) + 1);

/** rows: { set, arm, ms[], exact, frames, units, flushes, paths, error? }; one warm-up frame first, as the product decodes at init. */
async function time({ frames: dir, round, sets, flip, noDigests }) {
  const manifest = (await (await fetch(`/${dir}/manifest.json`)).json()).filter((s) => !sets || sets.includes(s.name));
  const rows = [];
  for (const set of order(manifest, round)) {
    const bytes = await Promise.all(set.frames.map((_, i) => fetched(dir, set.name, `${String(i).padStart(3, "0")}.g1`)));
    for (const arm of order(Object.keys(ARMS), round)) {
      const row = { set: set.name, arm, ms: [], exact: 0, frames: bytes.length, paths: {} };
      let dec = null;
      try {
        dec = await start(decoderOf(ARMS[arm]), 1, noDigests ? null : set.digests);
        const before = (await dec.send(bytes[0], 0, true)).m;
        for (let i = 0; i < bytes.length; i++) {
          const { m, f } = await dec.send(bytes[i], i, true);
          if (!f) throw new Error(`frame ${i}: ${m.kind} ${m.reason ?? ""}`);
          row.ms.push(f.stamps.decodeEnd - f.stamps.decodeStart);
          tally(row.paths, f.path);
          if (f.exact !== false && (await sha256(f.pixels, flip)) === set.frames[i].truth) row.exact++;
          row.units = m.units - before.units;
          row.flushes = m.flushes - before.flushes;
        }
      } catch (e) {
        row.error = String(e?.message ?? e);
      }
      dec?.close();
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Each send's outcome: `refused` (by name), `off-digest` (the worker's check failed it), `exact` (its truth's
 * samples) or `wrong` (shown as checked, or unchecked, with other samples: an escape), or `stalled`.
 */
async function outcome({ m, f }, truth, flip) {
  if (!f) return { outcome: m.kind === "stalled" ? "stalled" : "refused", reason: m.reason, units: m.units };
  const base = { ms: f.stamps.decodeEnd - f.stamps.decodeStart, path: f.path, units: m.units, reason: f.reason };
  if (f.exact === false) return { ...base, outcome: "off-digest" };
  return { ...base, outcome: (await sha256(f.pixels, flip)) === truth ? "exact" : "wrong" };
}

/** rows: { set, case, g, arm, control, sends: [{ index, outcome, path, ms, units, reason }] }, a fresh worker a case. */
async function mutate({ frames: dir, round, sets, flip, noDigests }) {
  const manifest = (await (await fetch(`/${dir}/manifest.json`)).json()).filter((s) => s.cases && (!sets || sets.includes(s.name)));
  const rows = [];
  for (const set of order(manifest, round)) {
    for (const c of set.cases) {
      for (const arm of order(Object.keys(ARMS), round)) {
        const row = { set: set.name, case: c.name, g: c.g, at: c.at, arm, control: c.control, sends: [] };
        let dec = null;
        try {
          dec = await start(decoderOf(ARMS[arm]), c.g, noDigests ? null : set.digests);
          for (const s of c.sends) {
            const t0 = performance.now();
            const got = await outcome(await dec.send(await fetched(dir, set.name, s.file), s.index, s.key), set.frames[s.index].truth, flip);
            row.sends.push({ index: s.index, wallMs: performance.now() - t0, ...got });
            if (got.outcome === "stalled") break;
          }
        } catch (e) {
          row.error = String(e?.message ?? e);
        }
        dec?.close();
        rows.push(row);
      }
    }
  }
  return rows;
}

const caps = async () => ({
  ua: navigator.userAgent, isolated: crossOriginIsolated, videoDecoder: typeof VideoDecoder === "function",
  cores: navigator.hardwareConcurrency,
});

(async () => {
  const task = await (await post("/kp/hello", await caps())).json();
  try {
    await post("/kp/done", { rows: await (task.mode === "mutate" ? mutate : time)(task) });
  } catch (e) {
    await post("/kp/done", { error: String(e?.stack ?? e) });
  }
})();
