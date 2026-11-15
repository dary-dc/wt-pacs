// Chromium's endings by raw CDP, not a Playwright page: a Playwright page never hid nor entered bfcache on this host
// (report-plan.md §7.6). Each lever is the command §7.6 checked.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";

class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = [];

  constructor(ws) {
    this.#ws = ws;
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      const p = this.#pending.get(msg.id);
      if (p) return this.#pending.delete(msg.id), msg.error ? p.fail(new Error(msg.error.message)) : p.ok(msg.result);
      for (const l of this.#listeners) l(msg);
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, fail) => this.#pending.set(id, { ok, fail }));
  }

  /** Fire and forget, for a command whose answer never comes (Page.crash). */
  post(method, params = {}, sessionId) { this.#ws.send(JSON.stringify({ id: ++this.#id, method, params, sessionId })); }

  waitFor(method, test = () => true, ms = 10000) {
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`no ${method} in ${ms} ms`)), ms);
      const l = (msg) => msg.method === method && test(msg.params) &&
        (clearTimeout(t), this.#listeners.splice(this.#listeners.indexOf(l), 1), ok(msg.params));
      this.#listeners.push(l);
    });
  }
}

export async function launch({ chrome = CHROME, args = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "report-arms-"));
  const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", ...args, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const url = await new Promise((ok, fail) => {
    let err = "";
    proc.stderr.on("data", (b) => { err += b; const m = err.match(/DevTools listening on (ws:\S+)/); if (m) ok(m[1]); });
    proc.on("exit", (code) => fail(new Error(`chrome exited ${code}: ${err}`)));
  });
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  const cdp = new Cdp(ws);
  return { cdp, proc, pid: proc.pid, close: () => { ws.close(); proc.kill("SIGKILL"); } };
}

export async function openPage(b, url) {
  const { targetId } = await b.cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await b.cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await b.cdp.send("Page.enable", {}, sessionId);
  const loaded = b.cdp.waitFor("Page.loadEventFired", () => true);
  await b.cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  return { targetId, sessionId };
}

export const evaluate = async (b, page, expression) =>
  (await b.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, page.sessionId))
    .result.value;

export async function hide(b, page) {
  const { windowId } = await b.cdp.send("Browser.getWindowForTarget", { targetId: page.targetId });
  await b.cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
}

export const navigate = (b, page, url) => b.cdp.send("Page.navigate", { url }, page.sessionId);
export const close = (b, page) => b.cdp.send("Target.closeTarget", { targetId: page.targetId });
export const crash = (b, page) => b.cdp.post("Page.crash", {}, page.sessionId);
export const freeze = (b, page) => b.cdp.send("Page.setWebLifecycleState", { state: "frozen" }, page.sessionId);
export const killBrowser = (b) => b.proc.kill("SIGKILL");

export async function back(b, page) {
  const { currentIndex, entries } = await b.cdp.send("Page.getNavigationHistory", {}, page.sessionId);
  await b.cdp.send("Page.navigateToHistoryEntry", { entryId: entries[currentIndex - 1].id }, page.sessionId);
}
