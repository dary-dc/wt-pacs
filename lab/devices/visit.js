// D2's visit on one arm: a fill with an ask for its last frame once half has landed (row 180's shape), then a fresh
// session asking one frame (row 181's). Decoding is off; every frame is compared with the bundle's bytes, which the
// runner proved decode to the encoder's input. docs/devices.md §2 D2
import { DownloaderClient } from "/client/transport/consumer.js";

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const within = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: nothing in ${ms / 1000} s`)), ms))]);

function fillAndAsk(arm, frames) {
  const n = frames.length;
  const ask = n - 1;
  const landed = new Map();
  let bad = 0;
  return new Promise((resolve, reject) => {
    let client = null;
    let issuedAt = 0;
    let askAt = 0;
    let askMs = null;
    const keep = (i, bytes) => {
      if (!landed.has(i)) landed.set(i, performance.now());
      if (!same(new Uint8Array(bytes), frames[i])) bad++;
    };
    const maybeDone = () => {
      if (landed.size < n || askMs === null) return;
      client.close();
      resolve({ fillMs: Math.max(...landed.values()) - issuedAt, askMs, wrong: bad });
    };
    DownloaderClient.connect(arm.wt_url, arm.cert_sha256, {
      decode: false,
      decoders: 0,
      onFrame: (f) => {
        keep(f.frameIndex, f.bytes);
        if (!askAt && landed.size >= n / 2) {
          askAt = performance.now();
          client.requestExactFrame(ask).then((g) => {
            askMs = performance.now() - askAt;
            keep(ask, g.bytes);
            maybeDone();
          }, reject);
        }
        maybeDone();
      },
      onError: (e) => reject(new Error(`frame ${e.frameIndex}: ${e.reason}`)),
    }).then((c) => {
      client = c;
      issuedAt = performance.now();
      client.fill([...Array(n).keys()]);
    }, reject);
  });
}

async function freshAsk(arm, frames) {
  const i = frames.length >> 1;
  const t0 = performance.now();
  const client = await DownloaderClient.connect(arm.wt_url, arm.cert_sha256, { decode: false, decoders: 0, onFrame: () => {}, onError: () => {} });
  const dialMs = performance.now() - t0;
  const g = await client.requestExactFrame(i);
  const freshMs = performance.now() - t0;
  client.close();
  return { dialMs, freshMs, freshWrong: same(new Uint8Array(g.bytes), frames[i]) ? 0 : 1 };
}

/** One visit's row; `exact` false when any frame differs from the bundle or the visit failed. */
export async function visit(arm, frames, deadlineMs = 120000) {
  try {
    const a = await within(fillAndAsk(arm, frames), deadlineMs, "fill");
    const b = await within(freshAsk(arm, frames), deadlineMs, "fresh ask");
    return { ...a, ...b, exact: a.wrong + b.freshWrong === 0 };
  } catch (e) {
    return { exact: false, error: String(e?.message ?? e) };
  }
}
