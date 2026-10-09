/**
 * MIXDEC's reading of row TOTAL's rows: per (series, link) at 4×, every frame on the page — median ms [range], n
 * kept — and the mixed arm's round-paired ratios to today's (same k), to w10 and to HTJ2K. VOID visits dropped.
 *
 *   node lab/av1/decode/mixed/total_summary.mjs rows.jsonl ...   — lab/av1/decode/mixed/README.md
 */
import { readFileSync } from "node:fs";

const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
const kept = rows.filter((r) => !r.void && r.frames);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const BITS = { ct_lidc: 13, xa_dynact16: 13, ct_nlst: 13, ct_crc: 13, dbtproj_ge: 14, dbtproj_holo: 14 };
const frames = (set) => Math.max(...rows.filter((r) => r.set === set).map((r) => r.exact));
console.log(`exact ${rows.reduce((n, r) => n + r.exact, 0)}/${rows.reduce((n, r) => n + frames(r.set), 0)} over every visit; VOID ${rows.filter((r) => r.void).length} of ${rows.length}`);
for (const set of Object.keys(BITS)) {
  for (const link of [...new Set(rows.map((r) => r.link))]) {
    const of = (arm) => new Map(kept.filter((r) => r.set === set && r.link === link && r.arm === arm).map((r) => [r.round, r.decodedMs]));
    const paired = (a, b) => [...a].filter(([r]) => b.has(r)).map(([r, v]) => v / b.get(r));
    const w10 = of(`k${BITS[set] - 10}`);
    const parts = [`htj2k ${med([...of("htj2k").values()])} n=${of("htj2k").size}`];
    for (const k of [BITS[set] - 12 || 1, 2, 3].filter((k, i, a) => a.indexOf(k) === i && BITS[set] - k > 10)) {
      const today = of(`k${k}`);
      const mixed = of(`k${k}m`);
      const ratio = (x, to) => { const p = paired(x, to); return p.length ? `${med(p).toFixed(3)} [${Math.min(...p).toFixed(2)}–${Math.max(...p).toFixed(2)}] (${p.filter((v) => v < 1).length}/${p.length} faster)` : "—"; };
      parts.push(`k${k} ${med([...today.values()])} n=${today.size} · k${k}m ${med([...mixed.values()])} n=${mixed.size}` +
        ` ×today ${ratio(mixed, today)} ×w10 ${ratio(mixed, w10)} ×HTJ2K ${ratio(mixed, of("htj2k"))} (today ×HTJ2K ${ratio(today, of("htj2k"))})`);
    }
    parts.push(`w10 ${med([...w10.values()])} n=${w10.size} ×HTJ2K ${(() => { const p = paired(w10, of("htj2k")); return p.length ? med(p).toFixed(3) : "—"; })()}`);
    console.log(`${set} ${link} 4x: ${parts.join(" · ")}`);
  }
}
