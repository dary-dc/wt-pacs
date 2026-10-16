/**
 * One surface, three implementations behind it: TypeScript and WASM over WebTransport, TypeScript
 * over a WebSocket. Each is handed to the clauses as it is; what differs is only how it is loaded.
 * Another implementation writes one of these and inherits every test.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ConformantSession, ConnectOptions } from "./clauses.ts";

export type { ConformantFrame, ConformantSession } from "./clauses.ts";

export type Implementation = {
  name: string;
  /** Dials a WebSocket, not WebTransport: one ordered stream, driven by fake-websocket.ts. */
  overWebSocket?: true;
  connect(url: string, certHash: string, options?: ConnectOptions): Promise<ConformantSession>;
};

/** Resolved from the tree, not from import.meta.url, which moves when this file is bundled. */
function repoRoot(): string {
  let at = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(at, "Cargo.lock"))) return at;
    at = path.dirname(at);
  }
  return process.cwd();
}

const root = repoRoot();

async function load(rel: string) {
  return import(pathToFileURL(path.join(root, rel)).href);
}

export async function typescriptImpl(): Promise<Implementation> {
  return sessionImpl("transport-ts", "client/transport/ts/dist/session.js");
}

export async function websocketImpl(): Promise<Implementation> {
  return { ...(await sessionImpl("transport-ws", "client/transport/ts/dist/ws-session.js")), overWebSocket: true };
}

/** Either carrier, whichever dials first: the race's winner is one of the two above. */
export async function raceImpl(): Promise<Implementation> {
  return sessionImpl("transport-race", "client/transport/ts/dist/race-session.js");
}

async function sessionImpl(name: string, bundle: string): Promise<Implementation> {
  const { TransportSession } = await load(bundle);
  return { name, connect: (url, certHash, options) => TransportSession.connect(url, certHash, options) };
}

/** The product's build, or another of the same client: `WTPACS_WASM_PKG` runs the suite on a
 *  feature build without displacing `pkg/`. */
export const WASM_PKG = process.env.WTPACS_WASM_PKG || path.join(root, "client/transport/wasm/pkg");

export function wasmBuilt(): boolean {
  return fs.existsSync(path.join(WASM_PKG, "transport_wasm_bg.wasm"));
}

export async function wasmImpl(): Promise<Implementation> {
  const mod = await import(pathToFileURL(path.join(WASM_PKG, "transport_wasm.js")).href);
  await mod.default({
    module_or_path: fs.readFileSync(path.join(WASM_PKG, "transport_wasm_bg.wasm")),
  });
  return {
    name: "transport-wasm",
    connect: (url, certHash, options) => mod.TransportSessionHandle.connect(url, certHash, options),
  };
}
