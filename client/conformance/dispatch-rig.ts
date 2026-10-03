/**
 * Dispatch: what the downloader does that the surface clauses cannot see — asks ahead of queued fill frames,
 * `perDecoder` per decoder, a fill on the wire before the decoders are up, survival, cancel and close — each
 * forced with the stand-in decoder (fake-decoder.js) and the fake session, not left to luck. docs/ARCHITECTURE.md §The downloader.
 */
import type { Check } from "./clauses.ts";
import { CERT, settle, started, tally, until } from "./rig-util.ts";
import { type WorkerFake, workerFake } from "./worker-fake.ts";
const enc = new TextEncoder();
/** Decoded pixels arrive over a SharedArrayBuffer, which TextDecoder refuses: copy, then read. */
const text = (b?: Uint8Array) => (b ? new TextDecoder().decode(Uint8Array.from(b)) : "");

type Frame = { frameIndex: number; generation: number; bytes: Uint8Array; info: { decodeSeq?: number; maxInFlight?: number; warmed?: boolean; byteCount?: number; wireBytes?: number; min?: number; max?: number; stamps?: { decoderReady?: number; dispatched?: number } } };
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
type Log = (line: string) => void;
type Clause = (DownloaderClient: DownloaderCtor, check: Check, log: Log) => Promise<void>;
type RealDecoder = { glue: string; wasm: string; dir: string };

let world = 0;

/** Unset: one decoder, two outstanding on it, no decode delay, frames dropped. */
type OpenOpts = {
  decoders?: number;
  perDecoder?: number;
  delayMs?: number;
  onFrame?: (f: Frame) => void;
  onError?: (f: Fail) => void;
  decode?: boolean;
  fill?: number[];
  /** The stand-ins wait for `hold.release()` before each decode, or before `ready`. */
  hold?: "decode" | "ready";
  /** `"default"` leaves it unset; the other clauses ask on the control stream. */
  openAsk?: boolean | "default";
  url?: Promise<string>;
  warmup?: string;
  /** The real decoder in place of the stand-in, with the glue and wasm it loads. */
  realDecoder?: RealDecoder;
  survival?: false | { stallMs?: number; redialMs?: number; tries?: number; dialMs?: number };
  hangDials?: number;
  recycleAtBytes?: number;
  /** One stand-in decoder fails its init when `hold.release()` is called. */
  failOneInit?: boolean;
};

/** The stand-ins' hold, seen from the page; only a stand-in already holding is sure to hear the release. */
function decoderHold(ch: string) {
  const bc = new BroadcastChannel(`${ch}-decoder`);
  const seen = { holding: 0, ready: 0 };
  bc.onmessage = (e) => {
    if (e.data === "holding" || e.data === "ready") seen[e.data as keyof typeof seen] += 1;
  };
  return {
    holding: () => seen.holding,
    ready: () => seen.ready,
    release: () => bc.postMessage("release"),
  };
}

function begin(DownloaderClient: DownloaderCtor, opts: OpenOpts) {
  const ch = `wtpacs-dispatch-${++world}`;
  const fake = workerFake(ch);
  const hold = decoderHold(ch);
  const connect = DownloaderClient.connect((opts.url ?? "https://conformance.invalid/") as string, CERT, {
    decode: opts.decode ?? true,
    decoders: opts.decoders ?? 1,
    perDecoder: opts.perDecoder ?? 2,
    fill: opts.fill,
    openAsk: opts.openAsk === "default" ? undefined : (opts.openAsk ?? false),
    transport: `/client/conformance/dist/fake-session.js?ch=${ch}&hang=${opts.hangDials ?? 0}`,
    decoderWorker: opts.realDecoder ? undefined : `/client/conformance/fake-decoder.js?ch=${ch}`,
    decoder: opts.realDecoder ?? {
      delayMs: opts.delayMs ?? 0,
      hold: opts.hold,
      failOneInit: opts.failOneInit && { ticket: new Int32Array(new SharedArrayBuffer(4)) },
    },
    warmup: opts.warmup,
    survival: opts.survival,
    recycleAtBytes: opts.recycleAtBytes,
    onFrame: opts.onFrame ?? (() => {}),
    onError: opts.onError,
  });
  return { connect, fake, hold };
}

async function open(DownloaderClient: DownloaderCtor, opts: OpenOpts) {
  const { connect, fake, hold } = begin(DownloaderClient, opts);
  return { c: await started(connect), fake, hold };
}

