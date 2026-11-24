// node lab/viewer/ask-summary.mjs ROWS.jsonl … — page-runs.md §4's cells (claude/page-runs): each arm's wait a leg, the A/A spread, the guards
import { readFileSync } from "node:fs";
import { legWaits } from "./trace.js";

const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

/** A visit's reading, or why it is not counted; P2's one way counts the steps after the window's first W frames. */
export function reading(r) {
  if (r.void) return { why: "VOID" };
  if (r.failure || !r.legs) return { why: `failed: ${r.failure ?? "no legs"}` };
  const oneWay = r.legs.spec.oneWay;
  const legs = legWaits(r.legs.steps, oneWay ? { from: 1, skip: r.legs.w } : {});
  const mu = (r.legs.w - 1) / ((r.legs.fill.toMs - r.legs.fill.fromMs) / 1000);
  return { ...legs, mu, rho: mu * legs.stepMs / 1000, w: r.legs.w, interior: r.legs.interior, exact: r.exact, frames: r.frames };
}

const byCell = new Map();
for (const r of rows) {
  const k = `${r.cell} ${r.link}`;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push({ ...r, read: reading(r) });
}
for (const [cell, rs] of byCell) {
  const arms = [...new Set(rs.map((r) => r.variant))];
  const kept = (a) => rs.filter((r) => r.variant === a && r.read.meanS !== undefined);
  console.log(`${cell}: ${rs.length} visits, ${rs.filter((r) => r.read.why).length} not counted (${[...new Set(rs.filter((r) => r.read.why).map((r) => r.read.why))].join("; ")})`);
  for (const a of arms) {
    const k = kept(a);
    if (!k.length) { console.log(`  ${a}: none kept`); continue; }
    const m = k.map((r) => r.read.meanS);
    console.log(`  ${a}: wait a leg median ${med(m).toFixed(2)} s [${Math.min(...m).toFixed(2)}–${Math.max(...m).toFixed(2)}] n=${k.length}` +
      ` μ̂ ${med(k.map((r) => r.read.mu)).toFixed(2)}/s step ${med(k.map((r) => r.read.stepMs)).toFixed(0)} ms ρ ${med(k.map((r) => r.read.rho)).toFixed(3)}` +
      ` live ${(med(k.map((r) => r.read.live)) * 100).toFixed(0)} % received after the first pass ${med(k.map((r) => r.read.received))}` +
      ` W ${[...new Set(k.map((r) => r.read.w))]} interior ${k.reduce((n, r) => n + r.read.interior, 0)} exact ${k.reduce((n, r) => n + r.read.exact, 0)}/${k.reduce((n, r) => n + r.read.frames, 0)}`);
  }
  const ref = new Map(kept("centred").map((r) => [r.round, r.read.meanS]));
  const aa = kept("centredaa").filter((r) => ref.has(r.round)).map((r) => r.read.meanS - ref.get(r.round));
  if (aa.length) {
    const noisy = med(aa.map(Math.abs)) > 0.1;
    console.log(`  A/A centred′ − centred: median ${med(aa).toFixed(3)} s, 10th–90th ${pct(aa, 0.1).toFixed(3)} … ${pct(aa, 0.9).toFixed(3)}, median |Δ| ${med(aa.map(Math.abs)).toFixed(3)}${noisy ? " — too noisy: reads nothing" : ""} (n=${aa.length})`);
    for (const a of arms.filter((x) => !x.startsWith("centred"))) {
      const d = kept(a).filter((r) => ref.has(r.round)).map((r) => r.read.meanS - ref.get(r.round));
      if (d.length) console.log(`  ${a} − centred: median ${med(d).toFixed(3)} s, ${d.filter((x) => x < pct(aa, 0.1)).length} below and ${d.filter((x) => x > pct(aa, 0.9)).length} above the A/A spread of ${d.length}`);
    }
  }
}
