// The base against the head on the total-time harness, the base again as the A/A arm, judged by lab/scripts/aa_rule.py
// with a confirming campaign: only a difference that repeats is flagged. README.md §Quick start, step 5.
//   NODE_PATH=$(npm root -g) node scripts/perf_nightly.mjs BASE_TREE HEAD_TREE [--rounds 12] [--frames 48] [--link r50000]
// Each tree needs its decoders built (wasm/build/build.sh) and fetched (fetch_openjph.sh, fetch_xxh3.sh); exits 1 when a cell is worse.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../lab/order.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [BASE, HEAD] = process.argv.slice(2, 4).map((t) => path.resolve(t));
const ROUNDS = Number(arg("--rounds", 12));
const N = Number(arg("--frames", 48));
const LINK = arg("--link", "r50000");
/** SHA-256 of grey-16.j2c's decoded samples, the bytes grey-16.xxh3 digests. */
const GREY_SHA256 = "8364984ae3ff1fb10788edba60dc13a441bf121e63fffcf1f87d23b9f5b359d9";
const T = mkdtempSync(path.join(tmpdir(), "perf-nightly-"));
process.on("exit", () => rmSync(T, { recursive: true, force: true }));

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

const frames = path.join(T, "frames", "grey");
mkdirSync(frames, { recursive: true });
for (let i = 0; i < N; i++) copyFileSync(path.join(ROOT, "client/contract/frames/grey-16.j2c"), path.join(frames, `${String(i).padStart(3, "0")}.htj2k`));
const xxh3 = readFileSync(path.join(ROOT, "client/contract/frames/grey-16.xxh3"), "utf8").trim();
writeFileSync(path.join(frames, "variants.json"), JSON.stringify({ name: "grey", frames: N, truth: Array(N).fill(GREY_SHA256),
  variants: { htj2k: { digests: Array(N).fill(xxh3) } } }));

const arms = { base: [baseBin, BASE], head: [headBin, HEAD], aa: [baseBin, BASE] };
for (let round = 0; round < 2 * ROUNDS; round++) {
  for (const arm of order(Object.keys(arms), round)) {
    const [bin, tree] = arms[arm];
    process.stderr.write(`${arm} `);
    execFileSync("node", ["lab/av1/delivery/total-time/run.mjs", "--rounds", "1", "--first-round", String(round), "--links", LINK,
      "--throttles", "1", "--frames", path.relative(ROOT, path.dirname(frames)), "--bin", bin, "--serve", tree, "--out", path.join(T, `${arm}.jsonl`)],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, TMPDIR: T } });
  }
}

const rows = Object.fromEntries(Object.keys(arms).map((a) => [a, readFileSync(path.join(T, `${a}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l))]));
const failed = Object.entries(rows).flatMap(([arm, rs]) => rs.filter((r) => !r.void && r.exact !== r.owed).map((r) => ({ arm, ...r })));
const inexact = failed.filter((r) => r.frames);
if (inexact.length) {
  console.log(`not exact, nothing judged: ${inexact.map((r) => `${r.arm} round ${r.round}`).join(", ")}`);
  process.exit(1);
}
const kept = (arm, round) => rows[arm].find((r) => r.round === round && !r.void && r.exact === r.owed);
const campaign = (first) => Object.fromEntries([["fill", "decodedMs"], ["first", "firstMs"]].map(([cell, key]) => {
  const values = (arm) => Array.from({ length: ROUNDS }, (_, k) => kept(arm, first + k)?.[key] ?? null);
  return [cell, { ref: values("base"), aa: values("aa"), arm: values("head") }];
}));
for (const first of [0, ROUNDS]) {
  const { ref, aa, arm } = campaign(first).fill;
  if (!ref.some((v, k) => v !== null && aa[k] !== null && arm[k] !== null)) {
    console.log(`no round from ${first} kept all three arms: ${failed[0]?.errors[0] ?? "every visit VOID"}`);
    process.exit(1);
  }
}
writeFileSync(path.join(T, "first.json"), JSON.stringify(campaign(0)));
writeFileSync(path.join(T, "confirm.json"), JSON.stringify(campaign(ROUNDS)));
const verdicts = execFileSync("python3", ["lab/scripts/aa_rule.py", path.join(T, "first.json"), "--confirm", path.join(T, "confirm.json")],
  { cwd: ROOT, encoding: "utf8" }).trim().split("\n").map((l) => [l.split(" ")[0], JSON.parse(l.slice(l.indexOf(" ") + 1))]);

console.log(`base ${BASE} series-server ${sha(path.join(baseBin, "series-server"))}`);
console.log(`head ${HEAD} series-server ${sha(path.join(headBin, "series-server"))}`);
console.log(`the gate's grey codestream × ${N} on ${LINK} at 1×, ${ROUNDS} rounds and ${ROUNDS} confirming; ` +
  `dropped ${Object.values(rows).flat().filter((r) => r.void).length} VOID and ${failed.length} failed of ${3 * 2 * ROUNDS} visits; ×: head ÷ base, base again ÷ base, median of rounds`);
if (failed.length) console.log(`failed: ${failed.map((r) => `${r.arm} round ${r.round} ${r.errors[0]?.slice(0, 80)}`).join("; ")}`);
for (const [cell, v] of verdicts) console.log(`${cell}: ${v.verdict} — head ×${v.arm}, A/A ×${v.aa}, n ${v.n}, A/A sd ${v.sd}, catches ${(v.mdl * 100).toFixed(1)} %`);
process.exit(verdicts.some(([, v]) => v.verdict === "worse") ? 1 : 0);
