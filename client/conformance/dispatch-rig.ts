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

type Frame = { frameIndex: number; generation: number; bytes: Uint8Array; info: { width?: number; height?: number; bits?: number; components?: number; signed?: boolean; preview?: boolean; decodeSeq?: number; maxInFlight?: number; byteCount?: number; wireBytes?: number; min?: number; max?: number; stamps?: { decodeStart?: number; decodeEnd?: number; decoder?: number } } };
type Fail = { frameIndex: number; reason: string; generation: number };
type Downloader = {
  requestExactFrame(index: number): Promise<Frame>;
  fill(indices: number[]): void;
  cancel(): Promise<void>;
  close(): void;
  stats(): { resumedAt: number[]; recycledAt: number[] };
};
type DownloaderCtor = {
  connect(url: string, certHash: string, opts: Record<string, unknown>): Promise<Downloader>;
};
type Wire = { op: string; from?: number; to?: number; frame?: number };
type Log = (line: string) => void;
type Clause = (DownloaderClient: DownloaderCtor, check: Check, log: Log) => Promise<void>;
type RealDecoder = { glue: string; wasm: string; dir: string; codec?: string; depth?: number; split?: number; offset?: number; rct?: boolean };

let world = 0;

/** Unset: one decoder, two outstanding on it, no decode delay, frames dropped. */
type OpenOpts = {
  decoders?: number;
  perDecoder?: number;
  delayMs?: number;
  onFrame?: (f: Frame) => void;
  onPreview?: (f: Frame) => void;
  onError?: (f: Fail) => void;
  decode?: boolean;
  fill?: number[];
  /** The stand-ins wait for `hold.release()` before each decode, or before `ready`. */
  hold?: "decode" | "ready";
  /** `"default"` leaves it unset; the other clauses ask on the control stream. */
  openAsk?: boolean | "default";
  url?: Promise<string>;
  /** The real decoder in place of the stand-in, with the glue and wasm it loads. */
  realDecoder?: RealDecoder;
  /** A worker that wraps the real decoder, in place of decoder.js itself. */
  decoderWorker?: string;
  groupLength?: number;
  frameCount?: number;
  survival?: false | { stallMs?: number; redialMs?: number; tries?: number; dialMs?: number };
  hangDials?: number;
  /** The first `n` dials are refused. */
  refuseDials?: number;
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
    transport: `/client/conformance/dist/fake-session.js?ch=${ch}&hang=${opts.hangDials ?? 0}&refuse=${opts.refuseDials ?? 0}`,
    decoderWorker: opts.decoderWorker ?? (opts.realDecoder ? undefined : `/client/conformance/fake-decoder.js?ch=${ch}`),
    decoder: opts.realDecoder ?? {
      delayMs: opts.delayMs ?? 0,
      hold: opts.hold,
      failOneInit: opts.failOneInit && { ticket: new Int32Array(new SharedArrayBuffer(4)) },
    },
    groupLength: opts.groupLength,
    frameCount: opts.frameCount,
    survival: opts.survival,
    recycleAtBytes: opts.recycleAtBytes,
    onFrame: opts.onFrame ?? (() => {}),
    onPreview: opts.onPreview,
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

/** A refusal that fails the rest of a run spares a frame of that run an ask is carrying: the ask settles
 *  it on its own promise, not with the refused frame's reason. */
async function aRefusalInTheRunSparesTheFrameAnAskCarries(DownloaderClient: DownloaderCtor, check: Check) {
  const captured: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, onFrame: (f) => captured.push(f), onError: (f) => failures.push(f),
  });
  c.fill([0, 1, 2, 3, 4, 5]);
  await settle();
  for (const i of [0, 1, 2]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => captured.length >= 3);

  let asked = -1;
  let rejected = "";
  c.requestExactFrame(3).then((f) => { asked = f.frameIndex; }, (e: Error) => { rejected = String(e.message); });
  await onTheWire(fake, "request_frame 3");
  await fake.pushFrame(4, enc.encode("fill-4"));
  await until(() => captured.length >= 4);
  await fake.pushRefusal(5, "refused-5");
  await until(() => failures.length >= 1);
  await fake.pushFrame(3, enc.encode("ask-3"));
  await until(() => asked >= 0 || rejected !== "");

  const named = failures.map((f) => f.frameIndex).join();
  check(named === "5", `refusal in a run: the refused frame reaches the error callback (${named || "none"})`);
  check(rejected === "", `refusal in a run: the frame an ask carries is not failed with it (${rejected || "not failed"})`);
  check(asked === 3, `refusal in a run: it is served on the ask's own promise (${asked})`);
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
 * exists are held for one, not handed to a decoder that cannot take them. `pump()`'s guard.
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
  hold.release();

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
  const good = await bytesOf("/client/conformance/frames/colour-8.j2c");
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
  const codestream = new Uint8Array(await (await fetch("/client/conformance/frames/colour-8.j2c")).arrayBuffer());

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
  const grey = await bytesOf("/client/conformance/frames/grey-16.j2c");
  const colour = await bytesOf("/client/conformance/frames/colour-8.j2c");
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

const AV1_DIR = "/lab/.av1-build/out";
const AV1 = { codec: "av1", glue: `${AV1_DIR}/simd.js`, wasm: `${AV1_DIR}/simd.wasm`, dir: AV1_DIR };
const AV1_SET = "/client/conformance/av1";
const ITEMS = `${AV1_SET}/items`;
const served = (url: string) => fetch(url, { method: "HEAD" }).then((r) => r.ok, () => false);
const fetched = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const sha256 = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)))].map((x) => x.toString(16).padStart(2, "0")).join("");
const webcodecsArms = () => (typeof VideoDecoder === "function" ? (["spy", "none"] as const) : (["none"] as const));

/** A bare unit as an item of one frame, with the header the writer gives a stream of `depth` bits: the older fixtures. */
function asItem(frame: Uint8Array, depth: number) {
  const out = new Uint8Array(20 + frame.length);
  const v = new DataView(out.buffer);
  out.set([1, depth, depth]);
  v.setUint32(12, 1, true);
  v.setUint32(16, frame.length, true);
  out.set(frame, 20);
  return out;
}

/** The writer's golden items: each a depth or a layout docs/av1/item-format.md treats apart, plain and optimized. */
const GOLDEN = ["g8", "g9", "g10", "g12", "s11", "s13", "g14", "c8"] as const;
const GOLDEN_SHAPE: Record<string, string> = {
  g8: "1x8-bit", g9: "1x9-bit", g10: "1x10-bit", g12: "1x12-bit", s11: "1x11-bit signed", s13: "1x13-bit signed", g14: "1x14-bit", c8: "3x8-bit",
};
const golden = (rep: string, name: string) => `${ITEMS}/${rep}/${name}`;
/** Row 43's items: b = 8…16 bits, every split k from the smallest whose top fits 12 bits to a top of 8, unsigned and signed. */
const MATRIX = Array.from({ length: 9 }, (_, i) => i + 8).flatMap((b) =>
  Array.from({ length: Math.max(b - 8, 4) - Math.max(0, b - 12) + 1 }, (_, j) => Math.max(0, b - 12) + j)
    .flatMap((k) => (["u", "s"] as const).map((sign) => [b, k, sign] as const)));

/** The item's stream units' lengths: what a WebCodecs spy saw of it, if it saw it. */
function unitLengths(item: Uint8Array) {
  const v = new DataView(item.buffer, item.byteOffset);
  const len = v.getUint32(16, true);
  if (!item[3]) return [len];
  const top = v.getUint32(20, true);
  return [top, len - 4 - top];
}

