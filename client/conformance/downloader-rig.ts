/**
 * The downloader arm's rig: adapts DownloaderClient to the conformant surface and drives the
 * fake transport inside its worker over the BroadcastChannel fake-session.ts listens on.
 * The page passes DownloaderClient in, so its worker URLs resolve from its own module.
 */
import { type Check, type ConformantSession, type Rig, runClauses } from "./clauses.ts";
import { workerFake } from "./worker-fake.ts";

const CERT = "ab".repeat(32);

type Downloader = {
  requestExactFrame(index: number): Promise<{ frameIndex: number; bytes: Uint8Array; timing: { askMs: number; lastChunkMs: number } }>;
  fill(indices: number[]): void;
  cancel(): void;
  stats(): { inFlight: number };
  close(): void;
};

type DownloaderCtor = {
  connect(url: string, certHash: string, opts: Record<string, unknown>): Promise<Downloader>;
};

function adapt(c: Downloader): ConformantSession {
  return {
    requestExactFrame: (i) => c.requestExactFrame(i),
    startStreamFrames(waitLast, range) {
      const from = range?.from ?? 0;
      const to = range?.to ?? waitLast;
      const indices = [];
      for (let i = from; i <= to; i++) indices.push(i);
      c.fill(indices);
      return performance.now();
    },
    endStream: async () => c.cancel(),
    stats: () => c.stats(),
    close: () => c.close(),
  };
}

function downloaderRig(DownloaderClient: DownloaderCtor): Rig {
  let world = 0;
  let handle: ReturnType<typeof workerFake> | null = null;
  return {
    name: "downloader",
    fillOp: "request_frames",
    closure: "redial",
    async open() {
      const ch = `wtpacs-conformance-${++world}`;
      handle = workerFake(ch);
      const connect = DownloaderClient.connect("https://conformance.invalid/", CERT, {
        decode: false,
        decoders: 0,
        transport: `/client/conformance/dist/fake-session.js?ch=${ch}`,
      });
      const c = await Promise.race([
        connect,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("the downloader did not start in 5 s")), 5000),
        ),
      ]);
      return adapt(c);
    },
    fake: () => {
      if (!handle) throw new Error("fake() before open()");
      return handle;
    },
    dialsSinceOpen: () => {
      if (!handle) throw new Error("dialsSinceOpen() before open()");
      return handle.dials();
    },
  };
}

/** Entry for the page: run every clause against the downloader, report, and say done. */
export async function runDownloaderArm(
  DownloaderClient: DownloaderCtor,
  log: (line: string) => void,
): Promise<void> {
  const strays: string[] = [];
  addEventListener("unhandledrejection", (e) => {
    e.preventDefault();
    strays.push(String(e.reason?.message ?? e.reason));
  });
  let failed = 0;
  let ran = 0;
  const check: Check = (cond, what) => {
    ran += 1;
    if (!cond) {
      failed += 1;
      log(`  FAIL: ${what}`);
    }
  };
  log("downloader");
  try {
    await runClauses(downloaderRig(DownloaderClient), check);
  } catch (e) {
    failed += 1;
    log(`  FAIL: a clause threw: ${(e as Error)?.message ?? e}`);
  }
  if (strays.length) log(`\n  ${strays.length} abandoned waiter(s) rejected after their fill was cancelled`);
  log(`\nconformance: ${ran - failed}/${ran} checks passed on the downloader arm`);
  (globalThis as Record<string, unknown>).__wtpacsFailed = failed;
  (globalThis as Record<string, unknown>).__wtpacsDone = true;
}
