// node client/transport/consumer.test.mjs — what `connect` refuses before it starts a worker; acks and unreadable deliveries.
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

console.log(failed ? `${failed} failed` : "consumer refusals, acks, unreadable deliveries: ok");
process.exit(failed ? 1 : 0);
