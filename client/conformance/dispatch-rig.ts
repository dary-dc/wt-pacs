/**
 * D2c: the behaviours the downloader implements and D2b's surface clauses cannot see — an ask
 * served before the fill frames still waiting for a decoder, never more than `perDecoder` frames
 * outstanding on one decoder, and a fill handed to `start` reaching the wire while the decoders
 * are still coming up. Each needs the stand-in decoder (fake-decoder.js) made to stall or to hold
 * `ready` back, not luck. docs/ARCHITECTURE.md §The downloader.
 */
import { type WorkerFake, workerFake } from "./worker-fake.ts";

const CERT = "ab".repeat(32);
const enc = new TextEncoder();
/** Decoded pixels arrive over a SharedArrayBuffer, which TextDecoder refuses: copy, then read. */
const text = (b?: Uint8Array) => (b ? new TextDecoder().decode(Uint8Array.from(b)) : "");

type Frame = { frameIndex: number; generation: number; bytes: Uint8Array; info: { width?: number; height?: number; bits?: number; components?: number; signed?: boolean; decodeSeq?: number; maxInFlight?: number; warmed?: boolean; byteCount?: number; wireBytes?: number; min?: number; max?: number; stamps?: { decoderReady?: number; dispatched?: number } } };
type Fail = { frameIndex: number; reason: string; generation: number };
type Downloader = {
  requestExactFrame(index: number): Promise<Frame>;
  fill(indices: number[]): void;
  cancel(): Promise<void>;
  close(): void;
};
type DownloaderCtor = {
  connect(url: string, certHash: string, opts: Record<string, unknown>): Promise<Downloader>;
};
type Wire = { op: string; from?: number; to?: number; frame?: number };

let world = 0;

type OpenOpts = {
  decoders: number;
  perDecoder: number;
  delayMs: number;
  onFrame: (f: Frame) => void;
  onError?: (f: Fail) => void;
  decode?: boolean;
  fill?: number[];
  readyDelayMs?: number;
  openAsk?: boolean;
  urlDelayMs?: number;
  warmup?: string;
  /** The real decoder in place of the stand-in, with the glue and wasm it loads. */
  realDecoder?: { glue: string; wasm: string; dir: string; codec?: string; depth?: number; split?: number; offset?: number };
  /** A worker that wraps the real decoder, in place of decoder.js itself. */
  decoderWorker?: string;
  survival?: false | { stallMs?: number; redialMs?: number; tries?: number; dialMs?: number };
  hangDials?: number;
  recycleAtBytes?: number;
};

function begin(DownloaderClient: DownloaderCtor, opts: OpenOpts) {
  const ch = `wtpacs-dispatch-${++world}`;
  const fake = workerFake(ch);
  const url = opts.urlDelayMs
    ? new Promise<string>((r) => setTimeout(() => r("https://conformance.invalid/"), opts.urlDelayMs))
    : "https://conformance.invalid/";
  const connect = DownloaderClient.connect(url as string, CERT, {
    decode: opts.decode ?? true,
    decoders: opts.decoders,
    perDecoder: opts.perDecoder,
    fill: opts.fill,
    openAsk: opts.openAsk,
    transport: `/client/conformance/dist/fake-session.js?ch=${ch}&hang=${opts.hangDials ?? 0}`,
    decoderWorker: opts.decoderWorker ?? (opts.realDecoder ? undefined : `/client/conformance/fake-decoder.js?ch=${ch}`),
    decoder: opts.realDecoder ?? { delayMs: opts.delayMs, readyDelayMs: opts.readyDelayMs },
    warmup: opts.warmup,
    survival: opts.survival,
    recycleAtBytes: opts.recycleAtBytes,
    onFrame: opts.onFrame,
    onError: opts.onError,
  });
  return { connect, fake };
}

async function open(DownloaderClient: DownloaderCtor, opts: OpenOpts) {
  const { connect, fake } = begin(DownloaderClient, opts);
  const c = await Promise.race([
    connect,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the downloader did not start in 5 s")), 5000)),
  ]);
  return { c, fake };
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** A cancel that never completes must fail its own check by name, not take the suite down (S1). */
const cancelled = (c: Downloader, ms = 3000) =>
  Promise.race([c.cancel().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

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

/**
 * A frame decoded for a cancelled request must never be handed over under an index the new
 * request is using: the right key with the wrong pixels is how the bit-exact guarantee is lost.
 */
async function lateFramesOfACancelledRequestAreDropped(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decoders: 1, perDecoder: 2, delayMs: 300, onFrame: (f) => got.push(f) });
  c.fill([5]);
  await settle();
  await fake.pushFrame(5, enc.encode("old-5"));
  await settle(60);

  await cancelled(c);
  c.fill([5]);
  await settle();
  await fake.pushFrame(5, enc.encode("new-5"));
  await until(() => got.length > 0);
  await settle(500);

  check(got.length === 1, `cancel: frame 5 is delivered once after the cancel, not twice (${got.length})`);
  check(text(got[0]?.bytes) === "new-5", `cancel: it carries the new request's bytes (${text(got[0]?.bytes) || "nothing"})`);
  check(got[0]?.generation === 1, `cancel: and the new request's generation (${got[0]?.generation})`);
  c.close();
}

/**
 * The cancelled request's `done` must not delete the record the new request keeps under the same
 * index; without that record the new frame arrives with nothing to put it in and is dropped.
 */
async function aLateDoneDoesNotDropTheNewRequestsFrame(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decoders: 1, perDecoder: 2, delayMs: 400, onFrame: (f) => got.push(f) });
  c.fill([5]);
  await settle();
  await fake.pushFrame(5, enc.encode("old-5"));
  await settle(60);

  await cancelled(c);
  c.fill([5]);
  // Long enough that the cancelled decode has finished while the new frame 5 is still on the wire.
  await settle(600);
  await fake.pushFrame(5, enc.encode("new-5"));

  const came = await until(() => got.length > 0);
  check(came, `cancel: the new request's frame 5 still arrives after the cancelled decode finished`);
  check(text(got[0]?.bytes) === "new-5", `cancel: carrying the new request's bytes (${text(got[0]?.bytes) || "nothing"})`);
  c.close();
}

/**
 * `cancel` completes, and the ask it dropped stops gating the fill: asks in flight are what hold
 * a fill back, so one left counted stalls the next request until the consumer's 15 s timeout.
 */
async function cancelCompletesAndUnblocksTheNextFill(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decode: false, decoders: 0, perDecoder: 2, delayMs: 0, onFrame: (f) => got.push(f) });
  c.fill([0, 1, 2, 3, 4, 5, 6, 7]);
  await settle();
  let abort = "";
  c.requestExactFrame(50).catch((e: Error) => { abort = String(e.message); });
  await settle();

  const finished = await cancelled(c);
  await settle();
  check(finished === true, `cancel: cancel() completes`);
  check(abort.includes("AbortError"), `cancel: the ask it dropped rejects with an AbortError (${abort || "still pending"})`);

  c.fill([5, 6, 7]);
  await settle();
  const wire = wireOf((await fake.controlMessages()) as Wire[]);
  const at = wire.lastIndexOf("end_stream");
  check(wire[at + 1] === "stream_frames 5-7", `cancel: the next fill reaches the wire (${wire.slice(at + 1).join(", ") || "nothing after end_stream"})`);

  for (const i of [5, 6, 7]) await fake.pushFrame(i, enc.encode(`new-${i}`));
  check(await until(() => got.length >= 3), `cancel: and its frames arrive (${got.length}/3)`);

  // The cancelled ask settles late. Its count belonged to the old request; subtracting it from
  // the new one's leaves a fill free to go out while an ask is still on the wire.
  await fake.pushFrame(50, enc.encode("late-50"));
  await settle();
  c.fill([20, 21, 30]);
  await settle();
  c.requestExactFrame(50).catch(() => {});
  await settle();
  for (const i of [20, 21]) await fake.pushFrame(i, enc.encode(`new-${i}`));
  await settle(100);
  const after = wireOf((await fake.controlMessages()) as Wire[]);
  const asked = after.lastIndexOf("request_frame 50");
  const runs = after.slice(asked).filter((w) => w.startsWith("stream_frames"));
  check(runs.length === 0, `cancel: a late ask of the cancelled request leaves no fill free to run beside a live ask (${runs.join(", ")})`);
  c.close();
}

