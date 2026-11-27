/**
 * PIXELWORK's reading of pixel.mjs's rows: checks per arm, ms a frame per arm and cell, the round-paired ratios with a
 * distribution-free 95 % interval, stage shares, the host's busy seconds, and the decision rule as pre-registered in
 * README.md here §Lossy pixel work protocol, pre-registered.
 *
 *   node lab/av1/delivery/residual/pixel-report.mjs rows.json [planned1x,planned4x] > summary.txt
 */
import { existsSync, readFileSync } from "node:fs";

const FILE = process.argv[2];
const PLANNED = (process.argv[3] ?? "152,40").split(",").map(Number);
const CONTROL = "mr_ispy1";
const DBT = ["dbts_a1", "dbts_b1", "dbts_c1"];
const rows = JSON.parse(readFileSync(FILE, "utf8"));

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Copied from lab/av1/decode/passes/report.mjs (origin/claude/av1-unified-mainbase), as the protocol says. */
function rank(n) {
  let p = 0;
  let term = Math.pow(0.5, n);
  let k = 0;
  while (k < n) {
    if (p + term > 0.025) break;
    p += term;
    k++;
    term *= (n - k + 1) / k;
  }
  return k;
}
function effect(logs) {
  const s = [...logs].sort((a, b) => a - b);
  const k = rank(s.length);
  return { n: s.length, ratio: Math.exp(median(s)), lo: k ? Math.exp(s[k - 1]) : NaN, hi: k ? Math.exp(s[s.length - k]) : NaN };
}

const MISS = (f) => f.exact === false || f.previewExact === false || f.equalL === false || f.equalPrep === false || f.digestsAgree === false;
const cells = new Map();
for (const r of rows) {
  const key = `${r.throttle}|${r.set}`;
  if (!cells.has(key)) cells.set(key, { throttle: r.throttle, set: r.set, rounds: [], errors: [] });
  const c = cells.get(key);
  if (r.error) c.errors.push(`round ${r.round}: ${r.error}`);
  else c.rounds.push(r);
}

const f2 = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const f3 = (v) => v.toFixed(4);
const pct = (v) => `${(100 * v).toFixed(0)} %`;
const spread = (v, f = f2) => (v?.length ? `${f(median(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}]` : "—");
const vals = (m) => (m ? [...m.values()].filter(Number.isFinite) : []);

/** arm → round → the median over its frames of `pick(frame)`. */
function perRound(c, pick = (f) => f.ms) {
  const out = {};
  for (const r of c.rounds) {
    const by = new Map();
    for (const f of r.frames) by.set(f.arm, [...(by.get(f.arm) ?? []), pick(f)]);
    for (const [arm, v] of by) (out[arm] ??= new Map()).set(r.round, median(v.filter(Number.isFinite)));
  }
  return out;
}

function pair(c, num, den) {
  const at = perRound(c);
  if (!at[num] || !at[den]) return null;
  const logs = [...at[num].keys()].filter((k) => at[den].has(k)).map((k) => Math.log(at[num].get(k) / at[den].get(k)));
  const e = effect(logs);
  // Order effect: frame-level ratios grouped by the numerator's predecessor, against their overall median.
  const byPrev = new Map();
  const all = [];
  for (const r of c.rounds) {
    const fr = new Map();
    for (const f of r.frames) fr.set(`${f.arm}|${f.frame}`, f);
    for (const f of r.frames) {
      if (f.arm !== num) continue;
      const d = fr.get(`${den}|${f.frame}`);
      if (!d) continue;
      const v = f.ms / d.ms;
      all.push(v);
      byPrev.set(f.prev ?? "first", [...(byPrev.get(f.prev ?? "first") ?? []), v]);
    }
  }
  const m = median(all);
  e.order = Math.max(...[...byPrev.values()].map((g) => Math.abs(median(g) / m - 1)));
  return e;
}

const out = (s = "") => console.log(s);
const chromium = [...new Set(rows.map((r) => r.chromium))].join(", ");
const renderer = [...new Set(rows.map((r) => r.renderer))].join(", ");
out(`Chromium ${chromium}; renderer ${renderer}; XXH3 vector ${[...new Set(rows.map((r) => r.xxh3Vector).filter((v) => v !== undefined))].join(",")}`);
out(`rounds: ${[...new Set(rows.map((r) => r.throttle))].sort().map((t) => `${t}x ${new Set(rows.filter((r) => r.throttle === t).map((r) => r.round)).size}`).join(", ")} (planned ${PLANNED[0]} at 1x, ${PLANNED[1]} at 4x)`);

