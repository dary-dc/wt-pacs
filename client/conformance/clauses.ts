/**
 * The clauses themselves, written against a Rig so the same checks drive every arm:
 * both clients in Node (run.ts) and the downloader in a browser (downloader-rig.ts).
 * docs/proposal-conformance-suite.md says why; the rows are proposal-downloader.md §Capabilities.
 */
export type ConformantFrame = {
  frameIndex: number;
  bytes: Uint8Array;
  timing: { askMs: number; lastChunkMs: number; firstChunkMs?: number; chunks?: number };
};

export type ConformantSession = {
  requestExactFrame(frameIndex: number): Promise<ConformantFrame>;
  startStreamFrames(waitLast: number, range?: { from?: number; to?: number }): number;
  fillFrames(
    from: number,
    to: number,
    onFrame: (f: ConformantFrame) => void,
    onError?: (frameIndex: number, reason: string) => void,
  ): number;
  endStream(): Promise<void>;
  /** Only the sessions own a ring; the downloader's rig leaves it out. client/conformance/ring.ts */
  releaseWireBuffer?(buffer: ArrayBuffer): void;
  stats(): { inFlight: number };
  close(): void;
};

/** Drives the fake wire; async because the downloader's fake lives in another thread. */
export type FakeHandle = {
  pushFrame(index: number, codestream: Uint8Array): Promise<void>;
  pushOnOneStream(frames: [number, Uint8Array][]): Promise<void>;
  pushTruncatedFrame(index: number, codestream: Uint8Array, sent: number): Promise<void>;
  trickleFrame(index: number, codestream: Uint8Array, chunks: number, everyMs: number): Promise<void>;
  serverClose(closeCode?: number, reason?: string, endStreams?: boolean): Promise<void>;
  controlMessages(): Promise<{ op: string }[]>;
  didClose(): Promise<boolean>;
};

export type Rig = {
  name: string;
  /** An ask after a closure: the sessions fail it, the downloader re-dials and serves it. */
  closure: "fail" | "redial";
  open(): Promise<ConformantSession>;
  /** Addresses the transport most recently dialled in the current open's world. */
  fake(): FakeHandle;
  dialsSinceOpen(): Promise<number>;
  /** Set where one ordered stream carries every frame, as a WebSocket does: a clause about
   *  independent delivery reports itself here by name instead of passing. docs/proposal-udp-fallback.md */
  oneStream?: (what: string) => void;
};

export type Check = (cond: boolean, what: string) => void;

const enc = new TextEncoder();
const text = (f: ConformantFrame | null) => (f ? new TextDecoder().decode(f.bytes) : "");

const settle = () => new Promise((r) => setTimeout(r, 30));

/**
 * Wait a bounded time for a frame. A frame that never arrives must fail its own check by name;
 * awaiting it raw instead takes the process down at FRAME_TIMEOUT_MS with nothing counted.
 */
function within<T>(p: Promise<T>, ms = 500): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

async function until(cond: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return cond();
}

const untilDials = (rig: Rig, n: number) => until(async () => (await rig.dialsSinceOpen()) >= n, 3000);

/** Timestamps must be real values, not the zeros a missing clock hands back in a worker. */
async function workerSafe(rig: Rig, check: Check) {
  const s = await rig.open();
  const pending = s.requestExactFrame(3);
  await settle();
  await rig.fake().pushFrame(3, enc.encode("frame-three"));
  const f = await within(pending);
  check(f !== null, `${rig.name}: the asked frame arrives`);
  if (f === null) return s.close();

  check(f.frameIndex === 3, `${rig.name}: frame index round-trips`);
  check(f.timing.askMs > 0, `${rig.name}: askMs is a real clock reading, not 0`);
  check(f.timing.lastChunkMs > 0, `${rig.name}: lastChunkMs is a real clock reading, not 0`);
  check(f.timing.lastChunkMs >= f.timing.askMs, `${rig.name}: the frame arrives at or after the ask`);
  s.close();
}

