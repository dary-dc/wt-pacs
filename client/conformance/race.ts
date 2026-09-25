/**
 * The race: both carriers dialled at once, the first ready kept and the other dropped. One clause
 * per outcome — QUIC first, TCP first, QUIC refused. docs/proposal-udp-fallback.md §Race it
 */
import { FakeTransport, installFakeTransport } from "./fake-transport.ts";
import { FakeWebSocket, installFakeWebSocket } from "./fake-websocket.ts";
import type { Implementation } from "./adapters.ts";
import type { Check, ConformantFrame, ConformantSession } from "./clauses.ts";

const CERT = "ab".repeat(32);
const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Pushes = { pushFrame(index: number, codestream: Uint8Array): void };

/** Dial with the two paths `quicMs` and `tcpMs` from ready; `null` refuses that path. */
async function dial(race: Implementation, quicMs: number | null, tcpMs: number | null) {
  installFakeTransport();
  installFakeWebSocket();
  FakeTransport.openAfterMs = quicMs ?? 0;
  FakeTransport.failNext = quicMs === null ? 1 : 0;
  FakeWebSocket.openAfterMs = tcpMs ?? 0;
  FakeWebSocket.failNext = tcpMs === null ? 1 : 0;
  const [quicAt, tcpAt] = [FakeTransport.dials, FakeWebSocket.dials];
  try {
    return await race.connect("https://conformance.invalid/", CERT);
  } finally {
    FakeTransport.openAfterMs = FakeWebSocket.openAfterMs = 0;
    if (FakeTransport.dials === quicAt || FakeWebSocket.dials === tcpAt) throw new Error("the race did not dial both");
  }
}

/** The frame is served when pushed on `on`, and nothing is asked on the other. */
async function servedOn(s: ConformantSession, on: Pushes, other: { sent: unknown[] }): Promise<string> {
  const asked = s.requestExactFrame(4);
  await sleep(30);
  on.pushFrame(4, enc.encode("won"));
  const f = await Promise.race([asked.catch(() => null), sleep(500).then(() => null)]);
  const text = f ? new TextDecoder().decode((f as ConformantFrame).bytes) : "none";
  return other.sent.length ? `${text}, and ${other.sent.length} message(s) on the loser` : text;
}

async function quicFirst(race: Implementation, check: Check) {
  const s = await dial(race, 0, 100);
  const [wt, ws] = [FakeTransport.last, FakeWebSocket.last];
  check((await servedOn(s, wt, ws)) === "won", `race: QUIC first — the WebTransport session is kept and serves`);
  await sleep(150);
  check(ws.didClose, `race: QUIC first — the WebSocket is closed once it opens`);
  s.close();
}

async function tcpFirst(race: Implementation, check: Check) {
  const s = await dial(race, 100, 0);
  const [wt, ws] = [FakeTransport.last, FakeWebSocket.last];
  check((await servedOn(s, ws, wt)) === "won", `race: TCP first — the WebSocket session is kept and serves`);
  await sleep(150);
  check(wt.didClose, `race: TCP first — the WebTransport session is closed once it is ready`);
  s.close();
}

async function quicRefused(race: Implementation, check: Check) {
  const s = await dial(race, null, 50);
  const [wt, ws] = [FakeTransport.last, FakeWebSocket.last];
  check((await servedOn(s, ws, wt)) === "won", `race: QUIC refused — the slower WebSocket is kept and serves`);
  s.close();

  let why = "it connected";
  await dial(race, null, null).then(
    (s) => s.close(),
    (e) => (why = String(e?.message ?? e)),
  );
  check(
    why.includes("dial refused") && why.includes("WebSocket"),
    `race: both refused — the dial fails naming both (${why})`,
  );
}

/** An opening fill rides neither dial's URL, where both servers would push it: it is asked on the winner. */
async function openingFillGoesToTheWinner(race: Implementation, check: Check) {
  installFakeTransport();
  installFakeWebSocket();
  FakeWebSocket.openAfterMs = 100;
  const got: number[] = [];
  const s = await (race.connect as (u: string, h: string, o: unknown) => Promise<ConformantSession>)(
    "https://conformance.invalid/",
    CERT,
    { fill: { from: 0, to: 1, onFrame: (f: ConformantFrame) => got.push(f.frameIndex), onError: () => {} } },
  );
  FakeWebSocket.openAfterMs = 0;
  await sleep(30);
  const [wt, ws] = [FakeTransport.last, FakeWebSocket.last];
  const asked = wt.controlMessages().map((m) => JSON.stringify(m));
  check(!/[?&]ask=/.test(wt.url) && !/[?&]ask=/.test(ws.url), `race: an opening fill rides neither dial's URL`);
  check(asked.includes(`{"op":"stream_frames","from":0,"to":1}`), `race: it is asked on the winner (${asked.join() || "nothing"})`);
  wt.pushOnOneStream([[0, enc.encode("a")], [1, enc.encode("b")]]);
  await sleep(30);
  check(got.join() === "0,1", `race: and lands through the fill's own callback (${got.join() || "none"})`);
  await sleep(150);
  s.close();
}

export async function runRace(race: Implementation, check: Check): Promise<void> {
  for (const clause of [quicFirst, tcpFirst, quicRefused, openingFillGoesToTheWinner]) {
    try {
      await clause(race, check);
    } catch (e) {
      check(false, `race: ${clause.name} threw: ${(e as Error)?.message ?? e}`);
    }
  }
}
