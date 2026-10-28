/**
 * The native window (client/native/src/window.rs) driven under Xvfb by real input over two committed series, grey and
 * RGB, each paint's surface read back and held to the CPU reference: |Δ| = 0 at 1:1, ≤ 1 fitted. docs/native/README.md §4
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

let bad = 0;
try {
  run("cargo", ["build", "-q", "-p", "series-server", "-p", "pack-series"]);
  run("cargo", ["build", "-q", "-p", "native-client", "--features", "window", "--bin", "native-window"]);
  run("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", `${T}/key.pem`, "-out", `${T}/cert.pem`,
    "-days", "2", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
  const der = execFileSync("openssl", ["x509", "-in", `${T}/cert.pem`, "-outform", "DER"]);
  const hash = execFileSync("openssl", ["dgst", "-sha256", "-r"], { input: der, encoding: "utf8" }).split(" ")[0];
  const xvfb = spawn("Xvfb", ["-displayfd", "1", "-screen", "0", "640x480x24"], { stdio: ["ignore", "pipe", "ignore"] });
  children.push(xvfb);
  const display = `:${(await line(xvfb, "\n")).trim()}`;
  const x = (...args) => {
    try {
      return execFileSync("xdotool", args.map(String), { env: { ...process.env, DISPLAY: display }, encoding: "utf8" }).trim();
    } catch (e) {
      return e.stdout ?? "";
    }
  };

  for (const [name, payloads, steps] of SERIES) {
    const fixture = path.join(ROOT, "lab/fixtures", name);
    const [frames, out] = [path.join(T, name), path.join(T, name, "out")];
    fs.mkdirSync(out, { recursive: true });
    payloads.forEach((p, i) => fs.symlinkSync(path.join(PLAIN, `${p}.av1`), path.join(frames, `${String(i).padStart(3, "0")}.av1`)));
    run(`${BIN}/pack-series`, ["--metadata", `${fixture}/metadata.json`, "--frames", frames, "--output", `${frames}/series.sbnd`]);
    const port = 30000 + Math.floor(Math.random() * 20000);
    const server = start(`${BIN}/series-server`, ["--port", port, "--bind", "127.0.0.1", "--series", `${frames}/series.sbnd`,
      "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`].map(String));
    await line(server, "wt_url=");
    const window = start(`${BIN}/native-window`, ["--url", `https://127.0.0.1:${port}/`, "--cert-sha256", hash,
      "--bundle", `${frames}/series.sbnd`, "--check", out], { DISPLAY: display });
    window.stdout.on("data", (d) => process.stdout.write(d));
    let id = "";
    for (let i = 0; i < 100 && !id && window.exitCode === null; i++, await sleep(100)) id = x("search", "--pid", window.pid).split("\n")[0];
    if (!id) throw new Error("the window did not open");
    x("windowfocus", "--sync", id);
    for (const [step, input, want] of steps(id)) {
      for (const args of input) x(...args);
      if (!(await painted(out, want))) {
        bad++;
        console.log(`FAIL ${name} ${step}: no paint shows ${JSON.stringify(want)}`);
      }
    }
    window.kill();
    server.kill();

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
      const failed = worst > (c.fit ? 1 : 0);
      bad += failed ? 1 : 0;
      console.log(`  ${failed ? "FAIL" : "ok  "} ${name} paint ${f.slice(0, 3)} frame ${c.frame} ${c.fit ? "fitted" : "1:1"} ` +
        `${c.width}×${c.height} center ${c.center} width ${c.windowWidth}: max |Δ| ${worst}`);
    }
  }
  console.log(bad ? `NOT EQUAL: ${bad}` : "every paint read back from the surface equals the reference: to the code at 1:1, within 1 fitted");
} finally {
  children.forEach((c) => c.kill());
  fs.rmSync(T, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