/** A fill can be stopped without ending the session: the ask goes out and the session survives. */
async function cancellable(rig: Rig, check: Check) {
  const s = await rig.open();
  const t = rig.fake();
  s.startStreamFrames(4, { from: 0, to: 4 });
  await settle();
  await s.endStream();
  await settle();

  const ops = (await t.controlMessages()).map((m) => m.op);
  check(ops.includes("stream_frames"), `${rig.name}: the fill was asked for`);
  check(ops.includes("end_stream"), `${rig.name}: end_stream was sent`);
  check(!(await t.didClose()), `${rig.name}: cancelling a fill does not close the session`);

  const after = s.requestExactFrame(9);
  await settle();
  await t.pushFrame(9, enc.encode("after-cancel"));
  const f = await within(after);
  check(text(f) === "after-cancel", `${rig.name}: the session still serves a frame after a cancel`);
  s.close();
}

/** A frame's buffer crosses a worker boundary as a move, and takes no sibling with it. */
async function transferable(rig: Rig, check: Check) {
  const s = await rig.open();
  const t = rig.fake();
  const a = s.requestExactFrame(1);
  const b = s.requestExactFrame(2);
  await settle();
  await t.pushOnOneStream([
    [1, enc.encode("frame-one")],
    [2, enc.encode("frame-two")],
  ]);
  const [f1, f2] = await Promise.all([within(a), within(b)]);
  check(f1 !== null && f2 !== null, `${rig.name}: both frames of a shared stream arrive`);
  if (f1 === null || f2 === null) {
    s.close();
    return;
  }

  const buf = f1.bytes.buffer as ArrayBuffer;
  check(buf.byteLength > 0, `${rig.name}: the frame arrives with a live buffer`);
  structuredClone(buf, { transfer: [buf] });
  check(buf.byteLength === 0, `${rig.name}: transferring the buffer detaches it — a move, not a copy`);
  check(
    f2.bytes.length > 0 && text(f2) === "frame-two",
    `${rig.name}: transferring one frame does not detach another delivered beside it`,
  );
  s.close();
}

/** After a closure the sessions fail the ask; the downloader re-dials and serves it. Both at once. */
async function askAfterClose(rig: Rig, check: Check, s: ConformantSession, index: number, what: string) {
  const t0 = Date.now();
  if (rig.closure === "fail") {
    let rejected = false;
    try {
      await s.requestExactFrame(index);
    } catch {
      rejected = true;
    }
    check(rejected, `${rig.name}: a request against a closed session fails (${what})`);
    check(Date.now() - t0 < 1000, `${rig.name}: at once, not at FRAME_TIMEOUT_MS (${what})`);
    return;
  }
  const dials = await rig.dialsSinceOpen();
  const p = s.requestExactFrame(index);
  const dialed = await untilDials(rig, dials + 1);
  check(dialed, `${rig.name}: an ask after a closure dials afresh (${what})`);
  if (!dialed) return;
  await rig.fake().pushFrame(index, enc.encode("after-close"));
  const f = await within(p, 2000);
  check(text(f) === "after-close", `${rig.name}: and is served on the new session (${what})`);
  // Generous under load; the claim is "not FRAME_TIMEOUT_MS", and 15 s still fails it.
  check(Date.now() - t0 < 5000, `${rig.name}: at once, not at FRAME_TIMEOUT_MS (${what})`);
}

/** A fake that never answers must fail one check by name, not throw the clause's rest away. */
async function serverGone(rig: Rig, check: Check, what: string, endStreams?: boolean): Promise<boolean> {
  const sent = rig.fake().serverClose(7, "server went away", endStreams);
  const took = await Promise.race([
    sent.then(() => true, () => false),
    new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
  ]);
  if (!took) check(false, `${rig.name}: the fake took the server's close (${what})`);
  return took;
}

