/**
 * A crafted link to the product's page is refused: each lab parameter, opened on a host that does not serve lab/
 * as the web image does not, stops the page before it fetches, imports or dials what the link names. On a host that
 * serves lab/ the same parameters are honoured, which shows the test would see them. A transport file naming a client
 * the page does not know is refused by name, before the WASM client's code is fetched or anything dialled.
 * client/README.md §The viewer
 *
 *   NODE_PATH=$(npm root -g) node client/viewer/crafted.mjs
 */
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };

/** A UDP port that records whether anything dialled it. */
async function listener() {
  const s = createSocket("udp4");
  s.dialled = false;
  s.on("message", () => (s.dialled = true));
  await new Promise((r) => s.bind(0, "127.0.0.1", r));
  return s;
}
const honest = await listener();
const crafted = await listener();

/** The image's shape: the page, client/, the metadata and the transport file; lab/ only when `serveLab`. */
const requests = [];
let serveLab = false;
let client;
const host = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  requests.push(url);
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" };
  let body = null;
  if (url === "/series/metadata") body = JSON.stringify({ frameCount: 2, codec: "htj2k" });
  else if (url === "/wt/dev-transport.json") body = JSON.stringify({ wt_url: `https://127.0.0.1:${honest.address().port}/`, cert_sha256: "0".repeat(64), client });
  else if (url.startsWith("/client/") || (serveLab && url.startsWith("/lab/")) || url === "/") {
    body = await readFile(path.join(ROOT, url === "/" ? "client/viewer/index.html" : url)).catch(() => null);
  }
  if (body === null) return res.writeHead(404, headers).end();
  res.writeHead(200, { ...headers, "Content-Type": TYPES[path.extname(url)] ?? (url === "/" ? "text/html" : "application/json") }).end(body);
});
await new Promise((r) => host.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${host.address().port}/`;

const LINKS = {
  wt: { wt: `https://127.0.0.1:${crafted.address().port}/`, hash: "0".repeat(64) },
  metadata: { metadata: "/crafted/metadata.json" },
  "opts.transport": { opts: JSON.stringify({ transport: "/crafted/transport.js" }) },
  "opts.decoder": { opts: JSON.stringify({ decoder: { glue: "/crafted/glue.js", wasm: "/crafted/glue.wasm", dir: "/crafted" } }) },
  post: { post: `${base}crafted/` },
  origin: { origin: "navigation" },
};

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const failures = [];

/** The page opened on `query`: its status line, what it fetched under /crafted/, and which ports it dialled. */
async function open(query) {
  requests.length = 0;
  honest.dialled = crafted.dialled = false;
  const tab = await browser.newPage();
  tab.on("pageerror", () => {});
  await tab.goto(`${base}?${new URLSearchParams(query)}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 5000 && !honest.dialled && !crafted.dialled && !requests.some((r) => r.startsWith("/crafted/"))) {
    if (/refused/.test(await tab.textContent("#status"))) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  // A dial, once the page has passed the point where it would refuse, follows within a few ms; a second is ample.
  await new Promise((r) => setTimeout(r, 1000));
  const seen = { status: await tab.textContent("#status"), fetched: requests.filter((r) => r.startsWith("/crafted/")), honest: honest.dialled, crafted: crafted.dialled,
    wasm: requests.filter((r) => r.startsWith("/client/transport/wasm/")) };
  await tab.close();
  return seen;
}

const plain = await open({});
if (!plain.honest || plain.crafted) failures.push(`a plain link did not dial the transport file's URL alone: ${JSON.stringify(plain)}`);

for (const [name, query] of Object.entries(LINKS)) {
  const r = await open(query);
  const ok = /refused/.test(r.status) && !r.fetched.length && !r.crafted && !r.honest;
  console.log(`${ok ? "ok  " : "FAIL"} ?${name} on the product's host: ${JSON.stringify(r)}`);
  if (!ok) failures.push(`?${name} was not refused`);
}

for (const name of ["rust", "toString"]) {
  client = name;
  const r = await open({});
  const ok = r.status.includes(`refused: client "${name}"`) && !r.wasm.length && !r.honest && !r.crafted;
  console.log(`${ok ? "ok  " : "FAIL"} a transport file naming client "${name}": ${JSON.stringify(r)}`);
  if (!ok) failures.push(`client "${name}" was not refused by name with nothing loaded`);
}
client = undefined;

serveLab = true;
for (const name of ["wt", "metadata"]) {
  const r = await open(LINKS[name]);
  const ok = name === "wt" ? r.crafted && !r.honest : r.fetched.includes("/crafted/metadata.json");
  console.log(`${ok ? "ok  " : "FAIL"} ?${name} on a host serving lab/, honoured: ${JSON.stringify(r)}`);
  if (!ok) failures.push(`?${name} was not honoured where lab/ is served`);
}

await browser.close();
host.close();
honest.close();
crafted.close();
for (const f of failures) console.log(`FAIL: ${f}`);
console.log(failures.length ? `crafted links: ${failures.length} failing` : `crafted links: ${Object.keys(LINKS).length} refused on the product's host, honoured where lab/ is served; 2 unknown clients refused`);
process.exit(failures.length ? 1 : 0);
