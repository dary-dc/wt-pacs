// node lab/report-arms/run.test.mjs — the driver's rules (report-plan.md §7.2, §7.3): the wait runs before the
// browser's close; a server without `telemetry` is refused; a cell is whole rounds in Williams order, every row with
// its round and predecessor, `off'` its own unit loading as `off`, and its balance reported; a load whose driver never answers is cut at its limit and VOID;
// D5a-busy's kill delay is drawn per load on 0–50 ms from its seed, and a fixed delay fails the spread check; its kill
// is timed from the worker's fault report and sent at the delay, with no call through the page.
import { drive, plan, balance, unit, serverBanner, killAfterFault, relayNetns, secureOrigins, DRIVER_VOID, killDelay,
  delaySpread, killOnFault } from "./run.mjs";

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
  let closed = false;
  const t0 = Date.now();
  const error = await drive(async () => ({ close: () => { closed = true; } }), () => new Promise(() => {}), 5000, 50);
  check(error === DRIVER_VOID && closed && Date.now() - t0 < 1000,
    `drive: steps that never return are cut at the limit, the browser killed and the row VOID (${error}, ${Date.now() - t0} ms)`);
}
{
  const units = ["off", "beacon:H", "beacon:Y", "keepalive:H", "keepalive:Y", "session:1", "session:Y", "session:H", "off'"];
  const rows = plan(units, 18).map((r) => ({ ...r, killDelay: killDelay(r.round, units.indexOf(r.unit)) }));
  const all = rows.map((r) => r.killDelay.ms);
  check(all.every((d) => d >= 0 && d < 50) && killDelay(3, 4).seed === 304 && killDelay(3, 4).ms === killDelay(3, 4).ms,
    "killDelay: on 0–50 ms, seed round × 100 + index, the same draw for the same seed");
  check(new Set(all).size === all.length, "killDelay: every load its own draw");
  const spread = delaySpread(rows);
  check(Object.values(spread).every((s) => !s.void), `delaySpread: the run's 18 draws per arm span ≥ 30 ms (${JSON.stringify(spread)})`);
  const fixed = delaySpread(rows.map((r) => ({ ...r, killDelay: { seed: 0, ms: 50 } })));
  check(Object.values(fixed).every((s) => s.void), "delaySpread: a fixed 50 ms delay makes every cell VOID");
}
{
  const t0 = performance.timeOrigin + performance.now();
  let crashedAt = null;
  const r = await killOnFault({ heard: () => t0, pause: (ms) => new Promise((ok) => setTimeout(ok, ms)),
    crash: async () => { crashedAt = performance.timeOrigin + performance.now() - t0; } }, 40);
  check(r.reached === "mismatch" && crashedAt >= 39 && crashedAt < 60 && r.kill.atKill >= 39,
    `killOnFault: the crash sent the drawn delay after the worker's fault (${crashedAt?.toFixed(1)} ms)`);
  const none = await killOnFault({ heard: () => null, pause: (ms) => new Promise((ok) => setTimeout(ok, ms)),
    crash: async () => { throw new Error("no crash without a fault"); }, timeoutMs: 30 }, 40);
  check(none.reached === "no mismatch" && none.kill === null, "killOnFault: no fault heard, no kill");
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

{
  // D5 (§7.3): the kill falls the ending's delay after the decoder's fault, not after the driver learns of it.
  const waits = [];
  const since = [12, 50.4];
  const t = await killAfterFault({ since: async () => since.shift(), pause: async (ms) => waits.push(ms) }, 50);
  check(waits.length === 1 && waits[0] === 38, `kill: waits the delay less the time already past (${waits})`);
  check(t.learned === 12 && t.atKill === 50.4 && t.late === false, `kill: the times read at the fault and at the kill ${JSON.stringify(t)}`);
  const lateWaits = [];
  const late = await killAfterFault({ since: async () => 70, pause: async (ms) => lateWaits.push(ms) }, 50);
  check(lateWaits.every((ms) => ms === 0) && late.late === true, "kill: a fault learned past the delay kills at once, marked late");
}
{
  // D6 (§7.2): under --tun the receivers live in the relay's server namespace, at an address Chromium must be told
  // is secure, or the page is neither cross-origin isolated nor allowed WebTransport.
  const ready = "READY udp=[] tcp=None ctrl=5556 delay_ms=10 jitter_ms=0 rate_kbit=50000 rate_up_kbit=50000 tun=10.77.0.1->10.77.0.2 server_netns=/proc/77/ns/net";
  check(relayNetns(ready) === "/proc/77/ns/net", "tun: the server namespace from the relay's READY line");
  check(relayNetns("READY udp=[5555]") === null, "tun: no namespace without --tun");
  check(JSON.stringify(secureOrigins("10.77.0.2", [8000, 9000])) === JSON.stringify(["--unsafely-treat-insecure-origin-as-secure=http://10.77.0.2:8000,http://10.77.0.2:9000"]),
    "tun: every receiver's origin declared secure");
  check(secureOrigins("127.0.0.1", [8000]).length === 0, "loopback: no flag, it is secure already");
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("ok: the driver waits before the close, refuses a server without telemetry, and runs balanced Williams rounds");
