/**
 * D2c: the behaviours the downloader implements and D2b's surface clauses cannot see — an ask
 * served before the fill frames still waiting for a decoder, never more than `perDecoder` frames
 * outstanding on one decoder, and a fill handed to `start` reaching the wire while the decoders
 * are still coming up. Each needs the stand-in decoder (fake-decoder.js) made to stall or to hold
 * `ready` back, not luck. docs/proposal-downloader.md §The downloader.
 */
import { type WorkerFake, workerFake } from "./worker-fake.ts";

const CERT = "ab".repeat(32);
const enc = new TextEncoder();
/** Decoded pixels arrive over a SharedArrayBuffer, which TextDecoder refuses: copy, then read. */
const text = (b?: Uint8Array) => (b ? new TextDecoder().decode(Uint8Array.from(b)) : "");

type Frame = { frameIndex: number; generation: number; bytes: Uint8Array; info: { decodeSeq?: number; maxInFlight?: number; warmed?: boolean } };
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
    transport: `/client/conformance/dist/fake-session.js?ch=${ch}`,
    decoderWorker: "/client/conformance/fake-decoder.js",
    decoder: { delayMs: opts.delayMs, readyDelayMs: opts.readyDelayMs },
    warmup: opts.warmup,
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
 * exists are held for one, not handed to a decoder that cannot take them. `pump()`'s guard.
 */
async function framesBeforeAnyDecoderAreHeld(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const indices = [...Array(12).keys()];
  const held: Frame[] = [];
  const t0 = Date.now();
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
 * the server's `--open-ask` is. docs/proposal-session-open.md
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
  for (const clause of [
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
  ]) {
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
