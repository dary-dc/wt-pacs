// SESSION-COST-RUN's cells against docs/server/session-cost.md §3, §4 (T1, claude/unified b059388b6) by §7's rule.
//   node lab/delivery/session-summary.mjs ROWS.jsonl [ROWS.jsonl …]
import fs from "node:fs";

const SERVER = "10.77.0.2";
/** §3 T1: frames asked a session, the three dwell asks included. */
const ASKS = {
  dbts_a1: { A: 56, "A+C1": 59, B: 56, FIT: 56 },
  dbts_b1: { A: 796, "A+C1": 799, B: 132, "FIT/15": 135, "FIT/63": 53 },
  dbts_c1: { A: 177, "A+C1": 180, B: 84, FIT: 84 },
  usb_cine: { B: 64 },
};
/** §4 T1: MB on the wire (±3 %) and server CPU in s on CLEAN; CR's CPU ×1.05–1.7 of CLEAN's. */
const WIRE = { dbts_a1: { A: 4.83, "A+C1": 8.53, B: 70.32, FIT: 70.32 }, dbts_b1: { A: 385.4, "A+C1": 392.0, B: 295.2, "FIT/15": 84.85, "FIT/63": 35.04 },
  dbts_c1: { A: 16.02, "A+C1": 19.14, B: 90.34, FIT: 90.34 }, usb_cine: { B: 5.17 } };
const CPU = { dbts_a1: { A: [0.028, 0.043], "A+C1": [0.045, 0.062], B: [0.33, 0.37], FIT: [0.33, 0.37] },
  dbts_b1: { A: [2.04, 2.46], "A+C1": [2.08, 2.5], B: [1.37, 1.52], "FIT/15": [0.4, 0.45], "FIT/63": [0.17, 0.19] },
  dbts_c1: { A: [0.088, 0.115], "A+C1": [0.1, 0.13], B: [0.42, 0.48], FIT: [0.42, 0.48] }, usb_cine: { B: [0.027, 0.04] } };
const CR_CPU = [1.05, 1.7];

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const range = (xs) => `${Math.min(...xs).toFixed(3)}–${Math.max(...xs).toFixed(3)}`;
/** Server → client UDP bytes, the series servers' flows in the relay's tally; the page's TCP apart; client → server beside. */
const wire = (r) => {
  const f = r.relayTally?.flows ?? [];
  const from = (x) => x.from.startsWith(`${SERVER}:`);
  const sum = (p) => f.filter(p).reduce((a, x) => a + x.bytes, 0);
  return { down: sum((x) => x.proto === "udp" && from(x)) / 1e6, page: sum((x) => x.proto === "tcp" && from(x)) / 1e6, up: sum((x) => !from(x)) / 1e6 };
};
const key = (r) => (r.arm === "FIT" && r.volume === "dbts_b1" ? `FIT/${r.session?.window}` : r.arm);

const rows = process.argv.slice(2).flatMap((f) => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
const counted = rows.filter((r) => !r.void?.length && !r.mutate && !r.warmup);
const cells = new Map();
for (const r of counted) {
  const k = `${r.cell} ${r.volume} ${key(r)}`;
  cells.set(k, [...(cells.get(k) ?? []), r]);
}
console.log(`${rows.length} rows, ${counted.length} counted; VOID ${rows.filter((r) => r.void?.length).length}: ${[...new Set(rows.flatMap((r) => r.void ?? []))].join("; ") || "none"}`);
console.log("cell | n | guard late | asks (pred) | MB down (pred ±3 %) | CPU s schedstat (pred) | peak RSS MB | page MB | up MB | length s | held");
const clean = new Map();
for (const [k, rs] of [...cells].sort()) {
  const [cell, volume, arm] = k.split(" ");
  const asks = median(rs.map((r) => r.session.asked + r.session.exactAsked));
  const w = rs.map(wire);
  const down = median(w.map((x) => x.down));
  const cpu = rs.map((r) => r.serverCost.reduce((a, c) => a + c.cpuNs, 0) / 1e9);
  const rss = rs.map((r) => Math.max(...r.serverCost.map((c) => (c.rssPeakKb - c.rssBeforeKb) / 1024)));
  if (cell === "CLEAN") clean.set(`${volume} ${arm}`, median(cpu));
  const pa = ASKS[volume]?.[arm], pw = WIRE[volume]?.[arm];
  const pc = cell === "CLEAN" ? CPU[volume]?.[arm] : clean.has(`${volume} ${arm}`) && CR_CPU.map((x) => x * clean.get(`${volume} ${arm}`));
  const held = {
    asks: pa !== undefined && Math.abs(asks - pa) <= 0.03 * pa,
    bytes: pw !== undefined && Math.abs(down - pw) <= 0.03 * pw,
    cpu: Boolean(pc) && median(cpu) >= pc[0] && median(cpu) <= pc[1],
    rss: median(rss) >= 0 && median(rss) <= 5,
  };
  const miss = Object.entries(held).filter(([, v]) => !v).map(([n]) => n);
  console.log(`${k} | ${rs.length} | ${rs.filter((r) => r.guardLate).length} | ${asks} (${pa ?? "—"}) | ${down.toFixed(2)} [${range(w.map((x) => x.down))}] (${pw ?? "—"}) | ${median(cpu).toFixed(3)} [${range(cpu)}] (${pc ? pc.map((x) => x.toFixed(3)).join("–") : "—"}) | ` +
    `${median(rss).toFixed(2)} [${range(rss)}] | ${median(w.map((x) => x.page)).toFixed(2)} | ${median(w.map((x) => x.up)).toFixed(2)} | ${(median(rs.map((r) => r.session.lengthMs)) / 1000).toFixed(1)} | ${miss.length ? `MISS ${miss.join(", ")}` : "held"}`);
}