/** Items through the real decoder behind the spy worker, and the length of every unit a VideoDecoder was handed. */
async function av1Through(
  DownloaderClient: DownloaderCtor,
  items: readonly (string | Uint8Array)[],
  mode: "spy" | "none" | "fail" | "stale",
  group: Partial<OpenOpts> = {},
) {
  const ch = `wtpacs-webcodecs-${++world}`;
  const units: number[] = [];
  const codecs: string[] = [];
  const spy = new BroadcastChannel(ch);
  spy.onmessage = (e) => void (typeof e.data === "string" ? codecs.push(e.data) : units.push(e.data));
  const got: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decoders: 1, perDecoder: 2, delayMs: 0, realDecoder: AV1,
    decoderWorker: `/client/conformance/webcodecs-spy.js?mode=${mode}&ch=${ch}`,
    onFrame: (f) => got.push(f), onError: (f) => failures.push(f), ...group,
  });
  c.fill(items.map((_, i) => i));
  const frames = await Promise.all(items.map((n) => (typeof n === "string" ? fetched(n) : n)));
  // All at once, so a decoder holds `perDecoder` of them together.
  await Promise.all(frames.map((b, i) => fake.pushFrame(i, b)));
  await until(() => got.length + failures.length >= items.length, 8000);
  c.close();
  await settle(50);
  spy.close();
  return { got, failures, units, codecs, frames };
}

/** Each frame hashes to its source's checksum at `base`.sha256 and says the shape `want` names. */
async function exactAv1(check: Check, what: string, got: Frame[], bases: readonly string[], want: (i: number) => string) {
  for (const [i, base] of bases.entries()) {
    const f = got.find((g) => g.frameIndex === i);
    const sum = (await (await fetch(`${base}.sha256`)).text()).trim();
    const have = f ? await sha256(f.bytes) : "no frame";
    const shape = `${f?.info.width}x${f?.info.height} ${f?.info.components}x${f?.info.bits}-bit${f?.info.signed ? " signed" : ""}`;
    const name = base.split("/").slice(-2).join(" ");
    check(have === sum && shape === want(i), `${what}: ${name} decodes to its source's samples as ${shape} (${have.slice(0, 12)}, source ${sum.slice(0, 12)})`);
    const range = f ? rangeOf(f) : "no frame";
    check(range === `${f?.info.min}..${f?.info.max}`, `${what}: ${name} carries its samples' range (${f?.info.min}..${f?.info.max}, samples ${range})`);
  }
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

/**
 * Every golden item from the writer, plain and optimized, decodes through the downloader to the
 * samples its source's checksum was written from, through WebCodecs where it takes them and through
 * dav1d-WASM in a browser without it — and the notices the build owes are served beside it.
 * docs/av1/item-format.md
 */
async function anAv1ItemDecodesToItsSource(DownloaderClient: DownloaderCtor, check: Check, log: Log) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  for (const mode of webcodecsArms()) {
    for (const rep of ["plain", "optimized"]) {
      const bases = GOLDEN.map((n) => golden(rep, n));
      const r = await av1Through(DownloaderClient, bases.map((b) => `${b}.av1`), mode);
      await exactAv1(check, `av1 ${mode === "spy" ? "webcodecs" : "dav1d"}`, r.got, bases, (i) => `64x48 ${GOLDEN_SHAPE[GOLDEN[i]]}`);
    }
    const bases = MATRIX.map(([b, k, sign]) => `${ITEMS}/matrix/b${b}k${k}${sign}`);
    const r = await av1Through(DownloaderClient, bases.map((b) => `${b}.av1`), mode);
    await exactAv1(check, `av1 matrix ${mode === "spy" ? "webcodecs" : "dav1d"}`, r.got, bases,
      (i) => `32x24 1x${MATRIX[i][0]}-bit${MATRIX[i][2] === "s" ? " signed" : ""}`);
  }
  const notices = await fetch(`${AV1_DIR}/THIRD_PARTY.txt`).then((r) => (r.ok ? r.text() : ""), () => "");
  check(notices.includes("VideoLAN and dav1d authors") && notices.includes("Alliance for Open Media Patent License 1.0"),
    "av1: the decoder's notices and the AOM patent licence are served beside it");
}

/**
 * The decoder is chosen per item: an item whose streams are all ≤ 10 bits reaches WebCodecs, every
 * stream of it; one with a 12-bit stream never does; an item WebCodecs fails on is decoded by
 * dav1d-WASM, exactly; and a frame WebCodecs returns late, from an earlier unit, is never taken for
 * the unit in hand. docs/av1/item-format.md §Decoder choice, per item
 */
async function anAv1ItemTakesWebCodecsOnlyWhereItIsExact(DownloaderClient: DownloaderCtor, check: Check, log: Log) {
  if (typeof VideoDecoder !== "function") return void log("  SKIPPED: WebCodecs — this browser has no VideoDecoder");
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: WebCodecs — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const shallow = [...["g8", "g9", "g10", "c8"].map((n) => golden("plain", n)), ...["g8", "g9", "g10", "g12", "s11", "s13", "c8"].map((n) => golden("optimized", n))];
  const deep = [...["g12", "s11", "s13", "g14"].map((n) => golden("plain", n)), ...["g14"].map((n) => golden("optimized", n))];
  const shape = (bases: string[]) => (i: number) => `64x48 ${GOLDEN_SHAPE[bases[i].split("/").pop()!]}`;
  const wc = await av1Through(DownloaderClient, shallow.map((b) => `${b}.av1`), "spy");
  await exactAv1(check, "webcodecs", wc.got, shallow, shape(shallow));
  const missed = wc.frames.flatMap((f, i) => (unitLengths(f).every((n) => wc.units.includes(n)) ? [] : [i]));
  check(missed.length === 0, `webcodecs: every stream of every ≤ 10-bit item reached it (missed: ${missed.join() || "none"})`);
  const spans = wc.got.map((f) => f.info.stamps as { decodeStart: number; decodeEnd: number }).sort((a, b) => a.decodeStart - b.decodeStart);
  const overlaps = spans.filter((s, i) => i > 0 && s.decodeStart < spans[i - 1].decodeEnd).length;
  check(spans.length === shallow.length && overlaps === 0, `webcodecs: its decoder takes the items it holds one at a time (${overlaps} overlapping)`);
  const [item, probe] = ["/client/downloader/av1-item.js", "/client/downloader/av1-probe.js"];
  const { codecString, sequence, units: streams } = await import(item);
  const { PROBES } = await import(probe);
  const own = (u: Uint8Array) => codecString(sequence(u));
  const derived = new Set<string>(wc.frames.flatMap((f) => {
    const v = new DataView(f.buffer, f.byteOffset);
    return streams(f.subarray(20, 20 + v.getUint32(16, true)), f[3]).filter(Boolean).map(own);
  }));
  const probes = Object.values(PROBES as Record<string, { unit: string }>).map((p) => own(Uint8Array.from(atob(p.unit), (c) => c.charCodeAt(0))));
  const foreign = wc.codecs.filter((c) => !derived.has(c) && !probes.includes(c));
  check(foreign.length === 0 && [...derived].every((c) => wc.codecs.includes(c)),
    `webcodecs: configured with each stream's own codec string, ${[...derived].join(", ")} (others: ${foreign.join() || "none"})`);

  const d12 = await av1Through(DownloaderClient, deep.map((b) => `${b}.av1`), "spy");
  await exactAv1(check, "webcodecs, 12-bit", d12.got, deep, shape(deep));
  check(d12.units.length === 0, `webcodecs: an item with a 12-bit stream never reaches it (${d12.units.length} units)`);

  const failing = await av1Through(DownloaderClient, shallow.map((b) => `${b}.av1`), "fail");
  await exactAv1(check, "webcodecs failing", failing.got, shallow, shape(shallow));
  check(failing.units.length > 0, `webcodecs failing: it was handed the items, and dav1d decoded them (${failing.units.length} units)`);

  const stale = await av1Through(DownloaderClient, shallow.map((b) => `${b}.av1`), "stale");
  await exactAv1(check, "webcodecs, a late frame first", stale.got, shallow, shape(shallow));
}

/**
 * A malformed item reaches the consumer as a failure that names what is wrong with it, through
 * either decoder, and never as pixels: each case docs/av1/item-format.md lists. The decoder that
 * refused them decodes the next item exactly.
 */
