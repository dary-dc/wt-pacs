/**
 * The native window (client/native/src/window.rs) driven under Xvfb by real input over two committed series, grey and
 * RGB, with every `--paint-thread`, each paint's surface read back and held to the CPU reference: |Δ| = 0 at 1:1, ≤ 1 fitted;
 * each painted frame's samples `exact`; each run's counts printed. Then the lab's settings on each paint thread, its end included. docs/native/README.md §4, §The view-worker design
 *
 *   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json node client/paint/window.mjs
 *
 * Needs Xvfb, xdotool, openssl and ingest/tools.sh's build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { paintReference } from "./reference.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const BIN = path.join(process.env.CARGO_TARGET_DIR ?? path.join(ROOT, "target"), "debug");
const PLAIN = path.join(ROOT, "client/contract/av1/payloads/plain");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();

const T = fs.mkdtempSync(path.join(os.tmpdir(), "native-window-"));
const children = [];
const start = (cmd, args, env = {}) => {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  return child;
};
const line = (child, has) => new Promise((ok) => child.stdout.on("data", (d) => String(d).includes(has) && ok(String(d))));

/** The last paint's read-back cell in `out`, once it shows `want`; null if none does within 10 s. */
async function painted(out, want) {
  for (let i = 0; i < 200; i++, await sleep(50)) {
    const last = fs.readdirSync(out).filter((f) => f.endsWith(".json")).sort().at(-1);
    try {
      const c = last && JSON.parse(fs.readFileSync(path.join(out, last), "utf8"));
      if (c && Object.entries(want).every(([k, v]) => c[k] === v)) return c;
    } catch {}
  }
  return null;
}

// Each step's input, then the paint it must end on; at the ends a step that wrapped would end elsewhere.
// winit 0.30 on X11 makes an XTEST wheel click's press and release two wheel events, so a click steps twice.
const grey = (id) => [
  ["open", [], { frame: 0, fit: false }],
  ["Left at the first frame, then Right", [["key", "Left"], ["key", "Right"]], { frame: 1 }],
  ["the wheel down", [["click", 5]], { frame: 3 }],
  ["Right at the last frame, then Left", [["key", "Right"], ["key", "Left"]], { frame: 2 }],
  ["the wheel up", [["click", 4]], { frame: 0 }],
  ["a drag 40 px right, 24 down", [["mousemove", "--window", id, 100, 100], ["mousedown", 1], ["mousemove", "--window", id, 140, 124], ["mouseup", 1]],
    { frame: 0, center: 1048, windowWidth: 2088 }],
  ["F, fitted", [["key", "f"]], { frame: 0, fit: true }],
  ["F, 1:1 again", [["key", "f"]], { frame: 0, fit: false }],
];
const SERIES = [
  ["window_grey16", ["g9", "g10", "g12", "g14"], grey],
  ["window_rgb8", ["c8"], () => [["open, the surface's channel order", [], { frame: 0 }]]],
];
// A budget of two grey frames makes steps miss; the second cache run reads what the first wrote.
const small = (cache) => ["--budget", 12288, "--cache", cache, "--series", "s", "--version", "v1", "--cache-write-delay-ms", 50];
const PAINT_THREADS = [
  ["ui", () => []],
  ["view", () => ["--paint-thread", "view"]],
  ["core", () => ["--paint-thread", "core"]],
  ["view, two frames, a cold cache", (name) => ["--paint-thread", "view", ...small(`${T}/cache-${name}`)]],
  ["core, two frames, the cache warm", (name) => ["--paint-thread", "core", "--stamp-painted", ...small(`${T}/cache-${name}`)]],
];
const counts = [];

