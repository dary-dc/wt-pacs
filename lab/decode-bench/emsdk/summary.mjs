/**
 * P-EMSDK and P-COPY read against their rules: per cell, each arm ÷ the reference paired by round — the median, its
 * range, and how many rounds sit at or under the bar — with every frame's exactness. lab/decode-bench/emsdk/README.md
 *
 *   node lab/decode-bench/emsdk/summary.mjs frame.json|rows.jsonl --ref A --arms B[,C] --bar 0.97 [--key decodedMs]
 */
import { readFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
const REF = arg("--ref");
const ARMS = arg("--arms").split(",");
const BAR = Number(arg("--bar"));
const KEY = arg("--key", null);
const text = readFileSync(file, "utf8").trim();
const rows = text.startsWith("[") ? JSON.parse(text) : text.split("\n").map((l) => JSON.parse(l));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
// A frame row is one round's frames, timed by the decoder; a fill row is one visit, `KEY` its time.
const value = (r) => (KEY ? r[KEY] : med(r.ms));
const usable = (r) => (KEY ? !r.void && r.frames && r.exact === r.owed : r.ms.length && r.exact === r.frames);
const cellOf = (r) => [r.set, r.link, r.throttle && `${r.throttle}x`].filter(Boolean).join(" ");
const cells = [...new Set(rows.map(cellOf))].sort();
const exact = (rs) => `${rs.reduce((n, r) => n + (r.exact ?? 0), 0)}/${rs.reduce((n, r) => n + (KEY ? r.owed : r.frames), 0)}`;
const arm = (r) => r.variant;
console.log(`${file}: ${ARMS.join(",")} ÷ ${REF} paired by round; bar ≤ ${BAR}${KEY ? `; ${KEY}` : "; ms a frame, a round's median"}`);
for (const cell of cells) {
  const at = rows.filter((r) => cellOf(r) === cell);
  const ref = new Map(at.filter((r) => arm(r) === REF && usable(r)).map((r) => [r.round, value(r)]));
  const parts = [`${REF} ${med([...ref.values()]).toFixed(1)} exact ${exact(at.filter((r) => arm(r) === REF))}`];
  for (const a of ARMS) {
    const mine = at.filter((r) => arm(r) === a);
    const ratio = mine.filter((r) => usable(r) && ref.has(r.round)).map((r) => value(r) / ref.get(r.round));
    if (!ratio.length) { parts.push(`${a}: no pair (${mine.length} visits)`); continue; }
    parts.push(`${a} ×${med(ratio).toFixed(3)} [${Math.min(...ratio).toFixed(3)}–${Math.max(...ratio).toFixed(3)}] ` +
      `≤ bar ${ratio.filter((x) => x <= BAR).length}/${ratio.length} exact ${exact(mine)}`);
  }
  console.log(`${cell}: ${parts.join("; ")}`);
}
