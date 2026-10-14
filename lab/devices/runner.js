// The device runner: D0–D2 driven from the phone, every row kept in IndexedDB and posted after every round.
// lab/devices/README.md, docs/devices.md §3
import { capabilities, roundLine } from "/lab/devices/caps.js";
import { D1_ARMS, FULL, QUICK, line, reading, schedule } from "/lab/devices/plan.mjs";
import { readBundle } from "/lab/devices/sbnd.js";
import { visit } from "/lab/devices/visit.js";

const q = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const evening = new Date().toISOString().replace(/[:.]/g, "-");
const kit = await (await fetch("/kit.json")).json();
let link = q.get("link");
let mode = q.get("mode") ?? "quick";
const readings = [];

const say = (s) => ($("#status").textContent = s);
const show = (s) => (readings.push(s), ($("#reading").textContent = readings.join("\n")));

const db = await new Promise((resolve, reject) => {
  const r = indexedDB.open("wt-pacs-devices", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("rows", { keyPath: "key", autoIncrement: true });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const tx = (m, f) => new Promise((resolve, reject) => {
  const t = db.transaction("rows", m);
  const out = f(t.objectStore("rows"));
  t.oncomplete = () => resolve(out.result);
  t.onerror = () => reject(t.error);
});
const all = () => tx("readonly", (s) => s.getAll());

/** Every row not yet posted goes to the collector; a failed post is retried after the next round. */
async function post() {
  const rows = (await all()).filter((r) => !r.posted);
  if (!rows.length) return;
  try {
    const res = await fetch("/collect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await tx("readwrite", (s) => { for (const r of rows) s.put({ ...r, posted: true }); return { result: null }; });
    $("#posted").textContent = `posted ${rows.length} rows`;
  } catch (e) {
    $("#posted").textContent = `post failed (${e.message}): save the JSON at the end`;
  }
}

const keep = (row) => tx("readwrite", (s) => s.add({ evening, mode, link, build: kit.build, at: new Date().toISOString(), ...row }));

async function wake() {
  try {
    return await navigator.wakeLock?.request("screen");
  } catch {
    return null;
  }
}

async function bundle(name) {
  const res = await fetch(`/bundles/${name}.sbnd`);
  if (!res.ok) throw new Error(`bundle ${name}: HTTP ${res.status}`);
  return readBundle(await res.arrayBuffer());
}

/** One arm decodes every frame of `b` in a fresh worker: per-frame rows, or the error. */
function decodeAll(arm, b) {
  return new Promise((resolve) => {
    const w = new Worker("/lab/devices/decode-worker.js", { type: "module" });
    w.onmessage = ({ data }) => (w.terminate(), resolve(data));
    w.onerror = (e) => (w.terminate(), resolve({ error: e.message }));
    const frames = b.frames.map((f) => f.slice().buffer);
    w.postMessage({ arm, meta: b.meta, frames, mutate: q.has("mutate") }, frames);
  });
}

const median = (v) => [...v].sort((a, b) => a - b)[(v.length - 1) >> 1];
const summary = (data) => data.error
  ? { exact: false, error: data.error }
  : { exact: data.rows.every((r) => r.exact === true), ms: median(data.rows.map((r) => r.ms)), firstMs: data.rows[0]?.ms,
      totalMs: data.rows.reduce((t, r) => t + r.ms, 0), paths: [...new Set(data.rows.map((r) => r.path))], notExact: data.rows.filter((r) => r.exact !== true).length };

async function D0() {
  say("D0: reading what this browser offers…");
  const caps = await capabilities(kit.arms);
  await keep({ run: "D0", caps });
  show(`D0 ${caps.model ?? ""} ${caps.userAgent}`);
  show(`  WebTransport ${caps.webTransport}, isolated ${caps.crossOriginIsolated}, SIMD ${caps.wasmSimd}, nested workers ${caps.nestedModuleWorkers}, measureMemory ${caps.measureMemory}, clock ${caps.clockStepMs} ms`);
  show(`  WebCodecs ${JSON.stringify(caps.webCodecs)}`);
  for (const [arm, d] of Object.entries(caps.dials ?? {})) show(`  dial ${arm}: ${d.ready ? `ready ${Math.round(d.ms)} ms` : d.error}${d.pinned ? " (hash)" : " (CA)"}`);
  await post();
}

async function D1(plan) {
  for (const set of plan.d1Sets) {
    say(`D1 ${set}: fetching both codings (untimed)…`);
    const b = { htj2k: await bundle(`${set}.htj2k`), av1: await bundle(`${set}.av1`) };
    // WebCodecs is an arm only where it decodes this set's payloads.
    const trial = await decodeAll("webcodecs", { meta: b.av1.meta, frames: b.av1.frames.slice(0, 1) });
    const arms = D1_ARMS.filter((a) => a !== "webcodecs" || !trial.error);
    if (trial.error) show(`D1 ${set}: no WebCodecs arm (${trial.error})`);
    const rows = [];
    for (const v of schedule(arms, plan.rounds)) {
      say(`D1 ${set}: round ${v.round + 1}/${plan.rounds}, ${v.arm}`);
      const r = { run: "D1", set, ...v, frames: b.htj2k.frames.length, ...summary(await decodeAll(v.arm, v.arm === "htj2k" ? b.htj2k : b.av1)), line: await roundLine() };
      rows.push(r);
      await keep(r);
      if (rows.filter((x) => x.round === v.round).length === arms.length) await post();
    }
    await post();
    show(`D1 ${set} (median decode ms a frame, phone):`);
    for (const a of arms) show(`  ${a}: ${rows.filter((r) => r.arm === a && r.exact).map((r) => r.ms.toFixed(1)).join(" ")}`);
    for (const r of reading(rows, "htj2k", "ms")) show(`  ${line(r)}`);
  }
}

async function D2(plan) {
  const arms = kit.arms.filter((a) => !plan.d2Arms || plan.d2Arms.includes(a.name));
  say(`D2: fetching ${kit.d2Set} and proving it decodes exactly (untimed)…`);
  const b = await bundle(`${kit.d2Set}.htj2k`);
  const proof = summary(await decodeAll("htj2k", b));
  await keep({ run: "D2-proof", set: kit.d2Set, ...proof });
  if (!proof.exact) return show(`D2: the bundle does not decode exactly (${proof.error ?? `${proof.notExact} frames`}): stopped`);
  const preflight = async (when) => {
    const d = [];
    for (let i = 0; i < 5; i++) d.push((await visitDial(arms[0])) ?? NaN);
    await keep({ run: "D2-preflight", when, dialMs: d, line: await roundLine() });
    return median(d);
  };
  show(`D2 pre-flight: dial ${Math.round(await preflight("before"))} ms (median of 5, ${arms[0].name})`);
  const rows = [];
  for (const v of schedule(arms.map((a) => a.name), plan.rounds)) {
    say(`D2 on ${link}: round ${v.round + 1}/${plan.rounds}, ${v.arm}`);
    const arm = arms.find((a) => a.name === v.arm);
    const r = { run: "D2", set: kit.d2Set, ...v, settings: arm.settings, ...(await visit(arm, b.frames)), line: await roundLine() };
    rows.push(r);
    await keep(r);
    if (rows.filter((x) => x.round === v.round).length === arms.length) await post();
  }
  show(`D2 post-flight: dial ${Math.round(await preflight("after"))} ms`);
  await post();
  show(`D2 on ${link} (n = rounds, strict pairs):`);
  for (const m of ["askMs", "fillMs", "freshMs"]) for (const r of reading(rows, "shared", m)) show(`  ${line(r)}`);
}

async function visitDial(arm) {
  const t0 = performance.now();
  try {
    const opts = arm.cert_sha256 ? { serverCertificateHashes: [{ algorithm: "sha-256", value: Uint8Array.from(arm.cert_sha256.match(/../g), (h) => parseInt(h, 16)) }] } : {};
    const wt = new WebTransport(arm.wt_url, opts);
    await Promise.race([wt.ready, new Promise((_, no) => setTimeout(() => no(new Error("no ready in 10 s")), 10000))]);
    const ms = performance.now() - t0;
    wt.close();
    return ms;
  } catch {
    return null;
  }
}

async function run(which) {
  if (!link) return say("Tap the link first.");
  const plan = mode === "full" ? FULL : QUICK;
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  const lock = await wake();
  const t0 = performance.now();
  try {
    if (which === "evening" || which === "D0") await D0();
    if (which === "evening" || which === "D1") await D1(plan);
    if (which === "evening" || which === "D2") await D2(plan);
    say(`Done in ${Math.round((performance.now() - t0) / 60000)} min (${mode}). Readings are provisional until the full n.`);
  } catch (e) {
    say(`Stopped: ${e.message}`);
    await keep({ run: "error", which, error: String(e?.stack ?? e) });
  } finally {
    await post();
    lock?.release();
    for (const b of document.querySelectorAll("button")) b.disabled = false;
    globalThis.__done = true;
  }
}

for (const b of document.querySelectorAll("[data-link]")) b.onclick = () => {
  link = b.dataset.link;
  for (const x of document.querySelectorAll("[data-link]")) x.classList.toggle("on", x === b);
};
for (const b of document.querySelectorAll("[data-mode]")) b.onclick = () => {
  mode = b.dataset.mode;
  for (const x of document.querySelectorAll("[data-mode]")) x.classList.toggle("on", x === b);
};
for (const b of document.querySelectorAll("[data-run]")) b.onclick = () => run(b.dataset.run);
$("#save").onclick = async () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(await all())], { type: "application/json" }));
  a.download = `devices-${evening}.json`;
  a.click();
};
if (q.get("run")) run(q.get("run"));