/** A cancel that never completes must fail its own check by name, not take the suite down. */
const cancelled = (c: Downloader, ms = 3000) =>
  Promise.race([c.cancel().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

/** The wire as a readable sequence: `stream_frames 4-7`, `request_frame 50`, … */
const wireOf = (msgs: Wire[]) =>
  msgs.map((m) =>
    m.op === "stream_frames" ? `stream_frames ${m.from}-${m.to}` : m.op === "request_frame" ? `request_frame ${m.frame}` : m.op,
  );

const onTheWire = (fake: WorkerFake, needle: string) =>
  until(async () => wireOf((await fake.controlMessages()) as Wire[]).includes(needle));

/**
 * With one decoder holding `perDecoder` frames, an ask that lands mid-fill is dispatched the
 * moment a decoder frees — ahead of every fill frame still queued behind it.
 */
async function askBeatsQueuedFill(DownloaderClient: DownloaderCtor, check: Check) {
  const perDecoder = 2;
  const captured: Frame[] = [];
  const { c, fake, hold } = await open(DownloaderClient, { perDecoder, hold: "decode", onFrame: (f) => captured.push(f) });

  const fillN = [0, 1, 2, 3, 4, 5, 6, 7];
  c.fill(fillN);
  for (const i of fillN) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  // The two the decoder can hold are now held; 2..7 wait in the fill queue.
  await until(() => hold.holding() >= perDecoder);

  const askIndex = 50;
  const askPromise = c.requestExactFrame(askIndex);
  await onTheWire(fake, `request_frame ${askIndex}`);
  await fake.pushFrame(askIndex, enc.encode("ask-50"));
  // A round trip to the worker: it has taken the frame by the time it answers.
  await fake.dials();
  hold.release();
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

/** An ask for a frame already queued in the fill is promoted, not re-asked: it moves to the ask queue and is
 *  dispatched ahead of the fill frames behind it. */
async function promoteBeatsQueuedFill(DownloaderClient: DownloaderCtor, check: Check) {
  const perDecoder = 2;
  const captured: Frame[] = [];
  const { c, fake, hold } = await open(DownloaderClient, { perDecoder, hold: "decode", onFrame: (f) => captured.push(f) });

  const fillN = [0, 1, 2, 3, 4, 5, 6, 7];
  c.fill(fillN);
  for (const i of fillN) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => hold.holding() >= perDecoder);

  const promotedP = c.requestExactFrame(7);
  // Commands are taken in order, so an ask that reaches the wire was taken after it.
  c.requestExactFrame(99).catch(() => {});
  await onTheWire(fake, "request_frame 99");
  hold.release();
  const promoted = await promotedP;
  const wire = await fake.controlMessages();

  const deadline = Date.now() + 8000;
  while (captured.length < fillN.length - 1 && Date.now() < deadline) await settle(20);

  const bySeq = new Map(captured.map((f) => [f.frameIndex, f.info.decodeSeq ?? -1]));
  const promotedSeq = promoted.info.decodeSeq ?? -1;
  const behind = [2, 3, 4, 5, 6];

  check(promotedSeq === perDecoder + 1, `dispatch: a promoted frame starts ${perDecoder + 1}th (was ${promotedSeq})`);
  check(behind.every((i) => (bySeq.get(i) ?? Infinity) > promotedSeq), `dispatch: it starts before the fill frames behind it`);
  const asks = wireOf(wire as Wire[]).filter((w) => w === "request_frame 7").length;
  check(asks === 0, `dispatch: promoting asks the wire no second time (${asks} extra request_frame 7)`);
  c.close();
}

/** The bound is per decoder: two decoders each hold up to `perDecoder`, none holds more. */
async function boundHoldsPerDecoder(DownloaderClient: DownloaderCtor, check: Check) {
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

/** An ask ends the fill on the server, so once the ask settles the downloader re-issues exactly the frames
 *  still owed as a new run — and the fill completes with every frame once. */
async function reissuesAfterAsk(DownloaderClient: DownloaderCtor, check: Check) {
  const captured: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decode: false, onFrame: (f) => captured.push(f) });
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
async function asksTheWireForAnOwedFrame(DownloaderClient: DownloaderCtor, check: Check) {
  const captured: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decode: false, onFrame: (f) => captured.push(f) });
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
async function lateFramesOfACancelledRequestAreDropped(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { delayMs: 300, onFrame: (f) => got.push(f) });
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
async function aLateDoneDoesNotDropTheNewRequestsFrame(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { delayMs: 400, onFrame: (f) => got.push(f) });
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
async function cancelCompletesAndUnblocksTheNextFill(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, { decode: false, onFrame: (f) => got.push(f) });
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

/** A refused fill reaches the consumer. The session fails the run's records, but a fill frame has no waiter,
 *  so without an error callback the consumer has only `onFrame` and never hears. */
async function aRefusedFillReachesTheConsumer(DownloaderClient: DownloaderCtor, check: Check) {
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false,
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
async function fillWithStartRunsAheadOfTheDecoders(DownloaderClient: DownloaderCtor, check: Check) {
  const indices = [0, 1, 2, 3, 4, 5, 6, 7];
  const payload = (i: number) => enc.encode(`frame-${i}-${"ab".repeat(i + 1)}`);

  const early: Frame[] = [];
  const { connect, fake, hold } = begin(DownloaderClient, {
    hold: "ready",
    fill: indices,
    onFrame: (f) => early.push(f),
  });
  await until(() => hold.holding() >= 1);
  const at = await firstSeenMs(fake, "stream_frames 0-7");
  check(at > 0 && hold.ready() === 0, `fill at start: the fill is on the wire while the decoder still holds ready (at ${at} ms)`);
  for (const i of indices) await fake.pushFrame(i, payload(i));
  hold.release();
  const c = await connect.catch(() => null);
  const all = await until(() => early.length >= indices.length, 5000);
  check(all, `fill at start: every frame of it arrives (${early.length}/${indices.length})`);
  c?.close();

  const late: Frame[] = [];
  const { c: c2, fake: fake2 } = await open(DownloaderClient, { onFrame: (f) => late.push(f) });
  c2.fill(indices);
  for (const i of indices) await fake2.pushFrame(i, payload(i));
  await until(() => late.length >= indices.length, 5000);

  const asStart = new Map(early.map((f) => [f.frameIndex, f.bytes]));
  const asFill = new Map(late.map((f) => [f.frameIndex, f.bytes]));
  check(asStart.size === early.length && asStart.size === indices.length, `fill at start: each frame exactly once (${asStart.size} of ${early.length})`);
  check(indices.every((i) => same(asStart.get(i), asFill.get(i))), `fill at start: byte-identical to the same fill asked after started`);
  c2.close();

  // Decoders ready at once and nothing pushed: `start` must not re-issue what `connect` just sent.
  const { c: c3, fake: fake3 } = await open(DownloaderClient, { fill: indices });
  const runs = wireOf((await fake3.controlMessages()) as Wire[]).filter((w) => w.startsWith("stream_frames"));
  check(runs.length === 1, `fill at start: it goes to the wire as one run (${runs.join(", ") || "none"})`);
  c3.close();
}

/**
 * The race the wire-ahead-of-the-decoders change opens: frames that land before any decoder
 * exists are held for one, not handed to a decoder that cannot take them. `pump()`'s guard. Each
 * carries when its decoder answered `ready`: no sooner than the stand-in let it, and before dispatch.
 */
async function framesBeforeAnyDecoderAreHeld(DownloaderClient: DownloaderCtor, check: Check) {
  const indices = [...Array(12).keys()];
  const held: Frame[] = [];
  const { connect, fake, hold } = begin(DownloaderClient, {
    decoders: 3,
    hold: "ready",
    fill: indices,
    onFrame: (f) => held.push(f),
  });
  await firstSeenMs(fake, "stream_frames 0-11");
  for (const i of indices) await fake.pushFrame(i, enc.encode(`held-${i}`));
  check(hold.ready() === 0, `held: all ${indices.length} frames land before any decoder is ready (${hold.ready()} ready)`);
  await until(() => hold.holding() >= 3);
  const releasedAt = performance.timeOrigin + performance.now();
  hold.release();

  const c = await connect.catch(() => null);
  const all = await until(() => held.length >= indices.length, 5000);
  check(all, `held: every frame that arrived before a decoder existed is delivered (${held.length}/${indices.length})`);
  check(held.every((f) => (f.info.decodeSeq ?? 0) > 0), `held: each of them went through a decoder`);
  check(new Set(held.map((f) => f.frameIndex)).size === indices.length, `held: each of them exactly once`);
  const late = held.map((f) => (f.info.stamps?.decoderReady ?? 0) - releasedAt);
  check(late.every((ms) => ms >= 0),
    `ready stamp: each frame carries its decoder's, taken after the release (${Math.min(...late).toFixed(1)} ms at the least)`);
  check(held.every((f) => (f.info.stamps?.decoderReady ?? Infinity) <= (f.info.stamps?.dispatched ?? 0)),
    `ready stamp: and never after the frame was dispatched to that decoder`);
  c?.close();
}

/**
 * `start` carrying a fill with an `ask` posted straight behind it — the pair the consumer cannot
 * make, since `connect` resolves on `started` — shares one handshake instead of racing into two.
 */
async function startWithAFillDialsOnce(_DownloaderClient: DownloaderCtor, check: Check) {
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

/**
 * R3: only the dial needs the session URL, so the worker graph comes up while it is still being
 * fetched: a decoder answers `ready` while the URL is withheld, and the first frame is decoded
 * once it is given. lab/page-open/README.md
 */
async function theDecodersComeUpWhileTheUrlIsUnknown(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  let giveUrl!: (url: string) => void;
  const { connect, fake, hold } = begin(DownloaderClient, {
    url: new Promise<string>((r) => (giveUrl = r)),
    fill: [0],
    onFrame: (f) => got.push(f),
  });
  const ready = await until(() => hold.ready() >= 1, 5000);
  check(ready, "un-gated: the decoder is ready while the session URL is still withheld");
  giveUrl("https://conformance.invalid/");
  const c = await connect;
  await fake.pushFrame(0, enc.encode("first"));
  check(await until(() => got.length > 0, 5000), "un-gated: and the first frame is decoded once the URL is given");
  c.close();
}

/**
 * R1: the fill the consumer opens with rides the session URL, so the server serves it behind its
 * accept, and the control stream is never asked for it a second time. On unless turned off, as
 * the server's `--open-ask` is. docs/ARCHITECTURE.md
 */
async function anOpeningFillRidesTheSessionUrl(DownloaderClient: DownloaderCtor, check: Check) {
  const indices = [0, 1, 2, 3];
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, fill: indices, openAsk: "default", onFrame: (f) => got.push(f),
  });
  const url = await fake.dialUrl();
  check(url.endsWith("?ask=fill:0-3"), `open ask: the session URL carries the fill (${url})`);
  const runs = wireOf((await fake.controlMessages()) as Wire[]).filter((w) => w.startsWith("stream_frames"));
  check(runs.length === 0, `open ask: and the wire is not asked for it again (${runs.join(", ") || "clean"})`);
  for (const i of indices) await fake.pushFrame(i, enc.encode(`open-${i}`));
  check(await until(() => got.length >= indices.length), `open ask: every frame of it is delivered (${got.length}/${indices.length})`);
  c.close();

  const { c: c2, fake: fake2 } = await open(DownloaderClient, {
    decode: false, fill: indices, openAsk: false,
  });
  const plain = await fake2.dialUrl();
  check(!plain.includes("ask="), `open ask: turned off, the session URL carries nothing (${plain})`);
  c2.close();
}

/**
 * A refused opening fill reaches the consumer: the run armed at the dial carries the same error
 * callback as one asked on the wire, so the refusal is not lost for want of a waiter.
 */
async function aRefusedOpeningFillReachesTheConsumer(DownloaderClient: DownloaderCtor, check: Check) {
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, fill: [0, 1, 2, 3], openAsk: true, onError: (f) => failures.push(f),
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
async function aWarmUpChangesNothingOnTheWire(DownloaderClient: DownloaderCtor, check: Check) {
  const indices = [0, 1, 2, 3, 4, 5, 6, 7];
  const payload = (i: number) => enc.encode(`frame-${i}-${"ab".repeat(i + 1)}`);
  const run = async (warmup?: string) => {
    const got: Frame[] = [];
    const { connect, fake } = begin(DownloaderClient, {
      decoders: 3, fill: indices, warmup, onFrame: (f) => got.push(f),
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
async function aTruncatedFrameIsAFailureNotAFrame(DownloaderClient: DownloaderCtor, check: Check) {
  const frames: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, onFrame: (f) => frames.push(f), onError: (f) => failures.push(f),
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

/** The vendored decoder, or null with a SKIPPED line naming `what` and how to fetch it. */
async function vendorDecoder(log: Log, what: string): Promise<RealDecoder | null> {
  const dir = "/lab/decode-bench/vendor/openjph";
  if (await fetch(`${dir}/openjphjs.js`, { method: "HEAD" }).then((r) => r.ok, () => false)) {
    return { glue: `${dir}/openjphjs.js`, wasm: `${dir}/openjphjs.wasm`, dir };
  }
  log(`  SKIPPED: ${what} — no ${dir} (bash lab/decode-bench/fetch_decoder.sh)`);
  return null;
}

/**
 * Only the decoder knows a codestream did not decode. An empty one and a file that is not one
 * reach the consumer as failures, each named and in the current generation, while a real frame
 * beside them arrives whole — one decoder object is reused, so without the check they would each
 * arrive as a frame carrying the previous frame's pixels. docs/decode/README.md §A frame that did not decode
 */
async function anUndecodableFrameIsAFailureNotAFrame(DownloaderClient: DownloaderCtor, check: Check, log: Log) {
  const realDecoder = await vendorDecoder(log, "an undecodable frame");
  if (!realDecoder) return;
  const bytesOf = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const good = await bytesOf("/client/downloader/warmup/colour-8.j2c");
  const wrong = await bytesOf("/client/downloader/README.md");

  const frames: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    realDecoder, onFrame: (f) => frames.push(f), onError: (f) => failures.push(f),
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
async function aFrameCarriesItsWireBytes(DownloaderClient: DownloaderCtor, check: Check, log: Log) {
  const payload = enc.encode("frame-zero-and-then-some-more");
  const undecoded: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, onFrame: (f) => undecoded.push(f),
  });
  c.fill([0]);
  await fake.pushFrame(0, payload);
  await until(() => undecoded.length >= 1);
  const raw = undecoded[0];
  check(raw?.info.wireBytes === payload.length, `wire bytes: undecoded, the length the envelope declared (${raw?.info.wireBytes ?? "none"} of ${payload.length})`);
  c.close();

  const realDecoder = await vendorDecoder(log, "wire bytes behind a decoder");
  if (!realDecoder) return;
  const codestream = new Uint8Array(await (await fetch("/client/downloader/warmup/colour-8.j2c")).arrayBuffer());

  const decoded: Frame[] = [];
  const { c: c2, fake: fake2 } = await open(DownloaderClient, {
    realDecoder, onFrame: (f) => decoded.push(f),
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
async function aFrameCarriesItsDecodersRangeOrItsOwn(DownloaderClient: DownloaderCtor, check: Check, log: Log) {
  const vendor = await vendorDecoder(log, "a frame's range");
  if (!vendor) return;
  const bytesOf = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const grey = await bytesOf("/client/downloader/warmup/grey-16.j2c");
  const colour = await bytesOf("/client/downloader/warmup/colour-8.j2c");
  const rangeOf = async (glue: string, codestream: Uint8Array) => {
    const got: Frame[] = [];
    const { c, fake } = await open(DownloaderClient, {
        realDecoder: { ...vendor, glue },
      onFrame: (f) => got.push(f),
    });
    c.fill([0]);
    await fake.pushFrame(0, codestream);
    await until(() => got.length >= 1);
    c.close();
    return got[0];
  };
  const pkg = vendor.glue;
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

/** Short enough that a clause can watch a whole death and resumption without a long wait. */
const QUICK = { stallMs: 120, redialMs: 60, tries: 3 };

async function stalledFill(DownloaderClient: DownloaderCtor, extra: Partial<OpenOpts> = {}) {
  const got: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: QUICK,
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
async function aSessionWhoseBytesKeepComingIsKept(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: QUICK, onFrame: (f) => got.push(f),
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
async function aSilentSessionIsRedialled(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake, got, failures } = await stalledFill(DownloaderClient);

  const redialled = await until(async () => (await fake.dials()) >= 2);
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
async function theWaitDoublesAfterEachRedialItCauses(DownloaderClient: DownloaderCtor, check: Check) {
  const stallMs = 200;
  const { c, fake } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs } });
  const third = await until(async () => (await fake.dials()) >= 3);
  // On the worker's clock: a timer never fires early, and the page's polling adds nothing.
  const at = await fake.dialledAt();
  const gap = Math.round(at[2] - at[1]);
  check(third && gap >= 2 * stallMs, `survival: the second silence is judged against twice stallMs (third dial ${gap} ms after the second, stallMs ${stallMs})`);
  c.close();
}

/** A session the API itself calls closed needs no silence to prove it. The fill is resumed rather than failed:
 *  naming what was owed is what happens when resumption runs out, not what happens first. */
async function aDeadSessionIsResumedNotReported(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake, got, failures } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs: 30_000 } });
  await fake.serverClose(0, "the server went away");

  const redialled = await until(async () => (await fake.dials()) >= 2);
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
async function anOwedAskIsReaskedAfterAResume(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs: 30_000 } });
  const asked = c.requestExactFrame(50);
  await settle();
  await fake.serverClose(0, "the server went away");

  const redialled = await until(async () => (await fake.dials()) >= 2);
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

/** Once the re-dials run out, every frame the fill still owed is named, each once, and the frames that did
 *  arrive are not among them. */
async function whenTheRedialsRunOutWhatWasOwedIsNamed(DownloaderClient: DownloaderCtor, check: Check) {
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

/** A server that accepts every dial and never sends spends the re-dials too: `tries` counts them since
 *  a frame last arrived, across resumptions, and then what was owed is named rather than re-dialled for ever. */
async function aSessionThatNeverDeliversSpendsTheRedials(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake, failures } = await stalledFill(DownloaderClient);
  const named = await until(() => failures.length >= 4, 4000);
  const dials = await fake.dials();
  check(named, `survival: sessions that never deliver end in the owed frames named (${failures.length} named, ${dials} dials)`);
  check(dials === 1 + QUICK.tries, `survival: after ${QUICK.tries} re-dials since the last frame (${dials} dials)`);
  c.close();
}

/** A frame that arrives gives the re-dials back: a session that dies more than `tries` times, delivering
 *  between deaths, is resumed every time. */
async function aFrameBetweenDeathsGivesTheRedialsBack(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake, got, failures } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs: 30_000 } });
  const deaths = QUICK.tries + 1;
  for (let k = 0; k < deaths; k++) {
    await fake.serverClose(0, "the server went away");
    if (!(await until(async () => (await fake.dials()) >= k + 2))) break;
    await fake.pushFrame(2 + k, enc.encode(`fill-${2 + k}`));
    await until(() => got.length >= 3 + k);
  }
  check(got.length === 2 + deaths && failures.length === 0,
    `survival: ${deaths} deaths with a frame after each are each resumed (${got.length} delivered, ${failures.length} failed)`);
  c.close();
}

