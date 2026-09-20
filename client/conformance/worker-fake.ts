/**
 * The page's end of the control path into a worker's fake: fake-session.ts (transport) and
 * fake-decoder.js (decoder) both listen on a BroadcastChannel named in their `?ch=`. This
 * sends a command and awaits its reply, so a test on the page drives a fake it cannot reach.
 */
export type WorkerFake = {
  pushFrame(index: number, codestream: Uint8Array): Promise<void>;
  pushOnOneStream(frames: [number, Uint8Array][]): Promise<void>;
  pushRefusal(index: number, reason: string): Promise<void>;
  serverClose(closeCode?: number, reason?: string, endStreams?: boolean): Promise<void>;
  controlMessages(): Promise<{ op: string }[]>;
  didClose(): Promise<boolean>;
  dials(): Promise<number>;
};

export function workerFake(name: string): WorkerFake {
  const bc = new BroadcastChannel(name);
  let nextId = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  bc.onmessage = (e) => {
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
      bc.postMessage({ id, cmd, args });
      setTimeout(() => {
        if (waiting.delete(id)) reject(new Error(`no reply to ${cmd} in 2 s — is the fake installed in the worker?`));
      }, 2000);
    });
  return {
    pushFrame: (i, c) => call("pushFrame", i, c) as Promise<void>,
    pushOnOneStream: (frames) => call("pushOnOneStream", frames) as Promise<void>,
    pushRefusal: (i, reason) => call("pushRefusal", i, reason) as Promise<void>,
    serverClose: (code, reason, endStreams) => call("serverClose", code, reason, endStreams) as Promise<void>,
    controlMessages: () => call("controlMessages") as Promise<{ op: string }[]>,
    didClose: () => call("didClose") as Promise<boolean>,
    dials: () => call("dials") as Promise<number>,
  };
}