// The lab's settings (docs/native/README.md §The comparison, pre-registered, metrics 4 and 7) smoked on each paint thread,
// the UI thread blocked 450 ms of every 500: a step injected off it, and the cine, paint through the block wherever it does
// not paint. Steps 700 ms apart meet the blocks at five phases 100 ms apart, so through it three in five wait 100 ms or more.
const BUSY = ["--busy-ui-ms", 450, "--busy-every-ms", 500];
const STEPS = ["--steps", 7, "--step-every-ms", 700, "--stamp-painted"];
const lags = (out) => {
  const at = (l) => Number(l.match(/at_ms=([\d.]+)/)[1]);
  const lines = out.split("\n");
  const steps = lines.filter((l) => l.startsWith("step at_ms=")).map(at);
  const painted = lines.filter((l) => l.startsWith("painted ")).map(at);
  return steps.map((s) => painted.find((p) => p > s) - s);
};
const hops = (out, names) => names.filter((n) => !new RegExp(`^hop ${n} n=[1-9]`, "m").test(out));
/** Null when the run holds; else what failed. */
const stepped = (within, names) => (out) => {
  const l = lags(out);
  console.log(`  steps painted after ${l.map((ms) => ms.toFixed(1)).join(", ")} ms`);
  if (l.length !== 7 || l.some(Number.isNaN)) return `${l.length} of 7 steps painted`;
  if (within && l.some((ms) => ms >= 100)) return "a step waited on the busy UI thread";
  if (!within && l.every((ms) => ms < 100)) return "no step waited on the busy UI thread";
  return hops(out, names).map((n) => `no hop ${n}`).join(", ") || null;
};
// These run without the read-back, which outlasts a 33 ms frame on lavapipe; where the UI thread paints, the block
// makes most slots late, elsewhere few.
const cine = (within) => (out) => {
  const [on, late] = (out.match(/cine_on_time=(\d+) cine_late=(\d+)/) ?? []).slice(1).map(Number);
  const shown = new Set([...out.matchAll(/^painted frame=(\d+)/gm)].map((m) => m[1]));
  console.log(`  cine slots on time ${on}, late ${late}; frames painted ${[...shown].sort()}`);
  if (!(on + late >= 60) || shown.size < 4) return "the cine did not show the series in turn";
  if (within) return late >= on ? "the cine waited on the busy UI thread" : null;
  return late <= on ? "the busy loop did not block the UI thread" : null;
};
const CINE = ["--cine-hz", 30, "--stamp-painted", ...BUSY];
// The lab's end (§Built for NATIVERUN): the window closes by itself once the series is exact and its last step painted,
// and its visit line times the series from the dial.
const END = ["--exit", "--steps", 2, "--step-every-ms", 300, "--stamp-painted"];
const ended = (steps) => (out) => {
  const v = Object.fromEntries([...(out.match(/^visit (.*)$/m)?.[1] ?? "").matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
  const [first, shown, last, p99, arrivals] = ["first_exact_ms", "first_shown_ms", "last_exact_ms", "inter_arrival_p99_ms", "arrivals"].map((k) => Number(v[k]));
  console.log(`  visit: first exact ${first} ms, first shown ${shown} ms, last exact ${last} ms, inter-arrival p99 ${p99} ms, ${arrivals} arrivals, exact ${v.exact}`);
  if (v.exact !== "12/12") return `exact ${v.exact}`;
  if (!(first > 0 && first <= shown && first <= last) || !(p99 >= 0) || !(arrivals >= 12)) return "the visit's times are not from its dial";
  const l = lags(out);
  return l.length === steps && !l.some(Number.isNaN) ? null : "the window closed before its last step painted";
};
const PAINTER = ["intent", "decoded", "job", "done", "stream", "shown"];
const LAB = [
  ["ui, busy, steps", [...BUSY, ...STEPS], stepped(false, ["stream", "frame", "step"]), false],
  ["view, busy, steps", ["--paint-thread", "view", ...BUSY, ...STEPS], stepped(true, PAINTER), false],
  ["core, busy, steps", ["--paint-thread", "core", ...BUSY, ...STEPS], stepped(true, PAINTER), false],
  ["view, busy, steps through the UI thread", ["--paint-thread", "view", ...BUSY, ...STEPS, "--steps-via", "ui"], stepped(false, [...PAINTER, "step"]), false],
  ["ui, busy, a 30 Hz cine", CINE, cine(false), false],
  ["view, busy, a 30 Hz cine", ["--paint-thread", "view", ...CINE], cine(true), false],
  ["core, busy, a 30 Hz cine", ["--paint-thread", "core", ...CINE], cine(true), false],
  ["ui, the lab's end", END, ended(2), false],
  ["view, the lab's end", ["--paint-thread", "view", ...END], ended(2), false],
  ["core, the lab's end", ["--paint-thread", "core", ...END], ended(2), false],
  // The cache's write delay spaces the frames 50 ms apart, so an end before the last frame shows.
  ["ui, the lab's end with no steps", ["--exit", "--cache", `${T}/cache-end`, "--series", "s", "--version", "v1", "--cache-write-delay-ms", 50], ended(0), false],
  ["view, the lab's end with no steps", ["--paint-thread", "view", "--exit"], ended(0), false],
];

let bad = 0;
let hash, display, x;
try {
  run("cargo", ["build", "-q", "-p", "series-server", "-p", "pack-series"]);
  run("cargo", ["build", "-q", "-p", "native-client", "--features", "window", "--bin", "native-window"]);
  run("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", `${T}/key.pem`, "-out", `${T}/cert.pem`,
    "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
  const der = execFileSync("openssl", ["x509", "-in", `${T}/cert.pem`, "-outform", "DER"]);
  hash = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: der, encoding: "utf8" }).split(" ")[0];
  const xvfb = spawn("Xvfb", ["-displayfd", "1", "-noreset", "-screen", "0", "640x480x24"], { stdio: ["ignore", "pipe", "ignore"] });
  children.push(xvfb);
  display = `:${(await line(xvfb, "\n")).trim()}`;
  x = (...args) => {
    try {
      return execFileSync("xdotool", args.map(String), { env: { ...process.env, DISPLAY: display }, encoding: "utf8" }).trim();
    } catch (e) {
      return e.stdout ?? "";
    }
  };

  /** One window over `frames`' series, driven by `steps`, each paint then held to the reference unless `read` is false; its stdout. */
  async function visit(name, frames, thread, flags, steps, read = true) {
    const fixture = path.join(ROOT, "lab/fixtures", name);
    const out = path.join(frames, `out-${counts.length}`);
    fs.mkdirSync(out);
    const port = 30000 + Math.floor(Math.random() * 20000);
    const server = start(`${BIN}/series-server`, ["--port", port, "--bind", "127.0.0.1", "--series", `${frames}/series.sbnd`,
      "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`].map(String));
    await line(server, "wt_url=");
    const window = start(`${BIN}/native-window`, ["--url", `https://127.0.0.1:${port}/`, "--cert-sha256", hash,
      "--bundle", `${frames}/series.sbnd`, ...(read ? ["--check", out] : []), ...flags.map(String)], { DISPLAY: display });
    let stdout = "";
    window.stdout.on("data", (d) => {
      process.stdout.write(d);
      stdout += d;
    });
    console.log(`-- ${name}, ${thread}`);
    let id = "";
    for (let i = 0; i < 100 && !id && window.exitCode === null; i++, await sleep(100)) id = x("search", "--pid", window.pid).split("\n")[0];
    if (!id && !flags.includes("--exit")) throw new Error("the window did not open");
    x("windowfocus", "--sync", id);
    for (const [step, input, want] of steps(id)) {
      if (typeof input === "number") await sleep(input);
      else for (const args of input) x(...args);
      if (want && !(await painted(out, want))) {
        bad++;
        console.log(`FAIL ${name} ${thread} ${step}: no paint shows ${JSON.stringify(want)}`);
      }
    }
    if (flags.includes("--exit")) {
      for (let i = 0; i < 100 && window.exitCode === null; i++) await sleep(100);
      if (window.exitCode !== 0) {
        bad++;
        console.log(`FAIL ${name} ${thread}: the window did not close by itself`);
      }
    }
    x("key", "Escape");
    for (let i = 0; i < 50 && window.exitCode === null; i++) await sleep(100);
    window.kill();
    server.kill();
    counts.push(`${name}, ${thread}: ${stdout.split("\n").findLast((l) => l.startsWith("counts ")) ?? ""}`);

    const m = JSON.parse(fs.readFileSync(`${fixture}/metadata.json`, "utf8"));
    const spec = { width: m.width, height: m.height, bits: m.bitsStored, components: m.channels, signed: m.signed };
    const View = spec.components === 3 || spec.bits <= 8 ? Uint8Array : spec.signed ? Int16Array : Uint16Array;
    for (const f of fs.readdirSync(out).filter((f) => f.endsWith(".json")).sort()) {
      const c = JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
      const display = { photometric: m.photometric, voi: { center: c.center, width: c.windowWidth, function: m.window?.function }, view: { fit: c.fit } };
      const samples = new View(new Uint8Array(fs.readFileSync(path.join(out, f.replace(".json", ".raw")))).buffer);
      const ref = paintReference({ ...spec, samples }, display, c.width, c.height, c.dpr);
      const got = fs.readFileSync(path.join(out, f.replace(".json", ".rgba")));
      let worst = got.length === ref.length ? 0 : 255;
      for (let k = 0; k < ref.length; k++) worst = Math.max(worst, Math.abs(ref[k] - got[k]));
      const failed = worst > (c.fit ? 1 : 0) || c.exact !== "true";
      bad += failed ? 1 : 0;
      console.log(`  ${failed ? "FAIL" : "ok  "} ${name} ${thread} paint ${f.slice(0, 3)} frame ${c.frame} exact=${c.exact} ${c.fit ? "fitted" : "1:1"} ` +
        `${c.width}×${c.height} center ${c.center} width ${c.windowWidth}: max |Δ| ${worst}`);
    }
    return stdout;
  }

  for (const [name, payloads, steps] of SERIES) {
    const frames = path.join(T, name);
    fs.mkdirSync(frames, { recursive: true });
    payloads.forEach((p, i) => fs.symlinkSync(path.join(PLAIN, `${p}.av1`), path.join(frames, `${String(i).padStart(3, "0")}.av1`)));
    run(`${BIN}/pack-series`, ["--metadata", path.join(ROOT, "lab/fixtures", name, "metadata.json"), "--frames", frames, "--output", `${frames}/series.sbnd`]);
    for (const [thread, flags] of PAINT_THREADS) await visit(name, frames, thread, flags(name), steps);
  }

  // The grey series with no window in its metadata: each paint thread windows each frame by its range, as the browser does.
  const bare = path.join(T, "window_grey16_bare");
  const unset = JSON.parse(fs.readFileSync(path.join(ROOT, "lab/fixtures/window_grey16/metadata.json"), "utf8"));
  delete unset.window;
  fs.writeFileSync(`${bare}.json`, JSON.stringify(unset));
  fs.mkdirSync(bare);
  SERIES[0][1].forEach((p, i) => fs.symlinkSync(path.join(PLAIN, `${p}.av1`), path.join(bare, `${String(i).padStart(3, "0")}.av1`)));
  run(`${BIN}/pack-series`, ["--metadata", `${bare}.json`, "--frames", bare, "--output", `${bare}/series.sbnd`]);
  const unwindowed = () => [["open, no window in the metadata", [], { frame: 0 }], ["Right", [["key", "Right"]], { frame: 1 }]];
  for (const [thread, flags] of PAINT_THREADS.slice(0, 3)) await visit("window_grey16", bare, `${thread}, no window`, flags(), unwindowed);

  // The grey frames three times over, so seven steps never reach the last.
  const long = path.join(T, "window_grey16_12");
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "lab/fixtures/window_grey16/metadata.json"), "utf8"));
  meta.frameCount = 12;
  meta.digests.frames = Array.from({ length: 12 }, (_, i) => meta.digests.frames[i % 4]);
  fs.writeFileSync(`${long}.json`, JSON.stringify(meta));
  fs.mkdirSync(long);
  for (let i = 0; i < 12; i++) fs.symlinkSync(path.join(PLAIN, `${SERIES[0][1][i % 4]}.av1`), path.join(long, `${String(i).padStart(3, "0")}.av1`));
  run(`${BIN}/pack-series`, ["--metadata", `${long}.json`, "--frames", long, "--output", `${long}/series.sbnd`]);
  for (const [thread, flags, check, read] of LAB) {
    const run = flags.includes("--exit") ? [] : [["the lab's run", 5500, null]];
    const stdout = await visit("window_grey16", long, `lab: ${thread}`, flags, () => run, read);
    const failed = check(stdout);
    bad += failed ? 1 : 0;
    console.log(`  ${failed ? `FAIL ${failed}` : "ok  "} lab: ${thread}`);
  }
  counts.forEach((c) => console.log(c));
} finally {
  children.forEach((c) => c.kill());
  fs.rmSync(T, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
