/**
 * The stamps' own check: a stage lengthened by a spin of X ms must grow by X and nothing outside it may, with the
 * frame still covered; then every stamp moved across its work, one copy each, and the check must fail. README.md here
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decode/breakdown/attribution.mjs [--x 40] [--only STAGE,…] [--no-mutations]
 */
import path from "node:path";
import { build, stages } from "./stamp.mjs";
import { inChromium, serve } from "./run.mjs";
import { coverage, durations, median, spans } from "./stages.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const X = Number(arg("--x", 100));
/** The first frames run before WASM tiers up; the check reads the rest. */
const COUNT = 6;
const SKIP = 2;
const ONLY = arg("--only", null)?.split(",");
const ROOT = new URL("../../../..", import.meta.url).pathname;
const WORK = "lab/.av1-work/breakdown";

const WC = ["config", "decode", "copyTo", "neutral", "flush"];
/** stage → the arms it runs in, the spin key, and the measured names the spin must land on. */
function plan(stage) {
  if (stage.startsWith("dav1d.")) return { arms: ["D"], spin: stage, grow: [`top.${stage.slice(6)}`, `low.${stage.slice(6)}`] };
  if (WC.includes(stage)) return { arms: ["W"], spin: `top.${stage}`, grow: [`top.${stage}`], ignore: "low." };
  const arms = { codec: ["H", "D"], digest: ["H", "D"], parse: ["D", "W"], place1: ["D", "W"], place2: ["D", "W"], fused: ["W2"], "z.inflate": ["Z_D", "Z_W"], "z.unpack": ["Z_D", "Z_W"] };
  return { arms: arms[stage], spin: stage, grow: [stage], ignore: stage === "z.inflate" ? "top." : null };
}

/** The verdict on one stage in one copy: whether every arm attributes the spin to it alone. */
async function check(base, stamped, stage) {
  const p = plan(stage);
  const why = [];
  for (const arm of p.arms) {
    const o = { frames: `${WORK}/frames`, stamped: `/${stamped}/client/decode`, sets: ["dbts_c1"], only: [arm], count: COUNT };
    const runs = { off: [], on: [] };
    for (let pair = 0; pair < 2; pair++) {
      for (const side of pair ? ["on", "off"] : ["off", "on"]) {
        const [row] = await inChromium(base, 1, { ...o, round: pair, spin: side === "on" ? { [p.spin]: X } : undefined });
        if (row.error || row.exact !== row.n) { why.push(`${arm} ${side}: ${row.exact}/${row.n} exact ${row.error ?? ""}`); continue; }
        runs[side].push(...row.frames.slice(SKIP).map((f) => ({ d: durations(spans(f.stamps)), c: coverage(spans(f.stamps), f.ms) })));
      }
    }
    if (!runs.on.length || !runs.off.length) continue;
    const names = new Set([...runs.on, ...runs.off].flatMap((r) => Object.keys(r.d)));
    const delta = (k) => median(runs.on.map((r) => r.d[k] ?? 0)) - median(runs.off.map((r) => r.d[k] ?? 0));
    for (const k of names) {
      if (k === "codec" || (p.ignore && k.startsWith(p.ignore))) continue;
      const dk = delta(k);
      const want = p.grow.includes(k);
      if (want && !(dk >= 0.8 * X && dk <= 1.2 * X + 3)) why.push(`${arm} ${k} grew ${dk.toFixed(1)} ms, not ${X}`);
      if (!want && Math.abs(dk) > 0.25 * X) why.push(`${arm} ${k} moved ${dk.toFixed(1)} ms`);
    }
    for (const k of p.grow) if (!names.has(k)) why.push(`${arm} has no ${k}`);
    // A spin in `codec` lies outside every stage it encloses: by design, not a gap.
    for (const side of stage === "codec" ? ["off"] : ["off", "on"]) {
      const c = median(runs[side].map((r) => r.c));
      if (c < 0.97 || c > 1.001) why.push(`${arm} ${side} covers ${(100 * c).toFixed(1)} %`);
    }
  }
  return why;
}

const { base } = await serve();
const list = stages().filter((s) => !ONLY || ONLY.includes(s));
let bad = 0;
build(path.join(ROOT, WORK, "stamped"));
for (const stage of list) {
  const why = await check(base, `${WORK}/stamped`, stage);
  console.log(`${why.length ? "FAIL" : "ok  "} ${stage} as built${why.length ? `: ${why.join("; ")}` : ""}`);
  bad += why.length > 0;
}
if (!process.argv.includes("--no-mutations")) {
  for (const stage of list) {
    for (const side of ["s", "e"]) {
      const dir = `${WORK}/moved/${stage}.${side}`;
      build(path.join(ROOT, dir), { move: `${stage}:${side}` });
      const why = await check(base, dir, stage);
      console.log(`${why.length ? "caught" : "MISSED"} ${stage}:${side} moved${why.length ? `: ${why[0]}` : ""}`);
      bad += why.length === 0;
    }
  }
}
console.log(bad ? `${bad} wrong` : "every stage attributed, every moved stamp caught");
process.exit(bad ? 1 : 0);