/**
 * A refused fill reaches the consumer. The session fails the run's records, but a fill frame has
 * no waiter, so without an error callback the consumer has only `onFrame` and never hears (D1r).
 */
async function aRefusedFillReachesTheConsumer(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false,
    decoders: 0,
    perDecoder: 2,
    delayMs: 0,
    onFrame: () => {},
    onError: (f) => failures.push(f),
  });
  c.fill([0, 1, 2, 3]);
  await settle();
  // A refused range is one frame_error at its first frame, so the whole run fails with it.
  await fake.pushRefusal(0, "no such frame");
  await until(() => failures.length >= 4);

  const indices = failures.map((f) => f.frameIndex).sort((a, b) => a - b).join();
  check(indices === "0,1,2,3", `refusal: every frame of the refused run reaches the consumer (${indices || "none"})`);
  check(failures.every((f) => f.reason.includes("no such frame")), `refusal: with the server's reason`);

  let rejected = "";
  c.requestExactFrame(9).catch((e: Error) => { rejected = String(e.message); });
  await settle();
  await fake.pushRefusal(9, "no such frame");
  await until(() => rejected !== "");
  check(rejected.includes("no such frame"), `refusal: a refused ask rejects its own promise (${rejected || "still pending"})`);
  check(!failures.some((f) => f.frameIndex === 9), `refusal: and does not go to the error callback as well`);
  c.close();
}

/** How long the stand-in decoders hold `ready` back, so the wire has a window to run ahead of them. */
const READY_DELAY_MS = 400;

const same = (a?: Uint8Array, b?: Uint8Array) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * When `needle` first appears on the wire, in ms from now. Probes are fired rather than awaited:
 * one sent before the worker has imported the fake is dropped, and awaiting it would cost 2 s.
 */
async function firstSeenMs(fake: WorkerFake, needle: string, budgetMs = 3000) {
  const t0 = Date.now();
  let at = 0;
  while (!at && Date.now() - t0 < budgetMs) {
    void fake
      .controlMessages()
      .then((msgs) => {
        if (!at && wireOf(msgs as Wire[]).includes(needle)) at = Date.now() - t0;
      })
      .catch(() => {});
    await settle(5);
  }
  return at;
}

/**
 * A fill handed to `start` is on the wire while the decoders are still coming up, and its frames
 * arrive decoded once each and byte-identical to the same fill asked the old way, after `started`.
 */
async function fillWithStartRunsAheadOfTheDecoders(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const indices = [0, 1, 2, 3, 4, 5, 6, 7];
  const payload = (i: number) => enc.encode(`frame-${i}-${"ab".repeat(i + 1)}`);

  const early: Frame[] = [];
  const { connect, fake } = begin(DownloaderClient, {
    decoders: 1,
    perDecoder: 2,
    delayMs: 0,
    readyDelayMs: READY_DELAY_MS,
    fill: indices,
    onFrame: (f) => early.push(f),
  });
  const at = await firstSeenMs(fake, "stream_frames 0-7");
  check(
    at > 0 && at < READY_DELAY_MS / 2,
    `fill at start: the fill is on the wire at ${at} ms, with the decoders ${READY_DELAY_MS} ms from ready`,
  );
  for (const i of indices) await fake.pushFrame(i, payload(i));
  const c = await connect.catch(() => null);
  const all = await until(() => early.length >= indices.length, 5000);
  check(all, `fill at start: every frame of it arrives (${early.length}/${indices.length})`);
  c?.close();

  const late: Frame[] = [];
  const { c: c2, fake: fake2 } = await open(DownloaderClient, { decoders: 1, perDecoder: 2, delayMs: 0, onFrame: (f) => late.push(f) });
  c2.fill(indices);
  for (const i of indices) await fake2.pushFrame(i, payload(i));
  await until(() => late.length >= indices.length, 5000);

  const asStart = new Map(early.map((f) => [f.frameIndex, f.bytes]));
  const asFill = new Map(late.map((f) => [f.frameIndex, f.bytes]));
  check(asStart.size === early.length && asStart.size === indices.length, `fill at start: each frame exactly once (${asStart.size} of ${early.length})`);
  check(indices.every((i) => same(asStart.get(i), asFill.get(i))), `fill at start: byte-identical to the same fill asked after started`);
  c2.close();

  // Decoders ready at once and nothing pushed: `start` must not re-issue what `connect` just sent.
  const { c: c3, fake: fake3 } = await open(DownloaderClient, { decoders: 1, perDecoder: 2, delayMs: 0, fill: indices, onFrame: () => {} });
  const runs = wireOf((await fake3.controlMessages()) as Wire[]).filter((w) => w.startsWith("stream_frames"));
  check(runs.length === 1, `fill at start: it goes to the wire as one run (${runs.join(", ") || "none"})`);
  c3.close();
}

/**
 * The race the wire-ahead-of-the-decoders change opens: frames that land before any decoder
 * exists are held for one, not handed to a decoder that cannot take them. `pump()`'s guard. Each
 * carries when its decoder answered `ready`: no sooner than the stand-in let it, and before dispatch.
 */
async function framesBeforeAnyDecoderAreHeld(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const indices = [...Array(12).keys()];
  const held: Frame[] = [];
  const t0 = Date.now();
  const t0abs = performance.timeOrigin + performance.now();
  const { connect, fake } = begin(DownloaderClient, {
    decoders: 3,
    perDecoder: 2,
    delayMs: 0,
    readyDelayMs: READY_DELAY_MS,
    fill: indices,
    onFrame: (f) => held.push(f),
  });
  await firstSeenMs(fake, "stream_frames 0-11");
  for (const i of indices) await fake.pushFrame(i, enc.encode(`held-${i}`));
  const pushedAt = Date.now() - t0;
  check(pushedAt < READY_DELAY_MS, `held: all ${indices.length} frames land at ${pushedAt} ms, before any decoder is ready (${READY_DELAY_MS} ms)`);

  const c = await connect.catch(() => null);
  const all = await until(() => held.length >= indices.length, 5000);
  check(all, `held: every frame that arrived before a decoder existed is delivered (${held.length}/${indices.length})`);
  check(held.every((f) => (f.info.decodeSeq ?? 0) > 0), `held: each of them went through a decoder`);
  check(new Set(held.map((f) => f.frameIndex)).size === indices.length, `held: each of them exactly once`);
  const late = held.map((f) => (f.info.stamps?.decoderReady ?? 0) - t0abs);
  check(late.every((ms) => ms >= READY_DELAY_MS),
    `ready stamp: each frame carries its decoder's, ${READY_DELAY_MS} ms or more after the open (${Math.min(...late).toFixed(0)} ms at the least)`);
  check(held.every((f) => (f.info.stamps?.decoderReady ?? Infinity) <= (f.info.stamps?.dispatched ?? 0)),
    `ready stamp: and never after the frame was dispatched to that decoder`);
  c?.close();
}

