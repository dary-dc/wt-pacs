// node lab/transport-arms/judge.test.mjs — a visit's VOID reasons and the failures that stop the run (stacks.md §5.2, §5.4).
import { judge } from "./judge.mjs";

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
  frames: [0, 1, 2].map((i) => ({ i, exact: true })),
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

// A fetch arm on the wrong protocol is VOID.
{
  const row = visit({ protocols: ["h2"] });
  judge(fill, row, { proto: "h3" });
  check(row.void?.join() === "spoke h2, not h3", `the wrong protocol voided as ${row.void}`);
}

if (failed) process.exit(1);
console.log("transport-arms judge: ok");
