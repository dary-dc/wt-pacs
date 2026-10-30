// The base against the head on the total-time harness, the base again as the A/A arm, judged by lab/scripts/aa_rule.py
// with a confirming campaign: only a difference that repeats is flagged. README.md §Quick start, step 5.
//   NODE_PATH=$(npm root -g) node scripts/perf_nightly.mjs BASE_TREE HEAD_TREE [--rounds 12] [--frames 48] [--link r50000]
//     [--impairs clean,l1] [--throttles 1,4] [--asks K] [--view worker] [--out DIR]
// Each tree needs its decoders built (wasm/build/build.sh) and fetched (fetch_openjph.sh, fetch_xxh3.sh); exits 1 when a cell is worse.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../lab/order.mjs";
import { arms, kept, value } from "./perf_campaign.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [BASE, HEAD] = process.argv.slice(2, 4).map((t) => path.resolve(t));
const ROUNDS = Number(arg("--rounds", 12));
const N = Number(arg("--frames", 48));
const LINK = arg("--link", "r50000");
const IMPAIRS = arg("--impairs", "clean").split(",");
const THROTTLES = arg("--throttles", "1").split(",");
/** The asked-frame cell's visit: frame 0 shown, then frames 1 … ASKS asked one at a time; 0 runs none. */
const ASKS = Number(arg("--asks", 0));
/** Every arm on the product's viewer, timed from navigation, the head's under `?view=VIEW`. */
const VIEW = arg("--view", null);
/** SHA-256 of grey-16.j2c's decoded samples, the bytes grey-16.xxh3 digests. */
const GREY_SHA256 = "8364984ae3ff1fb10788edba60dc13a441bf121e63fffcf1f87d23b9f5b359d9";
const T = mkdtempSync(path.join(tmpdir(), "perf-nightly-"));
/** Each arm's rows, kept: a visit already there is not run again. */
const OUT = path.resolve(arg("--out", T));
mkdirSync(OUT, { recursive: true });
// The viewer fetches the series' metadata from the tree it is served from, so under a view the set sits in every tree.
const SET = VIEW ? path.join("lab", `.perf-nightly-${process.pid}`) : path.relative(ROOT, path.join(T, "frames"));
const TREES = VIEW ? [...new Set([ROOT, BASE, HEAD])] : [ROOT];
process.on("exit", () => {
  for (const tree of TREES) rmSync(path.join(tree, SET), { recursive: true, force: true });
  rmSync(T, { recursive: true, force: true });
});

// A tree without its decoder builds serves the page a 404 body, which the page then refuses as not the pinned build.
for (const tree of new Set([BASE, HEAD])) {
  try {
    execFileSync("sha256sum", ["-c", "--quiet", "../build/manifest.sha256"], { cwd: path.join(tree, "client/decode/wasm/built"), stdio: "pipe" });
  } catch {
    console.log(`${tree}: client/decode/wasm/built is not the build its manifest pins; client/decode/wasm/build/build.sh`);
    process.exit(1);
  }
}

function build(tree, name) {
  // Cargo keys a workspace crate's freshness on its sources' mtimes, not on the tree they sit in.
  const now = new Date();
  for (const f of execFileSync("git", ["ls-files", "-z", "--", "*.rs", "*Cargo.toml"], { cwd: tree, encoding: "utf8" }).split("\0").filter(Boolean)) {
    utimesSync(path.join(tree, f), now, now);
  }
  execFileSync("cargo", ["build", "-q", "--release", "-p", "series-server", "-p", "pack-series"], { cwd: tree, stdio: "inherit" });
  execFileSync("bash", ["client/transport/ts/build.sh", "--product"], { cwd: tree, stdio: "pipe" });
  const release = path.join(process.env.CARGO_TARGET_DIR ?? path.join(tree, "target"), "release");
  const bin = path.join(T, name);
  mkdirSync(bin);
  for (const b of ["series-server", "pack-series"]) copyFileSync(path.join(release, b), path.join(bin, b));
  return bin;
}
const baseBin = build(BASE, "base");
const headBin = HEAD === BASE ? baseBin : build(HEAD, "head");
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

const { names, variants } = arms(VIEW, Array(N).fill(readFileSync(path.join(ROOT, "client/contract/frames/grey-16.xxh3"), "utf8").trim()));
for (const tree of TREES) {
  const frames = path.join(tree, SET, "grey");
  mkdirSync(frames, { recursive: true });
  for (let i = 0; i < N; i++) copyFileSync(path.join(ROOT, "client/contract/frames/grey-16.j2c"), path.join(frames, `${String(i).padStart(3, "0")}.htj2k`));
  writeFileSync(path.join(frames, "variants.json"), JSON.stringify({ name: "grey", frames: N, truth: Array(N).fill(GREY_SHA256), variants }));
  writeFileSync(path.join(frames, "viewer.json"), JSON.stringify({ frameCount: N, codec: "htj2k", digests: variants[names.head].digests }));
}