/**
 * `start` carrying a fill with an `ask` posted straight behind it — the pair the consumer cannot
 * make, since `connect` resolves on `started` — shares one handshake instead of racing into two.
 */
async function startWithAFillDialsOnce(_DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const ch = `wtpacs-dispatch-${++world}`;
  const fake = workerFake(ch);
  const w = new Worker("/client/downloader/downloader.js", { type: "module" });
  w.onmessage = () => {};
  w.postMessage({
    kind: "start",
    config: { decode: false, decoders: 0, transport: `/client/conformance/dist/fake-session.js?ch=${ch}`, fill: [0, 1, 2, 3] },
  });
  w.postMessage({ kind: "dial", url: "https://conformance.invalid/", certHash: CERT });
  w.postMessage({ kind: "ask", index: 50 });

  let dialled = 0;
  const deadline = Date.now() + 3000;
  while (!dialled && Date.now() < deadline) {
    void fake
      .dials()
      .then((n) => { dialled = n; })
      .catch(() => {});
    await settle(10);
  }
  await settle(300);
  const dials = await fake.dials();
  check(dials === 1, `fill at start: a start carrying a fill and an ask behind it dial once (${dials})`);
  w.terminate();
}

/** The URL is withheld for as long as the decoders hold `ready`, so the two have to overlap. */
const URL_DELAY_MS = 500;

/**
 * R3: only the dial needs the session URL, so the worker graph comes up while it is still being
 * fetched. With the URL and `ready` each URL_DELAY_MS out, the first frame is decoded at about
 * that, not at twice it. lab/page-open/README.md
 */
async function theDecodersComeUpWhileTheUrlIsUnknown(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const got: Frame[] = [];
  const t0 = Date.now();
  const { connect, fake } = begin(DownloaderClient, {
    decoders: 1,
    perDecoder: 2,
    delayMs: 0,
    readyDelayMs: URL_DELAY_MS,
    urlDelayMs: URL_DELAY_MS,
    fill: [0],
    onFrame: (f) => got.push(f),
  });
  const c = await connect;
  await fake.pushFrame(0, enc.encode("first"));
  const came = await until(() => got.length > 0, 5000);
  const at = Date.now() - t0;
  check(
    came && at < URL_DELAY_MS * 1.6,
    `un-gated: the first frame is decoded at ${at} ms, with the URL and the decoders each ${URL_DELAY_MS} ms out`,
  );
  c.close();
}

/**
 * R1: the fill the consumer opens with rides the session URL, so the server serves it behind its
 * accept, and the control stream is never asked for it a second time. Off unless asked for, as
 * the server's `--open-ask` is. docs/ARCHITECTURE.md
 */
async function anOpeningFillRidesTheSessionUrl(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const indices = [0, 1, 2, 3];
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0,
    fill: indices, openAsk: true, onFrame: (f) => got.push(f),
  });
  const url = await fake.dialUrl();
  check(url.endsWith("?ask=fill:0-3"), `open ask: the session URL carries the fill (${url})`);
  const runs = wireOf((await fake.controlMessages()) as Wire[]).filter((w) => w.startsWith("stream_frames"));
  check(runs.length === 0, `open ask: and the wire is not asked for it again (${runs.join(", ") || "clean"})`);
  for (const i of indices) await fake.pushFrame(i, enc.encode(`open-${i}`));
  check(await until(() => got.length >= indices.length), `open ask: every frame of it is delivered (${got.length}/${indices.length})`);
  c.close();

  const { c: c2, fake: fake2 } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0, fill: indices, onFrame: () => {},
  });
  const plain = await fake2.dialUrl();
  check(!plain.includes("ask="), `open ask: the session URL carries nothing unless asked for (${plain})`);
  c2.close();
}

/**
 * A refused opening fill reaches the consumer: the run armed at the dial carries the same error
 * callback as one asked on the wire, so the refusal is not lost for want of a waiter.
 */
async function aRefusedOpeningFillReachesTheConsumer(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0,
    fill: [0, 1, 2, 3], openAsk: true, onFrame: () => {}, onError: (f) => failures.push(f),
  });
  await fake.pushRefusal(0, "no such frame");
  await until(() => failures.length >= 4);
  const indices = failures.map((f) => f.frameIndex).sort((a, b) => a - b).join();
  check(indices === "0,1,2,3", `open ask: a refused opening fill reaches the consumer whole (${indices || "none"})`);
  c.close();
}

/**
 * The warm-up lives inside the decoders: the session carries exactly what it carried without one,
 * every frame comes from a warmed decoder, and a warm-up that cannot be fetched still leaves a
 * decoder that decodes. docs/decode/README.md §Warming the decoders
 */
async function aWarmUpChangesNothingOnTheWire(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const indices = [0, 1, 2, 3, 4, 5, 6, 7];
  const payload = (i: number) => enc.encode(`frame-${i}-${"ab".repeat(i + 1)}`);
  const run = async (warmup?: string) => {
    const got: Frame[] = [];
    const { connect, fake } = begin(DownloaderClient, {
      decoders: 3, perDecoder: 2, delayMs: 0, fill: indices, warmup, onFrame: (f) => got.push(f),
    });
    await firstSeenMs(fake, "stream_frames 0-7");
    for (const i of indices) await fake.pushFrame(i, payload(i));
    const c = await connect.catch(() => null);
    await until(() => got.length >= indices.length, 5000);
    const wire = wireOf((await fake.controlMessages()) as Wire[]);
    c?.close();
    return { by: new Map(got.map((f) => [f.frameIndex, f])), n: got.length, wire };
  };

  const plain = await run();
  const warm = await run("/client/conformance/fake-decoder.js");
  check(warm.wire.join(", ") === plain.wire.join(", "), `warm-up: the wire is what it was without one (${warm.wire.join(", ")})`);
  check(warm.n === indices.length, `warm-up: every frame of the fill arrives (${warm.n}/${indices.length})`);
  check(indices.every((i) => same(warm.by.get(i)?.bytes, plain.by.get(i)?.bytes)), `warm-up: each frame byte-identical to the fill without one`);
  check([...warm.by.values()].every((f) => f.info.warmed), `warm-up: every frame came from a warmed decoder`);

  const missing = await run("/client/conformance/no-such-frame.j2c");
  check(missing.n === indices.length, `warm-up: one that cannot be fetched still delivers the fill (${missing.n}/${indices.length})`);
  check([...missing.by.values()].every((f) => !f.info.warmed), `warm-up: and the decoders say they did not warm`);
}

/**
 * A media stream that ends before the length its own header declares has lost that frame: the
 * consumer is told which frame, in the generation it is living in, and is never handed the part
 * that did arrive as pixels. docs/CLIENTS.md#a-truncated-frame-is-a-failure
 */
