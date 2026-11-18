// round_headless.sh's browser half: DIR holds synth.sbnd and synth-q8-g8.sbnd with their metadata.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const ROOT = new URL("../..", import.meta.url).pathname;
const dir = process.argv[2];
const children = [];
process.on("exit", () => children.forEach((c) => c.kill("SIGTERM")));
let failed = 0;
const check = (ok, claim) => (console.log(`${ok ? "ok" : "FAIL"}: ${claim}`), ok || (failed += 1));

const hash = JSON.parse(readFileSync(`${ROOT}/client/dev-transport.json`)).cert_sha256;
const cert = ["--cert-pem", "server/dev-cert/cert.pem", "--key-pem", "server/dev-cert/key.pem"];
const transport = (port) => {
  writeFileSync(`${dir}/t-${port}.json`, JSON.stringify({ wt_url: `https://127.0.0.1:${port}/`, cert_sha256: hash }));
  return `${dir}/t-${port}.json`;
};
const quic = (port, id) => ({ cmd: [`${ROOT}target/release/series-server`, "--port", String(port), "--congestion", "cubic-restart", "--series", `${dir}/${id}.sbnd`, ...cert], readyLine: "transport=" });
const page = (port, lossy, beacon) => ({
  cmd: ["python3", "server/dev-server.py", "--bind", "127.0.0.1", "--port", String(port), "--beacon", beacon,
    "--metadata", `${dir}/synth-q8-g8.metadata.json`, "--transport", transport(lossy),
    "--exact-metadata", `${dir}/synth.metadata.json`, "--exact-transport", transport(4434)],
  ready: `http://127.0.0.1:${port}/`,
});
const exactPage = (port, beacon) => ({
  cmd: ["python3", "server/dev-server.py", "--bind", "127.0.0.1", "--port", String(port), "--beacon", beacon,
    "--metadata", `${dir}/synth.metadata.json`, "--transport", transport(4434)],
  ready: `http://127.0.0.1:${port}/`,
});
// The exact series' metadata with frame 3's digest changed: a wrong frame for the bench and for C2 to fail on.
const wrongMeta = JSON.parse(readFileSync(`${dir}/synth.metadata.json`));
wrongMeta.digests.frames[3] = wrongMeta.digests.frames[3].replace(/.$/, (c) => (c === "0" ? "1" : "0"));
writeFileSync(`${dir}/synth-wrong.metadata.json`, JSON.stringify(wrongMeta));
const wrongPair = (port, beacon) => ({ ...page(port, 4433, beacon), cmd: page(port, 4433, beacon).cmd.map((a) => a.replace("synth.metadata", "synth-wrong.metadata")) });
const wrongExact = (port, beacon) => ({ ...exactPage(port, beacon), cmd: exactPage(port, beacon).cmd.map((a) => a.replace("synth.metadata", "synth-wrong.metadata")) });
const beacon = `${dir}/beacon.jsonl`;
const viewer = (port, view) => `http://127.0.0.1:${port}/?overlay=1&view=${view}&beacon=cubic-restart`;
// Load 2 dials a port no server answers (a load made to fail); load 3 holds its thread 2.6 s (a stall); after the
// fill, load 9 throws and load 10 never settles (the plan's afterS bounds it).
const loads = [
  { url: viewer(8765, "page"), cell: "2", arm: "C1", press: "lossless" },
  { url: viewer(8765, "worker"), cell: "2", arm: "C1", press: "lossless" },
  { url: viewer(8767, "page"), cell: "2", arm: "A" },
  { url: viewer(8765, "worker"), cell: "2", arm: "A", stall: 2600 },
  { url: viewer(8765, "page"), cell: "2", arm: "A" },
  { url: viewer(8765, "worker"), cell: "2", arm: "A" },
  { url: viewer(8765, "page"), cell: "2", arm: "A", press: "lossless" },
  { url: viewer(8765, "page"), cell: "3", arm: "page", seq: "view", steps: 3, cineS: 2 },
  { url: viewer(8765, "worker"), cell: "3", arm: "worker", seq: "view", steps: 3, cineS: 2 },
  { url: viewer(8765, "page"), cell: "2", arm: "A", fault: "throw" },
  { url: viewer(8765, "worker"), cell: "2", arm: "A", fault: "hang" },
  { url: viewer(8765, "page"), cell: "2", arm: "A" },
  { url: viewer(8768, "page"), cell: "1", arm: "htj2k-2", bench: 50, decoders: 2 },
  { url: viewer(8765, "page"), cell: "1", arm: "view-2", bench: 50, decoders: 2 },
  { url: viewer(8765, "page"), cell: "2", arm: "C2", exactFill: 1 },
  { url: viewer(8765, "page"), cell: "2", arm: "A", decoders: 1 },
  { url: viewer(8769, "page"), cell: "1", arm: "htj2k-2", bench: 50, decoders: 2 },
  { url: viewer(8770, "page"), cell: "2", arm: "C2", exactFill: 1 },
];
const head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"]).toString().trim();
const blocks = [{ name: "wifi", servers: [quic(4433, "synth-q8-g8"), quic(4434, "synth"), page(8765, 4433, beacon), page(8767, 4499, beacon), exactPage(8768, beacon), wrongExact(8769, beacon), wrongPair(8770, beacon)], loads }];
const planOf = (commit) => {
  writeFileSync(`${dir}/plan.json`, JSON.stringify({ commit, gapS: 1, fillS: 60, afterS: 45, blocks }));
  return `${dir}/plan.json`;
};

