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
type Wire = { op: string; from?: number; to?: number; frame?: number };

let world = 0;

async function open(
  DownloaderClient: DownloaderCtor,
  opts: { decoders: number; perDecoder: number; delayMs: number; onFrame: (f: Frame) => void; decode?: boolean },
) {
  const ch = `wtpacs-dispatch-${++world}`;
  const fake = workerFake(ch);
  const connect = DownloaderClient.connect("https://conformance.invalid/", CERT, {
    decode: opts.decode ?? true,
    decoders: opts.decoders,
    perDecoder: opts.perDecoder,
    transport: `/client/conformance/dist/fake-session.js?ch=${ch}`,
    decoderWorker: "/client/conformance/fake-decoder.js",
    decoder: { delayMs: opts.delayMs },
    onFrame: opts.onFrame,
  });
  const c = await Promise.race([
    connect,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the downloader did not start in 5 s")), 5000)),
  ]);
  return { c, fake };
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await settle(10);
  return cond();
}

/** The wire as a readable sequence: `stream_frames 4-7`, `request_frame 50`, … */
const wireOf = (msgs: Wire[]) =>
  msgs.map((m) =>
    m.op === "stream_frames" ? `stream_frames ${m.from}-${m.to}` : m.op === "request_frame" ? `request_frame ${m.frame}` : m.op,
  );

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

/**
 * D3: an ask ends the fill on the server (L16), so once the ask settles the downloader re-issues
 * exactly the frames still owed as a new run — and the fill completes with every frame once.
 */
async function reissuesAfterAsk(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const captured: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decode: false, decoders: 0, perDecoder: 2, delayMs: 0, onFrame: (f) => captured.push(f) });
  c.fill([0, 1, 2, 3, 4, 5, 6, 7]);
  await settle();
  for (const i of [0, 1, 2, 3]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => captured.length >= 4);

  const askP = c.requestExactFrame(50);
  await settle();
  await fake.pushFrame(50, enc.encode("ask-50"));
  const asked = await askP;
  await settle();

  const wire = wireOf((await fake.controlMessages()) as Wire[]);
  const at = wire.indexOf("request_frame 50");
  check(wire[0] === "stream_frames 0-7", `reissue: the fill goes out as one stream_frames run (${wire[0]})`);
  check(at > 0, `reissue: the ask goes to the wire`);
  check(wire[at + 1] === "stream_frames 4-7", `reissue: once the ask settles, exactly the remainder is re-issued (${wire[at + 1]})`);
  check(asked.frameIndex === 50, `reissue: the ask was served`);

  for (const i of [4, 5, 6, 7]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => captured.length >= 8);
  const order = captured.map((f) => f.frameIndex).join();
  check(order === "0,1,2,3,4,5,6,7", `reissue: the fill completes, every frame once (${order})`);
  c.close();
}

/** A frame the fill still owes is asked on the wire — the server serves it next — and the runs re-issued after it skip it. */
async function asksTheWireForAnOwedFrame(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const captured: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decode: false, decoders: 0, perDecoder: 2, delayMs: 0, onFrame: (f) => captured.push(f) });
  c.fill([0, 1, 2, 3, 4, 5, 6, 7]);
  await settle();
  for (const i of [0, 1]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => captured.length >= 2);

  const askP = c.requestExactFrame(5);
  await settle();
  let wire = wireOf((await fake.controlMessages()) as Wire[]);
  check(wire.includes("request_frame 5"), `owed: an ask for a frame the fill still owes goes to the wire`);
  await fake.pushFrame(5, enc.encode("fill-5"));
  const asked = await askP;
  await settle();
  wire = wireOf((await fake.controlMessages()) as Wire[]);
  const at = wire.indexOf("request_frame 5");
  check(asked.frameIndex === 5, `owed: it is served on the ask's own promise`);
  check(wire[at + 1] === "stream_frames 2-4", `owed: the re-issued run stops short of it (${wire[at + 1]})`);

  for (const i of [2, 3, 4]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => captured.length >= 5);
  await settle();
  wire = wireOf((await fake.controlMessages()) as Wire[]);
  check(wire[at + 2] === "stream_frames 6-7", `owed: the run after it resumes past it (${wire[at + 2]})`);
  for (const i of [6, 7]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => captured.length >= 7);
  const order = captured.map((f) => f.frameIndex).join();
  check(order === "0,1,2,3,4,6,7", `owed: the fill delivers everything else once, in order (${order})`);
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
  for (const clause of [askBeatsQueuedFill, promoteBeatsQueuedFill, boundHoldsPerDecoder, reissuesAfterAsk, asksTheWireForAnOwedFrame]) {
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
