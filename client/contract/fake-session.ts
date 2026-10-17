/**
 * The module `config.transport` points at during a contract run: evaluated inside the
 * downloader's worker, it installs the fake WebTransport there, then answers the page's
 * commands over the BroadcastChannel named by its own `?ch=` — the control path into a
 * worker the page cannot otherwise reach. Exports the real TransportSession over the fake: the
 * TypeScript client's, or the WASM client's under `?client=wasm`.
 */
import { TransportSession as OverTs } from "../transport/ts/session.ts";
import { FakeTransport, installFakeTransport, pinnedHash } from "./fake-transport.ts";

const query = new URL(import.meta.url).searchParams;
installFakeTransport();
/** When each transport was dialled, on this worker's clock. */
const dialledAt: number[] = [];
(globalThis as Record<string, unknown>).WebTransport = class extends FakeTransport {
  constructor(url: string, options: unknown) {
    super(url, options);
    dialledAt.push(performance.now());
  }
};
// Before the first dial, which is what loads this module: `?hang=` dials never settle, `?refuse=` are refused.
FakeTransport.hangNext = Number(query.get("hang") ?? 0);
FakeTransport.failNext = Number(query.get("refuse") ?? 0);

/** The transport file as the page last set it, its first `missing` reads answered 404; every other fetch goes out. */
let transportFile: { url: string; body: unknown; missing: number } | null = null;
const fetchOut = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (!transportFile || String(input) !== transportFile.url) return fetchOut(input, init);
  if (transportFile.missing-- > 0) return new Response("", { status: 404 });
  return Response.json(transportFile.body);
};

const WASM = new URL("../../transport/wasm/session-adapter.js", import.meta.url).href;
export const TransportSession =
  query.get("client") === "wasm" ? (await import(WASM)).TransportSession : OverTs;

type Command = { id: number; cmd: string; args: unknown[] };

function run(cmd: string, args: unknown[]): unknown {
  const t = FakeTransport.last as FakeTransport | undefined;
  if (cmd === "dials") return FakeTransport.dials;
  if (cmd === "dialledAt") return dialledAt;
  if (cmd === "replacedClosed") return FakeTransport.all.slice(0, -1).every((t) => t.didClose);
  if (cmd === "failDials") return void (FakeTransport.failNext = args[0] as number);
  if (cmd === "hangDials") return void (FakeTransport.hangNext = args[0] as number);
  if (cmd === "openAfterMs") return void (FakeTransport.openAfterMs = args[0] as number);
  if (cmd === "pin") return void (FakeTransport.pin = args[0] as string);
  if (cmd === "setTransportFile")
    return void (transportFile = { url: args[0] as string, body: args[1], missing: (args[2] as number) ?? 0 });
  if (!t) throw new Error(`${cmd}: nothing has dialled yet`);
  if (cmd === "pushFrame") return void t.pushFrame(args[0] as number, args[1] as Uint8Array);
  if (cmd === "pushOnOneStream") return void t.pushOnOneStream(args[0] as [number, Uint8Array][]);
  if (cmd === "trickleFrame")
    return void t.trickleFrame(args[0] as number, args[1] as Uint8Array, args[2] as number, args[3] as number);
  if (cmd === "pushRefusal") return void t.pushRefusal(args[0] as number, args[1] as string);
  if (cmd === "pushTruncatedFrame")
    return void t.pushTruncatedFrame(args[0] as number, args[1] as Uint8Array, args[2] as number);
  if (cmd === "serverClose")
    return void t.serverClose(args[0] as number, args[1] as string, args[2] as boolean | undefined);
  // As a browser's control stream does once its session is gone.
  if (cmd === "failWrites")
    return void (t.sent.push = () => {
      throw new Error("the session is closed");
    });
  if (cmd === "controlMessages") return t.controlMessages();
  if (cmd === "dialUrl") return t.url;
  if (cmd === "dialHash") return pinnedHash(t.options);
  if (cmd === "didClose") return t.didClose;
  throw new Error(`unknown command ${cmd}`);
}

const name = query.get("ch") ?? "wtpacs-contract";
const bc = new BroadcastChannel(name);
bc.onmessage = (e: MessageEvent<Command>) => {
  const { id, cmd, args } = e.data;
  // Answered first, so the page knows the worker is wedged before it tests what that costs.
  if (cmd === "block") {
    bc.postMessage({ id, ok: true });
    const until = performance.now() + (args[0] as number);
    while (performance.now() < until);
    return;
  }
  try {
    bc.postMessage({ id, ok: true, result: run(cmd, args) });
  } catch (err) {
    bc.postMessage({ id, ok: false, result: String((err as Error)?.message ?? err) });
  }
};
bc.postMessage({ listening: true });
const alive = new BroadcastChannel(`${name}-alive`);
alive.onmessage = (e) => e.data.ping && alive.postMessage({ pong: e.data.ping, who: "downloader" });
