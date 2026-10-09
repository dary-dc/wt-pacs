/**
 * FOOTPRINT's tables from run.mjs's rows: medians over rounds [range], n, and every cell's exact frames.
 *
 *   node lab/av1/decode/memory/summary.mjs mem.jsonl first.jsonl
 */
import fs from "node:fs";

const rows = process.argv.slice(2).flatMap((f) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const fmt = (a, d = 1) => (a.length ? `${med(a).toFixed(d)} [${Math.min(...a).toFixed(d)}–${Math.max(...a).toFixed(d)}]` : "—");
const MB = 1048576;
const keys = (rs, k) => [...new Set(rs.map((r) => r[k]))];
const clean = (r) => !r.error && r.exact === r.checked && r.checked > 0;

const mem = rows.filter((r) => r.mode === "mem");
if (mem.length) {
  console.log("### memory, per worker (MB): WASM linear memory exact, JS+WASM the page's measure ÷ D, RSS slope paired in a round\n");
  console.log("| set | arm | D | heap first | heap series | heap again | JS+WASM series | RSS series | RSS peak | n |");
  console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const set of keys(mem, "set")) for (const arm of keys(mem.filter((r) => r.set === set), "arm")) {
    for (const D of keys(mem, "decoders").sort((a, b) => a - b)) {
      const rs = mem.filter((r) => r.set === set && r.arm === arm && r.decoders === D && clean(r));
      if (!rs.length) continue;
      const heap = (s) => rs.map((r) => Math.max(...r.checkpoints[s].heap) / MB);
      console.log(`| ${set} | ${arm} | ${D} | ${fmt(heap("first"))} | ${fmt(heap("series"))} | ${fmt(heap("again"))} | ` +
        `${fmt(rs.map((r) => r.checkpoints.series.workers.reduce((a, b) => a + b, 0) / D / MB))} | ` +
        `${fmt(rs.map((r) => r.rss_kib.series / 1024))} | ${fmt(rs.map((r) => r.rss_hwm_kib / 1024))} | ${rs.length} |`);
    }
    const Ds = keys(mem, "decoders").sort((a, b) => a - b);
    for (const hi of Ds.slice(1)) {
      const lo = Ds[0];
      const slope = (k) => keys(mem, "round").flatMap((round) => {
        const at = (D) => mem.find((r) => r.round === round && r.set === set && r.arm === arm && r.decoders === D && clean(r));
        const a = at(lo), b = at(hi);
        return a && b ? [(k(b) - k(a)) / (hi - lo) / 1024] : [];
      });
      console.log(`| ${set} | ${arm} | slope ${lo}→${hi} | | | | | ${fmt(slope((r) => r.rss_kib.series))} | ${fmt(slope((r) => r.rss_hwm_kib))} | ${slope((r) => r.rss_kib.series).length} |`);
    }
  }
}

const first = rows.filter((r) => r.mode === "first");
if (first.length) {
  console.log("\n### first use (ms): init = the init message to ready; frame 0, 1, 2 = the decode message to its pixels on the page\n");
  console.log("| throttle | set | arm | visit | init | frame 0 | frames 1–2 | first-use cost | ×HTJ2K's | module from cache | n |");
  console.log("| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  const cost = (r) => r.init_ms + r.decode[0].page_ms - (r.decode[1].page_ms + r.decode[2].page_ms) / 2;
  for (const throttle of keys(first, "throttle")) for (const set of keys(first, "set")) for (const arm of keys(first.filter((r) => r.set === set), "arm")) {
    for (const visit of keys(first, "visit")) {
      const rs = first.filter((r) => r.throttle === throttle && r.set === set && r.arm === arm && r.visit === visit && clean(r));
      if (!rs.length) continue;
      const ref = (r) => first.find((x) => x.round === r.round && x.throttle === throttle && x.set === set && x.arm === "htj2k" && x.visit === visit && clean(x));
      const ratio = rs.filter(ref).map((r) => cost(r) / cost(ref(r)));
      const wasm = (r) => r.resources.filter((e) => e.name.endsWith(".wasm"));
      const cached = rs.some((r) => wasm(r).length)
        ? `${rs.filter((r) => wasm(r).some((e) => e.transfer === 0 && e.body > 0)).length}/${rs.length}` : "no module";
      console.log(`| ${throttle}× | ${set} | ${arm} | ${visit} | ${fmt(rs.map((r) => r.init_ms))} | ${fmt(rs.map((r) => r.decode[0].page_ms))} | ` +
        `${fmt(rs.flatMap((r) => [r.decode[1].page_ms, r.decode[2].page_ms]))} | **${fmt(rs.map(cost))}** | ` +
        `${arm === "htj2k" ? "" : fmt(ratio, 2)} | ${cached} | ${rs.length} |`);
    }
  }
}

const bad = rows.filter((r) => !clean(r));
console.log(`\nexact: ${rows.reduce((n, r) => n + (r.exact ?? 0), 0)}/${rows.reduce((n, r) => n + (r.checked ?? 0), 0)} frames; cells not clean ${bad.length}/${rows.length}`);
for (const r of bad.slice(0, 8)) console.log(`  ${r.mode} ${r.set} ${r.arm} D=${r.decoders ?? ""} ${r.visit ?? ""}: ${r.exact}/${r.checked} ${r.error ?? ""}`);