/**
 * A session near its byte budget is replaced before it stalls: past three quarters the next is
 * dialled, the remainder asked on it and nothing that arrived, and the old one closed.
 * docs/ARCHITECTURE.md §Recycling before the stall
 */
async function aSessionNearItsBudgetIsReplaced(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: { ...QUICK, stallMs: 30_000 },
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
  const replaced = await until(async () => (await fake.dials()) >= 2 && (await fake.controlMessages()).length > 0);
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
async function aDialThatNeverSettlesIsDialledAgain(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: { ...QUICK, dialMs: 150 }, hangDials: 1,
  });
  check((await fake.dials()) === 2, `dial: a dial that never settles is dialled again (${await fake.dials()} dials)`);
  check(await fake.replacedClosed(), "dial: and the one it abandoned is closed, not left open");
  c.close();
}

/** Once every try has hung, the client says so rather than waiting for ever. */
async function aDialThatNeverSettlesAtAllIsNamed(DownloaderClient: DownloaderCtor, check: Check) {
  const dialMs = 100;
  const { connect } = begin(DownloaderClient, {
    decode: false, survival: { ...QUICK, dialMs }, hangDials: QUICK.tries,
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
async function aClosedClientEndsEveryWorkerItStarted(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, { decoders: 2 });
  await until(async () => (await fake.alive()).decoder === 2);
  const before = await fake.alive();
  check(before.downloader === 1 && before.decoder === 2, `close: the ping reaches every worker the client started (${JSON.stringify(before)})`);
  c.close();
  const after = await until(async () => {
    const a = await fake.alive();
    return a.downloader + a.decoder === 0;
  }, 1500);
  check(after, `close: and none of them is left running once it answers (${JSON.stringify(await fake.alive())})`);
}

/**
 * A downloader wedged in a long task never answers `close`. The client ends it at the deadline,
 * its decoders with it, and an ask still outstanding is named rather than left to its timeout.
 */
async function aDownloaderThatNeverAnswersIsEndedAnyway(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, { decoders: 2 });
  await until(async () => (await fake.alive()).decoder === 2);
  const asked = c.requestExactFrame(7).then(() => "delivered", (e: Error) => e.message);
  await settle();
  await fake.block(8000);
  const t0 = performance.now();
  c.close();
  const reason = await Promise.race([asked, settle(6000).then(() => "still waiting")]);
  const ms = Math.round(performance.now() - t0);
  // Generous under load: the claim is "at the deadline, not at FRAME_TIMEOUT_MS", and 15 s still fails it.
  check(/closed by the consumer/.test(reason) && ms < 5000, `close: an ask outstanding on a wedged downloader is named at the deadline (${reason}, ${ms} ms)`);
  // Chromium ends a worker busy in script 2 s after `terminate()`; the block outlasts both.
  const gone = await until(async () => {
    const a = await fake.alive();
    return a.downloader + a.decoder === 0;
  }, 4000);
  check(gone, `close: and the wedged downloader and its decoders are ended (${JSON.stringify(await fake.alive())})`);
}

/**
 * A command that cannot re-dial a closed session fails by name, in its own generation: the ask
 * rejects its own promise, and a fill names every frame it asked for.
 */
async function aFailedRedialNamesWhatItWasAskedFor(DownloaderClient: DownloaderCtor, check: Check) {
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: false, onError: (f) => failures.push(f),
  });
  await fake.serverClose(0, "the server went away");
  await settle();
  await fake.failDials(5);
  const asked = c.requestExactFrame(7).then(() => "delivered", (e: Error) => e.message);
  const reason = await Promise.race([asked, settle(3000).then(() => "still pending at 3 s")]);
  check(/dial refused/.test(reason), `failed re-dial: the ask rejects with the dial's reason (${reason})`);
  c.fill([1, 2, 3]);
  await until(() => failures.length >= 3);
  const named = failures.map((f) => f.frameIndex).sort((a, b) => a - b).join();
  check(named === "1,2,3", `failed re-dial: the fill names every frame it asked for (${named || "none"})`);
  c.close();
}

