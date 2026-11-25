// §7 for DELIVERY-RUN-2 (A2.8: 10 of 12): where A/A is not a tie, the band widened to the A/A pair's per-round ratio range; each verdict re-read
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const ROOT = new URL("../../../../../", import.meta.url).pathname;
const J = await import(`${ROOT}lab/delivery/judge.mjs`);
const R = `${ROOT}lab/delivery/rows/run2`;
const P = JSON.parse(fs.readFileSync(`${ROOT}lab/delivery/predictions.json`)).predictions;
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
for (const cell of process.argv.slice(2)) {
  const aa = JSON.parse(fs.readFileSync(`${R}/${cell}.aa.json`));
  const verdicts = Object.fromEntries(execFileSync("python3", [`${ROOT}lab/scripts/aa_rule.py`, `${R}/${cell}.aa.json`, "--bar", "0.05"]).toString().trim().split("\n").map((l) => [l.split(" ")[0], JSON.parse(l.slice(l.indexOf("{"))).verdict]));
  const pm = JSON.parse(fs.readFileSync(`${R}/${cell}-pilot.pilot-medians.json`));
  const rows = fs.readFileSync(`${R}/${cell}.jsonl`, "utf8").trim().split("\n").map(JSON.parse).filter((r) => !J.voidOf(r, { pilotMedian: pm[`${r.cell}/${r.volume}/${r.arm}`] }).why.length);
  for (const [key, v] of Object.entries(aa)) {
    if (verdicts[key] === "tie") continue;
    const volume = key.split("/")[1];
    const q = v.ref.map((r, i) => (r && v.aa[i] ? v.aa[i] / r : null)).filter((x) => x);
    const [aaLo, aaHi] = [Math.min(...q), Math.max(...q)];
    for (const p of P.filter((x) => x.cell === cell && x.volume === volume)) {
      const ratios = rows.filter((r) => r.volume === volume && r.arm === p.arm).map((r) => J.measured(r)[p.kind]).filter((m) => typeof m === "number").map((m) => m / p.ms);
      const band = [Math.min(p.band[0], aaLo), Math.max(p.band[1], aaHi)];
      const m = med(ratios), inB = ratios.filter((x) => x >= band[0] && x <= band[1]).length;
      const verdict = ratios.length < 10 ? "CANNOT HOLD" : m >= band[0] && m <= band[1] && inB >= 10 ? "HOLDS" : "MISSES";
      console.log(`${key} ${p.arm} ${p.kind} A/A ${aaLo.toFixed(2)}-${aaHi.toFixed(2)} band ${band.map((x) => x.toFixed(2)).join("-")} median ${m.toFixed(3)} ${inB}/${ratios.length} ${verdict}`);
    }
  }
}
