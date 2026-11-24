// Firefox's endings by raw WebDriver BiDi (report-plan.md §7.6), the same calls as cdp.mjs. Hide is a second tab
// activated; close keeps that tab open; crash is a SIGKILL of the content processes (levers.mjs); no freeze.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killMatching } from "./levers.mjs";

/** FIREFOX_PATH, required: a scratch default once ran a stale build unseen (docs/reviews/report-arms.md). */
export function firefoxPath(env = process.env) {
  if (!env.FIREFOX_PATH) throw new Error("FIREFOX_PATH is required for --engine firefox");
  return env.FIREFOX_PATH;
}

/** A BiDi remote value as plain JSON. */
export function plain(v) {
  if (v == null) return null;
  switch (v.type) {
    case "undefined": case "null": return null;
    case "number": return typeof v.value === "string" ? Number(v.value) : v.value;
    case "array": return v.value.map(plain);
    case "object": return Object.fromEntries(v.value.map(([k, x]) => [typeof k === "string" ? k : plain(k), plain(x)]));
    default: return v.value;
  }
}

export class Bidi {
  #ws; #id = 0; #pending = new Map(); #closed = null;
  constructor(ws) {
    this.#ws = ws;
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      const p = this.#pending.get(msg.id);
      if (p) this.#pending.delete(msg.id), msg.type === "error" ? p.fail(new Error(`${msg.error}: ${msg.message}`)) : p.ok(msg.result);
    };
    ws.onclose = () => {
      this.#closed = new Error("BiDi socket closed");
      for (const p of this.#pending.values()) p.fail(this.#closed);
      this.#pending.clear();
    };
  }
  send(method, params = {}) {
    if (this.#closed) return Promise.reject(this.#closed);
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.#pending.set(id, { ok, fail }));
  }
}

/** `secure`: an http origin list Firefox must treat as secure (the --tun address). */
export async function launch({ firefox = firefoxPath(), secure = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "report-arms-ff-"));
  const hosts = secure.map((o) => new URL(o).hostname);
  writeFileSync(join(profile, "user.js"), [`user_pref("browser.shell.checkDefaultBrowser", false);`,
    `user_pref("dom.securecontext.allowlist", ${JSON.stringify([...new Set(hosts)].join(","))});`].join("\n"));
  const proc = spawn(firefox, ["--headless", "--remote-debugging-port=0", "--profile", profile, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  const url = await new Promise((ok, fail) => {
    let err = "";
    proc.stderr.on("data", (b) => { err += b; const m = err.match(/WebDriver BiDi listening on (ws:\S+)/); if (m) ok(m[1]); });
    proc.on("exit", (code) => fail(new Error(`firefox exited ${code}: ${err}`)));
  }).catch((e) => { rmSync(profile, { recursive: true, force: true }); throw e; });
  const ws = new WebSocket(`${url}/session`);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  const bidi = new Bidi(ws);
  await bidi.send("session.new", { capabilities: {} });
  return { bidi, proc, pid: proc.pid, profile, close: () => closeBrowser(ws, proc, profile) };
}

/** The browser killed and its profile (~108 MB) removed once it has exited, so a long cell cannot fill the disk. */
export function closeBrowser(ws, proc, profile) {
  ws.close();
  const gone = proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve()
    : new Promise((ok) => proc.once("exit", ok));
  proc.kill("SIGKILL");
  return gone.then(() => rmSync(profile, { recursive: true, force: true }));
}

export async function openPage(b, url) {
  const { context } = await b.bidi.send("browsingContext.create", { type: "tab" });
  await b.bidi.send("browsingContext.navigate", { context, url, wait: "complete" });
  return { context };
}

export async function evaluate(b, page, expression) {
  const r = await b.bidi.send("script.evaluate", { expression, target: { context: page.context }, awaitPromise: true,
    resultOwnership: "none" });
  if (r.type === "exception") throw new Error(r.exceptionDetails?.text ?? "exception");
  return plain(r.result);
}

export async function hide(b) {
  const { context } = await b.bidi.send("browsingContext.create", { type: "tab" });
  await b.bidi.send("browsingContext.activate", { context });
}

export const navigate = (b, page, url) => b.bidi.send("browsingContext.navigate", { context: page.context, url, wait: "none" });
export async function close(b, page) { await hide(b); return b.bidi.send("browsingContext.close", { context: page.context }); }
export const crash = (b) => killMatching(b.pid, /-contentproc.*\btab$/);
export const freeze = async () => { throw new Error("no freeze lever in Firefox"); };
export const killBrowser = (b) => b.proc.kill("SIGKILL");
export const back = (b, page) => b.bidi.send("browsingContext.traverseHistory", { context: page.context, delta: -1 });
