/**
 * How fast a browser gives up on WebTransport when UDP does not work. Two arms, because the
 * network can fail in two ways and they do not cost the same:
 *
 *   refused  nothing bound on the port, so the host answers ICMP port unreachable
 *   silent   a socket is bound and never replies, so the dial gets nothing at all
 *
 *   NODE_PATH=$(npm root -g) node lab/scripts/udp_reject_time.mjs [rounds]
 *
 * docs/proposal-udp-fallback.md. The cert hash is bogus on purpose: the dial must fail at the
 * UDP layer, before anything looks at a certificate.
 */
import dgram from "node:dgram";
import http from "node:http";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROUNDS = Number(process.argv[2] || 5);
const HASH = "ab".repeat(32);

/** A bound socket that answers nothing — the "silent" arm's black hole. */
function silentSocket() {
  const sock = dgram.createSocket("udp4");
  return new Promise((resolve) => {
    sock.on("message", () => {});
    sock.bind(0, "127.0.0.1", () => resolve(sock));
  });
}

// WebTransport needs a secure context, and 127.0.0.1 is one; about:blank is not.
const host = http.createServer((_q, res) => res.end("<!doctype html>"));
await new Promise((r) => host.listen(0, "127.0.0.1", r));
const PAGE = `http://127.0.0.1:${host.address().port}/`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--disable-background-networking"],
});

/** Time from `new WebTransport(...)` to its rejection, in the page. */
async function dialUntilRejected(page, port, timeoutMs) {
  return page.evaluate(
    async ([url, hash, cap]) => {
      const bytes = Uint8Array.from(hash.match(/../g).map((h) => parseInt(h, 16)));
      const t0 = performance.now();
      const wt = new WebTransport(url, {
        serverCertificateHashes: [{ algorithm: "sha-256", value: bytes }],
      });
      const giveUp = new Promise((r) => setTimeout(() => r("capped"), cap));
      const settled = await Promise.race([
        wt.ready.then(() => "ready", () => "rejected"),
        wt.closed.then(() => "closed", () => "closed"),
        giveUp,
      ]);
      return { outcome: settled, ms: Math.round(performance.now() - t0) };
    },
    [`https://127.0.0.1:${port}/`, HASH, timeoutMs],
  );
}

const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  // Arms interleaved, order reversed every round — CLAUDE.md#measurement.
  const arms = round % 2 === 0 ? ["refused", "silent"] : ["silent", "refused"];
  for (const arm of arms) {
    const sock = arm === "silent" ? await silentSocket() : null;
    // An unbound port answers ICMP unreachable; a bound one swallows the datagram.
    const port = sock ? sock.address().port : 45000 + ((Math.random() * 1000) | 0);
    const page = await browser.newPage();
    await page.goto(PAGE);
    const r = await dialUntilRejected(page, port, 60000);
    await page.close();
    sock?.close();
    rows.push({ arm, ...r });
  }
  process.stderr.write(`round ${round + 1}/${ROUNDS}\n`);
}

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
console.log(`\n${"arm".padEnd(9)} ${"n".padStart(3)} ${"ms median".padStart(11)} ${"[min … max]".padStart(16)}  outcomes`);
for (const arm of ["refused", "silent"]) {
  const v = rows.filter((r) => r.arm === arm);
  if (!v.length) continue;
  const ms = v.map((r) => r.ms);
  const outcomes = [...new Set(v.map((r) => r.outcome))].join(",");
  console.log(
    `${arm.padEnd(9)} ${String(v.length).padStart(3)} ${String(median(ms)).padStart(11)} ` +
      `${`[${Math.min(...ms)} … ${Math.max(...ms)}]`.padStart(16)}  ${outcomes}`,
  );
}
await browser.close();
host.close();