/** A closed session is noticed at once; a live one still owes the frame its full timeout. */
async function noticesClose(rig: Rig, check: Check) {
  const closedFirst = await rig.open();
  if (await serverGone(rig, check, "closed before the ask")) {
    await settle();
    await askAfterClose(rig, check, closedFirst, 1, "closed before the ask");
  }
  closedFirst.close();

  const closedDuring = await rig.open();
  const inFlight = closedDuring.requestExactFrame(2);
  await settle();
  const t1 = Date.now();
  if (await serverGone(rig, check, "closed with an ask in flight")) {
    let woke = false;
    try {
      await inFlight;
    } catch {
      woke = true;
    }
    check(woke, `${rig.name}: a request in flight when the session closes is woken`);
    check(Date.now() - t1 < 1000, `${rig.name}: it is woken at once, not left to time out`);
  }
  closedDuring.close();

  // `closed` alone, with the media stream left open: the session object is the signal.
  const quietClose = await rig.open();
  if (await serverGone(rig, check, "closed with the stream left open", false)) {
    await settle();
    await askAfterClose(rig, check, quietClose, 4, "closed with the stream left open");
  }
  quietClose.close();

  // The timeout's own case: still alive, frame never arrives. It must NOT fail fast.
  const live = await rig.open();
  const pending = live.requestExactFrame(3);
  let early: unknown = null;
  pending.catch((e) => (early = e));
  await new Promise((r) => setTimeout(r, 300));
  check(early === null, `${rig.name}: a live session still owes the frame its full timeout`);
  live.close();
}

/** The per-frame mode needs independent streams; one ordered stream has the shared mode alone. */
function streamModes(rig: Rig, what: string): ("shared" | "per-frame")[] {
  if (!rig.oneStream) return ["shared", "per-frame"];
  rig.oneStream(`${rig.name}: ${what}, per-frame mode`);
  return ["shared"];
}

/** A fill arrives either as one stream carrying many frames or as a stream per frame. */
async function bothStreamModes(rig: Rig, check: Check) {
  for (const mode of streamModes(rig, "every frame of a fill arrives in the order asked")) {
    const s = await rig.open();
    const t = rig.fake();
    const want = [0, 1, 2];
    const pending = want.map((i) => s.requestExactFrame(i));
    await settle();
    const frames = want.map((i) => [i, enc.encode(`frame-${i}`)] as [number, Uint8Array]);
    if (mode === "shared") await t.pushOnOneStream(frames);
    else for (const [i, c] of frames) await t.pushFrame(i, c);
    const got = await Promise.all(pending.map((p) => within(p)));
    check(
      got.every((f, k) => f !== null && text(f) === `frame-${want[k]}`),
      `${rig.name}: every frame of a ${mode} fill arrives, in the order asked`,
    );
    s.close();
  }
}

/** `stats` counts what is outstanding, and lets it go when the frame lands. */
async function reportsStats(rig: Rig, check: Check) {
  const s = await rig.open();
  const t = rig.fake();
  check(s.stats().inFlight === 0, `${rig.name}: a fresh session has nothing in flight`);
  const a = s.requestExactFrame(1);
  const b = s.requestExactFrame(2);
  await settle();
  check(s.stats().inFlight === 2, `${rig.name}: stats counts both outstanding asks`);
  await t.pushFrame(1, enc.encode("one"));
  await within(a);
  check(s.stats().inFlight === 1, `${rig.name}: a delivered frame leaves the count`);
  await t.pushFrame(2, enc.encode("two"));
  await within(b);
  check(s.stats().inFlight === 0, `${rig.name}: the count returns to zero`);
  s.close();
}

/** A session opened at load serves an ask made later without dialling a second time. */
async function oneDialServesLaterAsks(rig: Rig, check: Check) {
  const s = await rig.open();
  const t = rig.fake();
  check((await rig.dialsSinceOpen()) === 1, `${rig.name}: connecting dials once`);
  await settle();
  const f = s.requestExactFrame(7);
  await settle();
  await t.pushFrame(7, enc.encode("late-ask"));
  const late = await within(f);
  check(text(late) === "late-ask", `${rig.name}: an ask long after the dial is served`);
  check((await rig.dialsSinceOpen()) === 1, `${rig.name}: serving it dials no second transport`);
  s.close();
}

/**
 * A fill pushed as it lands: every frame reaches the callback once and in order, none arms a
 * waiter, in both stream modes; an ask during it keeps its own promise; endStream() drops the rest.
 */
