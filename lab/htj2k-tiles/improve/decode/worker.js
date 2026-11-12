/**
 * One decoder worker: the delivered build for a whole codestream, the lab level binding for a prefix at its level.
 * Replies with the picture, transferred. lab/htj2k-tiles/improve/README.md §Stage 2
 */
const BUILDS = { whole: "/client/decode/wasm/built/openjph/openjph.js", level: "/lab/.openjph-build/wasm/levels.js" };
const dec = {};

async function load(url) {
  const src = await (await fetch(url)).text();
  const factory = new Function(`${src}\nreturn OpenJPHModule;`).call(globalThis);
  const wasmBinary = await (await fetch(url.replace(/js$/, "wasm"))).arrayBuffer();
  const M = await factory({ wasmBinary });
  return new M.HTJ2KDecoder();
}

function decode(bytes, level) {
  const d = level ? dec.level : dec.whole;
  d.getEncodedBuffer(bytes.length).set(bytes);
  d.readHeader();
  if (level) d.decodeLevel(level, level);
  else d.decode();
  return d.getDecodedBuffer().slice();
}

onmessage = async ({ data }) => {
  try {
    if (data.load) {
      dec.whole = await load(BUILDS.whole);
      dec.level = await load(data.levelBuild ?? BUILDS.level);
      postMessage({ ready: true });
      return;
    }
    const px = decode(new Uint8Array(data.bytes), data.level);
    postMessage({ id: data.id, px: px.buffer }, [px.buffer]);
  } catch (err) {
    postMessage({ id: data.id, error: String(err?.stack ?? err) });
  }
};
