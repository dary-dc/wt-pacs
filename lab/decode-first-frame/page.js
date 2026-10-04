// D6: what a decoder's first frame pays that its steady state does not. One fresh instance per
// visit, then K decodes of the same fixture, each timed on its own.
// ?set=decode_g512&k=8[&warmup=1][&instantiate=streaming|buffer]
const params = new URLSearchParams(location.search);
const set = params.get("set") || "decode_g512";
const K = Number(params.get("k") || 8);
const warmup = params.get("warmup") === "1";
const instantiate = params.get("instantiate") || "streaming";

const log = (m) => {
  document.getElementById("log").textContent += m + "\n";
};

/** A 16x16 grey frame, encoded by the same profile — small enough to be a warm-up and nothing else. */
async function warmupCodestream() {
  const r = await fetch("/lab/fixtures/decode_g160/000.j2c");
  return new Uint8Array(await r.arrayBuffer());
}

async function main() {
  const meta = await (await fetch(`/lab/fixtures/${set}/metadata.json`)).json();
  // Only the codestreams actually on disk: metadata records what a full generation makes, and a
  // 404 body would decode as garbage in a fraction of the time and look like a fast steady state.
  const pool = [];
  for (let i = 0; i < meta.frameCount; i++) {
    const r = await fetch(`/lab/fixtures/${set}/${String(i).padStart(3, "0")}.j2c`);
    if (!r.ok) break;
    pool.push(new Uint8Array(await r.arrayBuffer()));
  }
  if (!pool.length) throw new Error(`no codestreams in ${set}`);
  const frames = Array.from({ length: K }, (_, i) => pool[i % pool.length]);

  const tLoad = performance.now();
  // A classic emscripten script, not a module: it defines a global factory when it runs, which
  // is also why the engine's code cache has nothing to attach to (S13).
  await new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "/lab/decode-bench/vendor/openjph/openjphjs.js";
    el.onload = resolve;
    el.onerror = () => reject(new Error("decoder glue did not load"));
    document.head.append(el);
  });
  // D8: the product's path hands the glue a binary, which forbids a streamed compile; given none
  // the glue streams its own fetch. Only the streamed one is code-cached.
  const opts = { locateFile: (f) => "/lab/decode-bench/vendor/openjph/" + f };
  if (instantiate === "buffer") {
    opts.wasmBinary = await (
      await fetch("/lab/decode-bench/vendor/openjph/openjphjs.wasm")
    ).arrayBuffer();
  }
  const module = await globalThis.Module(opts);
  const loadMs = performance.now() - tLoad;

  if (warmup) {
    const w = await warmupCodestream();
    const d = new module.HTJ2KDecoder();
    d.getEncodedBuffer(w.length).set(w);
    d.readHeader();
    d.decode();
    d.delete();
  }

  const per = [];
  for (const bytes of frames) {
    const t = performance.now();
    const d = new module.HTJ2KDecoder();
    d.getEncodedBuffer(bytes.length).set(bytes);
    d.readHeader();
    d.decode();
    const n = d.getDecodedBuffer().length;
    d.delete();
    per.push({ ms: +(performance.now() - t).toFixed(2), bytes: n });
  }

  // A second, untimed pass: hashing inside the timed one would price the hash, not the decode.
  const digests = [];
  if (params.get("digest") === "1") {
    for (const bytes of frames) {
      const d = new module.HTJ2KDecoder();
      d.getEncodedBuffer(bytes.length).set(bytes);
      d.readHeader();
      d.decode();
      const h = await crypto.subtle.digest("SHA-256", d.getDecodedBuffer().slice());
      d.delete();
      digests.push([...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""));
    }
  }

  globalThis.__d6 = { set, instantiate, loadMs: +loadMs.toFixed(1), warmup, per, digests };
  log(JSON.stringify(globalThis.__d6));
  globalThis.__wtpacsDone = true;
}

main().catch((e) => {
  log("error " + e);
  globalThis.__wtpacsDone = true;
});
