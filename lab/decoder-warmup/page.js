// LF: what the first frames of a fill cost with no warm-up, with one of the wrong shape, and with
// one of the series' own. One fresh page and one fresh session per arm; the fill rides `start`,
// so the decoders warm inside the window before the first bytes. docs/decode/README.md §Warming
// ?set=cine512&frames=12&warmup=<url>
import { DownloaderClient } from "/client/downloader/consumer.js";

const q = new URLSearchParams(location.search);
const FRAMES = Number(q.get("frames") || 12);
const WARMUP = q.get("warmup") || "";
const DECODER = {
  glue: "/lab/decode-bench/vendor/openjph/openjphjs.js",
  wasm: "/lab/decode-bench/vendor/openjph/openjphjs.wasm",
  dir: "/lab/decode-bench/vendor/openjph",
};

const log = (s) => { document.getElementById("log").textContent += s + "\n"; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function main() {
  const result = { set: q.get("set"), warmup: WARMUP, frames: FRAMES };
  const rows = [];
  const pixels = new Map();
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const t0 = performance.now();
  const t0abs = performance.timeOrigin + t0;
  const c = await DownloaderClient.connect(q.get("wt"), q.get("hash"), {
    decode: true,
    decoders: 3,
    perDecoder: 2,
    decoder: DECODER,
    warmup: WARMUP || undefined,
    fill: Array.from({ length: FRAMES }, (_, i) => i),
    onFrame: (f) => {
      const s = f.info.stamps;
      rows.push({
        index: f.frameIndex,
        decode_ms: +(s.decodeEnd - s.decodeStart).toFixed(2),
        at_ms: +(performance.now() - t0).toFixed(1),
        // When its bytes landed, and how long they then waited for a decoder: a warm-up that
        // does not fit the idle window shows up here and nowhere else.
        bytes_ms: +(s.lastByte - t0abs).toFixed(1),
        wait_ms: +(s.dispatched - s.lastByte).toFixed(1),
      });
      // A SharedArrayBuffer view is refused by subtle.digest, and hashing in the timed path
      // would price the hash: copy now, hash once the fill is done.
      pixels.set(f.frameIndex, f.bytes.slice());
      if (rows.length === FRAMES) resolveDone();
    },
    onError: (e) => { result.error = `frame ${e.frameIndex}: ${e.reason}`; resolveDone(); },
  });

  await Promise.race([done, sleep(60000)]);
  rows.sort((a, b) => a.index - b.index);
  result.delivered = rows.length;
  result.decode_ms = rows.map((r) => r.decode_ms);
  result.first_ms = rows.find((r) => r.index === 0)?.at_ms ?? null;
  result.b0 = rows.find((r) => r.index === 0)?.bytes_ms ?? null;
  result.w0 = rows.find((r) => r.index === 0)?.wait_ms ?? null;
  result.fill_ms = rows.reduce((m, r) => Math.max(m, r.at_ms), 0);
  const digests = [];
  for (let i = 0; i < FRAMES; i++) {
    const p = pixels.get(i);
    digests.push(p ? hex(await crypto.subtle.digest("SHA-256", p)).slice(0, 16) : "missing");
  }
  result.digest = digests.join(",");
  c.close();
  log(JSON.stringify(result));
  globalThis.__wtpacsResult = result;
  globalThis.__wtpacsDone = true;
}

main().catch((e) => {
  log("FAILED: " + (e?.stack || e?.message || e));
  globalThis.__wtpacsResult = { error: String(e?.message ?? e) };
  globalThis.__wtpacsDone = true;
});
