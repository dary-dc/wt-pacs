/**
 * The breakdown's rounds: every throttle cell a fresh headless Chromium, in a Williams order every round; sets and
 * arms rotate inside it. Rows go to --out as they come. README.md here
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/decode/breakdown/run.mjs --stamped lab/.av1-work/breakdown/stamped
 *     [--frames lab/.av1-work/breakdown/frames] [--rounds 10] [--throttles 1,4] [--arms H,D,…] [--sets dbts_c1]
 *     [--count 16] [--mutate] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = new URL("../../../..", import.meta.url).pathname;
/** The protocol's Chromium 141, the headless shell row 100 ran; not $CHROME_PATH, which a host may point elsewhere. */
const CHROME = process.env.BREAKDOWN_CHROME || `${ROOT}lab/.av1-build/chrome141/chrome-headless-shell-linux64/chrome-headless-shell`;

export async function serve() {
  const port = 30000 + ((Math.random() * 10000) | 0);
  const http = spawn("python3", ["server/dev-server.py", "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  process.on("exit", () => http.kill());
  await new Promise((r) => setTimeout(r, 1000));
  return { base: `http://127.0.0.1:${port}`, stop: () => http.kill() };
}

/** One fresh browser at `throttle`, running page.js's run(o); its rows. */
export async function inChromium(base, throttle, o) {
  const server = await chromium.launchServer({ executablePath: CHROME });
  const browser = await chromium.connect(server.wsEndpoint());
  const page = await browser.newPage();
  await page.goto(`${base}/lab/av1/decode/breakdown/index.html`);
  if (!(await page.waitForFunction(() => globalThis.ready !== undefined).then((h) => h.jsonValue()))) {
    throw new Error("page is not cross-origin isolated");
  }
  const version = browser.version();
  const stop = throttleTree(server.process().pid, throttle);
  const rows = await page.evaluate((x) => globalThis.run(x), o);
  stop();
  await browser.close();
  await server.close();
  return rows.map((r) => ({ ...r, throttle, chromium: version }));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const list = (k) => arg(k, null)?.split(",");
  const ROUNDS = Number(arg("--rounds", 10));
  const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
  const OUT = arg("--out", null);
  const o = {
    frames: arg("--frames", "lab/.av1-work/breakdown/frames"),
    stamped: `/${arg("--stamped", "lab/.av1-work/breakdown/stamped")}/client/decode`,
    mutate: process.argv.includes("--mutate"),
    only: list("--arms"),
    sets: list("--sets"),
    count: arg("--count", null) && Number(arg("--count")),
  };
  const { base } = await serve();
  const rows = [];
  for (let round = 0; round < ROUNDS; round++) {
    for (const throttle of order(THROTTLES, round)) {
      const got = await inChromium(base, throttle, { ...o, round });
      rows.push(...got.map((r) => ({ round, ...r })));
      for (const r of got.filter((r) => r.error || r.exact !== r.n)) {
        console.error(`round ${round} ${throttle}x ${r.set} ${r.arm}: ${r.exact}/${r.n} exact ${r.error ?? ""}`);
      }
      console.error(`round ${round} ${throttle}x done ${new Date().toISOString()}`);
      if (OUT) writeFileSync(OUT, JSON.stringify(rows));
    }
  }
  process.exit(0);
}