async function aMalformedAv1ItemIsRefusedByName(DownloaderClient: DownloaderCtor, check: Check, log: Log) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 item refusals — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const g12 = await fetched(`${golden("optimized", "g12")}.av1`);
  const g10 = await fetched(`${golden("plain", "g10")}.av1`);
  const g8 = await fetched(`${golden("plain", "g8")}.av1`);
  const c8 = await fetched(`${golden("plain", "c8")}.av1`);
  const set = (b: Uint8Array, at: number, value: number) => {
    const out = Uint8Array.from(b);
    out[at] = value;
    return out;
  };
  const u32 = (b: Uint8Array, at: number, value: number) => {
    const out = Uint8Array.from(b);
    new DataView(out.buffer).setUint32(at, value, true);
    return out;
  };
  const cases: [Uint8Array, RegExp][] = [
    [set(g12, 0, 2), /version 2, not 1/],
    [set(g12, 4, 4), /unknown flag bits 0x4/],
    [set(g12, 3, 9), /split 9, over 8/],
    [set(g12, 1, 17), /bits 17, over 16/],
    [set(g12, 4, 2), /rct with split 2/],
    [u32(g12, 8, 5), /offset 5 without signed/],
    [set(g12, 1, 13), /bits 13 over depth 10 \+ split 2/],
    [set(set(g12, 1, 8), 3, 0), /depth 10 for a top of 8 bits, not 8/],
    [u32(g12, 12, 2), /2 frames, 1 expected/],
    [u32(g12, 16, 1e6), /frame 0 overruns the item/],
    [set(set(g8, 1, 10), 2, 10), /top stream 8-bit, header says 10/],
    [set(g10, 4, 2), /top stream of 1 planes under rct, not three/],
    [set(c8, 4, 1), /three planes without rct/],
  ];
  const good = `${golden("optimized", "g12")}`;
  for (const mode of webcodecsArms()) {
    const what = mode === "spy" ? "webcodecs" : "dav1d";
    const r = await av1Through(DownloaderClient, [...cases.map(([b]) => b), `${good}.av1`], mode);
    for (const [i, [, want]] of cases.entries()) {
      const why = r.failures.find((f) => f.frameIndex === i)?.reason ?? "no failure";
      check(want.test(why) && !r.got.some((f) => f.frameIndex === i), `${what}: refused by name, never pixels (${why})`);
    }
    const after = r.got.find((f) => f.frameIndex === cases.length);
    const sum = (await (await fetch(`${good}.sha256`)).text()).trim();
    check(after !== undefined && (await sha256(after.bytes)) === sum, `${what}: the next item after them is still exact`);
  }
}

/**
 * At G = 1 an item decodes alone or not at all: a frame of a group, an empty item and a file that is
 * not AV1 each reach the consumer as a failure, never as pixels decoded against the frame before.
 * docs/av1/adr-unit.md §2
 */
async function anAv1FrameThatCannotDecodeAloneIsAFailure(DownloaderClient: DownloaderCtor, check: Check, log: Log) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 refusals — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const frames: Frame[] = [];
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decoders: 1, perDecoder: 1, delayMs: 0, realDecoder: AV1,
    onFrame: (f) => frames.push(f), onError: (f) => failures.push(f),
  });
  c.fill([0, 1, 2, 3, 4]);
  await fake.pushFrame(0, asItem(await fetched(`${AV1_SET}/c8.av1`), 8));
  await fake.pushFrame(1, asItem(await fetched(`${AV1_SET}/inter.av1`), 8));
  await fake.pushFrame(2, new Uint8Array(0));
  await fake.pushFrame(3, await fetched("/client/downloader/README.md"));
  await fake.pushFrame(4, await fetched(`${golden("plain", "g12")}.av1`));
  await until(() => frames.length + failures.length >= 5, 5000);
  const refused = failures.map((f) => f.frameIndex).sort((a, b) => a - b).join() || "none";
  check(refused === "1,2,3", `av1: a frame of a group, an empty item and a non-AV1 file are refused (${refused})`);
  check(frames.map((f) => f.frameIndex).join() === "0,4", `av1: none of them arrives as a frame (${frames.map((f) => f.frameIndex).join() || "none"})`);
  const after = frames.find((f) => f.frameIndex === 4);
  const want = (await (await fetch(`${golden("plain", "g12")}.sha256`)).text()).trim();
  check(after !== undefined && (await sha256(after.bytes)) === want, "av1: the next frame after them is still exact");
  c.close();
}

/**
 * Through WebCodecs as through dav1d: a frame of a group, an empty frame, colour coded as YUV 4:2:0
 * or 4:4:4, a keyframe cut short and a unit that closes WebCodecs' decoder are each a failure, never
 * samples, and the decoder that refused them decodes the next item exactly.
 */
async function anAv1FrameEitherDecoderCannotReturnExactlyIsAFailure(DownloaderClient: DownloaderCtor, check: Check, log: Log) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 refusals by decoder — no ${AV1_DIR}`);
  const c8 = await fetched(`${AV1_SET}/c8.av1`);
  const bare = [c8, await fetched(`${AV1_SET}/inter.av1`), new Uint8Array(0), await fetched(`${AV1_SET}/yuv420.av1`),
    await fetched(`${AV1_SET}/yuv444.av1`), c8.subarray(0, c8.length >> 1), new Uint8Array(1)];
  const items: (string | Uint8Array)[] = [...bare.map((b) => asItem(b, 8)), `${golden("plain", "g10")}.av1`];
  const want = (await (await fetch(`${golden("plain", "g10")}.sha256`)).text()).trim();
  for (const mode of webcodecsArms()) {
    const what = mode === "spy" ? "webcodecs" : "dav1d";
    const r = await av1Through(DownloaderClient, items, mode);
    const refused = r.failures.map((f) => f.frameIndex).sort((a, b) => a - b).join() || "none";
    check(refused === "1,2,3,4,5,6", `${what}: a frame of a group, an empty frame, YUV colour, a cut keyframe and a decoder closed under it are refused (${refused})`);
    const after = r.got.find((f) => f.frameIndex === 7);
    check(after !== undefined && (await sha256(after.bytes)) === want, `${what}: the next item after them is still exact`);
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
    (c) => (c.close(), "connected"),
    (e) => String((e as Error)?.message ?? e),
  );
  check(refused === 'unknown codec "jxl"', `codec: an unknown one is refused by name (${refused})`);
  // The fake lives in the transport the downloader loads to dial; it answers only once loaded.
  const loaded = await fake.dials().then(() => true, () => false);
  check(!loaded, "codec: and no transport was loaded, so nothing was dialled");
}

const G8 = `${AV1_SET}/g8x20`;
/** The older fixtures' depth per set: each unit goes to the downloader as an item of one frame. */
const DEPTH: Record<string, number> = { g8x20: 8, whole12: 12, l2g1: 10, l2g8x20: 12 };
const unit = async (set: string, i: number) => asItem(await fetched(`${set}/${String(i).padStart(3, "0")}.av1`), DEPTH[set.split("/").pop()!]);
const source = async (set: string, i: number) => (await (await fetch(`${set}/${String(i).padStart(3, "0")}.sha256`)).text()).trim();
/** A promise that may never settle, settled anyway: a hung ask fails its check by name. */
const within = <T,>(p: Promise<T>, ms = 5000) => Promise.race([p, new Promise<undefined>((r) => setTimeout(r, ms))]);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

/** The frames of `want` that hash to their source, by index; anything else is named. */
async function inexact(set: string, frames: Frame[], want: number[]) {
  const bad: number[] = [];
  for (const i of want) {
    const f = frames.find((g) => g.frameIndex === i);
    if (!f || (await sha256(f.bytes)) !== (await source(set, i))) bad.push(i);
  }
  return bad.join() || "none";
}

/**
 * A G = 8 series and a series that is one group decode to their sources through the fill: every
 * frame of a group on the decoder that took its keyframe, in order. docs/av1/adr-unit.md §3
 */
async function aGroupDecodesOnOneDecoderInOrder(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 groups — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  for (const [set, g, n] of [[G8, 8, 20], [`${AV1_SET}/whole12`, 12, 12]] as const) {
    const got: Frame[] = [];
    const { c, fake } = await open(DownloaderClient, {
      decoders: 3, perDecoder: 2, delayMs: 0, realDecoder: AV1, groupLength: g, frameCount: n,
      onFrame: (f) => got.push(f),
    });
    c.fill(range(0, n - 1));
    for (const i of range(0, n - 1)) await fake.pushFrame(i, await unit(set, i));
    await until(() => got.length >= n, 5000);
    check((await inexact(set, got, range(0, n - 1))) === "none", `group: G = ${g}, ${n} frames, every frame its source's (inexact: ${await inexact(set, got, range(0, n - 1))})`);
    const split = range(0, n - 1).filter((i) => i % g && got.find((f) => f.frameIndex === i)?.info.stamps?.decoder !== got.find((f) => f.frameIndex === i - (i % g))?.info.stamps?.decoder);
    check(split.length === 0, `group: G = ${g}, every frame on its keyframe's decoder (elsewhere: ${split.join() || "none"})`);
    c.close();
  }
}