async function aTruncatedFrameIsAFailureNotAFrame(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const frames: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0,
    onFrame: (f) => frames.push(f), onError: (f) => failures.push(f),
  });
  // One cancel first, so the generation the failure carries is not the initial 0 by default.
  await cancelled(c);
  c.fill([0, 1]);
  await fake.pushFrame(0, enc.encode("frame-zero"));
  await until(() => frames.length >= 1);
  await fake.pushTruncatedFrame(1, enc.encode("frame-one-and-then-some"), 5);

  const named = await until(() => failures.some((f) => f.frameIndex === 1));
  const seen = failures.map((f) => f.frameIndex).join() || "none";
  check(named, `truncated: the frame the stream cut short is reported (${seen})`);
  check(failures.every((f) => f.generation === 1), `truncated: the failure carries the current generation (${failures.map((f) => f.generation).join() || "none"})`);
  check(!frames.some((f) => f.frameIndex === 1), "truncated: the frame it cut short never arrives as pixels");
  check(frames.length === 1 && frames[0].frameIndex === 0, `truncated: the whole frame before it still arrives (${frames.map((f) => f.frameIndex).join() || "none"})`);
  c.close();
}

/**
 * Only the decoder knows a codestream did not decode. An empty one and a file that is not one
 * reach the consumer as failures, each named and in the current generation, while a real frame
 * beside them arrives whole — one decoder object is reused, so without the check they would each
 * arrive as a frame carrying the previous frame's pixels. docs/decode/README.md §A frame that did not decode
 */
async function anUndecodableFrameIsAFailureNotAFrame(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  const dir = "/lab/decode-bench/vendor/openjph";
  const ok = await fetch(`${dir}/openjphjs.js`, { method: "HEAD" }).then((r) => r.ok, () => false);
  if (!ok) return void log(`  SKIPPED: an undecodable frame — no ${dir} (bash lab/decode-bench/fetch_decoder.sh)`);
  const bytesOf = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const good = await bytesOf("/client/downloader/warmup/colour-8.j2c");
  const wrong = await bytesOf("/client/downloader/README.md");

  const frames: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decoders: 1, perDecoder: 2, delayMs: 0,
    realDecoder: { glue: `${dir}/openjphjs.js`, wasm: `${dir}/openjphjs.wasm`, dir },
    onFrame: (f) => frames.push(f), onError: (f) => failures.push(f),
  });
  c.fill([0, 1, 2]);
  await fake.pushFrame(0, good);
  await until(() => frames.length >= 1);
  await fake.pushFrame(1, new Uint8Array(0));
  await fake.pushFrame(2, wrong);

  await until(() => failures.length >= 2);
  const seen = failures.map((f) => f.frameIndex).sort((a, b) => a - b).join();
  check(seen === "1,2", `undecodable: the empty codestream and the wrong file are both reported (${seen || "none"})`);
  check(failures.every((f) => f.generation === 0), `undecodable: each failure carries the request's generation (${failures.map((f) => f.generation).join() || "none"})`);
  check(frames.length === 1 && frames[0].frameIndex === 0, `undecodable: neither arrives as a frame (${frames.map((f) => f.frameIndex).join() || "none"})`);
  check(frames[0]?.info.byteCount === 160 * 160 * 3, `undecodable: the frame that did decode is whole (${frames[0]?.info.byteCount ?? "none"})`);
  c.close();
}

/**
 * A frame says what crossed the link. `wireBytes` is the codestream length its envelope declared,
 * on the undecoded path and behind a decoder alike — never the decoded plane, which on a
 * compressed frame is several times larger. client/downloader/README.md §What a frame reports
 */
async function aFrameCarriesItsWireBytes(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  const payload = enc.encode("frame-zero-and-then-some-more");
  const undecoded: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0, onFrame: (f) => undecoded.push(f),
  });
  c.fill([0]);
  await fake.pushFrame(0, payload);
  await until(() => undecoded.length >= 1);
  const raw = undecoded[0];
  check(raw?.info.wireBytes === payload.length, `wire bytes: undecoded, the length the envelope declared (${raw?.info.wireBytes ?? "none"} of ${payload.length})`);
  c.close();

  const dir = "/lab/decode-bench/vendor/openjph";
  const ok = await fetch(`${dir}/openjphjs.js`, { method: "HEAD" }).then((r) => r.ok, () => false);
  if (!ok) return void log(`  SKIPPED: wire bytes behind a decoder — no ${dir} (bash lab/decode-bench/fetch_decoder.sh)`);
  const codestream = new Uint8Array(await (await fetch("/client/downloader/warmup/colour-8.j2c")).arrayBuffer());

  const decoded: Frame[] = [];
  const { c: c2, fake: fake2 } = await open(DownloaderClient, {
    decoders: 1, perDecoder: 2, delayMs: 0,
    realDecoder: { glue: `${dir}/openjphjs.js`, wasm: `${dir}/openjphjs.wasm`, dir },
    onFrame: (f) => decoded.push(f),
  });
  c2.fill([0]);
  await fake2.pushFrame(0, codestream);
  await until(() => decoded.length >= 1);
  const f = decoded[0];
  check(f?.info.wireBytes === codestream.length, `wire bytes: decoded, the length the envelope declared (${f?.info.wireBytes ?? "none"} of ${codestream.length})`);
  check(f?.bytes.length === 160 * 160 * 3 && f.bytes.length !== f.info.wireBytes, `wire bytes: and the decoded plane is a separate, larger number (${f?.bytes.length ?? "none"} decoded)`);
  c2.close();
}


/**
 * A frame's range comes from the decoder when the decoder takes it as it packs, and from the
 * worker's own pass when it does not: the package's range is its pixels' own, and a decoder
 * answering `getRange()` is taken at its word, pass skipped. An 8-bit colour frame's is its sample
 * type's, whatever the decoder answers. docs/decode/README.md §The range in the pack
 */
async function aFrameCarriesItsDecodersRangeOrItsOwn(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  const dir = "/lab/decode-bench/vendor/openjph";
  const ok = await fetch(`${dir}/openjphjs.js`, { method: "HEAD" }).then((r) => r.ok, () => false);
  if (!ok) return void log(`  SKIPPED: a frame's range — no ${dir} (bash lab/decode-bench/fetch_decoder.sh)`);
  const bytesOf = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const grey = await bytesOf("/client/downloader/warmup/grey-16.j2c");
  const colour = await bytesOf("/client/downloader/warmup/colour-8.j2c");
  const rangeOf = async (glue: string, codestream: Uint8Array) => {
    const got: Frame[] = [];
    const { c, fake } = await open(DownloaderClient, {
      decoders: 1, perDecoder: 2, delayMs: 0,
      realDecoder: { glue, wasm: `${dir}/openjphjs.wasm`, dir },
      onFrame: (f) => got.push(f),
    });
    c.fill([0]);
    await fake.pushFrame(0, codestream);
    await until(() => got.length >= 1);
    c.close();
    return got[0];
  };
  const pkg = `${dir}/openjphjs.js`;
  const glue = "/client/conformance/range-glue.js";

  const own = await rangeOf(pkg, grey);
  let [min, max] = [Infinity, -Infinity];
  const samples = own ? new Uint16Array(own.bytes.buffer, own.bytes.byteOffset, own.bytes.length / 2) : [];
  for (const v of samples) [min, max] = [Math.min(min, v), Math.max(max, v)];
  check(own !== undefined && own.info.min === min && own.info.max === max,
    `range: a decoder without one gets the worker's pass (${own?.info.min}..${own?.info.max}, pixels ${min}..${max})`);
  const told = await rangeOf(glue, grey);
  check(told?.info.min === -7 && told?.info.max === 7,
    `range: a decoder that takes its own is taken at its word (${told?.info.min}..${told?.info.max})`);
  for (const [name, g] of [["the package", pkg], ["a decoder with its own", glue]]) {
    const f = await rangeOf(g, colour);
    check(f?.info.min === 0 && f?.info.max === 255,
      `range: an 8-bit colour frame through ${name} carries 0..255, no pass taken (${f?.info.min}..${f?.info.max})`);
  }
}

