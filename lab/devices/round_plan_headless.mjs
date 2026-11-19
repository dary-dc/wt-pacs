// round_headless.sh --plan's browser half: round_plan.mjs's whole round in quick mode on DIR's synthetic pair.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { roundPlan } from "./round_plan.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const dir = process.argv[2];
let failed = 0;
const check = (ok, claim) => (console.log(`${ok ? "ok" : "FAIL"}: ${claim}`), ok || (failed += 1));

const run = `${dir}/plan-run`;
mkdirSync(`${run}/bin`, { recursive: true });
const commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"]).toString().trim();
const plan = await roundPlan({ dir, run, views: ["synth-q8-g8", "synth-q8-g8"], quick: true, commit });
writeFileSync(`${run}/plan.json`, JSON.stringify(plan));
writeFileSync(`${run}/bin/adb`, `#!/bin/sh\necho "$*" >> ${run}/adb.log\n`);
chmodSync(`${run}/bin/adb`, 0o755);
const loads = plan.blocks[0].loads;

const host = spawn("python3", ["lab/devices/round.py", `${run}/plan.json`, `${run}/out`, "--bind", "127.0.0.1", "--port", "8780"],
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
check(loads.every((l, k) => !l.exactFill || of(k, "exactFill")[0]?.frames.every((f) => f.exact === true)), "each C2 load fills the whole exact series, every frame exact");
check(loads.every((l, k) => l.press !== "lossless" || of(k, "label").some((x) => x.quality === "lossless")), "each C1 press reaches the exact frame");
check(loads.every((l, k) => !l.seq || (of(k, "frameChange")[0]?.steps.length === 2 * l.steps && of(k, "cine").length === 2)), "each cell 3 load runs its steps and cine, idle and busy");
console.log(failed ? `round plan headless: ${failed} FAILED` : "round plan headless: every claim holds");
process.exit(failed ? 1 : 0);
