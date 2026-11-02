// What the OPFS rigs share: their child processes, the static host, a browser on a profile of its own, and its memory.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
/** Playwright's `ws`: Node's own WebSocket dropped Firefox's BiDi socket mid-run (docs/adr/frame-path.md §Arm D, Results). */
const { ws: WebSocket } = createRequire(require.resolve("playwright"))("playwright-core/lib/utilsBundle");
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
const BIDI_MS = 60000;
export const chromiumPath = () => chromium.executablePath();

/** Firefox over WebDriver BiDi on an Xvfb display (headless it has no WebGL), with `prefs` in its user.js. */
export async function firefoxAt(profile, prefs = {}) {
  const lines = { "browser.shell.checkDefaultBrowser": false, ...prefs };
  writeFileSync(path.join(profile, "user.js"), Object.entries(lines).map(([k, v]) => `user_pref("${k}", ${JSON.stringify(v)});`).join("\n") + "\n");
  const ff = own(process.env.FIREFOX_PATH, ["--no-remote", "--profile", profile, "--remote-debugging-port", "0", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":99" } });
  const exited = new Promise((r) => ff.once("exit", r));
  const kill = () => { try { process.kill(-ff.pid, "SIGKILL"); } catch {} };
  const failed = async (e) => { kill(); await exited; throw e; };
  const startup = setTimeout(kill, 60000);
  const [, ws] = await started(ff, "stderr", /WebDriver BiDi listening on (ws:\/\/\S+)/).catch(failed);
  const sock = new WebSocket(`${ws}/session`);
  await new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = reject; sock.onclose = reject; }).catch(failed);
  let id = 0;
  const waiting = new Map();
  sock.onmessage = (m) => {
    const r = JSON.parse(m.data);
    const w = waiting.get(r.id);
    waiting.delete(r.id);
    if (w) r.type === "error" ? w.reject(new Error(`${r.error}: ${r.message}`)) : w.resolve(r.result);
  };
  sock.onclose = () => { for (const w of waiting.values()) w.reject(new Error("Firefox closed")); waiting.clear(); };
  // A call Firefox never answers fails after BIDI_MS instead of hanging the caller.
  const send = (method, params) => new Promise((resolve, reject) => {
    if (sock.readyState !== WebSocket.OPEN) return reject(new Error("Firefox closed"));
    const at = ++id;
    const timer = setTimeout(() => (waiting.delete(at), reject(new Error(`${method}: no answer in ${BIDI_MS} ms`))), BIDI_MS);
    waiting.set(at, { resolve: (r) => (clearTimeout(timer), resolve(r)), reject: (e) => (clearTimeout(timer), reject(e)) });
    sock.send(JSON.stringify({ id: at, method, params }));
  });
  await send("session.new", { capabilities: {} }).catch(failed);
  const tab = (context) => {
    let at = "about:blank";
    const pointer = (...actions) => send("input.performActions", { context, actions: [{ type: "pointer", id: "mouse", actions }] });
    return {
      mouse: {
        move: (x, y) => pointer({ type: "pointerMove", x: Math.round(x), y: Math.round(y) }),
        down: () => pointer({ type: "pointerDown", button: 0 }),
        up: () => pointer({ type: "pointerUp", button: 0 }),
      },
      url: () => at,
      goto: async (url) => { at = url; await send("browsingContext.navigate", { context, url, wait: "complete" }); },
      async evaluate(fn) {
        const r = await send("script.evaluate", { expression: `(async () => JSON.stringify(await (${fn})()))()`, target: { context }, awaitPromise: true });
        if (r.type === "exception") throw new Error(r.exceptionDetails.text);
        return JSON.parse(r.result.value);
      },
      close: () => send("browsingContext.close", { context }),
    };
  };
  const first = (await send("browsingContext.getTree", {}).catch(failed)).contexts[0].context;
  clearTimeout(startup);
  return {
    pid: ff.pid, page: tab(first),
    context: {
      newPage: async () => tab((await send("browsingContext.create", { type: "tab" })).context),
      close: async () => {
        const killer = setTimeout(kill, 10000);
        send("browser.close", {}).catch(() => {});
        await exited;
        clearTimeout(killer);
      },
    },
  };
}