mkdirSync(`${dir}/bin`, { recursive: true });
writeFileSync(`${dir}/bin/adb`, `#!/bin/sh\necho "$*" >> ${dir}/adb.log\n`);
chmodSync(`${dir}/bin/adb`, 0o755);
const env = { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` };
const round = (plan, out) => spawn("python3", ["lab/devices/round.py", plan, out, "--bind", "127.0.0.1", "--port", "8780"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });

/** A plan at another commit: round.py refuses before load 1, no page served, nothing asked of adb. */
const wrong = round(planOf("0".repeat(40)), `${dir}/wrong`);
const code = await new Promise((r) => wrong.once("exit", r));
check(code === 1 && !existsSync(`${dir}/wrong/round.jsonl`) && !existsSync(`${dir}/adb.log`), "a run-commit mismatch stops before load 1");

const out = `${dir}/out`;
const host = round(planOf(head), out);
children.push(host);
await new Promise((resolve, reject) => {
  host.stdout.on("data", (d) => /press Start/.test(d) && resolve());
  host.once("exit", (c) => reject(new Error(`round.py exited ${c}`)));
});
const browser = await createRequire(import.meta.url)("playwright").chromium.launch();
const tab = await browser.newPage();
tab.on("pageerror", (e) => console.log(`page error: ${e.message}`));
await tab.goto("http://127.0.0.1:8780/");
await tab.click("#start");
const events = () => (existsSync(`${out}/round.jsonl`) ? readFileSync(`${out}/round.jsonl`, "utf8").trim().split("\n").map(JSON.parse) : []);
const t0 = Date.now();
while (!events().some((e) => e.event === "round ended") && Date.now() - t0 < 300000) await new Promise((r) => setTimeout(r, 500));
await browser.close();

const records = existsSync(beacon) ? readFileSync(beacon, "utf8").trim().split("\n").map(JSON.parse) : [];
const of = (k, kind) => records.filter((r) => r.step === k && r.kind === kind);
const verdicts = loads.map((_, k) => of(k, "verdict")[0]);
check(events().some((e) => e.event === "round ended"), "one press runs the plan to its end");
check(verdicts.every(Boolean), `every load has its verdict (${verdicts.map((v) => (v ? (v.ok ? "ok" : v.void ?? "failed") : "none")).join(" ")})`);
check(verdicts[2]?.ok === false && !verdicts[2]?.void && verdicts.slice(4, 9).every((v) => v?.ok), "a load made to fail is recorded and the next taken");
check(/after the fill: .*injected/.test(verdicts[9]?.why) && verdicts[11]?.ok, `a throw after the fill fails its load and the next is taken (${verdicts[9]?.why})`);
check(/no end 45 s after the fill/.test(verdicts[10]?.why) && verdicts[11]?.ok, `a hang after the fill fails its load at afterS and the next is taken (${verdicts[10]?.why})`);
check(verdicts[3]?.void === "stopped", `a stall in the runner's timers marks its load VOID: stopped (${verdicts[3]?.why})`);
check([0, 1, 4, 5, 6, 7, 8].every((k) => verdicts[k]?.ok && verdicts[k].gapMs < 2000), "the other loads pass with their timers steady");
const locks = loads.map((_, k) => of(k, "wakeLock"));
check(locks.every((l) => l.length && l.every((w) => ["acquired", "refused", "released"].includes(w.event))),
  `each load records its wake lock (${[...new Set(locks.flat().map((w) => `${w.event}${w.error ? `: ${w.error}` : ""}`))].join("; ")})`);
const filled = loads.map((_, k) => of(k, "load")[0]);
check([0, 1, 3, 4, 5, 6, 7, 8, 11, 14, 15].every((k) => filled[k]?.fillMs > 0 && filled[k].frames.length === 20 && filled[k].frames.every((f) => f.decodeMs > 0 && f.kb > 0)
  && filled[k].cell === loads[k].cell && filled[k].counted === true), "each filled load's record carries its fill, its frames' wire KB and decode ms, its cell");
check([0, 1, 6].every((k) => of(k, "label").some((l) => l.quality === "lossless")), "each lossless press reaches the exact frame");
for (const k of [7, 8]) {
  const steps = of(k, "frameChange")[0]?.steps ?? [];
  check(steps.length === 6 && steps.filter((s) => s.busy).length === 3 && steps.every((s) => s.ms > 0 && s.ms < 10000),
    `cell 3, ${loads[k].arm} view: each dispatched step to its frame painted, idle and busy (${steps.map((s) => Math.round(s.ms)).join(" ")} ms)`);
  const cine = of(k, "cine");
  check(cine.length === 2 && cine.every((c) => c.due > 0 && c.painted > 0), `cine idle and busy: painted against due (${cine.map((c) => `${c.painted}/${c.due}`).join(", ")})`);
  const exact = of(k, "exactFrame");
  check(exact.length === 2 && exact[0].i !== exact[1].i && exact.every((e) => e.ms > 0 && !e.failure), `exact-frame latency idle and busy, on two frames (${exact.map((e) => Math.round(e.ms)).join(", ")} ms)`);
  const busy = of(k, "busy");
  check(busy.filter((b) => b.on).length === 3 && busy.filter((b) => b.on === false).every((b) => b.tasks > 0), "the busy lever on and off three times, its tasks run on the viewer's thread");
}
// The synthetic view carries no reconstruction digests, so its frames are unchecked, in the product as here.
for (const [k, codec, exact] of [[12, "htj2k", true], [13, "av1", "unchecked"]]) {
  const b = of(k, "bench")[0];
  check(verdicts[k]?.ok && of(k, "load").length === 0 && b?.codec === codec && b.decoders === 2 && b.frames.length === 20
    && b.frames.every((f, i) => f.i === i && f.exact === exact && f.ms > 0) && new Set(b.frames.map((f) => f.decoder)).size === 2 && b.effectiveMs > 0,
    `cell 1's bench, ${codec}: 20 frames from memory on 2 decoders, each checked and timed, the viewer never filling (${b ? `${b.effectiveMs.toFixed(2)} ms effective, ${[...new Set(b.frames.map((f) => f.route))]}` : "none"}${verdicts[k]?.ok ? "" : `; ${verdicts[k]?.why}`})`);
}
for (const k of [12, 13]) {
  const b = of(k, "bench")[0];
  const byDecoder = Object.values(Object.groupBy(b?.frames ?? [], (f) => f.decoder)).map((fs) => fs.sort((x, y) => x.start - y.start));
  check(b?.t0 > 0 && b.frames.every((f) => f.ms === f.end - f.start && f.start >= b.t0) && byDecoder.every((fs) => fs.every((f, j) => !j || f.start >= fs[j - 1].end))
    && b.spanMs === Math.max(...b.frames.map((f) => f.end)) - b.t0, `cell 1's bench, ${b?.codec}: each frame's time its decoder's own start to end, one at a time on each decoder, the span from the first hand-over`);
}
check(verdicts[16]?.ok === false && !verdicts[16].void && verdicts[16].why === "frame 3 decoded not exact" && of(16, "bench")[0]?.failure === "frame 3 decoded not exact",
  `cell 1's bench fails a load whose frame is not exact, by name (${verdicts[16]?.why})`);
check(verdicts[17]?.ok === false && !verdicts[17].void && verdicts[17].why === "exactFill: frame 3 decoded false, not exact" && of(17, "exactFill")[0]?.frames.length === 20,
  `arm C2 fails a load whose exact frame is not exact, by name (${verdicts[17]?.why})`);
const c2 = of(14, "exactFill")[0];
check(verdicts[14]?.ok && c2?.frames.length === 20 && c2.frames.every((f) => f.exact === true && f.decodeMs > 0) && c2.issuedAt >= filled[14]?.fillTo && c2.spanMs > 0,
  `arm C2: after the view's fill, the whole exact series, every frame checked (${c2 ? `${c2.frames.length} frames in ${Math.round(c2.spanMs)} ms` : "none"})`);
const spans = (filled[15]?.frames ?? []).map((f) => [f.decodedAt - f.decodeMs, f.decodedAt]).sort((a, b) => a[0] - b[0]);
check(verdicts[15]?.ok && filled[15].decoders === 1 && filled[15].cores > 0 && spans.length === 20 && spans.every(([s], j) => !j || s >= spans[j - 1][1] - 0.01),
  "decoders=1: the load records its count, and no two of its frames decoded at once");
check(filled[4]?.decoders === null, "a load without the lever records no count");
const adb = readFileSync(`${dir}/adb.log`, "utf8").trim().split("\n");
check(adb.filter((l) => l === "start-server").length === 1 && adb.filter((l) => l.startsWith("logcat -d")).length === loads.length + 1,
  "one adb server; logcat read once before the press and after each load");
console.log(failed ? `round headless: ${failed} FAILED` : "round headless: every claim holds");
process.exit(failed ? 1 : 0);