/**
 * A group decodes through WebCodecs as through dav1d-WASM: an 8-bit G = 8 series reaches WebCodecs
 * unit by unit, every frame its source's; a unit mid-group that gives neither a frame nor an error
 * fails by name, the rest of its group with it, and the next group is exact; a keyframe that is not
 * one is refused even by a decoder whose group was cut short. lab/av1/wclat
 */
async function aGroupDecodesThroughEitherDecoder(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 groups by decoder — no ${AV1_DIR}`);
  const bare = range(0, 19).map((i) => `${G8}/${String(i).padStart(3, "0")}.av1`);
  const names = await Promise.all(range(0, 19).map((i) => unit(G8, i)));
  const group = { groupLength: 8, frameCount: 20 };
  for (const mode of webcodecsArms()) {
    const what = mode === "spy" ? "webcodecs" : "dav1d";
    const r = await av1Through(DownloaderClient, names, mode, group);
    check((await inexact(G8, r.got, range(0, 19))) === "none" && r.failures.length === 0,
      `${what}: G = 8, every frame its source's (inexact: ${await inexact(G8, r.got, range(0, 19))})`);
    const reached = r.frames.filter((f) => r.units.includes(unitLengths(f)[0])).length;
    check(reached === (mode === "spy" ? 20 : 0), `${what}: a group's units reach WebCodecs only where it is there (${reached})`);
    // A temporal delimiter alone: a unit with no frame in it.
    const stalled = await av1Through(DownloaderClient, names.map((n, i) => (i === 3 ? asItem(new Uint8Array([0x12, 0]), 8) : n)), mode, group);
    const refused = stalled.failures.map((f) => f.frameIndex).sort((a, b) => a - b).join() || "none";
    check(refused === "3,4,5,6,7", `${what}: a unit mid-group with no frame fails, and its group's rest (${refused})`);
    check((await inexact(G8, stalled.got, range(8, 19))) === "none", `${what}: the next group is still exact (inexact: ${await inexact(G8, stalled.got, range(8, 19))})`);
    // Group 0 left at frame 4 still holds its references: frame 9's bytes sent as a keyframe must not decode against them.
    const module = `/client/downloader/${mode === "spy" ? "decode-av1-webcodecs.js" : "decode-av1.js"}`;
    const av1 = await import(module);
    await av1.init({ ...AV1, groupLength: 8 });
    for (const i of range(0, 4)) await av1.picture(await fetched(bare[i]), { key: i === 0, gen: 0, index: i });
    const nine = await fetched(bare[9]);
    const late = await Promise.resolve().then(() => av1.picture(nine, { key: true, gen: 0, index: 8 })).then(() => "decoded", (e) => String(e?.message ?? e));
    check(late.startsWith("undecodable"), `${what}: a keyframe that is not one, after a group cut short, is refused (${late})`);
  }
}

/**
 * An ask for a frame mid-group puts its whole group on the wire from the keyframe, the last group
 * cut at the series' end; frames that land out of order still decode in order. docs/av1/adr-unit.md §3
 */
async function anAskForAFrameAsksItsWholeGroup(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 group asks — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decoders: 2, perDecoder: 2, delayMs: 0, realDecoder: AV1, groupLength: 8, frameCount: 20,
    onFrame: (f) => got.push(f),
  });
  const asked = c.requestExactFrame(11);
  await until(async () => (await fake.controlMessages()).length >= 8);
  check(wireOf(await fake.controlMessages()).join() === range(8, 15).map((i) => `request_frame ${i}`).join(),
    `group: an ask for 11 asks 8..15 in order (${wireOf(await fake.controlMessages()).join()})`);
  for (const i of range(8, 15).reverse()) await fake.pushFrame(i, await unit(G8, i));
  const eleven = await within(asked);
  await until(() => got.length >= 7, 5000);
  const ask = eleven ? [...got, eleven] : got;
  check((await inexact(G8, ask, range(8, 15))) === "none",
    `group: pushed last to first, 8..15 still decode to their sources (inexact: ${await inexact(G8, ask, range(8, 15))})`);
  const tail = c.requestExactFrame(17);
  await until(async () => (await fake.controlMessages()).length >= 12);
  check(wireOf(await fake.controlMessages()).slice(8).join() === range(16, 19).map((i) => `request_frame ${i}`).join(),
    `group: the last group is asked to the series' end (${wireOf(await fake.controlMessages()).slice(8).join()})`);
  for (const i of range(16, 19)) await fake.pushFrame(i, await unit(G8, i));
  const seventeen = await within(tail);
  check(!!seventeen && (await sha256(seventeen.bytes)) === (await source(G8, 17)), "group: and its asked frame is its source's");
  c.close();
}

/**
 * An ask mid-fill is served from its keyframe; the fill's remainder resumes where it was cut, on the
 * decoder still holding that group, and every frame is its source's. docs/av1/adr-unit.md §3
 */
async function anAskMidFillStartsAtItsKeyframe(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 ask mid-fill — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  // One decoder: the ask's keyframe must wait for the group it holds, not take its state.
  for (const decoders of [1, 2]) await askMidFill(DownloaderClient, check, decoders);
}

async function askMidFill(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void, decoders: number) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decoders, perDecoder: 2, delayMs: 0, realDecoder: AV1, groupLength: 8, frameCount: 20,
    onFrame: (f) => got.push(f),
  });
  c.fill(range(0, 19));
  for (const i of range(0, 3)) await fake.pushFrame(i, await unit(G8, i));
  const asked = c.requestExactFrame(13);
  await until(async () => (await fake.controlMessages()).length >= 9);
  for (const i of range(8, 15)) await fake.pushFrame(i, await unit(G8, i));
  await until(async () => wireOf(await fake.controlMessages()).includes("stream_frames 4-7"));
  for (const i of range(4, 7)) await fake.pushFrame(i, await unit(G8, i));
  const thirteen = await within(asked);
  await until(async () => wireOf(await fake.controlMessages()).includes("stream_frames 16-19"));
  for (const i of range(16, 19)) await fake.pushFrame(i, await unit(G8, i));
  await until(() => got.length >= 19, 5000);
  const wire = wireOf(await fake.controlMessages()).join();
  check(wire === ["stream_frames 0-19", ...range(8, 15).map((i) => `request_frame ${i}`), "stream_frames 4-7", "stream_frames 16-19"].join(),
    `group: ${decoders} decoder(s), an ask for 13 mid-fill asks 8..15, then the fill resumes at 4 (${wire})`);
  const all = thirteen ? [...got, thirteen] : got;
  check((await inexact(G8, all, range(0, 19))) === "none", `group: ${decoders} decoder(s), every frame its source's (inexact: ${await inexact(G8, all, range(0, 19))})`);
  const decoderOf = (i: number) => all.find((f) => f.frameIndex === i)?.info.stamps?.decoder;
  check(range(1, 7).every((i) => decoderOf(i) === decoderOf(0)), `group: ${decoders} decoder(s), 4..7 decoded after the ask on the decoder that holds 0..3`);
  c.close();
}