out("\nchecks over every round and frame: exact = SHA-256 vs the fetched source; preview = dense Y vs native dav1d; =L = byte-equal to L; =prep = L equals the A arms' preview; agree = A/H digests equal");
const voids = new Set();
for (const c of cells.values()) {
  const arms = [...new Set(c.rounds.flatMap((r) => r.frames.map((f) => f.arm)))];
  const tally = arms.map((arm) => {
    const fs = c.rounds.flatMap((r) => r.frames.filter((f) => f.arm === arm));
    const keys = ["exact", "previewExact", "equalL", "equalPrep", "digestsAgree"].filter((k) => fs.some((f) => k in f));
    return `${arm} ${keys.map((k) => `${{ exact: "exact", previewExact: "preview", equalL: "=L", equalPrep: "=prep", digestsAgree: "agree" }[k]} ${fs.filter((f) => f[k]).length}/${fs.length}`).join(" ")}`;
  });
  const missed = c.rounds.some((r) => r.frames.some(MISS)) || c.errors.length;
  if (missed) voids.add(`${c.throttle}|${c.set}`);
  out(`${c.throttle}x\t${c.set}\t${tally.join("\t")}${c.errors.length ? `\tERRORS ${c.errors.join("; ")}` : ""}${missed ? "\tVOID" : ""}`);
}

out("\nms a frame: median of the rounds' medians over 16 frames [range over rounds]");
const ARMS = ["L", "LR", "LS", "A2", "A1", "A1′", "AS", "H"];
for (const c of cells.values()) {
  const at = perRound(c);
  out(`${c.throttle}x\t${c.set}\t${ARMS.filter((a) => at[a]).map((a) => `${a} ${spread([...at[a].values()])}`).join("\t")}`);
}

out("\nstages, ms a frame, median [range over rounds]: decode = WebCodecs group span ÷ frames (chunk in → flush resolved); chunk→output; flush; digest of each arm's output; OpenJPH call (H's: a twin decode outside its span)");
for (const c of cells.values()) {
  const span = c.rounds.map((r) => median(r.groups.map((g) => g.span / g.chunkToOutput.length)));
  const c2o = c.rounds.map((r) => median(r.groups.flatMap((g) => g.chunkToOutput)));
  const flush = c.rounds.map((r) => median(r.groups.map((g) => g.flush)));
  const dg = perRound(c, (f) => f.digestMs);
  const codec = perRound(c, (f) => f.codec ?? NaN);
  out(`${c.throttle}x\t${c.set}\tdecode ${spread(span)}\tchunk→output ${spread(c2o)}\tflush ${spread(flush)}`
    + `\tdigest L ${spread(vals(dg.L))} A1 ${spread(vals(dg.A1))} H ${spread(vals(dg.H))}`
    + `\tOpenJPH in A1 ${spread(vals(codec.A1))} in H ${spread(vals(codec.H))}`);
}

out("\npixel work after decode, share of the design's frame, median [range over rounds]");
const shares = new Map();
for (const c of cells.values()) {
  const at = perRound(c);
  const dg = perRound(c, (f) => f.digestMs);
  const codec = perRound(c, (f) => f.codec ?? NaN);
  const dec = new Map(c.rounds.map((r) => [r.round, median(r.groups.map((g) => g.span / g.chunkToOutput.length))]));
  const ks = [...at.L.keys()];
  const d1 = ks.map((k) => (at.L.get(k) + dg.L.get(k)) / (dec.get(k) + at.L.get(k) + dg.L.get(k)));
  const d2 = ks.map((k) => (at.A1.get(k) - codec.A1.get(k) + dg.A1.get(k)) / (at.A1.get(k) + dg.A1.get(k)));
  const d3 = ks.map((k) => (at.H.get(k) - codec.H.get(k) + dg.H.get(k)) / (at.H.get(k) + dg.H.get(k)));
  shares.set(`${c.throttle}|${c.set}`, { d1: median(d1), d2: median(d2), d3: median(d3) });
  out(`${c.throttle}x\t${c.set}\tdesign 1 ${spread(d1, pct)}\tdesign 2 ${spread(d2, pct)}\tdesign 3 ${spread(d3, pct)}`);
}

out("\nround-paired ratios: median [95 % interval] (n rounds; order effect = largest |by-predecessor median ÷ median − 1| over frames)");
const PAIRS = [["A1", "A2"], ["A1′", "A1"], ["LR", "L"], ["LS", "LR"], ["AS", "A1"]];
const res = new Map();
for (const c of cells.values()) {
  const key = `${c.throttle}|${c.set}`;
  const planned = c.throttle === 1 ? PLANNED[0] : PLANNED[1];
  const got = Object.fromEntries(PAIRS.map(([a, b]) => [`${a}÷${b}`, pair(c, a, b)]));
  res.set(key, got);
  out(`${c.throttle}x\t${c.set}\t${Object.entries(got).filter(([, e]) => e).map(([k, e]) =>
    `${k} ${f3(e.ratio)} [${f3(e.lo)}–${f3(e.hi)}] n ${e.n}${e.n < planned ? " SHORT" : ""} order ${(100 * e.order).toFixed(1)} %`).join("\t")}`);
}

