/**
 * Proves the paint's settle waits for its draw: a draw heavy enough to take hundreds of ms on a software renderer,
 * then each settle timed against the read. README §When a paint has executed
 *
 *   NODE_PATH=$(npm root -g) node client/paint/settle-check.mjs [--n 150] [--trials 5]        # Chromium, SwiftShader
 *   FIREFOX_PATH=… xvfb-run -a node client/paint/settle-check.mjs --browser firefox            # Firefox, llvmpipe
 *   … settle-check.mjs mutants                                                                 # each mutant of settle.js
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { firefoxAt, staticHost } from "../../lab/opfs-cache/browser.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};
const engine = flag("browser", "chromium");
const N = Number(flag("n", 150));
const TRIALS = Number(flag("trials", 5));
const SETTLES = ["read", "fence", "finish", "none"];
/** A settle waits when it takes at least WAITS of the read's time and leaves a read after it under LEFT of it. */
const WAITS = 0.8;
const LEFT = 0.2;

const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];

async function visit(origin) {
  const url = `${origin}/client/paint/settle-check.html?${new URLSearchParams({ n: N, trials: TRIALS, settles: SETTLES.join(",") })}`;
  if (engine === "firefox") {
    const profile = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "settle-check-"));
    const ff = await firefoxAt(profile, { "webgl.force-enabled": true });
    try {
      await ff.page.goto(url);
      return await ff.page.evaluate(() => globalThis.__run);
    } finally {
      await ff.context.close();
    }
  }
  const { chromium } = createRequire(import.meta.url)("playwright");
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const page = await b.newPage();
    await page.goto(url);
    return await page.evaluate(() => globalThis.__run);
  } finally {
    await b.close();
  }
}

/** The medians per settle, and what each claim says of them. */
function judge({ renderer, out, error }) {
  if (error) return { ok: false, lines: [`error: ${error}`] };
  const m = Object.fromEntries(SETTLES.map((s) => [s, { settle: median(out.filter((o) => o.name === s).map((o) => o.settle)), after: median(out.filter((o) => o.name === s).map((o) => o.after)) }]));
  const ref = m.read.settle;
  const waits = (s) => m[s].settle >= WAITS * ref && m[s].after < LEFT * ref;
  const deferred = m.none.settle < LEFT * ref && m.none.after >= WAITS * ref;
  const lines = [`${engine}: ${renderer}; n ${N}, median of ${TRIALS}`,
    ...SETTLES.map((s) => `  ${s.padEnd(6)} settle ${m[s].settle.toFixed(1).padStart(7)} ms, a read after it ${m[s].after.toFixed(1).padStart(7)} ms${s === "read" || s === "none" ? "" : waits(s) ? "  waits" : "  RETURNS EARLY"}`),
    deferred ? "  the draw alone is deferred to the next read: the check can tell" : "  INCONCLUSIVE: the draw is not deferred, so no settle can be told from none"];
  return { ok: deferred && waits("fence"), lines };
}

const MUTANTS = {
  "one turn, no poll": ["  do await turn();\n  while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED);", "  await turn();"],
  "no wait": ["  do await turn();\n  while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED);", ""],
  "finish in place of the fence": ["  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);\n  gl.flush();\n  do await turn();\n  while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED);\n  gl.deleteSync(sync);", "  gl.finish();"],
};

const origin = await staticHost();
if (argv.includes("mutants")) {
  const file = path.join(HERE, "settle.js");
  const original = fs.readFileSync(file, "utf8");
  process.on("exit", () => fs.writeFileSync(file, original));
  let survived = 0;
  for (const [name, [from, to]] of Object.entries(MUTANTS)) {
    if (!original.includes(from)) throw new Error(`mutant ${name}: settle.js has no ${from.slice(0, 40)}`);
    fs.writeFileSync(file, original.replace(from, to));
    const r = judge(await visit(origin));
    fs.writeFileSync(file, original);
    if (r.ok) survived += 1;
    console.log(`mutant ${name}: ${r.ok ? "SURVIVED" : "caught"}\n${r.lines.join("\n")}`);
  }
  process.exit(survived ? 1 : 0);
}
const r = judge(await visit(origin));
console.log(r.lines.join("\n"));
process.exit(r.ok ? 0 : 1);
