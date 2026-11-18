/** One visit: a cell's action through the downloader over one arm's carrier, each frame checked. lab/transport-arms/README.md */
import { DownloaderClient } from "/client/transport/consumer.js";

const OPENJPH = "/client/decode/wasm/built/openjph";
const protocols = [];
new BroadcastChannel("transport-arms").onmessage = (e) => protocols.push(e.data.protocol);

const limit = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`no end in ${ms} ms`)), ms));

/** `fill` 0 … n−1; `first` frame 0; `ad` the fill, the last frame asked at `askAfter`; `aa` all but the last, `go()`, then it. Epoch ms. */
globalThis.visit = async ({ module, url, hash, n, action, askAfter = 0, digests, limitMs }) => {
  const frames = new Map();
  const failures = [];
  let resolveAll;
  const all = new Promise((r) => (resolveAll = r));
  const filled = action === "first" ? [0] : action === "aa" ? [...Array(n - 1).keys()] : [...Array(n).keys()];
  let asked = null;
  // The page's clock, one message before the worker's: a frame the fill still owes keeps the fill's ask stamp.
  let askAt = null;
  const ask = () => {
    askAt = performance.timeOrigin + performance.now();
    asked = client.requestFrame(n - 1).then((f) => keep(f), (e) => failures.push({ i: n - 1, reason: String(e?.message ?? e) }));
  };
  const keep = (f) => {
    const s = f.info.stamps;
    frames.set(f.frameIndex, { i: f.frameIndex, lastByte: s.lastByte, ask: s.ask, exact: f.info.exact, boot: s.boot });
    if (action === "ad" && f.frameIndex === askAfter && f.info.exact === true && !asked) ask();
    if (filled.every((i) => frames.has(i))) resolveAll();
  };
  const client = await DownloaderClient.connect(url, hash, {
    transport: module,
    decoder: { glue: `${OPENJPH}/openjph.js`, wasm: `${OPENJPH}/openjph.wasm`, dir: OPENJPH },
    digests,
    onFrame: keep,
    onError: (e) => failures.push({ i: e.frameIndex, reason: e.reason }),
  });
  let error = null;
  try {
    client.fill(filled);
    await Promise.race([all, limit(limitMs)]);
    if (action === "aa") {
      await globalThis.go();
      ask();
    }
    if (asked) await Promise.race([asked, limit(limitMs)]);
  } catch (e) {
    error = String(e?.message ?? e);
  }
  client.close();
  const list = [...frames.values()];
  const boot = list.find((f) => f.boot)?.boot ?? {};
  return { error, frames: list, failures, protocols, dial: boot.dial ?? null, askAt };
};
globalThis.__ready = true;
