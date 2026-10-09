/**
 * H2: the downloader page over HTTP/1.1 and HTTP/2 from nginx on the deploy template, its hints as
 * committed, with none, and with a modulepreload of the worker graph instead, the arms in a Williams
 * order inside every round (lab/order.mjs). The page's TCP crosses one shaped bottleneck; the
 * WebTransport session does not.
 * lab/page-open/README.md §The worker graph over HTTP/1.1 and HTTP/2
 *
 *   NODE_PATH=$(npm root -g) node lab/page-open/h2.mjs [rounds]
 *   LINK=20,80 (Mbit/s, round trip ms) ARMS=h1:today,h2:bare,... ROWS=FILE
 */
import fs from "node:fs";
import path from "node:path";
import { leadsByPredecessor, order } from "../order.mjs";
import { ROOT, T, aged, browser, median, nginx, port, start, study, tls } from "./host.mjs";

const ROUNDS = Number(process.argv[2] || 7);
const [MBIT, RTT] = (process.env.LINK || "20,80").split(",").map(Number);
const PROTOCOLS = { h1: false, h2: true };
/** The worker graph: each worker's script and the transport it imports. The decoders' glue is a classic script, fetched. */
const WORKER_GRAPH = ["/client/transport/downloader.js", "/client/decode/decoder.js", "/client/transport/ts/dist/session.js"];
const PAGE = fs.readFileSync(path.join(ROOT, "lab/page-open/downloader.html"), "utf8");
const HINT = /^[ \t]*<link rel="(?:preload|modulepreload)"[^>]*>\n/gm;
if (PAGE.match(HINT)?.length !== 7) throw new Error("downloader.html's hints changed: re-read what `bare` removes");
const bare = PAGE.replace(HINT, "");
const HINTS = {
  bare,
  today: null,
  module: bare.replace("</head>", WORKER_GRAPH.map((u) => `  <link rel="modulepreload" href="${u}" />\n`).join("") + "</head>"),
};
const ARMS = process.env.ARMS?.split(",") ?? Object.keys(PROTOCOLS).flatMap((p) => Object.keys(HINTS).map((h) => `${p}:${h}`));
const GLUE = "/client/decode/wasm/vendor/openjph/openjphjs.js";
const WASM = "/client/decode/wasm/vendor/openjph/openjphjs.wasm";
const WATCH = { worker: WORKER_GRAPH[0], transport: WORKER_GRAPH[2], decoder: WORKER_GRAPH[1], glue: GLUE, wasm: WASM };

fs.mkdirSync(path.join(T, "variants"));
for (const [name, html] of Object.entries(HINTS)) {
  if (!html) continue;
  fs.writeFileSync(path.join(T, "variants", `${name}.html`), html);
  aged(path.join(T, "variants", `${name}.html`));
}
study();
const template = fs.readFileSync(path.join(ROOT, "deploy/nginx/wt-pacs.conf.template"), "utf8")
  .replace(/\$\{STUDY\}/g, "us_cine_smoke").replace(/\/srv\/wt-pacs/g, ROOT);
const hosts = Object.fromEntries(Object.keys(PROTOCOLS).map((p) => [p, { srv: port(), inn: port() }]));
await nginx(Object.entries(PROTOCOLS).map(([p, http2]) => template
  .replace(/listen\s+8765;/, tls(hosts[p].srv, http2))
  .replace(/\n}\s*$/, `\n    location /variants/ { alias ${T}/variants/; }\n}\n`)).join("\n"));
for (const h of Object.values(hosts)) {
  start("python3", ["lab/scripts/link_impair.py", "--tcp", `${h.inn}:${h.srv}`, "--delay-ms", String(RTT / 2),
    "--rate-kbit", String(MBIT * 1000), "--tcp-rate", "shared"]);
}
await new Promise((r) => setTimeout(r, 1000));
const { browser: b } = await browser();