const AV1_DIR = "/lab/.av1-build/out";
const AV1 = { codec: "av1", glue: `${AV1_DIR}/simd.js`, wasm: `${AV1_DIR}/simd.wasm`, dir: AV1_DIR };
const AV1_SET = "/client/conformance/av1";
const served = (url: string) => fetch(url, { method: "HEAD" }).then((r) => r.ok, () => false);
const fetched = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const sha256 = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)))].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * An AV1 series decodes to its source: at every depth and layout the AV1 path takes, a frame's
 * pixels hash to the checksum the generator wrote for the encoder's input, through decoders warmed
 * on an AV1 frame — and the notices the build owes are served beside it. docs/av1/adr-unit.md §2
 */
async function anAv1FrameDecodesToItsSource(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const shapes = [["g8", 1, 8], ["g10", 1, 10], ["g12", 1, 12], ["c8", 3, 8], ["c10", 3, 10], ["c12", 3, 12]] as const;
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decoders: 2, perDecoder: 2, delayMs: 0, realDecoder: AV1,
    warmup: "/client/downloader/warmup/colour-8.av1", onFrame: (f) => got.push(f),
  });
  c.fill(shapes.map((_, i) => i));
  for (const [i, [name]] of shapes.entries()) await fake.pushFrame(i, await fetched(`${AV1_SET}/${name}.av1`));
  await until(() => got.length >= shapes.length, 5000);
  for (const [i, [name, components, bits]] of shapes.entries()) {
    const f = got.find((g) => g.frameIndex === i);
    const want = (await (await fetch(`${AV1_SET}/${name}.sha256`)).text()).trim();
    const have = f ? await sha256(f.bytes) : "no frame";
    check(have === want, `av1: ${name} decodes to its source's samples (${have.slice(0, 12)}, source ${want.slice(0, 12)})`);
    const shape = `${f?.info.width}x${f?.info.height} ${f?.info.components}x${f?.info.bits}-bit${f?.info.signed ? " signed" : ""}`;
    check(shape === `90x70 ${components}x${bits}-bit`, `av1: ${name} says what it is (${shape})`);
  }
  c.close();
  const notices = await fetch(`${AV1_DIR}/THIRD_PARTY.txt`).then((r) => (r.ok ? r.text() : ""), () => "");
  check(notices.includes("VideoLAN and dav1d authors") && notices.includes("Alliance for Open Media Patent License 1.0"),
    "av1: the decoder's notices and the AOM patent licence are served beside it");
}

/**
 * At G = 1 a frame decodes alone or not at all: a frame of a group, an empty unit and a file that is
 * not AV1 each reach the consumer as a failure, never as pixels decoded against the frame before,
 * and the decoder that refused them still decodes the next frame exactly. docs/av1/adr-unit.md §2
 */
async function anAv1FrameThatCannotDecodeAloneIsAFailure(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 refusals — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const frames: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decoders: 1, perDecoder: 1, delayMs: 0, realDecoder: AV1,
    onFrame: (f) => frames.push(f), onError: (f) => failures.push(f),
  });
  c.fill([0, 1, 2, 3, 4]);
  await fake.pushFrame(0, await fetched(`${AV1_SET}/c8.av1`));
  await fake.pushFrame(1, await fetched(`${AV1_SET}/inter.av1`));
  await fake.pushFrame(2, new Uint8Array(0));
  await fake.pushFrame(3, await fetched("/client/downloader/README.md"));
  await fake.pushFrame(4, await fetched(`${AV1_SET}/g12.av1`));
  await until(() => frames.length + failures.length >= 5, 5000);
  const refused = failures.map((f) => f.frameIndex).sort((a, b) => a - b).join() || "none";
  check(refused === "1,2,3", `av1: a frame of a group, an empty unit and a non-AV1 file are refused (${refused})`);
  check(frames.map((f) => f.frameIndex).join() === "0,4", `av1: none of them arrives as a frame (${frames.map((f) => f.frameIndex).join() || "none"})`);
  const after = frames.find((f) => f.frameIndex === 4);
  const want = (await (await fetch(`${AV1_SET}/g12.sha256`)).text()).trim();
  check(after !== undefined && (await sha256(after.bytes)) === want, "av1: the next frame after them is still exact");
  c.close();
}

/** Frames of the set through the real decoder behind `worker`, and how many units reached a VideoDecoder. */
async function av1Through(
  DownloaderClient: DownloaderCtor,
  names: readonly (string | Uint8Array)[],
  decoder: Partial<NonNullable<OpenOpts["realDecoder"]>>,
  mode: "spy" | "none",
) {
  const ch = `wtpacs-webcodecs-${++world}`;
  let units = 0;
  const spy = new BroadcastChannel(ch);
  spy.onmessage = () => void (units += 1);
  const got: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decoders: 1, perDecoder: 2, delayMs: 0, realDecoder: { ...AV1, ...decoder },
    decoderWorker: `/client/conformance/webcodecs-spy.js?mode=${mode}&ch=${ch}`,
    onFrame: (f) => got.push(f), onError: (f) => failures.push(f),
  });
  c.fill(names.map((_, i) => i));
  const frames = await Promise.all(names.map((n) => (typeof n !== "string" ? n : fetched(n.startsWith("/") ? n : `${AV1_SET}/${n}.av1`))));
  // All at once, so a decoder holds `perDecoder` of them together.
  await Promise.all(frames.map((b, i) => fake.pushFrame(i, b)));
  await until(() => got.length + failures.length >= names.length, 5000);
  c.close();
  await settle(50);
  spy.close();
  return { got, failures, units };
}

/** Each frame of `names` hashes to its source's checksum, and says the shape `want` names. */
async function exactAv1(check: (c: boolean, w: string) => void, what: string, got: Frame[], names: readonly string[], want: (n: string) => string) {
  for (const [i, name] of names.entries()) {
    const f = got.find((g) => g.frameIndex === i);
    const sum = (await (await fetch(`${AV1_SET}/${name}.sha256`)).text()).trim();
    const have = f ? await sha256(f.bytes) : "no frame";
    const shape = `${f?.info.width}x${f?.info.height} ${f?.info.components}x${f?.info.bits}-bit${f?.info.signed ? " signed" : ""}`;
    check(have === sum && shape === want(name), `${what}: ${name} decodes to its source's samples as ${shape} (${have.slice(0, 12)}, source ${sum.slice(0, 12)})`);
    const range = f ? rangeOf(f) : "no frame";
    check(range === `${f?.info.min}..${f?.info.max}`, `${what}: ${name} carries its samples' range (${f?.info.min}..${f?.info.max}, samples ${range})`);
  }
}

/** s13's top unit over a colour low unit. */
async function withColourLow() {
  const s13 = await fetched(`${AV1_SET}/s13.av1`);
  const top = 4 + new DataView(s13.buffer).getUint32(0, true);
  const c8 = await fetched(`${AV1_SET}/c8.av1`);
  const out = new Uint8Array(top + c8.length);
  out.set(s13.subarray(0, top));
  out.set(c8, top);
  return out;
}

