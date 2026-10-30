// node client/transport/consumer.test.mjs — what `connect` refuses before it starts a worker; acks and unreadable deliveries; a delivered frame not failed; a worker that does not load.
import { DownloaderClient } from "./consumer.js";

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const refusal = (opts) => DownloaderClient.connect("https://x.invalid/", "ab", opts).then(() => "started", (e) => e.message);

globalThis.crossOriginIsolated = true;
// A group length must be a whole number of at least one frame.
for (const g of [0, 2.5, -1]) check(/groupLength/.test(await refusal({ groupLength: g })), `groupLength ${g} is refused`);
// Above one, the series' frame count is needed to cut its last group.
check(/frameCount/.test(await refusal({ groupLength: 4 })), "groupLength 4 without frameCount is refused");

// Pixels go through a SharedArrayBuffer, so a page that is not cross-origin isolated is refused.
globalThis.crossOriginIsolated = false;
check(/cross-origin isolated/.test(await refusal({})), "a page not cross-origin isolated is refused");
// Undecoded bytes need no shared memory: that start gets as far as making its worker.
globalThis.Worker = class {
  constructor() {
    throw new Error("worker made");
  }
};
check(/worker made/.test(await refusal({ decode: false })), "decode: false is not refused for isolation");

/** The page acknowledges every exact frame it is handed, never a preview, and reports an unreadable delivery with its decoder's id. */
async function acksAndUnreadable() {
  const sent = [];
  let worker;
  globalThis.Worker = class {
    constructor() {
      worker = this;
    }
    postMessage(m) {
      sent.push(m);
      if (m.kind === "dial") queueMicrotask(() => this.onmessage({ data: { kind: "started" } }));
    }
    terminate() {}
  };
  globalThis.crossOriginIsolated = true;
  const client = await DownloaderClient.connect("https://x.invalid/", "ab", {});
  const port = {};
  worker.onmessage({ data: { kind: "pixel-port", port, decoder: 4 } });
  port.onmessage({ data: { index: 7, gen: 0, pixels: new Uint8Array(1), preview: true } });
  port.onmessage({ data: { index: 7, gen: 0, pixels: new Uint8Array(1) } });
  port.onmessageerror?.(new Event("messageerror"));
  const acks = sent.filter((m) => m.kind === "ack");
  check(acks.length === 1 && acks[0].index === 7 && acks[0].gen === 0, `one ack, for the exact frame (${JSON.stringify(acks)})`);
  check(sent.some((m) => m.kind === "undelivered" && m.decoder === 4), "an unreadable delivery is reported with its decoder");
  client.close();
}
await acksAndUnreadable();

/** A failure of a frame the page already has is dropped; once that frame is filled again, its failure is the page's. */
async function aDeliveredFrameIsNotFailed() {
  let worker;
  globalThis.Worker = class {
    constructor() {
      worker = this;
    }
    postMessage(m) {
      if (m.kind === "dial") queueMicrotask(() => this.onmessage({ data: { kind: "started" } }));
    }
    terminate() {}
  };
  globalThis.crossOriginIsolated = true;
  const failures = [];
  const client = await DownloaderClient.connect("https://x.invalid/", "ab", { onError: (f) => failures.push(f.frameIndex) });
  const port = {};
  worker.onmessage({ data: { kind: "pixel-port", port, decoder: 0 } });
  port.onmessage({ data: { index: 3, gen: 0, pixels: new Uint8Array(1) } });
  worker.onmessage({ data: { kind: "failed", index: 3, gen: 0, reason: "decoder 0 crashed (lost 2 times)" } });
  check(failures.length === 0, `a delivered frame's late failure is dropped (failed ${failures})`);
  client.fill([3]);
  worker.onmessage({ data: { kind: "failed", index: 3, gen: 0, reason: "refused" } });
  check(failures.join() === "3", `filled again, its failure reaches onError (failed ${failures})`);
  client.close();
}
await aDeliveredFrameIsNotFailed();

/** A frame's bytes are a Uint8Array over its pixels, whether they came shared or transferred. */
async function bytesOverEitherBuffer() {
  let worker;
  globalThis.Worker = class {
    constructor() {
      worker = this;
    }
    postMessage(m) {
      if (m.kind === "dial") queueMicrotask(() => this.onmessage({ data: { kind: "started" } }));
    }
    terminate() {}
  };
  const got = [];
  const client = await DownloaderClient.connect("https://x.invalid/", "ab", { onFrame: (f) => got.push(f.bytes) });
  const port = {};
  worker.onmessage({ data: { kind: "pixel-port", port, decoder: 0 } });
  const buffers = [new SharedArrayBuffer(2), new ArrayBuffer(2)];
  buffers.forEach((pixels, index) => port.onmessage({ data: { index, gen: 0, pixels } }));
  check(got.length === 2 && got.every((b, k) => b instanceof Uint8Array && b.buffer === buffers[k]), `bytes over each buffer (${got.map((b) => b?.constructor.name)})`);
  client.close();
}
await bytesOverEitherBuffer();

/** A downloader whose script does not load ends `connect` with the reason, where it used to wait for ever. */
async function scriptThatDoesNotLoad() {
  globalThis.Worker = class {
    constructor() {
      setTimeout(() => this.onerror?.(new Event("error")));
    }
    postMessage() {}
    terminate() {}
  };
  globalThis.crossOriginIsolated = true;
  const waiting = new Promise((r) => setTimeout(() => r("still waiting after 1 s"), 1000));
  const got = await Promise.race([refusal({}), waiting]);
  check(/did not start: its script did not load/.test(got), `a worker that does not load ends connect (${got})`);
}
await scriptThatDoesNotLoad();

console.log(failed ? `${failed} failed` : "consumer refusals, acks, unreadable deliveries, a delivered frame not failed, bytes over either buffer, a worker that does not load: ok");
process.exit(failed ? 1 : 0);
