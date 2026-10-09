/**
 * HELPERSTART's tables from run.sh's rows: each cell's median [range] and the arms × the reference paired by round.
 * The relay's cells twice, strict (neither visit VOID) and round-paired (VOID kept). README.md
 *
 *   node lab/decode-bench/helper-start/summary.mjs ROWS_DIR
 */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const span = (a) => `${med(a).toFixed(1)} [${Math.min(...a).toFixed(1)}–${Math.max(...a).toFixed(1)}]`;
const ARMS = ["ref", "cb2", "cb2late"];
const armOf = { built: "ref", "lab:cb2": "cb2", "lab:cb2late": "cb2late" };

/** `rows` of one cell: {arm, round, ms, ok}; the ratio column also counts rounds at or under each bound. */
function line(cell, rows, bounds) {
  const by = (arm) => rows.filter((r) => r.arm === arm);
  const cols = ARMS.map((arm) => {
    const b = by(arm);
    if (!b.length) return "—";
    if (arm === "ref") return span(b.map((r) => r.ms));
    const ratios = b.map((r) => [r, by("ref").find((q) => q.round === r.round)]).filter(([, q]) => q).map(([r, q]) => r.ms / q.ms);
    const under = bounds.map((x) => `≤${x} ${ratios.filter((v) => v <= x).length}`).join(", ");
    return `${span(b.map((r) => r.ms))} ×${med(ratios).toFixed(3)} (${ratios.filter((v) => v < 1).length}/${ratios.length} faster; ${under})`;
  });
  const exact = rows.reduce((n, r) => n + r.exact, 0);
  const owed = rows.reduce((n, r) => n + r.owed, 0);
  console.log(`| ${cell} | ${cols.join(" | ")} | ${exact}/${owed} |`);
}

console.log("| cell | ref ms | cb2 ms, × ref paired by round | cb2late ms, × ref | exact |\n| --- | --- | --- | --- | --- |");
const loop = fs.readdirSync(dir).filter((f) => f.startsWith("loop-")).flatMap((f) => read(f).map((r) => ({ ...r, series: f.split("-")[1] })));
for (const series of ["g512", "proj"]) {
  for (const scenario of ["ready", "ask", "warm"]) {
    for (const throttle of [1, 4]) {
      const rows = loop.filter((r) => r.series === series && r.scenario === scenario && r.throttle === throttle)
        .map((r) => ({ arm: armOf[r.arm], round: r.round, ms: r.ms, exact: r.exact, owed: r.frames }));
      if (rows.length) line(`${series} ${scenario} loopback ${throttle}×`, rows, scenario === "warm" ? [0.85, 1.0] : [1.03]);
    }
  }
}

for (const [file, what] of [["ask-lte.jsonl", "cold ask"], ["fill.jsonl", "fill"]]) {
  if (!fs.existsSync(path.join(dir, file))) continue;
  const all = read(file);
  const cells = [...new Set(all.map((r) => `${r.set}|${r.link}|${r.throttle}`))].sort();
  for (const c of cells) {
    const [set, link, throttle] = c.split("|");
    const rows = all.filter((r) => `${r.set}|${r.link}|${r.throttle}` === c);
    const voided = rows.filter((r) => r.void).length;
    const as = (r) => ({ arm: r.variant, round: r.round, ms: r.decodedMs, exact: r.exact, owed: r.owed });
    line(`${set} ${what} ${link} ${throttle}× strict (VOID ${voided}/${rows.length})`, rows.filter((r) => !r.void && r.frames).map(as), [1.02, 1.03]);
    line(`${set} ${what} ${link} ${throttle}× round-paired`, rows.filter((r) => r.frames).map(as), [1.02, 1.03]);
  }
}