/**
 * A frame of a group that fails takes the rest of its group with it, each named, never decoded
 * against a broken reference; the next group decodes exactly. docs/av1/adr-unit.md §3 invariant 4
 */
async function aFailedFrameFailsTheRestOfItsGroup(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 group failures — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  for (const how of ["undecodable", "refused"] as const) {
    const got: Frame[] = [];
    const failures: Fail[] = [];
    const { c, fake } = await open(DownloaderClient, {
      decoders: 2, perDecoder: 2, delayMs: 0, realDecoder: AV1, groupLength: 8, frameCount: 20,
      onFrame: (f) => got.push(f), onError: (f) => failures.push(f),
    });
    const rejected: [number, string][] = [];
    const asks = range(0, 15).map((i) =>
      c.requestExactFrame(i).then((f) => void got.push(f), (e) => void rejected.push([i, String(e?.message ?? e)])));
    await until(async () => (await fake.controlMessages()).length >= 16);
    // Refused last, on a quiet wire: 4..7 wait on 3, so its failure itself has to reach them.
    const order = how === "undecodable" ? range(0, 15) : [0, 1, 2, ...range(4, 15), 3];
    for (const i of order) {
      if (i !== 3) await fake.pushFrame(i, await unit(G8, i));
      else if (how === "undecodable") await fake.pushFrame(i, new Uint8Array(0));
      else await until(() => got.length >= 11).then(() => fake.pushRefusal(i, "gone"));
    }
    await within(Promise.all(asks));
    const failed = new Set(failures.map((f) => f.frameIndex));
    const decoded = got.map((f) => f.frameIndex).sort((a, b) => a - b).join();
    check(decoded === "0,1,2,8,9,10,11,12,13,14,15", `group: frame 3 ${how}, 4..7 never reach the page as frames (${decoded})`);
    const named = rejected.sort((a, b) => a[0] - b[0]).filter(([i, why]) => i === 3 || /frame \d+ (of its group did not decode|was not decoded before it here)/.test(why));
    check(named.map(([i]) => i).join() === "3,4,5,6,7", `group: frame 3 ${how}, 3..7 each fail by name (${named.map(([i]) => i).join() || "none"} of ${rejected.length})`);
    check((await inexact(G8, got, [0, 1, 2, ...range(8, 15)])) === "none", `group: frame 3 ${how}, the frames that arrived are their sources'`);
    check(failed.size === 0, `group: and asked frames fail on their own promises, not onError (${[...failed].join() || "none"})`);
    c.close();
  }
}

/**
 * A decoder decodes a frame of a group only right after its predecessor, in the same request: any
 * other order is refused without touching its state, and a frame after one that failed is refused
 * too. docs/av1/adr-unit.md §3
 */
async function aDecoderRefusesAFrameWhosePredecessorItDidNotDecode(
  _: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 decoder order — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const worker = new Worker("/client/downloader/decoder.js", { type: "module" });
  const ch = new MessageChannel();
  const replies: { kind: string; index?: number; reason?: string }[] = [];
  worker.onmessage = (e) => replies.push(e.data);
  ch.port2.onmessage = () => {};
  worker.postMessage({ kind: "init", toConsumer: ch.port1, decoder: AV1, groupLength: 8 }, [ch.port1]);
  await until(() => replies.length > 0, 5000);
  const outcome: string[] = [];
  for (const [index, gen, empty] of [[0, 0], [2, 0], [1, 0], [2, 0, true], [3, 0], [8, 0], [9, 1], [9, 0]] as [number, number, boolean?][]) {
    const n = replies.length;
    const bytes = empty ? new Uint8Array(0) : await unit(G8, index);
    worker.postMessage({ kind: "decode", index, gen, key: index % 8 === 0, bytes, stamps: {} });
    await until(() => replies.length > n, 5000);
    outcome.push(`${index}:${replies.at(-1)?.kind}`);
  }
  check(outcome.join() === "0:done,2:failed,1:done,2:failed,3:failed,8:done,9:failed,9:done",
    `group: out of order, after a failure or from another request is refused (${outcome.join()})`);
  worker.terminate();
}

const SCALABLE = `${AV1_SET}/scalable`;

/** What the page saw, in order — `p3` a preview of 3, `f3` its frame, `x3` its failure — and what is on screen. */
async function scalableThrough(
  DownloaderClient: DownloaderCtor,
  units: Uint8Array[],
  opts: { groupLength?: number; mode: "spy" | "none"; ask: boolean },
) {
  const ch = `wtpacs-scalable-${++world}`;
  const lengths: number[] = [];
  const spy = new BroadcastChannel(ch);
  spy.onmessage = (e) => void (typeof e.data === "number" && lengths.push(e.data));
  const seen: string[] = [];
  const previews: Frame[] = [];
  const frames: Frame[] = [];
  const screen = new Map<number, Frame>();
  const shown = (f: Frame) => void screen.set(f.frameIndex, f);
  const n = units.length;
  const { c, fake } = await open(DownloaderClient, {
    decoders: 2, perDecoder: 2, delayMs: 0, realDecoder: AV1,
    decoderWorker: `/client/conformance/webcodecs-spy.js?mode=${opts.mode}&ch=${ch}`,
    groupLength: opts.groupLength, frameCount: opts.groupLength ? n : undefined,
    onPreview: (f) => { seen.push(`p${f.frameIndex}`); previews.push(f); shown(f); },
    onFrame: (f) => { seen.push(`f${f.frameIndex}`); frames.push(f); shown(f); },
    onError: (f) => void seen.push(`x${f.frameIndex}`),
  });
  const reasons = new Map<number, string>();
  const asks = opts.ask
    ? range(0, n - 1).map((i) => c.requestExactFrame(i).then(
      (f) => { seen.push(`f${i}`); frames.push(f); shown(f); },
      (e) => { seen.push(`x${i}`); reasons.set(i, String(e?.message ?? e)); }))
    : (c.fill(range(0, n - 1)), []);
  for (const [i, b] of units.entries()) await fake.pushFrame(i, b);
  await within(Promise.all(asks));
  await until(() => seen.filter((e) => e[0] !== "p").length >= n, 5000);
  c.close();
  await settle(50);
  spy.close();
  const toWebCodecs = units.filter((u) => lengths.includes(unitLengths(u)[0])).length;
  return { seen, previews, frames, screen, reasons, toWebCodecs };
}

const scalableUnits = (set: string, n: number) => Promise.all(range(0, n - 1).map((i) => unit(`${SCALABLE}/${set}`, i)));

/**
 * A scalable frame — a lossy half-size base under a lossless top — reaches the page twice from the same
 * bytes through dav1d-WASM: its base, marked a preview at its own size and the same samples native dav1d
 * returns at the base's operating point, then its exact frame, which replaces it. An ask resolves with
 * the exact frame only. At G = 1 and in groups. docs/av1/adr-unit.md §6
 */
