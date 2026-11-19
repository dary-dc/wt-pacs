// node lab/transport-arms/judge.test.mjs — a visit's VOID reasons and the failures that stop the run (stacks.md §5.2, §5.4).
import { judge, pooledRelay } from "./judge.mjs";

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const fill = { action: "fill", n: 3 };
const visit = (o = {}) => ({
  relayTally: { late: false },
  busiestCore: 0.5,
  serverTicks: 10,
  protocols: ["h3"],
  exact: 3,
  dial: 100,
  frames: [0, 1, 2].map((i) => ({ i, exact: true, ask: 90 })),
  ...o,
});

// A clean visit is counted and the run goes on.
{
  const row = visit();
  check(judge(fill, row, { proto: "h3" }) === null && row.void === undefined, "a clean visit stops or is voided");
}

// B2: a frame that failed its check stops the run even when a VOID reason coincides (§5.2: "never voided").
{
  const row = visit({ relayTally: { late: true }, exact: 2, frames: [{ i: 0, exact: true }, { i: 1, exact: false }, { i: 2, exact: true }] });
  const stop = judge(fill, row, { proto: "h3" });
  check(/^STOP: frame 1 false/.test(stop ?? ""), `a failed check under a late relay gave ${stop}`);
  check(row.void?.[0] === "relay guard p99 over 1 ms", "the coinciding VOID reason is still recorded");
}

// A frame not delivered, with nothing voiding the visit, stops the run; voided, it is the void's.
{
  const short = { exact: 2, frames: [{ i: 0, exact: true }, { i: 1, exact: true }] };
  check(/^STOP: 2 of 3/.test(judge(fill, visit(short), { proto: "h3" }) ?? ""), "an undelivered frame did not stop the run");
  check(judge(fill, visit({ ...short, busiestCore: 0.99 }), { proto: "h3" }) === null, "an undelivered frame on a saturated core stopped the run");
}

// B3: a crashed visit on a fetch arm has no protocols; it is VOID crash, and the driver goes on.
{
  const row = visit({ crash: true, error: "page.evaluate: Target closed", protocols: undefined, exact: undefined, frames: undefined });
  let stop;
  try {
    stop = judge(fill, row, { proto: "h3" });
  } catch (e) {
    stop = `threw ${e.message}`;
  }
  check(stop === null, `a crash gave ${stop}`);
  check(row.void?.join() === "crash: page.evaluate: Target closed", `a crash voided as ${row.void}`);
}

// B1: on a WT or WS arm, a fill frame asked after the dial did not ride the opening ask, so the run stops.
{
  check(judge(fill, visit(), { opening: true }) === null, "a fill asked before the dial stopped the run");
  const row = visit({ frames: [0, 1, 2].map((i) => ({ i, exact: true, ask: 130 })) });
  const stop = judge(fill, row, { opening: true });
  check(stop === "STOP: frame 0, 1, 2 asked after the dial, not by the opening ask", `a fill asked after the dial gave ${stop}`);
  const ad = { action: "ad", n: 3 };
  const asked = visit({ frames: [{ i: 0, exact: true, ask: 90 }, { i: 1, exact: true, ask: 90 }, { i: 2, exact: true, ask: 400 }] });
  check(judge(ad, asked, { opening: true }) === null, "the cell's own ask of the last frame stopped the run");
}

// B4: a TCP arm's server sockets must run cubic, read back; anything else, or nothing read, stops the run.
{
  check(judge(fill, visit({ tcpCongestion: ["cubic"] }), { tcp: true }) === null, "cubic stopped the run");
  check(judge(fill, visit({ tcpCongestion: ["bbr"] }), { tcp: true }) === "STOP: the server's TCP ran bbr, not cubic", "bbr did not stop the run");
  check(/nothing read/.test(judge(fill, visit({ tcpCongestion: [] }), { tcp: true }) ?? ""), "nothing read did not stop the run");
}

// A zero server CPU is flagged in the cells CPU reads, not on a short visit elsewhere.
{
  const row = visit({ serverTicks: 0 });
  judge(fill, row, {});
  check(row.flags === undefined, "a zero CPU flagged outside CLEAN");
  judge({ ...fill, cpu: true }, row, {});
  check(/^CPU ZERO/.test(row.flags?.[0] ?? ""), "a zero CPU not flagged in CLEAN");
}

// A fetch arm on the wrong protocol is VOID.
{
  const row = visit({ protocols: ["h2"] });
  judge(fill, row, { proto: "h3" });
  check(row.void?.join() === "spoke h2, not h3", `the wrong protocol voided as ${row.void}`);
}

// The pilot's relay check: one visit too short to judge 0.1 % goes on; the form's visits pooled are judged, and refuse
// a relay at 0 % or too few packets in all.
{
  const lte = { action: "fill", n: 3, loss: 0.1 };
  const tally = (sent, lost) => ({ late: false, up: { sent: 0, lost: 0 }, down: { sent, lost } });
  check(judge(lte, visit({ relayTally: tally(27000, 30) }), { proto: "h3", pilot: true }) === null, "one short visit refused the pilot");
  const rows = (lost) => [0, 1, 2].map(() => ({ relayTally: tally(27000, lost) }));
  check(pooledRelay(lte, rows(30)) === null, `a relay at 0.11 % pooled was refused: ${pooledRelay(lte, rows(30))}`);
  check(/relay loss 0\.000 %/.test(pooledRelay(lte, rows(0)) ?? ""), "a relay at 0 % pooled was not refused");
  check(/too few/.test(pooledRelay(lte, rows(30).slice(0, 1)) ?? ""), "too few packets pooled were not refused");
  check(/relay loss/.test(judge({ ...lte, loss: 1 }, visit({ relayTally: tally(27000, 0) }), { proto: "h3", pilot: true }) ?? ""),
    "a visit long enough to judge alone was not refused at 0 %");
}

if (failed) process.exit(1);
console.log("transport-arms judge: ok");
