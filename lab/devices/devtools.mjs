#!/usr/bin/env node
// usage: devtools.mjs TREE [--port 9222] [--wait-s 600]   lab/devices/README.md §The round
// Over Chrome's DevTools port, before load 1: the browser cache cleared, the round's own tabs closed, then the first
// round page's scripts checked against TREE. Only tabs on http://127.0.0.1 are read; no other tab is printed or recorded.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const [tree, ...rest] = process.argv.slice(2);
if (!tree) {
  console.error("usage: devtools.mjs TREE [--port 9222] [--wait-s 600]");
  process.exit(2);
}
const option = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
const devtools = `http://127.0.0.1:${option("--port", 9222)}`;
const waitS = Number(option("--wait-s", 600));
const ROUND = /^http:\/\/127\.0\.0\.1:\d+\//;
const say = (record) => console.log(JSON.stringify({ kind: "devtools", ...record }));

const roundTabs = async () => (await (await fetch(`${devtools}/json/list`)).json()).filter((t) => t.type === "page" && ROUND.test(t.url));

function attach(tab) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  };
  const open = new Promise((ok, fail) => Object.assign(ws, { onopen: ok, onerror: fail }));
  return {
    async send(method, params = {}) {
      await open;
      const m = await new Promise((ok) => {
        pending.set(++id, ok);
        ws.send(JSON.stringify({ id, method, params }));
      });
      if (m.error) throw new Error(`${method}: ${m.error.message}`);
      return m.result;
    },
    close: () => ws.close(),
  };
}

/** Each same-origin script and WASM the page fetched, as the HTTP cache holds it, by its SHA-256. */
const RAN = `(async () => {
  const out = {};
  for (const e of performance.getEntriesByType("resource")) {
    const u = new URL(e.name);
    if (u.origin !== location.origin || !/\\.(m?js|wasm)$/.test(u.pathname)) continue;
    const bytes = await (await fetch(u.pathname, { cache: "force-cache" })).arrayBuffer();
    out[u.pathname] = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return out;
})()`;

async function clearCache() {
  const made = (await roundTabs()).length ? null : await (await fetch(`${devtools}/json/new?about:blank`, { method: "PUT" })).json();
  const tab = made ?? (await roundTabs())[0];
  const page = attach(tab);
  await page.send("Network.clearBrowserCache");
  page.close();
  if (made) await fetch(`${devtools}/json/close/${made.id}`);
  say({ event: "cache cleared" });
}

/** The ids closed, which `/json/list` may still list for a moment. */
async function closeRoundTabs() {
  const tabs = await roundTabs();
  for (const t of tabs) await fetch(`${devtools}/json/close/${t.id}`);
  say({ event: "round tabs closed", count: tabs.length });
  return new Set(tabs.map((t) => t.id));
}

async function firstRoundPage(closed) {
  const until = Date.now() + waitS * 1000;
  while (Date.now() < until) {
    const tab = (await roundTabs()).find((t) => !closed.has(t.id) && /[?&]round=/.test(t.url) && /[?&]at=\d+/.test(t.url));
    if (tab) return tab;
    await new Promise((ok) => setTimeout(ok, 300));
  }
  return null;
}

async function checkCode(tab) {
  const page = attach(tab);
  const value = async (expression) => (await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  while ((await value("document.readyState")) !== "complete") await new Promise((ok) => setTimeout(ok, 200));
  const ran = await value(RAN);
  page.close();
  const differ = [];
  for (const [path, sha] of Object.entries(ran)) {
    const served = await readFile(join(tree, decodeURIComponent(path))).catch(() => null);
    if (!served || createHash("sha256").update(served).digest("hex") !== sha) differ.push(path);
  }
  const url = new URL(tab.url);
  say({ event: "code checked", page: url.pathname, at: Number(url.searchParams.get("at")), scripts: Object.keys(ran).length, differ });
  return differ.length === 0;
}

await clearCache();
const closed = await closeRoundTabs();
say({ event: "waiting", forS: waitS });
const tab = await firstRoundPage(closed);
if (!tab) {
  say({ event: "no round page", forS: waitS });
  process.exit(2);
}
process.exit((await checkCode(tab)) ? 0 : 1);