async function pushedFill(rig: Rig, check: Check) {
  for (const mode of streamModes(rig, "a pushed fill lands once, in order")) {
    const s = await rig.open();
    const t = rig.fake();
    const got: ConformantFrame[] = [];
    s.fillFrames(0, 2, (f) => got.push(f));
    await settle();
    check(s.stats().inFlight === 0, `${rig.name}: a pushed ${mode} fill arms no waiter`);
    // Frame 9 is outside the fill: it must be dropped, not pushed.
    const frames = [0, 1, 2, 9].map((i) => [i, enc.encode(`frame-${i}`)] as [number, Uint8Array]);
    if (mode === "shared") await t.pushOnOneStream(frames);
    else for (const [i, c] of frames) await t.pushFrame(i, c);
    await until(() => got.length >= 3, 1000);
    await settle();
    const order = got.map((f) => f.frameIndex).join();
    check(order === "0,1,2", `${rig.name}: every frame of a pushed ${mode} fill lands once, in order (got ${order})`);
    check(got.every((f) => text(f) === `frame-${f.frameIndex}`), `${rig.name}: pushed ${mode} frames carry their bytes`);
    check(
      got.every((f) => f.timing.askMs > 0 && f.timing.lastChunkMs >= f.timing.askMs),
      `${rig.name}: pushed ${mode} frames carry real timings`,
    );
    s.close();
  }

  const s = await rig.open();
  const t = rig.fake();
  const got: ConformantFrame[] = [];
  s.fillFrames(0, 3, (f) => got.push(f));
  await settle();
  const asked = s.requestExactFrame(2);
  await settle();
  await t.pushFrame(2, enc.encode("frame-2"));
  const f = await within(asked);
  check(text(f) === "frame-2", `${rig.name}: an ask during a pushed fill is served on its own promise`);
  await settle();
  check(!got.some((g) => g.frameIndex === 2), `${rig.name}: and is not pushed to the fill as well`);
  await s.endStream();
  await settle();
  await t.pushFrame(3, enc.encode("frame-3"));
  await settle();
  check(!got.some((g) => g.frameIndex === 3), `${rig.name}: after endStream a late fill frame is dropped, not pushed`);
  s.close();
}

/**
 * A uni stream that ends mid-frame has lost that frame: it is named on the fill's refusal path,
 * never delivered, and the whole frame before it still arrives.
 * docs/CLIENTS.md#a-truncated-frame-is-a-failure
 */
async function aTruncatedFrameIsAFailure(rig: Rig, check: Check) {
  const s = await rig.open();
  const t = rig.fake();
  const got: ConformantFrame[] = [];
  const named: [number, string][] = [];
  s.fillFrames(0, 1, (f) => got.push(f), (i, reason) => named.push([i, reason]));
  await settle();
  await t.pushFrame(0, enc.encode("frame-zero"));
  await until(() => got.length >= 1, 1000);
  await t.pushTruncatedFrame(1, enc.encode("frame-one-and-then-some"), 5);
  await until(() => named.length >= 1, 1000);
  await settle();

  const seen = named.map(([i]) => i).join() || "none";
  check(named.some(([i]) => i === 1), `${rig.name}: the frame a stream cut short is named (${seen})`);
  check(
    named.every(([, r]) => r.includes("truncated")),
    `${rig.name}: with a reason that says so (${named.map(([, r]) => r).join() || "none"})`,
  );
  check(!got.some((f) => f.frameIndex === 1), `${rig.name}: the frame it cut short never arrives`);
  check(
    got.length === 1 && got[0]?.frameIndex === 0,
    `${rig.name}: the whole frame before it still arrives (${got.map((f) => f.frameIndex).join() || "none"})`,
  );
  s.close();
}

/** A session that dies mid-fill names every frame it still owed, each once. */
async function aDeadSessionNamesWhatItOwed(rig: Rig, check: Check) {
  const s = await rig.open();
  const t = rig.fake();
  const got: ConformantFrame[] = [];
  const named: number[] = [];
  s.fillFrames(0, 2, (f) => got.push(f), (i) => named.push(i));
  await settle();
  await t.pushFrame(0, enc.encode("frame-zero"));
  await until(() => got.length >= 1, 1000);
  if (!(await serverGone(rig, check, "mid-fill"))) return s.close();
  await until(() => named.length >= 2, 1000);
  await settle();

  const owed = [...new Set(named)].sort((a, b) => a - b).join();
  check(owed === "1,2", `${rig.name}: every frame the dead session still owed is named (${owed || "none"})`);
  check(named.length === 2, `${rig.name}: each of them once (${named.join() || "none"})`);
  check(
    got.length === 1 && got[0]?.frameIndex === 0,
    `${rig.name}: the frame that did arrive is not among them (${got.map((f) => f.frameIndex).join() || "none"})`,
  );
  s.close();
}