/**
 * `cancel` resolves on a session that can no longer end its stream, and the one after it resolves
 * its own promise: the page matches each `cancelled` to the oldest cancel still waiting.
 */
async function aCancelOnADeadSessionResolves(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: false,
  });
  await fake.serverClose(0, "the server went away");
  await fake.failWrites();
  check(await cancelled(c, 1000), "cancel: a cancel on a dead session resolves");
  check(await cancelled(c, 1000), "cancel: and the next cancel resolves its own promise");
  c.close();
}

/** A cancel still unanswered when the client ends resolves with it, rather than never. */
async function aCancelOnAnEndedClientResolves(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, {
    decode: false,
  });
  await fake.block(3000);
  const done = cancelled(c, 3000);
  c.close();
  check(await done, "cancel: a cancel the wedged downloader never answers resolves when the client ends it");
}

/**
 * A cancel that lands while an ask or a fill waits on a re-dial drops them: neither reaches the
 * new session, and no frame of the cancelled request reaches the consumer.
 */
async function aCancelDuringARedialDropsWhatWasAsked(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: false, onFrame: (f) => got.push(f),
  });
  await fake.serverClose(0, "the server went away");
  await settle();
  await fake.openAfterMs(300);
  c.requestExactFrame(7).catch(() => {});
  c.fill([8]);
  await settle();
  await cancelled(c);
  const redialled = await until(async () => (await fake.dials()) >= 2);
  check(redialled, `cancel during a re-dial: the re-dial still happens (${await fake.dials()} dials)`);
  await settle(400);
  for (const i of [7, 8]) await fake.pushFrame(i, enc.encode(`late-${i}`));
  await settle(100);
  const wire = wireOf((await fake.controlMessages()) as Wire[]);
  check(!wire.includes("request_frame 7"), `cancel during a re-dial: the cancelled ask is not asked (${wire.join(", ") || "nothing"})`);
  check(!wire.some((w) => w.startsWith("stream_frames")), `cancel during a re-dial: nor the cancelled fill (${wire.join(", ") || "nothing"})`);
  check(got.length === 0, `cancel during a re-dial: no frame of it reaches the consumer (${got.map((f) => f.frameIndex).join() || "none"})`);
  c.close();
}