async function aScalableFrameShowsItsBaseThenItsExactFrame(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 scalable — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const sets = [["l2g1", 4, undefined, true], ["l2g8x20", 20, 8, false]] as const;
  for (const [set, n, groupLength, ask] of sets) {
    const what = `scalable ${set}, ${ask ? "asked" : "filled"}`;
    const r = await scalableThrough(DownloaderClient, await scalableUnits(set, n), { groupLength, mode: "none", ask });
    const all = range(0, n - 1);
    check((await inexact(`${SCALABLE}/${set}`, r.frames, all)) === "none",
      `${what}: every exact frame its source's (inexact: ${await inexact(`${SCALABLE}/${set}`, r.frames, all)})`);
    check(r.frames.every((f) => !f.info.preview && f.info.width === 64 && f.info.height === 48),
      `${what}: no frame is marked a preview, each at the series' size (${r.frames.map((f) => `${f.info.width}x${f.info.height}`).join() || "none"})`);
    const late = all.filter((i) => !(r.seen.indexOf(`p${i}`) >= 0 && r.seen.indexOf(`p${i}`) < r.seen.indexOf(`f${i}`)));
    check(late.length === 0, `${what}: each frame's preview reached the page before it (not: ${late.join() || "none"})`);
    check(r.previews.length === n, `${what}: one preview a frame (${r.previews.length} of ${n})`);
    const wrong: number[] = [];
    for (const p of r.previews) {
      const want = (await (await fetch(`${SCALABLE}/${set}/${String(p.frameIndex).padStart(3, "0")}.preview.sha256`)).text()).trim();
      if (!p.info.preview || p.info.width !== 32 || p.info.height !== 24 || (await sha256(p.bytes)) !== want) wrong.push(p.frameIndex);
    }
    check(wrong.length === 0, `${what}: each preview is marked, 32x24, native dav1d's base (not: ${wrong.join() || "none"})`);
    const stale = all.filter((i) => r.screen.get(i)?.info.preview);
    check(stale.length === 0 && r.screen.size === n, `${what}: no preview is left on screen after its frame (${stale.join() || "none"})`);
  }
  const single = await scalableThrough(DownloaderClient, await Promise.all(range(0, 19).map((i) => unit(G8, i))), { groupLength: 8, mode: "none", ask: false });
  check(single.previews.length === 0 && (await inexact(G8, single.frames, range(0, 19))) === "none",
    `scalable: a single-layer series sends no preview and stays exact (${single.previews.length} previews)`);
}

/**
 * A scalable unit whose top layer is missing shows its base as a preview, still marked, and the frame
 * fails by name, never arriving as the base; the frames either side are exact. docs/av1/adr-unit.md §6
 */
async function aScalableFrameWithoutItsTopFailsByName(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: AV1 scalable, no top — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const units = await scalableUnits("l2g1", 3);
  units[1] = asItem(await fetched(`${SCALABLE}/notop.av1`), 10);
  const r = await scalableThrough(DownloaderClient, units, { mode: "none", ask: true });
  check(r.seen.filter((e) => e.endsWith("1")).join() === "p1,x1", `scalable, no top: frame 1 shows its preview, then fails (${r.seen.join()})`);
  check(/spatial layer 0 of 1 is the unit's last/.test(r.reasons.get(1) ?? ""), `scalable, no top: by name (${r.reasons.get(1) ?? "no failure"})`);
  check(r.screen.get(1)?.info.preview === true, "scalable, no top: what stays on screen is still marked a preview");
  check((await inexact(`${SCALABLE}/l2g1`, r.frames, [0, 2])) === "none" && r.frames.length === 2,
    `scalable, no top: the frames either side are exact (${r.frames.map((f) => f.frameIndex).join()})`);
}

/**
 * Through WebCodecs, a ≤ 10-bit scalable series is exact but has no preview: it returns the highest
 * layer it is fed and cannot be asked for the base (row 31). docs/av1/adr-unit.md §6
 */
async function aScalableFrameThroughWebCodecsIsExactWithoutAPreview(
  DownloaderClient: DownloaderCtor,
  check: (c: boolean, w: string) => void,
  log: (line: string) => void,
) {
  if (typeof VideoDecoder !== "function") return void log("  SKIPPED: WebCodecs scalable — this browser has no VideoDecoder");
  if (!(await served(AV1.glue))) return void log(`  SKIPPED: WebCodecs scalable — no ${AV1_DIR} (lab/av1/dav1d-wasm/build.sh)`);
  const r = await scalableThrough(DownloaderClient, await scalableUnits("l2g1", 4), { mode: "spy", ask: true });
  check(r.toWebCodecs === 4 && r.previews.length === 0 && (await inexact(`${SCALABLE}/l2g1`, r.frames, range(0, 3))) === "none",
    `webcodecs scalable: 4 units decoded by WebCodecs, every frame exact, no preview (${r.toWebCodecs} units, ${r.previews.length} previews)`);
}

/** A group is asked whole, so a series coded in groups without its frame count is refused at `connect`. */
async function aGroupWithoutItsSeriesLengthIsRefused(DownloaderClient: DownloaderCtor, check: (c: boolean, w: string) => void) {
  const { connect } = begin(DownloaderClient, { decoders: 1, perDecoder: 2, delayMs: 0, realDecoder: AV1, groupLength: 8, onFrame: () => {} });
  const refused = await connect.then((c) => (c.close(), "connected"), (e) => String((e as Error)?.message ?? e));
  check(/frameCount/.test(refused), `group: G = 8 and no frameCount is refused (${refused})`);
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
  check(c.stats().resumedAt.length === 1, `survival: and the page learns when it was resumed (${c.stats().resumedAt.length} times)`);
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
    recycleAtBytes: 400, onFrame: (f) => got.push(f), onError: (f) => failures.push(f),
  });
  // 108 envelope bytes a frame: two are under 300, three over it and under the whole budget.
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
  check(c.stats().recycledAt.length > 0, `recycle: and the page learns when (${c.stats().recycledAt.length} times)`);
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

/**
 * A resumption dials with the fill still owed in its URL, so a cancel that lands during that dial
 * cannot take it back: the new session's stream is ended once it opens, and none of it reaches the consumer.
 */
async function aCancelDuringAResumeEndsTheFillItsDialCarried(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake, got } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs: 30_000 }, openAsk: "default" });
  await fake.openAfterMs(300);
  await fake.serverClose(0, "the server went away");
  const redialled = await until(async () => (await fake.dials()) >= 2);
  const url = await fake.dialUrl();
  check(redialled && url.endsWith("?ask=fill:2-5"), `cancel during a resume: the re-dial carries what was owed (${url})`);
  await cancelled(c);
  await settle(400);
  for (const i of [2, 3]) await fake.pushFrame(i, enc.encode(`late-${i}`));
  await settle(100);
  const wire = wireOf((await fake.controlMessages()) as Wire[]);
  check(wire.includes("end_stream"), `cancel during a resume: the stream the dial opened is ended (${wire.join(", ") || "nothing"})`);
  check(got.length === 2, `cancel during a resume: and none of it reaches the consumer (${got.map((f) => f.frameIndex).join()})`);
  c.close();
}

/**
 * `close` during a re-dial ends the client: a dial already under way is closed when it opens, and
 * nothing is asked on it. Driven on the downloader's worker, since the page ends it on `closed`.
 */
async function aCloseDuringARedialAdoptsNoSession(_DownloaderClient: DownloaderCtor, check: Check) {
  const ch = `wtpacs-dispatch-${++world}`;
  const fake = workerFake(ch);
  const w = new Worker("/client/downloader/downloader.js", { type: "module" });
  const closed = new Promise<void>((r) => (w.onmessage = (e) => e.data.kind === "closed" && r()));
  w.postMessage({
    kind: "start",
    config: {
      decode: false, decoders: 0, openAsk: false, survival: { ...QUICK, stallMs: 30_000 },
      transport: `/client/conformance/dist/fake-session.js?ch=${ch}`,
    },
  });
  w.postMessage({ kind: "dial", url: "https://conformance.invalid/", certHash: CERT });
  w.postMessage({ kind: "fill", indices: [0, 1, 2, 3] });
  await onTheWire(fake, "stream_frames 0-3");
  await fake.pushFrame(0, enc.encode("fill-0"));
  await fake.openAfterMs(300);
  await fake.serverClose(0, "the server went away");
  const redialled = await until(async () => (await fake.dials()) >= 2);
  w.postMessage({ kind: "close" });
  await closed;
  await settle(500);
  const wire = wireOf((await fake.controlMessages()) as Wire[]);
  check(redialled && wire.length === 0, `close during a re-dial: nothing is asked on the session it opened (${wire.join(", ") || "nothing"})`);
  check(await fake.didClose(), "close during a re-dial: and that session is closed");
  check((await fake.dials()) === 2, `close during a re-dial: and none is dialled after it (${await fake.dials()} dials)`);
  w.terminate();
}

