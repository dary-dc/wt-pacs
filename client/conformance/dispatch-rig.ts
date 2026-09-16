/**
 * D2c: the two behaviours the downloader implements and D2b's surface clauses cannot see —
 * an ask served before the fill frames still waiting for a decoder, and never more than
 * `perDecoder` frames outstanding on one decoder. Both need contention forced with a stalling
 * decoder (fake-decoder.js), not luck. docs/proposal-downloader.md §The downloader.
 */
import { workerFake } from "./worker-fake.ts";

const CERT = "ab".repeat(32);
const enc = new TextEncoder();

type Frame = { frameIndex: number; info: { decodeSeq?: number; maxInFlight?: number } };
type Downloader = {
  requestExactFrame(index: number): Promise<Frame>;
  fill(indices: number[]): void;
  close(): void;
};
type DownloaderCtor = {
  connect(url: string, certHash: string, opts: Record<string, unknown>): Promise<Downloader>;
};

let world = 0;

async function open(
  DownloaderClient: DownloaderCtor,
  opts: { decoders: number; perDecoder: number; delayMs: number; onFrame: (f: Frame) => void },
) {
  const ch = `wtpacs-dispatch-${++world}`;
  const fake = workerFake(ch);
  const c = await DownloaderClient.connect("https://conformance.invalid/", CERT, {
    decode: true,
    decoders: opts.decoders,
    perDecoder: opts.perDecoder,
    transport: `/client/conformance/dist/fake-session.js?ch=${ch}`,
    decoderWorker: "/client/conformance/fake-decoder.js",
    decoder: { delayMs: opts.delayMs },
    onFrame: opts.onFrame,
  });
  return { c, fake };
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/**
 * With one decoder holding `perDecoder` frames, an ask that lands mid-fill is dispatched the
 * moment a decoder frees — ahead of every fill frame still queued behind it.
 */
async function askBeatsQueuedFill(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const perDecoder = 2;
  const captured: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decoders: 1, perDecoder, delayMs: 150, onFrame: (f) => captured.push(f) });

  const fillN = [0, 1, 2, 3, 4, 5, 6, 7];
  c.fill(fillN);
  for (const i of fillN) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  // The two the decoder can hold are now stalling; 2..7 wait in the fill queue.
  await settle();

  const askIndex = 50;
  const askPromise = c.requestExactFrame(askIndex);
  await fake.pushFrame(askIndex, enc.encode("ask-50"));
  const ask = await askPromise;

  const deadline = Date.now() + 8000;
  while (captured.length < fillN.length && Date.now() < deadline) await settle(20);

  const bySeq = new Map(captured.map((f) => [f.frameIndex, f.info.decodeSeq ?? -1]));
  const askSeq = ask.info.decodeSeq ?? -1;
  const stillQueued = [2, 3, 4, 5, 6, 7];

  check(captured.length === fillN.length, `dispatch: every fill frame decoded (${captured.length}/${fillN.length})`);
  check(askSeq === perDecoder + 1, `dispatch: the ask starts ${perDecoder + 1}th, right after the ${perDecoder} in flight (was ${askSeq})`);
  check(
    stillQueued.every((i) => (bySeq.get(i) ?? Infinity) > askSeq),
    `dispatch: the ask starts before every fill frame that was still queued`,
  );

  const maxOutstanding = Math.max(...captured.map((f) => f.info.maxInFlight ?? 0), ask.info.maxInFlight ?? 0);
  check(maxOutstanding <= perDecoder, `dispatch: never more than ${perDecoder} outstanding on one decoder (peak ${maxOutstanding})`);
  c.close();
}

/**
 * An ask for a frame already queued in the fill is promoted, not re-asked: it moves to the ask
 * queue and is dispatched ahead of the fill frames behind it. This is `promote()`, which L16
 * flagged and D2 left unasserted.
 */
async function promoteBeatsQueuedFill(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const perDecoder = 2;
  const captured: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decoders: 1, perDecoder, delayMs: 150, onFrame: (f) => captured.push(f) });

  const fillN = [0, 1, 2, 3, 4, 5, 6, 7];
  c.fill(fillN);
  for (const i of fillN) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await settle();

  // Frame 7 is already queued as fill; asking for it must promote it, not ask the wire twice.
  const promoted = await c.requestExactFrame(7);
  const before = await fake.controlMessages();

  const deadline = Date.now() + 8000;
  while (captured.length < fillN.length - 1 && Date.now() < deadline) await settle(20);

  const bySeq = new Map(captured.map((f) => [f.frameIndex, f.info.decodeSeq ?? -1]));
  const promotedSeq = promoted.info.decodeSeq ?? -1;
  const behind = [2, 3, 4, 5, 6];

  check(promotedSeq === perDecoder + 1, `dispatch: a promoted frame starts ${perDecoder + 1}th (was ${promotedSeq})`);
  check(behind.every((i) => (bySeq.get(i) ?? Infinity) > promotedSeq), `dispatch: it starts before the fill frames behind it`);
  const asks = before.filter((m) => m.op === "request_frame").length;
  check(asks === 0, `dispatch: promoting asks the wire no second time (${asks} extra request_frame)`);
  c.close();
}

/** The bound is per decoder: two decoders each hold up to `perDecoder`, none holds more. */
async function boundHoldsPerDecoder(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const perDecoder = 2;
  const captured: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decoders: 2, perDecoder, delayMs: 80, onFrame: (f) => captured.push(f) });

  const fillN = [...Array(12).keys()];
  c.fill(fillN);
  for (const i of fillN) await fake.pushFrame(i, enc.encode(`fill-${i}`));

  const deadline = Date.now() + 8000;
  while (captured.length < fillN.length && Date.now() < deadline) await settle(20);

  check(captured.length === fillN.length, `dispatch: two decoders drain the fill (${captured.length}/${fillN.length})`);
  const peak = Math.max(...captured.map((f) => f.info.maxInFlight ?? 0));
  check(peak <= perDecoder, `dispatch: no single decoder holds more than ${perDecoder} (peak ${peak})`);
  c.close();
}

export async function runDispatchArm(DownloaderClient: DownloaderCtor, log: (line: string) => void): Promise<void> {
  addEventListener("unhandledrejection", (e) => e.preventDefault());
  let failed = 0;
  let ran = 0;
  const check = (cond: boolean, what: string) => {
    ran += 1;
    if (!cond) {
      failed += 1;
      log(`  FAIL: ${what}`);
    }
  };
  log("dispatch (D2c)");
  for (const clause of [askBeatsQueuedFill, promoteBeatsQueuedFill, boundHoldsPerDecoder]) {
    try {
      await clause(DownloaderClient, check);
    } catch (e) {
      failed += 1;
      log(`  FAIL: ${clause.name} threw: ${(e as Error)?.message ?? e}`);
    }
  }
  log(`\ndispatch: ${ran - failed}/${ran} checks passed on the downloader arm`);
  (globalThis as Record<string, unknown>).__wtpacsFailed = failed;
  (globalThis as Record<string, unknown>).__wtpacsDone = true;
}
