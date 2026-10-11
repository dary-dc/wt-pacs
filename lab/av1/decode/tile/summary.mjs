// TILEMEASURE's reading: ms an ask, the median of round medians [range]; × ref paired by round (rounds at or under
// the rule's ×0.60 of n), t3 against REGIONDECODE's three stripes paired; bytes from the manifest.
// lab/av1/decode/tile/README.md
import { readFileSync } from "node:fs";

const rows = readFileSync(process.argv[2] || "tile.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const manifest = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : [];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1));

const exact = rows.reduce((n, r) => n + r.exact, 0), frames = rows.reduce((n, r) => n + r.frames, 0);
console.log(`${new Set(rows.map((r) => r.round)).size} rounds; ${exact}/${frames} asks exact on their checking pass`);
console.log("settings:", JSON.stringify(rows[0].settings));
for (const s of manifest) {
  const whole = s.frames.reduce((n, x) => n + x.whole, 0);
  const t = (k) => s.frames.reduce((n, x) => n + x[`t${k}`].reduce((a, b) => a + b, 0), 0) / whole;
  console.log(`bytes ${s.name} ${s.width}×${s.height}: t2 ×${t(2).toFixed(4)}, t3 ×${t(3).toFixed(4)} of ${whole} B`);
}
const sets = [...new Set(rows.map((r) => r.set))];
for (const throttle of [...new Set(rows.map((r) => r.throttle))].sort()) for (const set of sets) {
  const of = (arm) => new Map(rows.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm).map((r) => [r.round, med(r.ms)]));
  const paired = (a, b) => { const x = of(a), y = of(b); return [...x].filter(([r]) => y.has(r)).map(([r, v]) => v / y.get(r)); };
  for (const arm of [...new Set(rows.filter((r) => r.set === set).map((r) => r.arm))]) {
    const per = [...of(arm).values()];
    let line = `${throttle}× ${set} ${arm}: ${f(med(per))} [${f(Math.min(...per))}–${f(Math.max(...per))}]`;
    if (arm !== "ref") {
      const x = paired(arm, "ref");
      line += ` ×${med(x).toFixed(3)} ref [${Math.min(...x).toFixed(3)}–${Math.max(...x).toFixed(3)}] (≤0.60 in ${x.filter((v) => v <= 0.6).length}/${x.length})`;
    }
    if (arm === "t3" && of("stripes3").size) {
      const x = paired("t3", "stripes3");
      line += `, ×${med(x).toFixed(3)} stripes3 (under in ${x.filter((v) => v < 1).length}/${x.length})`;
    }
    console.log(line);
  }
}