out("\nthe rule, as pre-registered");
const readable = (key, name) => {
  const e = res.get(key)?.[name];
  if (voids.has(key)) return { ok: false, why: "void (a check missed)" };
  if (!e) return { ok: false, why: "no data" };
  if (e.order > 0.1) return { ok: false, why: `not read (order effect ${(100 * e.order).toFixed(0)} %)` };
  return { ok: true, e };
};
const keys = [...cells.keys()];
const aaMiss = keys.filter((k) => { const r = readable(k, "A1′÷A1"); return !r.ok || !(r.e.lo <= 1 && r.e.hi >= 1); });
out(`A/A (A1′÷A1 interval contains 1): ${keys.length - aaMiss.length}/${keys.length} cells; misses ${aaMiss.join(", ") || "none"} → ${aaMiss.length >= 2 ? "RUN VOID" : "run stands"}`);

function line(name, label) {
  const fails = [1, 4].flatMap((t) => [...DBT, CONTROL].map((d) => `${t}|${d}`)).filter((k) => !cells.has(k)).map((k) => `${k}: no data`);
  for (const k of keys) {
    const r = readable(k, name);
    const set = k.split("|")[1];
    if (!r.ok) { fails.push(`${k}: ${r.why}`); continue; }
    if (set === CONTROL) { if (!(r.e.hi <= 1.02)) fails.push(`${k}: upper end ${f3(r.e.hi)} > 1.02`); continue; }
    const why = [r.e.hi >= 1 && `upper end ${f3(r.e.hi)} ≥ 1.00`, r.e.ratio > 0.97 && `median ${f3(r.e.ratio)} > 0.97`].filter(Boolean);
    if (why.length) fails.push(`${k}: ${why.join(", ")}`);
  }
  out(`${label}: ${fails.length ? `NO — ${fails.join("; ")}` : "YES, every cell"}`);
  return !fails.length;
}
line("A1÷A2", "#1, the add in one pass, is the add a lossy design's product build takes");
line("LR÷L", "R on the preview meets the same line");
const missing = [1, 4].flatMap((t) => DBT.map((d) => `${t}|${d}`)).filter((k) => !cells.has(k));
const sFails = missing.map((k) => `${k}: no data`);
for (const k of keys.filter((k) => !k.endsWith(CONTROL))) {
  for (const name of ["LS÷LR", "AS÷A1"]) {
    const r = readable(k, name);
    if (!r.ok) sFails.push(`${k} ${name}: ${r.why}`);
    else if (!(r.e.hi < 0.9)) sFails.push(`${k} ${name}: upper end ${f3(r.e.hi)} ≥ 0.90`);
  }
}
out(`S proposed for building (LS÷LR and AS÷A1 entirely below 0.90 in every DBT cell): ${sFails.length ? `NO — ${sFails.join("; ")}` : "YES"}`);

out("\npredictions (falsified by a DBT cell whose median lies outside)");
const PRED = { "A1÷A2": [0.8, 0.9], "LR÷L": [0.65, 0.9], "LS÷LR": [0.5, 0.8], "AS÷A1": [0.78, 0.9] };
for (const [name, [lo, hi]] of Object.entries(PRED)) {
  const outside = keys.filter((k) => !k.endsWith(CONTROL)).filter((k) => { const e = res.get(k)?.[name]; return e && (e.ratio < lo || e.ratio > hi); });
  out(`${name} ${lo}–${hi}: ${outside.length ? `FALSIFIED by ${outside.map((k) => `${k} ${f3(res.get(k)[name].ratio)}`).join(", ")}` : "held"}`);
}
for (const [d, [lo, hi]] of Object.entries({ d1: [0.45, 0.75], d2: [0.3, 0.5], d3: [0.04, 0.09] })) {
  const outside = keys.filter((k) => !k.endsWith(CONTROL)).filter((k) => shares.get(k)[d] < lo || shares.get(k)[d] > hi);
  out(`design ${d[1]} share ${pct(lo)}–${pct(hi)}: ${outside.length ? `FALSIFIED by ${outside.map((k) => `${k} ${pct(shares.get(k)[d])}`).join(", ")}` : "held"}`);
}

const BUSY = `${FILE}.busy`;
if (existsSync(BUSY)) {
  const b = readFileSync(BUSY, "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
  const share = b.slice(1).map((x, i) => (x[1] - b[i][1]) / (x[2] - b[i][2])).filter(Number.isFinite);
  out(`\nhost busy (every CPU, a second at a time, ${share.length} s): median ${pct(median(share))}, busiest ${pct(Math.max(...share))}, seconds ≥ 95 % ${pct(share.filter((s) => s >= 0.95).length / share.length)}`);
}
