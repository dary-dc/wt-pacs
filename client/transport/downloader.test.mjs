// node client/transport/downloader.test.mjs — decoders a start makes, a timed-out ask; no browser.
globalThis.onmessage ??= null;
globalThis.addEventListener ??= () => {};
const posted = [];
globalThis.postMessage = (m) => posted.push(m);
let made = 0;
globalThis.Worker = class {
  constructor() {
    made++;
  }
  postMessage() {}
};

/** A fresh downloader on a host reporting `cores`, started with no `decoders`: the workers it makes. */
async function decodersOn(cores) {
  Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: cores }, configurable: true });
  made = 0;
  await import(`./downloader.js?cores=${cores}`);
  onmessage({ data: { kind: "start", config: {} } });
  return made;
}

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};

// Two cores get two decoders: a third is no faster there and starves the page's main thread.
const two = await decodersOn(2);
check(two === 2, `2 cores: ${two} decoders, not 2`);
// Eight cores get three: the count is capped, not the core count.
const eight = await decodersOn(8);
check(eight === 3, `8 cores: ${eight} decoders, not 3`);
// A host that does not report its cores gets three.
const unknown = await decodersOn(undefined);
check(unknown === 3, `unreported cores: ${unknown} decoders, not 3`);

/** A transport's frame timeout is silence, as the stall's is: past a doubled wait, the ask is resumed, not failed. */
async function aTimedOutAskIsResumed() {
  let dials = 0;
  globalThis.fakeTransport = {
    connect: async () => {
      const dial = ++dials;
      return {
        requestExactFrame: (i) => dial === 1
          ? Promise.reject(Object.assign(new Error(`timeout waiting for frame ${i}: no byte for 15000 ms`), { name: "FrameTimeoutError" }))
          : Promise.resolve({ frameIndex: i, bytes: new Uint8Array(4), timing: {} }),
        stats: () => ({ closed: null, lastByteAt: performance.now() }),
        fillFrames() {},
        endStream: async () => {},
        close() {},
      };
    },
  };
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport;`;
  posted.length = 0;
  await import("./downloader.js?timeout");
  await onmessage({ data: { kind: "start", config: { decode: false, decoders: 0, transport, survival: { stallMs: 60_000, redialMs: 1 } } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
  await onmessage({ data: { kind: "ask", index: 0 } });
  for (let n = 0; n < 50 && !posted.some((m) => m.kind === "frame"); n++) await new Promise((r) => setTimeout(r, 10));
  check(!posted.some((m) => m.kind === "failed"), `a timed-out ask is not failed (${posted.find((m) => m.kind === "failed")?.reason})`);
  check(dials === 2 && posted.some((m) => m.kind === "frame" && m.index === 0), `it is asked again on a new session (${dials} dials)`);
}
await aTimedOutAskIsResumed();

console.log(failed ? `${failed} failed` : "downloader decoder count, timed-out ask: ok");
process.exit(failed ? 1 : 0);
