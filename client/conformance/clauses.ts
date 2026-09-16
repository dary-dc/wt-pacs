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
  endStream(): Promise<void>;
  stats(): { inFlight: number };
  close(): void;
};

/** Drives the fake wire; async because the downloader's fake lives in another thread. */
export type FakeHandle = {
  pushFrame(index: number, codestream: Uint8Array): Promise<void>;
  pushOnOneStream(frames: [number, Uint8Array][]): Promise<void>;
  serverClose(closeCode?: number, reason?: string, endStreams?: boolean): Promise<void>;
  controlMessages(): Promise<{ op: string }[]>;
  didClose(): Promise<boolean>;
};

export type Rig = {
  name: string;
  /** The wire op this arm's fill sends. */
  fillOp: "stream_frames" | "request_frames";
  /** An ask after a closure: the sessions fail it, the downloader re-dials and serves it. */
  closure: "fail" | "redial";
  open(): Promise<ConformantSession>;
  /** Addresses the transport most recently dialled in the current open's world. */
  fake(): FakeHandle;
  dialsSinceOpen(): Promise<number>;
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

async function untilDials(rig: Rig, n: number, ms = 3000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await rig.dialsSinceOpen()) >= n) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

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
  check(ops.includes(rig.fillOp), `${rig.name}: the fill was asked for`);
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

/** A closed session is noticed at once; a live one still owes the frame its full timeout. */
async function noticesClose(rig: Rig, check: Check) {
  const closedFirst = await rig.open();
  await rig.fake().serverClose(7, "server went away");
  await settle();
  await askAfterClose(rig, check, closedFirst, 1, "closed before the ask");
  closedFirst.close();

  const closedDuring = await rig.open();
  const inFlight = closedDuring.requestExactFrame(2);
  await settle();
  const t1 = Date.now();
  await rig.fake().serverClose(7, "server went away");
  let woke = false;
  try {
    await inFlight;
  } catch {
    woke = true;
  }
  check(woke, `${rig.name}: a request in flight when the session closes is woken`);
  check(Date.now() - t1 < 1000, `${rig.name}: it is woken at once, not left to time out`);
  closedDuring.close();

  // `closed` alone, with the media stream left open: the session object is the signal.
  const quietClose = await rig.open();
  await rig.fake().serverClose(7, "server went away", false);
  await settle();
  await askAfterClose(rig, check, quietClose, 4, "closed with the stream left open");
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

/** A fill arrives either as one stream carrying many frames or as a stream per frame. */
async function bothStreamModes(rig: Rig, check: Check) {
  for (const mode of ["shared", "per-frame"] as const) {
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

/** A closed session can be replaced: the next connect serves frames again. */
async function redialsAfterClosure(rig: Rig, check: Check) {
  const first = await rig.open();
  await rig.fake().serverClose(1, "gone");
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

/** A clause that throws fails by name and the rest still run — an abort counts nothing. */
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
  ];
  for (const clause of clauses) {
    try {
      await clause(rig, check);
    } catch (e) {
      check(false, `${rig.name}: ${clause.name} threw: ${(e as Error)?.message ?? e}`);
    }
  }
}
