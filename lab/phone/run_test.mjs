// lab/phone/run_test.sh's browser half: DIR holds synth.sbnd and synth-q8-g8.sbnd with their metadata.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const dir = process.argv[2];
const children = [];
process.on("exit", () => children.forEach((c) => c.kill("SIGKILL")));
let failed = 0;
const check = (ok, claim) => (console.log(`${ok ? "ok" : "FAIL"}: ${claim}`), ok || (failed += 1));

const run = (cmd, args, ready) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  const read = (d) => ((out += d), ready.test(out) && resolve(child));
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.once("exit", (c) => reject(new Error(`${cmd} exited ${c}: ${out}`)));
});

await new Promise((resolve, reject) => spawn("server/scripts/gen_dev_cert.sh", ["--if-needed"], { cwd: ROOT, stdio: "inherit" })
  .once("exit", (c) => (c === 0 ? resolve() : reject(new Error(`gen_dev_cert.sh exited ${c}`)))));
const hash = JSON.parse(readFileSync(path.join(ROOT, "client/dev-transport.json"))).cert_sha256;
const cert = ["--cert-pem", "server/dev-cert/cert.pem", "--key-pem", "server/dev-cert/key.pem"];
const servers = {};
for (const [port, cc, id] of [[4433, "cubic-restart", "synth-q8-g8"], [4434, "cubic-restart", "synth"], [4443, "bbr", "synth-q8-g8"], [4444, "bbr", "synth"]]) {
  servers[port] = await run("target/release/series-server", ["--port", String(port), "--congestion", cc, "--series", `${dir}/${id}.sbnd`, ...cert], /transport=/);
  writeFileSync(`${dir}/t-${port}.json`, JSON.stringify({ wt_url: `https://127.0.0.1:${port}/`, cert_sha256: hash }));
}
const BINDS = { tether: "127.0.0.1", wifi: "127.0.0.2" };
const log = (bind) => `${dir}/beacon-${bind}.jsonl`;
for (const bind of Object.values(BINDS)) {
  for (const [page, lossy, exact] of [[8765, 4433, 4434], [8766, 4443, 4444]]) {
    await run("python3", ["server/dev-server.py", "--bind", bind, "--port", String(page), "--beacon-log", log(bind),
      "--metadata", `${dir}/synth-q8-g8.metadata.json`, "--transport", `${dir}/t-${lossy}.json`,
      "--exact-metadata", `${dir}/synth.metadata.json`, "--exact-transport", `${dir}/t-${exact}.json`], /port=/);
  }
}

const browser = await createRequire(import.meta.url)("playwright").chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.log(`page console: ${m.text()}`));
page.on("pageerror", (e) => console.log(`page error: ${e.message}`));

/** The start page with `loads`, Start pressed, each pause continued; the runner's last banner once it says done or stopped, and the pauses met. */
async function runPlan(loads) {
  const pauses = [];
  const q = new URLSearchParams({ tether: "127.0.0.1", wifi: "127.0.0.2", gap: "1", fill: "60", series: "synth-q8-g8", loads });
  await page.goto(`http://127.0.0.1:8765/lab/phone/?${q}`);
  await page.click("#start");
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const text = await page.locator("#phone-run").textContent({ timeout: 1000 }).catch(() => "");
    if (/run done|stopped/.test(text)) {
      if (/stopped/.test(text)) console.log(`status: ${await page.locator("#status").textContent()}`);
      return { end: text, pauses };
    }
    if (/waits: /.test(text) && !pauses.includes(text)) {
      pauses.push(text);
      await page.click("#phone-run-continue");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { end: "no end in 180 s", pauses };
}
/** Every record either static host appended, each with the address that took it. */
const records = () => Object.values(BINDS).flatMap((bind) => readFileSync(log(bind), "utf8").split("\n").filter(Boolean)
  .map((l) => ({ ...JSON.parse(l), host: bind })));
const clearLogs = () => Object.values(BINDS).forEach((bind) => writeFileSync(log(bind), ""));

/** A plan across both links and both controllers runs whole, each step at its own origin, holding at its pause: each load filled, checked, pressed twice, and recorded. */
clearLogs();
const plan = ["tether cubic-restart page warm-up", "wifi cubic-restart page warm-up", "pause read the counters", "wifi bbr worker", "tether bbr page"];
const { end, pauses } = await runPlan(plan.join("\n"));
check(end === "run done: 4 loads", `the plan ran whole (${end})`);
check(pauses.join() === "load 2 of 4 passed; load 3 waits: read the counters", `it held once, before load 3 (${pauses.join(" | ")})`);
await new Promise((r) => setTimeout(r, 500));
const all = records();
const loads = all.filter((r) => r.kind === "load").sort((a, b) => a.step - b.step);
check(loads.map((l) => `${l.link} ${l.controller} ${l.view}`).join() === plan.filter((l) => !l.startsWith("pause")).map((l) => l.replace(" warm-up", "")).join(),
  `each load ran on its link, controller and view, in order (${loads.map((l) => `${l.step}:${l.link}/${l.port}/${l.view}`).join(" ")})`);
check(loads.map((l) => l.port).join() === "8765,8765,8766,8766", "each controller's page port");
check(loads.every((l) => l.host === BINDS[l.link]), `each load's records reached its own link's address (${loads.map((l) => l.host).join(" ")})`);
check(loads.map((l) => l.counted).join() === "false,false,true,true", "the warm-ups are not counted");
for (const l of loads) {
  const mine = all.filter((r) => r.load === l.load);
  const labels = mine.filter((r) => r.kind === "label").map((r) => r.quality).join(" ");
  check(l.received === 20 && l.frames.every((f) => f.route === "av1-webcodecs" && f.kb > 0 && f.decodeMs >= 0) && l.fillMs > 0,
    `load ${l.step}: 20 frames through WebCodecs, each with KB and decode ms, fill ${Math.round(l.fillMs)} ms`);
  check(/optimal.* asking.* lossless.* optimal/.test(labels), `load ${l.step}: labels in order (${labels})`);
  check(mine.filter((r) => r.kind === "lossless").length === 2, `load ${l.step}: lossless pressed twice`);
  check(mine.some((r) => r.kind === "verdict" && r.ok), `load ${l.step}: passed`);
  check(mine.every((r) => r.kind !== "error"), `load ${l.step}: no error recorded`);
}

/** With an exact series' server gone, the first load fails, says why, and the run stops there. */
clearLogs();
servers[4444].kill("SIGKILL");
const { end: stopped } = await runPlan("wifi bbr page\ntether cubic-restart page");
await new Promise((r) => setTimeout(r, 3000));
const after = records();
const verdict = after.find((r) => r.kind === "verdict");
check(/^stopped at load 1 of 2: .*; not rerun: the start page at load 2$/.test(stopped), `the run stopped at load 1 and names the next (${stopped})`);
check(verdict && !verdict.ok && /lossless/.test(verdict.why), `its verdict names the cause (${verdict?.why})`);
check(!after.some((r) => r.step === 1), "load 2 never ran");

await browser.close();
console.log(failed ? `run_test: ${failed} failed` : "run_test: the runner and the beacon, both plans: ok");
process.exit(failed ? 1 : 0);
