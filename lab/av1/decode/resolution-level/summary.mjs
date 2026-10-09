/**
 * RESLEVEL on the links: lab/av1/delivery/total-time/run.mjs's rows for `htj2k` against `res`, each paired by round. First picture:
 * htj2k's first exact frame, res's first level picture; every frame on screen: htj2k's last exact frame, res's last
 * level picture; full: every exact frame; zoom: res's first exact frame after its last level picture. lab/av1/decode/resolution-level/README.md
 *
 *   node lab/av1/decode/resolution-level/summary.mjs rows.jsonl
 */
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const kept = rows.filter((r) => !r.void && r.frames);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const span = (a) => `${med(a).toFixed(0)} [${Math.min(...a)}–${Math.max(...a)}]`;
const measures = {
  first: { htj2k: (r) => r.firstMs, res: (r) => r.firstMs },
  shown: { htj2k: (r) => r.decodedMs, res: (r) => r.shownMs },
  full: { htj2k: (r) => r.decodedMs, res: (r) => r.decodedMs },
};
console.log("ms from the fill's issue, median [min–max]; res ÷ htj2k, the median of rounds paired [range], res faster in k/n;" +
  " zoom = res's first exact frame − its last level picture; exact: frames, level pictures, over every visit");
const cells = [...new Set(rows.map((r) => `${r.set} ${r.link} ${r.throttle}`))];
for (const cell of cells) {
  const of = (arm, from = kept) => from.filter((r) => `${r.set} ${r.link} ${r.throttle}` === cell && r.arm === arm);
  const h = new Map(of("htj2k").map((r) => [r.round, r]));
  const res = of("res");
  const parts = Object.entries(measures).map(([k, f]) => {
    const q = res.filter((r) => h.has(r.round)).map((r) => f.res(r) / f.htj2k(h.get(r.round)));
    return `${k} ${span([...h.values()].map(f.htj2k))} → ${span(res.map(f.res))} ×${med(q).toFixed(2)} [${Math.min(...q).toFixed(2)}–${Math.max(...q).toFixed(2)}] ${q.filter((x) => x < 1).length}/${q.length}`;
  });
  const all = (arm) => of(arm, rows);
  const sum = (k) => [...all("htj2k"), ...all("res")].reduce((n, r) => n + (r[k] ?? 0), 0);
  const exact = `${sum("exact")}/${sum("frames")}, ${sum("failures")} failed`;
  const shown = `${all("res").reduce((n, r) => n + (r.previewExact ?? 0), 0)}/${all("res").reduce((n, r) => n + (r.previews ?? 0), 0)}`;
  console.log(`${cell} n=${h.size}/${res.length}: ${parts.join(" · ")} · zoom ${span(res.map((r) => r.firstExactMs - r.shownMs))} · exact ${exact}, level ${shown}`);
}
console.log(`VOID, dropped: ${rows.filter((r) => r.void).length} of ${rows.length}`);