/** An ask after `close()` rejects at once, without waiting on a downloader that may never answer. */
async function anAskAfterCloseRejectsAtOnce(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, {
    decode: false,
  });
  await fake.block(3000);
  c.close();
  const asked = c.requestExactFrame(7).then(() => "delivered", (e: Error) => e.message);
  const reason = await Promise.race([asked, settle(200).then(() => "still pending")]);
  check(/closed by the consumer/.test(reason), `close: an ask after it rejects at once (${reason})`);
}

/**
 * A decoder whose init fails after `started` leaves the pool: every frame goes to the decoder
 * that did come up, and none is lost to the one that did not.
 */
async function aDecoderThatFailsItsInitLeavesThePool(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake, hold } = await open(DownloaderClient, {
    decoders: 2, delayMs: 20, failOneInit: true,
    onFrame: (f) => got.push(f), onError: (f) => failures.push(f),
  });
  const indices = [0, 1, 2, 3, 4, 5];
  c.fill(indices);
  for (const i of indices) await fake.pushFrame(i, enc.encode(`frame-${i}`));
  await until(() => hold.holding() >= 1);
  hold.release();
  await until(() => got.length + failures.length >= indices.length, 5000);
  check(got.length === indices.length, `decoder init: every frame decodes on the decoder that came up (${got.length}/${indices.length})`);
  check(failures.length === 0, `decoder init: none is lost to the one that failed (${failures.map((f) => f.reason).join("; ") || "none"})`);
  c.close();
}