const trees = { base: [baseBin, BASE], head: [headBin, HEAD], aa: [baseBin, BASE] };
const metrics = { fill: ["fill", "first"], ask: ["asked"] };
const cells = IMPAIRS.flatMap((impairment) => THROTTLES.flatMap((throttle) => (ASKS ? ["fill", "ask"] : ["fill"]).map((mode) => ({ impairment, throttle, mode }))));
const file = (arm, mode) => path.join(OUT, `${arm}-${mode}.jsonl`);
const read = (arm, mode) => (existsSync(file(arm, mode)) ? readFileSync(file(arm, mode), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const rowOf = (rs, { impairment, throttle }, round) => rs.find((r) => r.round === round && r.impairment === impairment && String(r.throttle) === throttle);
for (let round = 0; round < 2 * ROUNDS; round++) {
  for (const [k, cell] of order(cells, round).entries()) {
    for (const arm of order(Object.keys(trees), round + k)) {
      if (rowOf(read(arm, cell.mode), cell, round)) continue;
      const [bin, tree] = trees[arm];
      process.stderr.write(`${round} ${cell.impairment} ${cell.throttle}x ${cell.mode} ${arm}\n`);
      execFileSync("node", ["lab/av1/delivery/total-time/run.mjs", "--rounds", "1", "--first-round", String(round), "--links", LINK,
        "--impairs", cell.impairment, "--throttles", cell.throttle, "--frames", SET, "--variants", names[arm],
        ...(cell.mode === "ask" ? ["--fill", VIEW ? "0" : "1", "--asks-after", String(ASKS)] : []), ...(VIEW ? ["--origin", "navigation"] : []),
        "--bin", bin, "--serve", tree, "--out", file(arm, cell.mode)],
      { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, TMPDIR: T } });
    }
  }
}

const rows = Object.keys(trees).flatMap((arm) => Object.keys(metrics).flatMap((mode) => read(arm, mode).map((r) => ({ arm, mode, ...r }))));
const failed = rows.filter((r) => !r.void && !kept(r));
const inexact = failed.filter((r) => r.frames || r.afterMs?.length);
if (inexact.length) {
  console.log(`not exact, nothing judged: ${inexact.map((r) => `${r.arm} ${r.mode} ${r.impairment} ${r.throttle}x round ${r.round}`).join(", ")}`);
  process.exit(1);
}
const campaign = (first) => Object.fromEntries(cells.flatMap((cell) => metrics[cell.mode].map((metric) => {
  const values = (arm) => Array.from({ length: ROUNDS }, (_, k) => value(rowOf(rows.filter((r) => r.arm === arm && r.mode === cell.mode), cell, first + k), metric));
  return [`${cell.impairment}.${cell.throttle}x.${metric}`, { ref: values("base"), aa: values("aa"), arm: values("head") }];
})));
const complete = (c) => c.ref.some((v, k) => v !== null && c.aa[k] !== null && c.arm[k] !== null);
const [firsts, confirms] = [campaign(0), campaign(ROUNDS)];
const unjudged = Object.keys(firsts).filter((name) => !complete(firsts[name]) || !complete(confirms[name]));
for (const name of unjudged) {
  console.log(`${name}: no round kept all three arms in a campaign: ${failed[0]?.errors[0] ?? "every visit VOID"}`);
  delete firsts[name];
}
if (!Object.keys(firsts).length) process.exit(1);
writeFileSync(path.join(T, "first.json"), JSON.stringify(firsts));
writeFileSync(path.join(T, "confirm.json"), JSON.stringify(confirms));
const verdicts = execFileSync("python3", ["lab/scripts/aa_rule.py", path.join(T, "first.json"), "--confirm", path.join(T, "confirm.json")],
  { cwd: ROOT, encoding: "utf8" }).trim().split("\n").map((l) => [l.split(" ")[0], JSON.parse(l.slice(l.indexOf(" ") + 1))]);

console.log(`base ${BASE} series-server ${sha(path.join(baseBin, "series-server"))}`);
console.log(`head ${HEAD} series-server ${sha(path.join(headBin, "series-server"))}`);
console.log(`the gate's grey codestream × ${N} on ${LINK} ${IMPAIRS.join(", ")} at ${THROTTLES.join("×, ")}×${VIEW ? `, every arm on the viewer from navigation, the head's under ?view=${VIEW}` : ""}, ` +
  `${ROUNDS} rounds and ${ROUNDS} confirming; dropped ${rows.filter((r) => r.void).length} VOID and ${failed.length} failed of ${rows.length} visits; ×: head ÷ base, base again ÷ base, median of rounds`);
if (failed.length) console.log(`failed: ${failed.map((r) => `${r.arm} ${r.mode} ${r.impairment} ${r.throttle}x round ${r.round} ${r.errors[0]?.slice(0, 80) ?? r.failure}`).join("; ")}`);
for (const [cell, v] of verdicts) console.log(`${cell}: ${v.verdict} — head ×${v.arm}, A/A ×${v.aa}, n ${v.n}, A/A sd ${v.sd}, catches ${(v.mdl * 100).toFixed(1)} %`);
process.exit(verdicts.some(([, v]) => v.verdict === "worse") ? 1 : 0);