/** The range the contract owes: an 8-bit colour frame's is its type's, any other its samples'. */
function rangeOf(f: Frame) {
  const { bits = 0, components, signed } = f.info;
  if (components === 3 && bits === 8 && !signed) return "0..255";
  const { buffer, byteOffset, length } = Uint8Array.from(f.bytes);
  const view = bits > 8 ? (signed ? new Int16Array(buffer, byteOffset, length / 2) : new Uint16Array(buffer, byteOffset, length / 2))
    : signed ? new Int8Array(buffer) : new Uint8Array(buffer);
  let [min, max] = [Infinity, -Infinity];
  for (const v of view) [min, max] = [Math.min(min, v), Math.max(max, v)];
  return `${min}..${max}`;
}

const SHAPE: Record<string, string> = { g8: "1x8", g10: "1x10", g12: "1x12", c8: "3x8", c10: "3x10", c12: "3x12" };

/**
 * A series whose streams are all ≤ 10 bits decodes through WebCodecs, exactly, in every shape that
 * takes it; one deeper, or a browser without `VideoDecoder`, decodes through dav1d-WASM, exactly,
 * and never hands WebCodecs a unit. docs/decode/README.md §AV1
 */
async function anAv1SeriesTakesWebCodecsOnlyWhereItIsExact(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (typeof VideoDecoder !== "function") return void log("  SKIPPED: WebCodecs — this browser has no VideoDecoder");
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: WebCodecs — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const shallow = ["g8", "g10", "c8", "c10"] as const;
  const shape = (n: string) => `90x70 ${SHAPE[n]}-bit`;
  const wc = await av1Through(DownloaderClient, shallow, { depth: 10 }, "spy");
  await exactAv1(check, "webcodecs", wc.got, shallow, shape);
  check(wc.units === shallow.length, `webcodecs: a ≤ 10-bit series is decoded by WebCodecs (${wc.units} of ${shallow.length} units)`);
  const spans = wc.got.map((f) => f.info.stamps as { decodeStart: number; decodeEnd: number }).sort((a, b) => a.decodeStart - b.decodeStart);
  const overlaps = spans.filter((s, i) => i > 0 && s.decodeStart < spans[i - 1].decodeEnd).length;
  check(spans.length === shallow.length && overlaps === 0, `webcodecs: its decoder takes the frames it holds one at a time (${overlaps} overlapping)`);

  const none = await av1Through(DownloaderClient, shallow, { depth: 10 }, "none");
  await exactAv1(check, "webcodecs, absent", none.got, shallow, shape);
  const deep = ["g12", "c12"] as const;
  const d12 = await av1Through(DownloaderClient, deep, { depth: 12 }, "spy");
  await exactAv1(check, "webcodecs, 12-bit", d12.got, deep, shape);
  check(d12.units === 0, `webcodecs: a 12-bit series never reaches it (${d12.units} units)`);
  const unsaid = await av1Through(DownloaderClient, ["g8"], {}, "spy");
  check(unsaid.units === 0 && unsaid.got.length === 1, `webcodecs: nor does a series that does not say its depth (${unsaid.units} units)`);
}

/**
 * A 13-bit series split top10+low decodes to its source through either decoder — the two units
 * merged, the offset undone and the samples signed where the series is. docs/av1/adr-unit.md §2
 */
async function anAv1SplitFrameDecodesToItsSource(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 split — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const arms = typeof VideoDecoder === "function" ? (["spy", "none"] as const) : (["none"] as const);
  for (const mode of arms) {
    const what = `split, ${mode === "spy" ? "webcodecs" : "dav1d"}`;
    const plain = await av1Through(DownloaderClient, ["s13"], { depth: 10, split: 3 }, mode);
    await exactAv1(check, what, plain.got, ["s13"], () => "90x70 1x13-bit");
    const signed = await av1Through(DownloaderClient, ["n13"], { depth: 10, split: 3, offset: 4096 }, mode);
    await exactAv1(check, what, signed.got, ["n13"], () => "90x70 1x13-bit signed");
    const f = signed.got[0];
    check(f?.info.min !== undefined && f.info.min < 0, `${what}: the signed series' range is its own (${f?.info.min}..${f?.info.max})`);
    const wide = await av1Through(DownloaderClient, ["n16"], { depth: 10, split: 6, offset: 32768 }, mode);
    await exactAv1(check, what, wide.got, ["n16"], () => "90x70 1x16-bit signed");
    const odd = await av1Through(DownloaderClient, ["g10", await withColourLow()], { depth: 10, split: 3 }, mode);
    check(odd.failures.length === 2 && odd.got.length === 0,
      `${what}: an unsplit frame, and one whose low unit is colour, are refused in a split series (${odd.failures.map((f) => f.reason).join("; ") || "decoded"})`);
  }
}

/**
 * Through WebCodecs as through dav1d: a frame of a group, an empty unit, a file that is not AV1,
 * colour coded as YUV 4:2:0 or 4:4:4, a keyframe cut short and a unit that closes WebCodecs' decoder
 * are each a failure, never samples, and the decoder that refused them decodes the next frame exactly.
 */