/** With no decoder left, a frame waiting for one is named with the reason the last init failed. */
async function framesWithNoDecoderLeftAreNamed(DownloaderClient: DownloaderCtor, check: Check) {
  const failures: Fail[] = [];
  const { c, fake, hold } = await open(DownloaderClient, {
    failOneInit: true, onError: (f) => failures.push(f),
  });
  c.fill([0, 1]);
  for (const i of [0, 1]) await fake.pushFrame(i, enc.encode(`frame-${i}`));
  await until(() => hold.holding() >= 1);
  hold.release();
  await until(() => failures.length >= 2, 3000);
  const named = failures.map((f) => f.frameIndex).sort((a, b) => a - b).join();
  check(named === "0,1", `decoder init: with none left, both frames are named (${named || "none"})`);
  check(failures.every((f) => /failed its init/.test(f.reason)), `decoder init: with the init's reason (${failures[0]?.reason ?? "none"})`);
  c.close();
}

/** An option that cannot cross to the worker fails `connect` by name; drive_page.cjs counts the worker it must not leave. */
async function anOptionThatCannotBeClonedFailsConnect(DownloaderClient: DownloaderCtor, check: Check) {
  const outcome = await DownloaderClient.connect("https://conformance.invalid/", CERT, {
    decode: false, decoders: 0, transport: "/client/conformance/dist/fake-session.js", notCloneable: () => {},
  }).then((c) => (c.close(), "started"), (e: Error) => e.name);
  check(outcome === "DataCloneError", `connect: an option that cannot be cloned fails it (${outcome})`);
}

