// round_headless.sh --plan's browser half: round_plan.mjs's whole round in quick mode on DIR's synthetic pair.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { roundPlan } from "./round_plan.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const dir = process.argv[2];
let failed = 0;
const check = (ok, claim) => (console.log(`${ok ? "ok" : "FAIL"}: ${claim}`), ok || (failed += 1));

const run = `${dir}/plan-run-window`;
mkdirSync(`${run}/bin`, { recursive: true });
const commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"]).toString().trim();
const round2 = process.argv[3] === "round2";
const views = ["synth-q8-g8", "synth-q8-g8"];
const plan = round2
  ? await roundPlan({ dir, run, dial: "127.0.0.1", views, counts: { pairs: 2 }, cells: ["3", "M"], commit })
  : await roundPlan({ dir, run, dial: "127.0.0.1", views, quick: true, commit });
// round-2.md's dry run: the round's 10 s cine, and the most steps 20 frames allow; a short gap.
// REVIEW VARIANT: cell M's window under the series (w = 6 of 20 frames), so the window is exercised.
const twoW = round2 && Math.max(...plan.blocks[0].loads.filter((x) => x.cell === "M").map((x) => x.budget));
if (round2) plan.blocks[0].loads.forEach((l) => { if (l.cell !== "M") return; const b = l.budget === twoW ? 12 : 6; Object.assign(l, { budget: b, arm: `${l.view} ${b}`, steps: Math.min(20, Math.floor((Math.min(20, b) - 1) / 2)), url: l.url.replace(/&budget=\d+/, `&budget=${b}`) }); });
if (round2) Object.assign(plan, { gapS: 2 }).blocks[0].loads.forEach((l) => l.cell === "3" && Object.assign(l, { steps: 9, cineS: 10 }));
writeFileSync(`${run}/plan.json`, JSON.stringify(plan));
writeFileSync(`${run}/bin/adb`, `#!/bin/sh\necho "$*" >> ${run}/adb.log\n`);
chmodSync(`${run}/bin/adb`, 0o755);
const loads = plan.blocks[0].loads;

const fresh = round2 ? ["--fresh-chrome", "--beacon", `${run}/beacon.jsonl`] : [];
const host = spawn("python3", ["lab/devices/round.py", `${run}/plan.json`, `${run}/out`, "--bind", "127.0.0.1", "--port", "8780", ...fresh],
  { cwd: ROOT, env: { ...process.env, PATH: `${run}/bin:${process.env.PATH}` }, stdio: ["ignore", "pipe", "inherit"] });
process.on("exit", () => host.kill("SIGTERM"));
await new Promise((resolve, reject) => {
  host.stdout.on("data", (d) => /press Start/.test(d) && resolve());
  host.once("exit", (c) => reject(new Error(`round.py exited ${c}`)));
});
const browser = await createRequire(import.meta.url)("playwright").chromium.launch();
const tab = await browser.newPage();
await tab.goto("http://127.0.0.1:8780/");
await tab.click("#start");
const events = () => (existsSync(`${run}/out/round.jsonl`) ? readFileSync(`${run}/out/round.jsonl`, "utf8").trim().split("\n").map(JSON.parse) : []);
const t0 = Date.now();
while (!events().some((e) => e.event === "round ended") && Date.now() - t0 < 900000) await new Promise((r) => setTimeout(r, 500));
await browser.close();

const records = existsSync(`${run}/beacon.jsonl`) ? readFileSync(`${run}/beacon.jsonl`, "utf8").trim().split("\n").map(JSON.parse) : [];
const of = (k, kind) => records.filter((r) => r.step === k && r.kind === kind);
const verdicts = loads.map((_, k) => of(k, "verdict")[0]);
const cells = Object.groupBy(loads.map((l, k) => ({ ...l, k })), (l) => `${l.cell}${l.counted === false ? " warm-up" : ""}${l.drift ? " drift" : ""}`);
check(events().some((e) => e.event === "round ended"), `one press runs the round's ${loads.length} loads to the end`);
for (const [cell, ls] of Object.entries(cells)) {
  const bad = ls.filter((l) => !verdicts[l.k]?.ok);
  check(!bad.length, `cell ${cell}: ${ls.length - bad.length} of ${ls.length} loads ok${bad.map((l) => `; ${l.k} ${l.arm}: ${verdicts[l.k]?.why ?? "no verdict"}`).join("")}`);
}
const bench = loads.flatMap((l, k) => (l.bench ? [[l, of(k, "bench")[0]]] : []));
check(bench.every(([l, b]) => b?.decoders === l.decoders && b.codec === (l.arm.startsWith("htj2k") ? "htj2k" : "av1")), "each cell 1 arm benches its codec on its decoder count");
const byArm = (arm) => loads.flatMap((l, k) => (l.cell === "2" && l.arm === arm && l.counted ? [of(k, "load")[0]] : []));
check(byArm("B").every((r) => r && r.exactSeries === null && r.lossy === null), "arm B fills the exact series alone");
check(["A", "C1", "C2"].every((a) => byArm(a).every((r) => r?.lossy)), "arms A, C1 and C2 fill the view");
const arm = (a) => loads.flatMap((l, k) => (l.cell === "2" && l.arm === a ? [k] : []));
check(arm("C2").every((k) => of(k, "exactFill")[0]?.frames.every((f) => f.exact === true)), "each C2 load fills the whole exact series, every frame exact");
check(arm("C1").every((k) => of(k, "label").some((x) => x.quality === "lossless")), "each C1 press reaches the exact frame");
if (round2) {
  const relaunched = events().filter((e) => e.event === "relaunch" || e.event === "relaunch skipped").map((e) => e.after);
  const expected = loads.flatMap((l, k) => (k + 1 < loads.length && !loads[k + 1].sameRenderer ? [k] : []));
  check(JSON.stringify(relaunched) === JSON.stringify(expected), `a relaunch after loads ${expected} (each before a load not on the same renderer), got ${relaunched}`);
  check(loads.every((l, k) => of(k, "memory")[0]?.window === Math.min(20, l.budget) && of(k, "memory")[0]?.budget === l.budget && "maxTextureSize" in of(k, "memory")[0]), "each load records its window, budget and MAX_TEXTURE_SIZE");
  check(loads.every((l, k) => of(k, "frameChange")[0]?.steps.length === 2 * l.steps && of(k, "cine").length === 2), "each load runs its steps and cine, idle and busy, at its size");
  check(loads.every((l, k) => l.cell !== "M" || of(k, "load")[0]?.received === Math.min(20, l.budget)), `each cell M load fills to its window: ${loads.map((l, k) => l.cell === "M" ? `${l.arm}:${of(k, "load")[0]?.received}` : "").filter(Boolean)}`);
  check(loads.every((l, k) => of(k, "drain").some((d) => d.path === "post")), "every load's last batch posted");
  check(loads.every((l, k) => of(k, "firstPicture").length === 1 && of(k, "firstPicture")[0].ms > 0), "each load records one first picture, ms from its navigation");
  check(loads.every((l, k) => (l.cell === "3" && l.view === "worker") === l.url.includes("&opts=")), "cell 3's worker loads, and only they, carry the start's fix");
} else check(loads.every((l, k) => l.cell !== "3" || (of(k, "frameChange")[0]?.steps.length === 6 && of(k, "cine").length === 2)), "each cell 3 load runs its steps and cine, idle and busy");
console.log(failed ? `round plan headless: ${failed} FAILED` : "round plan headless: every claim holds");
process.exit(failed ? 1 : 0);
