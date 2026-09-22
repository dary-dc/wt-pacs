/**
 * The module `config.transport` points at during a conformance run: evaluated inside the
 * downloader's worker, it installs the fake WebTransport there, then answers the page's
 * commands over the BroadcastChannel named by its own `?ch=` — the control path into a
 * worker the page cannot otherwise reach. Exports the real TransportSession over the fake.
 */
import { FakeTransport, installFakeTransport } from "./fake-transport.ts";

export { TransportSession } from "../transport-ts/session.ts";

installFakeTransport();

type Command = { id: number; cmd: string; args: unknown[] };

function run(cmd: string, args: unknown[]): unknown {
  const t = FakeTransport.last as FakeTransport | undefined;
  if (cmd === "dials") return FakeTransport.dials;
  if (!t) throw new Error(`${cmd}: nothing has dialled yet`);
  if (cmd === "pushFrame") return void t.pushFrame(args[0] as number, args[1] as Uint8Array);
  if (cmd === "pushOnOneStream") return void t.pushOnOneStream(args[0] as [number, Uint8Array][]);
  if (cmd === "pushRefusal") return void t.pushRefusal(args[0] as number, args[1] as string);
  if (cmd === "serverClose")
    return void t.serverClose(args[0] as number, args[1] as string, args[2] as boolean | undefined);
  if (cmd === "controlMessages") return t.controlMessages();
  if (cmd === "dialUrl") return t.url;
  if (cmd === "didClose") return t.didClose;
  throw new Error(`unknown command ${cmd}`);
}

const name = new URL(import.meta.url).searchParams.get("ch") ?? "wtpacs-conformance";
const bc = new BroadcastChannel(name);
bc.onmessage = (e: MessageEvent<Command>) => {
  const { id, cmd, args } = e.data;
  try {
    bc.postMessage({ id, ok: true, result: run(cmd, args) });
  } catch (err) {
    bc.postMessage({ id, ok: false, result: String((err as Error)?.message ?? err) });
  }
};