/** A frame goes to the decoder holding the fewest: two frames on two idle decoders go one to each. */
async function aFrameGoesToTheLeastBusyDecoder(DownloaderClient: DownloaderCtor, check: Check) {
  const captured: Frame[] = [];
  const { c, fake, hold } = await open(DownloaderClient, { decoders: 2, hold: "decode", onFrame: (f) => captured.push(f) });
  c.fill([0, 1]);
  for (const i of [0, 1]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => hold.holding() >= 2);
  hold.release();
  await until(() => captured.length >= 2);
  const on = captured.map((f) => f.info.stamps?.decoder).sort().join();
  check(on === "0,1", `dispatch: two frames on two idle decoders go one to each (decoders ${on || "none"})`);
  c.close();
}

/** A fill naming frames already in hand asks the wire for none of them again, only for the rest. */
async function aFillOfFramesInHandAsksOnlyTheRest(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake, hold } = await open(DownloaderClient, { hold: "decode" });
  c.fill([0, 1]);
  for (const i of [0, 1]) await fake.pushFrame(i, enc.encode(`fill-${i}`));
  await until(() => hold.holding() >= 2);
  c.fill([0, 1, 2]);
  await until(async () => (await fake.controlMessages()).length >= 2);
  const wire = wireOf((await fake.controlMessages()) as Wire[]);
  check(wire.join() === "stream_frames 0-1,stream_frames 2-2", `fill: frames in hand are not asked again (${wire.join(", ")})`);
  hold.release();
  c.close();
}

/** A decoder that fails its init before the dial has its URL does not fail the start while another remains. */
async function aDecoderLostBeforeTheDialDoesNotFailTheStart(DownloaderClient: DownloaderCtor, check: Check) {
  let giveUrl = (_: string) => {};
  const url = new Promise<string>((r) => (giveUrl = r));
  const got: Frame[] = [];
  const { connect, fake, hold } = begin(DownloaderClient, { decoders: 2, failOneInit: true, url, onFrame: (f) => got.push(f) });
  await until(() => hold.holding() >= 1);
  hold.release();
  await settle(100);
  giveUrl("https://conformance.invalid/");
  const c = await started(connect).catch((e: Error) => e);
  check(!(c instanceof Error), `decoder init: one lost before the dial does not fail the start (${c instanceof Error ? c.message : "started"})`);
  if (c instanceof Error) return;
  c.fill([0]);
  await fake.pushFrame(0, enc.encode("frame-0"));
  check(await until(() => got.length >= 1), "decoder init: and the one left decodes");
  c.close();
}

/** An ask alone on a session that closes under it is asked again on a new one, not failed. */
async function anAskAloneOnAClosedSessionIsReasked(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, { decode: false, survival: { ...QUICK, stallMs: 30_000 } });
  const asked = c.requestExactFrame(50).then((f) => text(f.bytes), (e: Error) => `failed: ${e.message}`);
  await onTheWire(fake, "request_frame 50");
  await fake.serverClose(0, "the server went away");
  const redialled = await until(async () => (await fake.dials()) >= 2 && (await fake.controlMessages()).length > 0);
  check(redialled, `survival: a session that closes under an ask alone is re-dialled and asked (${await fake.dials()} dials)`);
  await fake.pushFrame(50, enc.encode("ask-50"));
  const got = await Promise.race([asked, settle(2000).then(() => "never")]);
  check(got === "ask-50", `survival: and the ask settles with its frame (${got})`);
  c.close();
}

/** A silent session owing only an ask is condemned like one owing a fill. */
async function aSilentSessionOwingAnAskIsRedialled(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, { decode: false, survival: QUICK });
  const asked = c.requestExactFrame(50).catch(() => null);
  const redialled = await until(async () => (await fake.dials()) >= 2, 2000);
  check(redialled, `survival: a silent session owing an ask is re-dialled (${await fake.dials()} dials)`);
  await fake.pushFrame(50, enc.encode("ask-50"));
  await Promise.race([asked, settle(1000)]);
  c.close();
}

/** Recycling carries an outstanding ask over: the new session is asked for it, and it settles there. */
async function aRecycledSessionTakesTheOwedAsk(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: { ...QUICK, stallMs: 30_000 }, recycleAtBytes: 300, onFrame: (f) => got.push(f),
  });
  const body = (i: number) => enc.encode(`fill-${i}`.padEnd(100, "."));
  c.fill([0, 1, 2]);
  await settle();
  for (const i of [0, 1]) await fake.pushFrame(i, body(i));
  await until(() => got.length >= 2);
  const asked = c.requestExactFrame(50).then((f) => text(f.bytes), (e: Error) => `failed: ${e.message}`);
  await onTheWire(fake, "request_frame 50");
  // The third frame crosses three quarters of the budget while the ask is still owed.
  await fake.pushFrame(2, body(2));
  const replaced = await until(async () => (await fake.dials()) >= 2 && wireOf((await fake.controlMessages()) as Wire[]).includes("request_frame 50"));
  check(replaced, `recycle: the new session is asked for the ask still owed (${wireOf((await fake.controlMessages()) as Wire[]).join(", ") || "nothing"})`);
  await fake.pushFrame(50, enc.encode("ask-50"));
  const f = await Promise.race([asked, settle(2000).then(() => "never")]);
  check(f === "ask-50", `recycle: and the ask settles there (${f})`);
  c.close();
}

/** A cancel between re-dials ends them: with nothing owed, no further dial is made. */
async function aCancelBetweenRedialsEndsThem(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await stalledFill(DownloaderClient, { survival: { ...QUICK, redialMs: 300, stallMs: 30_000 } });
  await fake.failDials(QUICK.tries);
  await fake.serverClose(0, "the server went away");
  await until(async () => (await fake.dials()) >= 2);
  await cancelled(c);
  const at = await fake.dials();
  await settle(1000);
  check((await fake.dials()) === at, `survival: a cancel between re-dials ends them (${at} → ${await fake.dials()} dials)`);
  c.close();
}

/** Once the re-dials run out an outstanding ask is named too, rejecting the promise the page holds. */
async function whenTheRedialsRunOutAnOwedAskIsNamed(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, { decode: false, survival: { ...QUICK, stallMs: 30_000 } });
  const asked = c.requestExactFrame(50).then(() => "delivered", (e: Error) => e.message);
  await onTheWire(fake, "request_frame 50");
  await fake.failDials(QUICK.tries);
  await fake.serverClose(0, "the server went away");
  const reason = await Promise.race([asked, settle(3000).then(() => "still pending at 3 s")]);
  check(/could not be re-dialled/.test(reason), `survival: the ask is named once the re-dials run out (${reason})`);
  c.close();
}

/** Spent re-dials are given back once they run out: a session dialled after that is resumed again when it dies. */
async function theRedialsAreGivenBackOnceSpent(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake, failures } = await stalledFill(DownloaderClient, { survival: { ...QUICK, stallMs: 30_000 } });
  await fake.failDials(QUICK.tries);
  await fake.serverClose(0, "the server went away");
  await until(() => failures.length >= 4, 5000);
  const before = await fake.dials();
  c.fill([10, 11]);
  await onTheWire(fake, "stream_frames 10-11");
  await fake.serverClose(0, "the server went away again");
  const resumed = await until(async () => (await fake.dials()) >= before + 2, 2000);
  check(resumed, `survival: a session dialled after the re-dials ran out is resumed when it dies (${before} → ${await fake.dials()} dials)`);
  c.close();
}

/** A survival option passed as `undefined` keeps the default: a dead session is still resumed. */
async function anUndefinedOptionKeepsItsDefault(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await stalledFill(DownloaderClient, { survival: undefined });
  await fake.serverClose(0, "the server went away");
  const resumed = await until(async () => (await fake.dials()) >= 2, 3000);
  check(resumed, `start: survival left undefined is on, as by default (${await fake.dials()} dials)`);
  c.close();
}