/** Each watched URL's first request, ms from navigation: asked for, queued for a socket, its connection's setup, ended. */
async function visit(arm) {
  const [proto, hints] = arm.split(":");
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  const requests = [];
  ctx.on("requestfinished", (r) => requests.push(r));
  let err = null;
  page.on("pageerror", (e) => (err = e.message));
  await page.goto(`https://127.0.0.1:${hosts[proto].inn}${HINTS[hints] ? `/variants/${hints}.html` : "/lab/page-open/downloader.html"}`,
    { waitUntil: "commit" });
  await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 120000, polling: 100 });
  const { open, origin, error, proto: got } = await page.evaluate(() => ({
    open: globalThis.__wtpacsOpen, origin: performance.timeOrigin, error: globalThis.__wtpacsError ?? null,
    proto: performance.getEntriesByType("navigation")[0].nextHopProtocol,
  }));
  await ctx.close();
  if (err || error) throw new Error(err || error);
  // A control that must be able to fail: the arm's protocol is the one the page came over.
  if (got !== { h1: "http/1.1", h2: "h2" }[proto]) throw new Error(`${arm}: the page came over ${got}`);
  const row = { config: open.config, session: open.session, frame: open.frame };
  for (const [key, url] of Object.entries(WATCH)) {
    const t = requests.filter((r) => new URL(r.url()).pathname === url).map((r) => r.timing())
      .sort((x, y) => x.startTime - y.startTime)[0];
    if (!t) continue;
    row[`${key}Asked`] = t.startTime - origin;
    row[`${key}End`] = t.startTime - origin + t.responseEnd;
    // A worker's own script comes back as one total, sent and answered at once: it has no split.
    if (t.responseStart === t.requestStart) continue;
    const setup = t.connectStart >= 0 ? t.connectEnd - t.connectStart : 0;
    row[`${key}Setup`] = setup;
    row[`${key}Queued`] = t.requestStart - setup;
  }
  return row;
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  let prev = null;
  for (const arm of order(ARMS, round)) {
    try {
      rows.push({ round, arm, prev, ...(await visit(arm)) });
    } catch (e) {
      process.stderr.write(`${arm} round ${round}: ${e.message.split("\n")[0]}\n`);
    }
    prev = arm;
  }
  process.stderr.write(`round ${round} done\n`);
}
if (process.env.ROWS) fs.writeFileSync(process.env.ROWS, JSON.stringify(rows));

const KEYS = ["config", ...Object.keys(WATCH).flatMap((k) => [`${k}Asked`, `${k}Queued`, `${k}Setup`, `${k}End`]), "session", "frame"];
console.log(`\n${MBIT} Mbit/s, ${RTT} ms round trip on the page's TCP; ms from navigation: median [min-max], rounds below ${ARMS[0]}`);
console.log(`${"".padEnd(15)} ${ARMS.map((a) => a.padEnd(22)).join("")}`);
for (const key of KEYS) {
  const cells = ARMS.map((arm) => {
    const mine = rows.filter((r) => r.arm === arm && Number.isFinite(r[key]));
    if (!mine.length) return "-".padEnd(22);
    const v = mine.map((r) => r[key]).sort((x, y) => x - y);
    const ref = new Map(rows.filter((r) => r.arm === ARMS[0]).map((r) => [r.round, r[key]]));
    const won = mine.filter((r) => r[key] < ref.get(r.round)).length;
    return `${median(v).toFixed(0)} [${v[0].toFixed(0)}-${v.at(-1).toFixed(0)}]${arm === ARMS[0] ? "" : ` ${won}/${mine.length}`}`.padEnd(22);
  });
  console.log(`${key.padEnd(15)} ${cells.join("")}`);
}
console.log("\nthe first frame, ms: each lead by the predecessor it ran after, rounds in brackets");
const byArm = rows.map((r) => ({ round: r.round, unit: r.arm, prev: r.prev, v: r.frame }));
for (const line of leadsByPredecessor(byArm, ARMS, ARMS.slice(1).map((a) => [a, ARMS[0]]))) console.log(line);
process.exit(0);
