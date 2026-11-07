// RESIDEXACT's browser run (docs/av1/residual-exact.md §2): each cell streams.py coded, through dav1d-WASM and
// WebCodecs in headless Chromium, every sample against native dav1d; Chromium's media log names the decoder.
//
//   node lab/av1/delivery/residual-exact/run.mjs WORK OUT.jsonl [--cells a,b] [--mutate] [--port 31997]
//     [--browser chromium|firefox|webkit] [--channel chrome] [--headed] [--args "--flag …"] [--arms dav1d-wasm,webcodecs:prefer-hardware]
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const playwright = createRequire(import.meta.url)("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const [work, outPath] = process.argv.slice(2).map((p) => resolve(p));
const opt = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const mutate = process.argv.includes("--mutate");
const port = Number(opt("--port", "31997"));
const ARMS = opt("--arms", "dav1d-wasm,webcodecs:prefer-software,webcodecs:no-preference,webcodecs:prefer-hardware").split(",").map((a) => a.split(":"));
const engine = opt("--browser", "chromium");

const cells = (opt("--cells") ?? readdirSync(work).join(",")).split(",").filter((c) => {
  try {
    return readFileSync(join(work, c, "cell.json")).length > 0;
  } catch {
    return false;
  }
});

const http = spawn("python3", ["server/dev-server.py", "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));
const args = opt("--args", "").split(" ").filter(Boolean);
const browser = await playwright[engine].launch({ headless: !process.argv.includes("--headed"), channel: opt("--channel"), args });
const page = await browser.newPage();
const players = new Map();
const cdp = engine === "chromium" ? await page.context().newCDPSession(page) : { on() {}, send: async () => {} };
cdp.on("Media.playerPropertiesChanged", ({ playerId, properties }) => {
  const p = players.get(playerId) ?? {};
  for (const { name, value } of properties) p[name] = value;
  players.set(playerId, p);
});
cdp.on("Media.playerErrorsRaised", ({ playerId, errors }) => {
  const p = players.get(playerId) ?? {};
  p.errors = [...(p.errors ?? []), ...errors.map((e) => `${e.errorType} ${e.code}`)];
  players.set(playerId, p);
});
await cdp.send("Media.enable");
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await page.goto(`http://127.0.0.1:${port}/${relative(ROOT, HERE)}/decode.html`);
await page.waitForFunction(() => globalThis.ready);
const meta = { engine, chromium: browser.version(), headless: !process.argv.includes("--headed"), args, userAgent: await page.evaluate(() => navigator.userAgent) };
console.log(JSON.stringify(meta));

for (const [c, name] of cells.entries()) {
  const cell = JSON.parse(readFileSync(join(work, name, "cell.json")));
  const refs = spawnSync(join(ROOT, "lab/av1/.venv/bin/python"),
    [join(HERE, "streams.py"), join(ROOT, "lab/.av1-build"), work, "--refs", name], { stdio: "inherit" });
  if (refs.status) throw new Error(`${name}: refs failed`);
  const arms = ARMS.map((_, i) => ARMS[(i + c) % ARMS.length]);
  for (const [decoder, accel] of arms) {
    const before = new Set(players.keys());
    const plant = mutate ? [Math.floor(cell.frames / 2), Math.floor(cell.height / 3), Math.floor(cell.width / 3)] : null;
    const r = await page.evaluate((o) => globalThis.check(o), {
      dir: `/${relative(ROOT, join(work, name))}`, n: cell.frames, decoder, accel, mutate: plant,
    });
    await new Promise((res) => setTimeout(res, 300));
    const log = [...players.entries()].filter(([id]) => !before.has(id)).map(([, p]) => p);
    const shaMatch = r.sha.filter((s, i) => s === cell.native.sha[i]).length;
    const row = { ...meta, cell: name, set: cell.set, form: cell.form, depth: cell.depth, q: cell.q, g: cell.g, accel: accel ?? null,
      ...r, sha_match: shaMatch, mutate: plant, media_log: log };
    delete row.sha;
    appendFileSync(outPath, JSON.stringify(row) + "\n");
    console.log(name, decoder, accel ?? "", r.error ?? `${r.differ}/${r.samples} differ, sha ${shaMatch}/${cell.frames}`,
      log.map((p) => `${p.kVideoDecoderName} platform=${p.kIsPlatformVideoDecoder}`).join(" "));
  }
  for (const f of readdirSync(join(work, name))) if (f.endsWith(".y")) rmSync(join(work, name, f));
}
await browser.close();
http.kill();