/** A first dial refused outright fails `connect` at once and names why; only a dial that never settles is tried again. */
async function aRefusedFirstDialFailsAtOnce(DownloaderClient: DownloaderCtor, check: Check) {
  const { connect } = begin(DownloaderClient, { decode: false, survival: QUICK, refuseDials: 1 });
  const outcome = await Promise.race([
    connect.then((c) => (c.close(), "started"), (e) => String((e as Error)?.message ?? e)),
    settle(3000).then(() => "still pending at 3 s"),
  ]);
  check(/dial refused/.test(outcome), `dial: a refused first dial fails connect and names why (${outcome})`);
}

/** A command during a resumption waits for it rather than dialling beside it: one session, and the ask on it. */
async function aCommandDuringAResumeDialsNoSessionOfItsOwn(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await stalledFill(DownloaderClient, { survival: { ...QUICK, redialMs: 400, stallMs: 30_000 } });
  await fake.failDials(1);
  await fake.serverClose(0, "the server went away");
  await until(async () => (await fake.dials()) >= 2);
  const asked = c.requestExactFrame(50).then((f) => text(f.bytes), (e: Error) => `failed: ${e.message}`);
  await settle(800);
  check((await fake.dials()) === 3, `survival: an ask during a resumption dials no session of its own (${await fake.dials()} dials)`);
  await onTheWire(fake, "request_frame 50");
  await fake.pushFrame(50, enc.encode("ask-50"));
  const f = await Promise.race([asked, settle(2000).then(() => "never")]);
  check(f === "ask-50", `survival: the ask settles on the resumed session (${f})`);
  c.close();
}

/** A command whose dial fails after a cancel names nothing: its frames were the cancelled request's. */
async function aDialFailingAfterACancelNamesNothing(DownloaderClient: DownloaderCtor, check: Check) {
  const failures: Fail[] = [];
  const { c, fake } = await open(DownloaderClient, {
    decode: false, survival: { ...QUICK, dialMs: 300, stallMs: 30_000 }, onError: (f) => failures.push(f),
  });
  await fake.serverClose(0, "the server went away");
  await settle();
  await fake.hangDials(1);
  c.fill([7]);
  await until(async () => (await fake.dials()) >= 2);
  await cancelled(c);
  await settle(600);
  check(failures.length === 0, `cancel: a dial failing after it names none of the cancelled frames (${failures.map((f) => f.frameIndex).join() || "none"})`);
  c.close();
}

/** A decoder's failure that lands after a cancel names nothing; one in the live request is named. */
async function aDecodeFailingAfterACancelNamesNothing(DownloaderClient: DownloaderCtor, check: Check) {
  const failures: Fail[] = [];
  const { c, fake, hold } = await open(DownloaderClient, { hold: "decode", onError: (f) => failures.push(f) });
  c.fill([0]);
  await fake.pushFrame(0, enc.encode("fail-0"));
  await until(() => hold.holding() >= 1);
  await cancelled(c);
  hold.release();
  await settle(300);
  check(failures.length === 0, `cancel: a decode failing after it is not named (${failures.map((f) => f.frameIndex).join() || "none"})`);
  c.fill([1]);
  await onTheWire(fake, "stream_frames 1-1");
  await fake.pushFrame(1, enc.encode("fail-1"));
  const named = await until(() => failures.length >= 1);
  check(named && failures[0].frameIndex === 1, `cancel: one failing in the live request is (${failures.map((f) => f.frameIndex).join() || "none"})`);
  c.close();
}

/** After a cancel no decoder still waits for the next frame of a group it began: the new request's group stays on one decoder. */
async function aCancelReleasesTheGroupADecoderHeld(DownloaderClient: DownloaderCtor, check: Check) {
  const got: Frame[] = [];
  const { c, fake, hold } = await open(DownloaderClient, {
    decoders: 2, hold: "decode", groupLength: 4, frameCount: 8, onFrame: (f) => got.push(f),
  });
  c.fill([0, 1]);
  await onTheWire(fake, "stream_frames 0-3");
  for (const i of [0, 1]) await fake.pushFrame(i, enc.encode(`old-${i}`));
  await until(() => hold.holding() >= 2);
  await cancelled(c);
  c.fill([0, 1, 2, 3]);
  await until(async () => (await fake.controlMessages()).length >= 3);
  // The first decoder is full of the cancelled frames, so the new group begins on the second.
  for (const i of [0, 1]) await fake.pushFrame(i, enc.encode(`new-${i}`));
  await until(() => hold.holding() >= 4);
  hold.release();
  await until(() => got.length >= 2);
  await settle(100);
  for (const i of [2, 3]) await fake.pushFrame(i, enc.encode(`new-${i}`));
  await until(() => got.length >= 4);
  const on = [...got].sort((a, b) => a.frameIndex - b.frameIndex).map((f) => f.info.stamps?.decoder).join();
  check(on === "1,1,1,1", `group: after a cancel the new group stays on the decoder that began it (decoders ${on})`);
  c.close();
}

/** A second ask for a frame already asked rejects at once, and the first still settles. */
async function aSecondAskForTheSameFrameIsRefused(DownloaderClient: DownloaderCtor, check: Check) {
  const { c, fake } = await open(DownloaderClient, { decode: false });
  const first = c.requestExactFrame(5).then((f) => text(f.bytes), (e: Error) => `failed: ${e.message}`);
  const second = await c.requestExactFrame(5).then(() => "delivered", (e: Error) => e.message);
  check(/already requested/.test(second), `ask: a second ask for the same frame rejects at once (${second})`);
  await onTheWire(fake, "request_frame 5");
  await fake.pushFrame(5, enc.encode("ask-5"));
  const f = await Promise.race([first, settle(2000).then(() => "never")]);
  check(f === "ask-5", `ask: and the first still settles (${f})`);
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
    aRefusalInTheRunSparesTheFrameAnAskCarries,
    theDecodersComeUpWhileTheUrlIsUnknown,
    anOpeningFillRidesTheSessionUrl,
    aRefusedOpeningFillReachesTheConsumer,
    aTruncatedFrameIsAFailureNotAFrame,
    anUndecodableFrameIsAFailureNotAFrame,
    aFrameCarriesItsWireBytes,
    aFrameCarriesItsDecodersRangeOrItsOwn,
    anAv1ItemDecodesToItsSource,
    anAv1ItemTakesWebCodecsOnlyWhereItIsExact,
    aMalformedAv1ItemIsRefusedByName,
    anAv1FrameThatCannotDecodeAloneIsAFailure,
    anAv1FrameEitherDecoderCannotReturnExactlyIsAFailure,
    anUnknownCodecIsRefusedBeforeTheDial,
    aGroupDecodesOnOneDecoderInOrder,
    aGroupDecodesThroughEitherDecoder,
    anAskForAFrameAsksItsWholeGroup,
    anAskMidFillStartsAtItsKeyframe,
    aFailedFrameFailsTheRestOfItsGroup,
    aDecoderRefusesAFrameWhosePredecessorItDidNotDecode,
    aGroupWithoutItsSeriesLengthIsRefused,
    aScalableFrameShowsItsBaseThenItsExactFrame,
    aScalableFrameWithoutItsTopFailsByName,
    aScalableFrameThroughWebCodecsIsExactWithoutAPreview,
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
    aCancelDuringAResumeEndsTheFillItsDialCarried,
    aCloseDuringARedialAdoptsNoSession,
    aFrameGoesToTheLeastBusyDecoder,
    aFillOfFramesInHandAsksOnlyTheRest,
    aDecoderLostBeforeTheDialDoesNotFailTheStart,
    anAskAloneOnAClosedSessionIsReasked,
    aSilentSessionOwingAnAskIsRedialled,
    aRecycledSessionTakesTheOwedAsk,
    aCancelBetweenRedialsEndsThem,
    whenTheRedialsRunOutAnOwedAskIsNamed,
    theRedialsAreGivenBackOnceSpent,
    anUndefinedOptionKeepsItsDefault,
    aRefusedFirstDialFailsAtOnce,
    aCommandDuringAResumeDialsNoSessionOfItsOwn,
    aDialFailingAfterACancelNamesNothing,
    aDecodeFailingAfterACancelNamesNothing,
    aCancelReleasesTheGroupADecoderHeld,
    aSecondAskForTheSameFrameIsRefused,
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