/** A closed session can be replaced: the next connect serves frames again. */
async function redialsAfterClosure(rig: Rig, check: Check) {
  const first = await rig.open();
  if (await serverGone(rig, check, "before a redial")) {
    await settle();
    if (rig.closure === "fail") {
      await first.requestExactFrame(1).then(
        () => check(false, `${rig.name}: an ask on the closed session should fail`),
        () => check(true, `${rig.name}: the closed session fails its asks`),
      );
    } else {
      // The downloader re-dials by itself — proven in noticesClose. Here: a fresh client after it.
      await askAfterClose(rig, check, first, 1, "redial");
    }
  }
  first.close();

  const second = await rig.open();
  const t = rig.fake();
  const f = second.requestExactFrame(5);
  await settle();
  await t.pushFrame(5, enc.encode("after-redial"));
  const again = await within(f);
  check(text(again) === "after-redial", `${rig.name}: a session opened after a closure serves frames again`);
  second.close();
}

/** A frame slow on its own stream holds back no frame on another: delivery is independent. */
async function aSlowFrameHoldsNoOther(rig: Rig, check: Check) {
  if (rig.oneStream) return rig.oneStream(`${rig.name}: a frame slow on its own stream holds no other`);
  const s = await rig.open();
  const order: number[] = [];
  const slow = s.requestExactFrame(0).then((f) => order.push(f.frameIndex), () => {});
  const fast = s.requestExactFrame(1).then((f) => order.push(f.frameIndex), () => {});
  await settle();
  await rig.fake().trickleFrame(0, enc.encode("slow".repeat(40)), 5, 100);
  await rig.fake().pushFrame(1, enc.encode("fast"));
  await within(Promise.all([slow, fast]), 2000);
  check(order.join() === "1,0", `${rig.name}: a frame slow on its own stream holds no other (${order.join() || "none"})`);
  s.close();
}

/**
 * A frame is late when its session goes quiet, not when its ask is old: one whose bytes keep coming
 * for longer than FRAME_TIMEOUT_MS still lands — the tail of a burst on a slow link.
 * docs/proposal-session-survival.md §Detection by the bytes
 */
async function aFrameIsLateOnlyWhenTheSessionGoesQuiet(rig: Rig, check: Check) {
  const s = await rig.open();
  const asked = s.requestExactFrame(0).then(
    (f) => text(f),
    (e) => `rejected: ${e?.message ?? e}`,
  );
  await settle();
  // Seventeen chunks a second apart: sixteen seconds of bytes, none more than one apart.
  await rig.fake().trickleFrame(0, enc.encode("slow".repeat(40)), 17, 1000);
  const got = await asked;
  check(got === "slow".repeat(40), `${rig.name}: a frame whose bytes take 16 s lands (${got.slice(0, 60)})`);
  s.close();
}

export async function runClauses(rig: Rig, check: Check): Promise<void> {
  const clauses = [
    workerSafe,
    cancellable,
    transferable,
    noticesClose,
    bothStreamModes,
    reportsStats,
    oneDialServesLaterAsks,
    redialsAfterClosure,
    pushedFill,
    aTruncatedFrameIsAFailure,
    aDeadSessionNamesWhatItOwed,
    aFrameIsLateOnlyWhenTheSessionGoesQuiet,
    aSlowFrameHoldsNoOther,
  ];
  // A clause that throws fails by name and the rest still run — an abort counts nothing.
  for (const clause of clauses) {
    try {
      await clause(rig, check);
    } catch (e) {
      check(false, `${rig.name}: ${clause.name} threw: ${(e as Error)?.message ?? e}`);
    }
  }
}
