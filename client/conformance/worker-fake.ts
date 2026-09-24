/**
 * The page's end of the control path into a worker's fake: fake-session.ts (transport) and
 * fake-decoder.js (decoder) both listen on a BroadcastChannel named in their `?ch=`. This
 * sends a command and awaits its reply, so a test on the page drives a fake it cannot reach.
 */
export type WorkerFake = {
  pushFrame(index: number, codestream: Uint8Array): Promise<void>;
  pushOnOneStream(frames: [number, Uint8Array][]): Promise<void>;
  trickleFrame(index: number, codestream: Uint8Array, chunks: number, everyMs: number): Promise<void>;
  pushRefusal(index: number, reason: string): Promise<void>;
  pushTruncatedFrame(index: number, codestream: Uint8Array, sent: number): Promise<void>;
  serverClose(closeCode?: number, reason?: string, endStreams?: boolean): Promise<void>;
  controlMessages(): Promise<{ op: string }[]>;
  dialUrl(): Promise<string>;
  didClose(): Promise<boolean>;
  dials(): Promise<number>;
  /** Whether every transport before the latest was closed by the client. */
  replacedClosed(): Promise<boolean>;
  failDials(n: number): Promise<void>;
  /** Resolves once the downloader's worker has started a busy loop of `ms` that answers nothing. */
  block(ms: number): Promise<void>;
  /** The fakes still running in this world's workers, by kind: a terminated worker cannot answer. */
  alive(): Promise<{ downloader: number; decoder: number }>;
};

export function workerFake(name: string): WorkerFake {
  const bc = new BroadcastChannel(name);
  let nextId = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let heard!: () => void;
  const listening = new Promise<void>((r) => (heard = r));
  bc.onmessage = (e) => {
    if (e.data.listening) return void heard();
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.resolve(e.data.result);
    else w.reject(new Error(e.data.result));
  };
  const call = (cmd: string, ...args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      // Posted before the worker's channel is registered, a command is dropped. docs/proposal-conformance-suite.md
      void listening.then(() => waiting.has(id) && bc.postMessage({ id, cmd, args }));
      setTimeout(() => {
        if (waiting.delete(id)) reject(new Error(`no reply to ${cmd} in 2 s — is the fake installed in the worker?`));
      }, 2000);
    });
  return {
    pushFrame: (i, c) => call("pushFrame", i, c) as Promise<void>,
    pushOnOneStream: (frames) => call("pushOnOneStream", frames) as Promise<void>,
    trickleFrame: (i, c, n, ms) => call("trickleFrame", i, c, n, ms) as Promise<void>,
    pushRefusal: (i, reason) => call("pushRefusal", i, reason) as Promise<void>,
    pushTruncatedFrame: (i, c, sent) => call("pushTruncatedFrame", i, c, sent) as Promise<void>,
    serverClose: (code, reason, endStreams) => call("serverClose", code, reason, endStreams) as Promise<void>,
    controlMessages: () => call("controlMessages") as Promise<{ op: string }[]>,
    dialUrl: () => call("dialUrl") as Promise<string>,
    didClose: () => call("didClose") as Promise<boolean>,
    dials: () => call("dials") as Promise<number>,
    replacedClosed: () => call("replacedClosed") as Promise<boolean>,
    failDials: (n) => call("failDials", n) as Promise<void>,
    block: (ms) => call("block", ms) as Promise<void>,
    alive: () => alive(name),
  };
}

let pings = 0;
async function alive(name: string) {
  const bc = new BroadcastChannel(`${name}-alive`);
  const ping = ++pings;
  const count = { downloader: 0, decoder: 0 };
  bc.onmessage = (e) => {
    if (e.data.pong === ping) count[e.data.who as keyof typeof count] += 1;
  };
  bc.postMessage({ ping });
  await new Promise((r) => setTimeout(r, 250));
  bc.close();
  return count;
}
