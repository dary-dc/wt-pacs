// REGIONDECODE's reading: ms an ask, the median of round medians [range], and × an arm paired by round (rounds
// under it). lab/av1/decode/region/README.md
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2] || "region.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1));
const VS = { oh: ["ref"], pool: ["ref"], centre: ["oh", "ref"], corner: ["oh", "ref"], k2: ["oh", "ref"], k3: ["oh", "ref", "pool"] };

const sets = [...new Set(rows.map((r) => r.set))];
const exact = rows.reduce((n, r) => n + r.exact, 0), frames = rows.reduce((n, r) => n + r.frames, 0);
console.log(`${new Set(rows.map((r) => r.round)).size} rounds; ${exact}/${frames} decodes exact on their checking pass`);
for (const throttle of [...new Set(rows.map((r) => r.throttle))].sort()) for (const set of sets) {
  const of = (arm) => new Map(rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm).map((r) => [r.round, med(r.ms)]));
  const arms = [...new Set(rows.filter((r) => r.set === set).map((r) => r.arm))];
  for (const arm of arms) {
    const m = of(arm), per = [...m.values()];
    const vs = (VS[arm] ?? []).filter((b) => arms.includes(b)).map((b) => {
      const ref = of(b), x = [...m].filter(([r]) => ref.has(r)).map(([r, v]) => v / ref.get(r));
      return `×${med(x).toFixed(3)} ${b} (${x.filter((v) => v < 1).length}/${x.length})`;
    });
    const r0 = rows.find((r) => r.set === set && r.arm === arm);
    const bytes = r0.blockBytes ? ` blocks ${(r0.blockBytes / r0.frames / 1e6).toFixed(2)} MB` : "";
    console.log(`${throttle}× ${set} ${arm}: ${f(med(per))} [${f(Math.min(...per))}–${f(Math.max(...per))}] ${vs.join(", ")}${bytes}`);
  }
}
