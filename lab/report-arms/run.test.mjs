// node lab/report-arms/run.test.mjs — the driver's rules (report-plan.md §7.2, §7.3): the wait runs before the
// browser's close; a server without `telemetry` is refused; a cell is whole rounds in Williams order, every row with
// its round and predecessor, `off'` its own unit loading as `off`, and its balance reported.
import { drive, plan, balance, unit, serverBanner } from "./run.mjs";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));

{
  const t0 = Date.now(), at = {};
  const error = await drive(async () => ({ close: () => { at.close = Date.now() - t0; } }),
    async () => { at.ending = Date.now() - t0; }, 200);
  check(error === null, "drive: no error");
  check(at.close - at.ending >= 190, `drive: the browser closes after the wait (ending ${at.ending} ms, close ${at.close} ms)`);
}
{
  let closed = false;
  const error = await drive(async () => ({ close: () => { closed = true; } }), async () => { throw new Error("gone"); }, 10);
  check(error === "gone" && closed, "drive: an ending that throws is recorded, and the browser still closed after the wait");
}
{
  const ok = "wt_url=https://127.0.0.1:1/\ncert_sha256=ab12\ntransport=x\ntelemetry=compile-time\n";
  check(serverBanner(ok).hash === "ab12", "banner: the telemetry build's hash");
  let refused = false;
  try { serverBanner(ok.replace("compile-time", "absent")); } catch { refused = true; }
  check(refused, "banner: a build without telemetry is refused");
}
{
  check(JSON.stringify(unit("beacon:H")) === JSON.stringify({ unit: "beacon:H", arm: "beacon", timing: "H" }), "unit: arm:timing");
  const twin = unit("off'");
  check(twin.unit === "off'" && twin.arm === "off", "unit: off' is its own unit and loads as off");
}
{
  const units = ["off", "beacon:H", "beacon:Y", "keepalive:H", "keepalive:Y", "session:1", "session:Y", "session:H", "off'"];
  const rows = plan(units, 18);
  check(rows.length === 9 * 18, `plan: 18 rounds of 9 (${rows.length})`);
  for (let r = 0; r < 18; r++) {
    const round = rows.filter((x) => x.round === r);
    check(new Set(round.map((x) => x.unit)).size === 9, `plan: round ${r} runs every unit once`);
    check(round[0].predecessor === null && round.slice(1).every((x, i) => x.predecessor === round[i].unit),
      `plan: round ${r}'s predecessors are the unit before`);
  }
  check(rows[0].unit !== rows[9].unit || rows[1].unit !== rows[10].unit, "plan: rounds 0 and 1 differ in order");
  const b = balance(rows, units);
  check(units.every((u) => b[u] === true), `balance: a whole period is balanced ${JSON.stringify(b)}`);
  const same = [0, 1, 2, 3].flatMap((round) => plan(units, 1).map((x) => ({ ...x, round })));
  check(Object.values(balance(same, units)).every((v) => v === false), "balance: one order repeated is not");
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("ok: the driver waits before the close, refuses a server without telemetry, and runs balanced Williams rounds");