async function anAv1FrameEitherDecoderCannotReturnExactlyIsAFailure(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 refusals by decoder — no ${AV1_DIR}`);
  const c8 = await fetched(`${AV1_SET}/c8.av1`);
  const names = ["c8", "inter", new Uint8Array(0), "/client/downloader/README.md", "yuv420", "yuv444", c8.subarray(0, c8.length >> 1), new Uint8Array(1), "c10"];
  const want = (await (await fetch(`${AV1_SET}/c10.sha256`)).text()).trim();
  for (const mode of typeof VideoDecoder === "function" ? (["spy", "none"] as const) : (["none"] as const)) {
    const what = mode === "spy" ? "webcodecs" : "dav1d";
    const r = await av1Through(DownloaderClient, names, { depth: 10 }, mode);
    const refused = r.failures.map((f) => f.frameIndex).sort((a, b) => a - b).join() || "none";
    check(refused === "1,2,3,4,5,6,7", `${what}: a frame of a group, an empty unit, a non-AV1 file, YUV colour, a cut keyframe and a decoder closed under it are refused (${refused})`);
    const after = r.got.find((f) => f.frameIndex === 8);
    check(after !== undefined && (await sha256(after.bytes)) === want, `${what}: the next frame after them is still exact`);
  }
}

/**
 * A codec the client does not know is refused by `connect` before anything starts: no dial, so no
 * frame of the series can reach a decoder that would decode it to something. docs/av1/adr-unit.md §1
 */
async function anUnknownCodecIsRefusedBeforeTheDial(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { connect, fake } = begin(DownloaderClient, {
    decoders: 1, perDecoder: 2, delayMs: 0, realDecoder: { ...AV1, codec: "jxl" }, onFrame: () => {},
  });
  const refused = await connect.then(
    (c) => void c.close() ?? "connected",
    (e) => String((e as Error)?.message ?? e),
  );
  check(refused === 'unknown codec "jxl"', `codec: an unknown one is refused by name (${refused})`);
  // The fake lives in the transport the downloader loads to dial; it answers only once loaded.
  const loaded = await fake.dials().then(() => true, () => false);
  check(!loaded, "codec: and no transport was loaded, so nothing was dialled");
}

/** The fake answers over a channel, so a condition that reads its wire has to be awaited. */
async function untilAsync(cond: () => Promise<boolean>, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (!(await cond()) && Date.now() - t0 < ms) await settle(10);
  return cond();
}

/** Short enough that a clause can watch a whole death and resumption without a long wait. */
const QUICK = { stallMs: 120, redialMs: 60, tries: 3 };

async function stalledFill(DownloaderClient: DownloaderCtor, extra: Partial<OpenOpts> = {}) {
  const got: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0, survival: QUICK,
    onFrame: (f) => got.push(f), onError: (f) => failures.push(f), ...extra,
  });
  c.fill([0, 1, 2, 3, 4, 5]);
  await settle();
  for (const i of [0, 1]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => got.length >= 2);
  return { c, fake, got, failures };
}

/**
 * A slow frame is not a death, and a trigger is not a verdict: while bytes keep arriving the session
 * is kept however long the frame takes — no re-dial, and nothing asked to test it.
 * docs/ARCHITECTURE.md §Detection by the bytes
 */
async function aSessionWhoseBytesKeepComingIsKept(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0, survival: QUICK, onFrame: (f) => got.push(f),
  });
  c.fill([0, 1]);
  await settle();
  await fake.trickleFrame(0, enc.encode("slow".repeat(64)), 20, (QUICK.stallMs * 5) / 20);
  await settle(QUICK.stallMs * 2);
  dispatchEvent(new Event("pageshow"));
  const landed = await until(() => got.length >= 1, 3000);
  check(landed, `survival: a frame slower than stallMs still lands (${got.length})`);
  check((await fake.dials()) === 1, `survival: with no re-dial while its bytes were moving (${await fake.dials()} dials)`);
  check((await fake.controlMessages()).every((m) => m.op !== "request_frame"), "survival: and nothing asked to test the session");
  await fake.pushFrame(1, enc.encode("fill-1"));
  check(await until(() => got.length >= 2), `survival: the fill goes on (${got.length}/2)`);
  c.close();
}

/**
 * Silence is the only proof when a path stops carrying bytes: after `stallMs` of it with frames owed
 * the client re-dials, asks nothing first, and re-issues exactly what the records still owed.
 */
async function aSilentSessionIsRedialled(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { c, fake, got, failures } = await stalledFill(DownloaderClient);

  const redialled = await untilAsync(async () => (await fake.dials()) >= 2);
  check(redialled, `survival: a session silent for stallMs is re-dialled (${await fake.dials()} dials)`);
  if (!redialled) return c.close();
  check(await fake.replacedClosed(), "survival: the session it replaced is closed, not left sending to nobody");

  const wire = wireOf(await fake.controlMessages());
  const fills = wire.filter((w) => w.startsWith("stream_frames"));
  check(wire[0] === "stream_frames 2-5" && fills.every((w) => w === "stream_frames 2-5"),
    `survival: the new session is asked for what was owed and for nothing that arrived (${wire.join(", ") || "nothing"})`);
  for (const i of [2, 3, 4, 5]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  const all = await until(() => got.length >= 6, 3000);
  check(all, `survival: and the fill finishes across the two sessions (${got.length}/6)`);
  check(failures.length === 0, `survival: with nothing reported as failed (${failures.map((f) => f.frameIndex).join() || "none"})`);
  c.close();
}

/**
 * A path that is slow rather than dead would be re-dialled for ever at a fixed wait, so each re-dial
 * the silence causes doubles the wait for the next.
 */
async function theWaitDoublesAfterEachRedialItCauses(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const stallMs = 200;
  const { c, fake } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs } });
  const second = await untilAsync(async () => (await fake.dials()) >= 2);
  const t0 = performance.now();
  await settle(stallMs * 1.5);
  const held = (await fake.dials()) === 2;
  const third = await untilAsync(async () => (await fake.dials()) >= 3);
  const ms = Math.round(performance.now() - t0);
  check(second && held && third, `survival: the second silence is judged against twice stallMs (third dial after ${ms} ms, stallMs ${stallMs})`);
  c.close();
}

/**
 * A session the API itself calls closed needs no silence to prove it. The fill is resumed rather than failed —
 * LG/LH's naming is what happens when resumption runs out, not what happens first.
 */
async function aDeadSessionIsResumedNotReported(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { c, fake, got, failures } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs: 30_000 } });
  await fake.serverClose(0, "the server went away");

  const redialled = await untilAsync(async () => (await fake.dials()) >= 2);
  check(redialled, `survival: a closed session is re-dialled at once, with no wait (${await fake.dials()} dials)`);
  if (!redialled) return c.close();
  check((await fake.controlMessages()).every((m) => m.op !== "request_frame"), "survival: and the close is proof enough — nothing was asked");

  for (const i of [2, 3, 4, 5]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  const all = await until(() => got.length >= 6, 3000);
  check(all, `survival: the fill finishes (${got.length}/6)`);
  check(failures.length === 0, `survival: and nothing reached the consumer as a failure (${failures.map((f) => f.frameIndex).join() || "none"})`);
  c.close();
}

/** An ask outstanding when the session dies is re-asked on the new one, on its own promise. */
async function anOwedAskIsReaskedAfterAResume(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { c, fake } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs: 30_000 } });
  const asked = c.requestExactFrame(50);
  await settle();
  await fake.serverClose(0, "the server went away");

  const redialled = await untilAsync(async () => (await fake.dials()) >= 2);
  check(redialled, `survival: the session dies with an ask outstanding and is re-dialled (${await fake.dials()} dials)`);
  if (!redialled) {
    asked.catch(() => {});
    return c.close();
  }
  const wire = wireOf(await fake.controlMessages());
  check(wire.includes("request_frame 50"), `survival: the owed ask is asked again (${wire.join(", ") || "nothing"})`);
  await fake.pushFrame(50, enc.encode("ask-50"));
  const f = await Promise.race([asked, settle(2000).then(() => null)]);
  check(text(f?.bytes) === "ask-50", `survival: and settles the promise the page is still holding (${text(f?.bytes) || "never"})`);
  c.close();
}

/**
 * The terminal state is LG/LH's: once the re-dials run out, every frame the fill still owed is
 * named, each once, and the frames that did arrive are not among them.
 */
async function whenTheRedialsRunOutWhatWasOwedIsNamed(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { c, fake, got, failures } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs: 30_000 } });
  await fake.failDials(QUICK.tries);
  await fake.serverClose(0, "the server went away");

  const named = await until(() => failures.length >= 4, 5000);
  const owed = [...new Set(failures.map((f) => f.frameIndex))].sort((a, b) => a - b).join();
  check(named && owed === "2,3,4,5", `survival: every frame the fill still owed is named once the re-dials run out (${owed || "none"})`);
  check(failures.length === 4, `survival: each of them once (${failures.map((f) => f.frameIndex).join() || "none"})`);
  check(got.length === 2, `survival: the frames that did arrive are not among them (${got.length} delivered)`);
  c.close();
}

/**
 * A session near its byte budget is replaced before it stalls: past three quarters the next is
 * dialled, the remainder asked on it and nothing that arrived, and the old one closed.
 * docs/ARCHITECTURE.md §Recycling before the stall
 */
async function aSessionNearItsBudgetIsReplaced(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const got: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0, survival: { ...QUICK, stallMs: 30_000 },
    recycleAtBytes: 300, onFrame: (f) => got.push(f), onError: (f) => failures.push(f),
  });
  // 108 envelope bytes a frame: two are under 225, three over.
  const body = (i: number) => enc.encode(`fill-${i}`.padEnd(100, "."));
  c.fill([0, 1, 2, 3, 4, 5]);
  await settle();
  for (const i of [0, 1]) await fake.pushFrame(i, body(i));
  await until(() => got.length >= 2);
  await settle(100);
  check((await fake.dials()) === 1, `recycle: under three quarters of the budget the session is kept (${await fake.dials()} dials)`);
  await fake.pushFrame(2, body(2));
  const replaced = await untilAsync(async () => (await fake.dials()) >= 2 && (await fake.controlMessages()).length > 0);
  check(replaced, `recycle: past three quarters a second session is dialled and asked (${await fake.dials()} dials)`);
  if (!replaced) return c.close();
  check(await fake.replacedClosed(), "recycle: the session it replaced is closed");
  const wire = wireOf(await fake.controlMessages());
  check(wire.length > 0 && wire.every((w) => w === "stream_frames 3-5"),
    `recycle: the new session is asked for the remainder and nothing that arrived (${wire.join(", ")})`);
  for (const i of [3, 4, 5]) await fake.pushFrame(i, body(i));
  const all = await until(() => got.length >= 6, 3000);
  const seen = got.map((f) => f.frameIndex).join();
  check(all && seen === "0,1,2,3,4,5", `recycle: the fill finishes across the two, each frame once (${seen})`);
  check(failures.length === 0, `recycle: with nothing reported as failed (${failures.map((f) => f.frameIndex).join() || "none"})`);
  c.close();
}

/** A dial that never settles is closed at `dialMs` and dialled again. docs/ARCHITECTURE.md §A dial that never settles */
async function aDialThatNeverSettlesIsDialledAgain(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { c, fake } = await open(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0, onFrame: () => {}, survival: { ...QUICK, dialMs: 150 }, hangDials: 1,
  });
  check((await fake.dials()) === 2, `dial: a dial that never settles is dialled again (${await fake.dials()} dials)`);
  check(await fake.replacedClosed(), "dial: and the one it abandoned is closed, not left open");
  c.close();
}

/** Once every try has hung, the client says so rather than waiting for ever. */
async function aDialThatNeverSettlesAtAllIsNamed(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const dialMs = 100;
  const { connect } = begin(DownloaderClient, {
    decode: false, decoders: 0, perDecoder: 2, delayMs: 0, onFrame: () => {}, survival: { ...QUICK, dialMs }, hangDials: QUICK.tries,
  });
  const t0 = performance.now();
  const outcome = await Promise.race([
    connect.then((c) => (c.close(), "started"), (e) => String((e as Error)?.message ?? e)),
    settle(5000).then(() => "still pending at 5 s"),
  ]);
  const ms = Math.round(performance.now() - t0);
  check(/did not settle/.test(outcome), `dial: after ${QUICK.tries} dials that hung, connect fails and names why (${outcome}, ${ms} ms)`);
}

/** A closed client ends every worker it started: the downloader's, and each decoder's. */
async function aClosedClientEndsEveryWorkerItStarted(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { c, fake } = await open(DownloaderClient, { decoders: 2, perDecoder: 2, delayMs: 0, onFrame: () => {} });
  await untilAsync(async () => (await fake.alive()).decoder === 2);
  const before = await fake.alive();
  check(before.downloader === 1 && before.decoder === 2, `close: the ping reaches every worker the client started (${JSON.stringify(before)})`);
  c.close();
  const after = await untilAsync(async () => {
    const a = await fake.alive();
    return a.downloader + a.decoder === 0;
  }, 1500);
  check(after, `close: and none of them is left running once it answers (${JSON.stringify(await fake.alive())})`);
}

/**
 * A downloader wedged in a long task never answers `close`. The client ends it at the deadline,
 * its decoders with it, and an ask still outstanding is named rather than left to its timeout.
 */
async function aDownloaderThatNeverAnswersIsEndedAnyway(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { c, fake } = await open(DownloaderClient, { decoders: 2, perDecoder: 2, delayMs: 0, onFrame: () => {} });
  await untilAsync(async () => (await fake.alive()).decoder === 2);
  const asked = c.requestExactFrame(7).then(() => "delivered", (e: Error) => e.message);
  await settle();
  await fake.block(8000);
  const t0 = performance.now();
  c.close();
  const reason = await Promise.race([asked, settle(3000).then(() => "still waiting")]);
  const ms = Math.round(performance.now() - t0);
  check(/closed by the consumer/.test(reason) && ms < 2000, `close: an ask outstanding on a wedged downloader is named at the deadline (${reason}, ${ms} ms)`);
  // Chromium ends a worker busy in script 2 s after `terminate()`; the block outlasts both.
  const gone = await untilAsync(async () => {
    const a = await fake.alive();
    return a.downloader + a.decoder === 0;
  }, 4000);
  check(gone, `close: and the wedged downloader and its decoders are ended (${JSON.stringify(await fake.alive())})`);
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
  const clauses: ((c: DownloaderCtor, check: (c: boolean, w: string) => void, log: (l: string) => void) => Promise<void>)[] = [
    askBeatsQueuedFill,
    promoteBeatsQueuedFill,
    boundHoldsPerDecoder,
    reissuesAfterAsk,
    asksTheWireForAnOwedFrame,
    fillWithStartRunsAheadOfTheDecoders,
    framesBeforeAnyDecoderAreHeld,
    startWithAFillDialsOnce,
    lateFramesOfACancelledRequestAreDropped,
    aLateDoneDoesNotDropTheNewRequestsFrame,
    cancelCompletesAndUnblocksTheNextFill,
    aRefusedFillReachesTheConsumer,
    theDecodersComeUpWhileTheUrlIsUnknown,
    anOpeningFillRidesTheSessionUrl,
    aRefusedOpeningFillReachesTheConsumer,
    aWarmUpChangesNothingOnTheWire,
    aTruncatedFrameIsAFailureNotAFrame,
    anUndecodableFrameIsAFailureNotAFrame,
    aFrameCarriesItsWireBytes,
    aFrameCarriesItsDecodersRangeOrItsOwn,
    anAv1FrameDecodesToItsSource,
    anAv1FrameThatCannotDecodeAloneIsAFailure,
    anAv1SeriesTakesWebCodecsOnlyWhereItIsExact,
    anAv1SplitFrameDecodesToItsSource,
    anAv1FrameEitherDecoderCannotReturnExactlyIsAFailure,
    anUnknownCodecIsRefusedBeforeTheDial,
    aSessionWhoseBytesKeepComingIsKept,
    aSilentSessionIsRedialled,
    theWaitDoublesAfterEachRedialItCauses,
    aDeadSessionIsResumedNotReported,
    anOwedAskIsReaskedAfterAResume,
    whenTheRedialsRunOutWhatWasOwedIsNamed,
    aSessionNearItsBudgetIsReplaced,
    aDialThatNeverSettlesIsDialledAgain,
    aDialThatNeverSettlesAtAllIsNamed,
    aClosedClientEndsEveryWorkerItStarted,
    aDownloaderThatNeverAnswersIsEndedAnyway,
  ];
  log("dispatch (D2c)");
  for (const clause of clauses) {
    try {
      await clause(DownloaderClient, check, log);
    } catch (e) {
      failed += 1;
      log(`  FAIL: ${clause.name} threw: ${(e as Error)?.message ?? e}`);
    }
  }
  log(`\ndispatch: ${ran - failed}/${ran} checks passed on the downloader arm`);
  (globalThis as Record<string, unknown>).__wtpacsFailed = failed;
  (globalThis as Record<string, unknown>).__wtpacsDone = true;
}
