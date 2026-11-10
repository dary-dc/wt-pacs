// Loads today's downloader in node over a hand-fed fake transport, as client/transport/downloader.test.mjs does.
globalThis.onmessage ??= null;
globalThis.addEventListener ??= () => {};
export const posted = [];
globalThis.postMessage = (m) => posted.push(m);
export const settle = () => new Promise((r) => setTimeout(r, 0));
export const frame = (i) => ({ frameIndex: i, bytes: new Uint8Array(4), timing: {} });

export function handFed() {
  const fed = { fills: [], asks: [], onFrame: null };
  globalThis.fakeTransport = {
    connect: async (_u, _c, options) => {
      if (options.fill) fed.fills.push([options.fill.from, options.fill.to, "dial"]);
      return {
        requestExactFrame: (i) => (fed.asks.push(i), new Promise(() => {})),
        stats: () => ({ closed: null, lastByteAt: performance.now() }),
        fillFrames: (from, to, onFrame) => (fed.fills.push([from, to]), (fed.onFrame = onFrame)),
        endStream: async () => {},
        releaseWireBuffer() {},
        close() {},
      };
    },
  };
  return fed;
}

export async function load(tag, config) {
  await import(`../../client/transport/downloader.js?${tag}`);
  const transport = `data:text/javascript,export const TransportSession = globalThis.fakeTransport; // ${tag}`;
  await onmessage({ data: { kind: "start", config: { transport, survival: false, ...config } } });
  await onmessage({ data: { kind: "dial", url: "https://x.invalid/", certHash: "ab" } });
}