export async function run(DownloaderClient: DownloaderCtor, log: Log): Promise<void> {
  addEventListener("unhandledrejection", (e) => e.preventDefault());
  const clauses: Clause[] = [
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
    aSessionWhoseBytesKeepComingIsKept,
    aSilentSessionIsRedialled,
    theWaitDoublesAfterEachRedialItCauses,
    aDeadSessionIsResumedNotReported,
    anOwedAskIsReaskedAfterAResume,
    whenTheRedialsRunOutWhatWasOwedIsNamed,
    aSessionThatNeverDeliversSpendsTheRedials,
    aFrameBetweenDeathsGivesTheRedialsBack,
    aSessionNearItsBudgetIsReplaced,
    aDialThatNeverSettlesIsDialledAgain,
    aDialThatNeverSettlesAtAllIsNamed,
    aClosedClientEndsEveryWorkerItStarted,
    aDownloaderThatNeverAnswersIsEndedAnyway,
    aFailedRedialNamesWhatItWasAskedFor,
    aCancelOnADeadSessionResolves,
    aCancelOnAnEndedClientResolves,
    aCancelDuringARedialDropsWhatWasAsked,
    anAskAfterCloseRejectsAtOnce,
    aDecoderThatFailsItsInitLeavesThePool,
    framesWithNoDecoderLeftAreNamed,
    anOptionThatCannotBeClonedFailsConnect,
  ];
  await tally(log, "dispatch", "dispatch", async (check) => {
    for (const clause of clauses) {
      try {
        await clause(DownloaderClient, check, log);
      } catch (e) {
        check(false, `${clause.name} threw: ${(e as Error)?.message ?? e}`);
      }
    }
  });
}
