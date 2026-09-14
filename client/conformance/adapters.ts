/**
 * One surface, two implementations behind it. The names mostly agree; what does not is
 * `endStream`, which is a promise on one and synchronous on the other, and the shape of
 * `startStreamFrames`. A third implementation writes one of these and inherits every test.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ConformantFrame = {
  frameIndex: number;
  bytes: Uint8Array;
  timing: { askMs: number; firstChunkMs: number; lastChunkMs: number; chunks: number };
};

export type ConformantSession = {
  requestExactFrame(frameIndex: number): Promise<ConformantFrame>;
  startStreamFrames(waitLast: number, range?: { from?: number; to?: number }): number;
  endStream(): Promise<void>;
  stats(): { inFlight: number };
  close(): void;
};

export type Implementation = {
  name: string;
  connect(url: string, certHash: string): Promise<ConformantSession>;
};

const here = path.dirname(new URL(import.meta.url).pathname);

async function load(rel: string) {
  return import(pathToFileURL(path.join(here, rel)).href);
}

export async function typescriptImpl(): Promise<Implementation> {
  const { TransportSession } = await load("../transport-ts/dist/session.js");
  return {
    name: "transport-ts",
    async connect(url, certHash) {
      const s = await TransportSession.connect(url, certHash);
      return {
        requestExactFrame: (i: number) => s.requestExactFrame(i),
        startStreamFrames: (last: number, range?: { from?: number; to?: number }) =>
          s.startStreamFrames(last, range),
        endStream: () => s.endStream(),
        stats: () => s.stats(),
        close: () => s.close(),
      };
    },
  };
}

export const WASM_PKG = path.join(here, "../transport-wasm/pkg");

export function wasmBuilt(): boolean {
  return fs.existsSync(path.join(WASM_PKG, "transport_wasm_bg.wasm"));
}

export async function wasmImpl(): Promise<Implementation> {
  const mod = await load("../transport-wasm/pkg/transport_wasm.js");
  await mod.default({
    module_or_path: fs.readFileSync(path.join(WASM_PKG, "transport_wasm_bg.wasm")),
  });
  return {
    name: "transport-wasm",
    async connect(url, certHash) {
      const s = await mod.TransportSessionHandle.connect(url, certHash);
      return {
        requestExactFrame: (i: number) => s.requestExactFrame(i),
        startStreamFrames: (last: number, range?: { from?: number; to?: number }) =>
          s.startStreamFrames(last, range?.from ?? undefined, range?.to ?? undefined),
        endStream: async () => s.endStream(),
        stats: () => s.stats(),
        close: () => s.close(),
      };
    },
  };
}
