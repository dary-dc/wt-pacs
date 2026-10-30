// What the OPFS rigs share: their child processes, the static host, a browser on a profile of its own, and its memory.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const { chromium } = createRequire(import.meta.url)("playwright");
const children = new Set();
process.on("exit", () => { for (const c of children) try { process.kill(-c.pid, "SIGKILL"); } catch {} });

export function own(cmd, args, opts = {}) {
  const c = spawn(cmd, args, { detached: true, stdio: ["ignore", "pipe", "inherit"], ...opts });
  children.add(c);
  c.once("exit", () => children.delete(c));
  return c;
}
export const started = (child, stream, re) => new Promise((resolve, reject) => {
  let out = "";
  child[stream].on("data", (d) => { out += d; const m = re.exec(out); if (m) resolve(m); });
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${out}`)));
});

let origin = null;
export async function staticHost() {
  if (origin) return origin;
  const http = own("python3", [path.join(ROOT, "server/dev-server.py"), "--port", "0"]);
  const [, p] = await started(http, "stdout", /port=(\d+)/);
  return (origin = `http://127.0.0.1:${p}`);
}

export function parent(p) {
  try { return readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1]; } catch { return null; }
}
export function tree(root) {
  const kids = new Map();
  for (const p of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) kids.set(parent(p), [...(kids.get(parent(p)) ?? []), p]);
  const all = [];
  for (const todo = [String(root)]; todo.length;) { const p = todo.pop(); all.push(p); todo.push(...(kids.get(p) ?? [])); }
  return all;
}
/** MiB, shared pages counted once across the browser's processes. */
export function treePss(root) {
  let kib = 0;
  for (const p of tree(root)) try { kib += parseInt(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${p}/smaps_rollup`, "utf8"))[1], 10); } catch {}
  return kib / 1024;
}

/** Chromium on a profile of its own, and the browser process's pid, for PSS, a throttle or a kill. */
export async function chromiumAt(profile, args = []) {
  const before = new Set(readdirSync("/proc"));
  const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1024, height: 768 }, args });
  const pid = Number(readdirSync("/proc").find((p) => !before.has(p) && /^\d+$/.test(p) && parent(p) === String(process.pid)));
  return { context, pid, page: context.pages()[0] ?? (await context.newPage()) };
}
const CALL_MS = 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const chromiumPath = () => chromium.executablePath();

/** Marionette's messages, each `length:json`, out of a stream's chunks: what is whole, and the rest. */
export function marionetteMessages(buffered) {
  const out = [];
  for (;;) {
    const colon = buffered.indexOf(":");
    if (colon < 0) return { messages: out, rest: buffered };
    const length = Number(buffered.subarray(0, colon).toString());
    if (buffered.length < colon + 1 + length) return { messages: out, rest: buffered };
    out.push(JSON.parse(buffered.subarray(colon + 1, colon + 1 + length).toString()));
    buffered = buffered.subarray(colon + 1 + length);
  }
}

/** Firefox over Marionette on an Xvfb display (headless it has no WebGL), with `prefs` in its user.js. Not WebDriver BiDi:
 *  its session watches every worker, and a worker starting a worker then hangs (docs/adr/frame-path.md, *Firefox's fills that never start*). */
export async function firefoxAt(profile, prefs = {}) {
  const lines = { "browser.shell.checkDefaultBrowser": false, "marionette.port": 0, ...prefs };
  writeFileSync(path.join(profile, "user.js"), Object.entries(lines).map(([k, v]) => `user_pref("${k}", ${JSON.stringify(v)});`).join("\n") + "\n");
  const ff = own(process.env.FIREFOX_PATH, ["--no-remote", "--marionette", "--profile", profile, "about:blank"],
    { stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":99" } });
  const kill = () => { try { process.kill(-ff.pid, "SIGKILL"); } catch {} };
  const portFile = path.join(profile, "MarionetteActivePort");
  for (const t0 = Date.now(); !existsSync(portFile) || !readFileSync(portFile, "utf8").trim(); await sleep(100)) {
    if (Date.now() - t0 > CALL_MS || ff.exitCode !== null) throw (kill(), new Error(`Marionette did not listen in ${CALL_MS} ms`));
  }
  const sock = connect(Number(readFileSync(portFile, "utf8")), "127.0.0.1");
  let buffered = Buffer.alloc(0);
  let hello = null;
  const handshake = new Promise((resolve) => (hello = resolve));
  let id = 0;
  const waiting = new Map();
  sock.on("data", (d) => {
    const { messages, rest } = marionetteMessages(Buffer.concat([buffered, d]));
    buffered = rest;
    for (const m of messages) {
      if (!Array.isArray(m)) { hello(m); continue; }
      const [, at, error, result] = m;
      const w = waiting.get(at);
      waiting.delete(at);
      if (w) error ? w.reject(new Error(`${error.error}: ${error.message}`)) : w.resolve(result);
    }
  });
  await Promise.race([handshake, new Promise((_, reject) => sock.once("error", reject))]).catch((e) => { throw (kill(), e); });
  // A call Firefox never answers fails after CALL_MS instead of hanging the caller.
  const send = (command, params = {}) => new Promise((resolve, reject) => {
    const at = ++id;
    const timer = setTimeout(() => (waiting.delete(at), reject(new Error(`${command}: no answer in ${CALL_MS} ms`))), CALL_MS);
    waiting.set(at, { resolve: (r) => (clearTimeout(timer), resolve(r)), reject: (e) => (clearTimeout(timer), reject(e)) });
    const body = Buffer.from(JSON.stringify([0, at, command, params]));
    sock.write(`${body.length}:`);
    sock.write(body);
  });
  await send("WebDriver:NewSession", { capabilities: { alwaysMatch: { timeouts: { script: CALL_MS, pageLoad: CALL_MS } } } }).catch((e) => { throw (kill(), e); });
  let current = (await send("WebDriver:GetWindowHandle")).value;
  const tab = (handle) => {
    let at = "about:blank";
    const on = async (command, params) => {
      if (current !== handle) await send("WebDriver:SwitchToWindow", { handle });
      current = handle;
      return send(command, params);
    };
    const pointer = (...actions) => on("WebDriver:PerformActions", { actions: [{ type: "pointer", id: "mouse", actions }] });
    return {
      mouse: {
        move: (x, y) => pointer({ type: "pointerMove", x: Math.round(x), y: Math.round(y) }),
        down: () => pointer({ type: "pointerDown", button: 0 }),
        up: () => pointer({ type: "pointerUp", button: 0 }),
      },
      url: () => at,
      goto: async (url) => { at = url; await on("WebDriver:Navigate", { url }); },
      async evaluate(fn) {
        const r = await on("WebDriver:ExecuteScript", { script: `return (async () => JSON.stringify(await (${fn})()))();`, args: [] });
        return JSON.parse(r.value);
      },
      close: () => on("WebDriver:CloseWindow"),
    };
  };
  return {
    pid: ff.pid, page: tab(current), send,
    context: {
      newPage: async () => tab((await send("WebDriver:NewWindow", { type: "tab" })).handle),
      close: async () => {
        await send("Marionette:Quit", { flags: ["eForceQuit"] }).catch(() => {});
        sock.destroy();
        const exited = new Promise((r) => (ff.exitCode !== null ? r() : ff.once("exit", r)));
        await Promise.race([exited, sleep(10000).then(kill)]);
        await exited;
      },
    },
  };
}
