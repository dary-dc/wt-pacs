/** The phone run's runner: each load of a plan in turn, its step carried in the URL across the two origins. lab/phone/README.md */
import { beaconHooks } from "./beacon.js";

/** The page's port per controller, as `docs/devices.md` §7's amendment serves them. */
export const PORTS = { "cubic-restart": 8765, bbr: 8766 };
const LINKS = ["tether", "wifi"];
const VIEWS = ["page", "worker"];

/** The Second amendment's fixed gap and its limits on the label after each press; a fill's own limit is the runner's. */
export const DEFAULTS = { gapS: 15, fillS: 120, losslessMs: 30000, optimalMs: 10000 };

/**
 * A plan's text, one load a line, `<link> <controller> <view>`, `warm-up` after a load not counted; `pause <why>` holds
 * the next load until the owner continues; `#` starts a comment.
 */
export function parseLoads(text) {
  const loads = [];
  let pauseBefore;
  const lines = text.split("\n").map((l) => l.replace(/#.*/, "").trim());
  lines.forEach((line, k) => {
    if (!line) return;
    if (/^pause\b/.test(line)) return void (pauseBefore = line.slice(5).trim() || "paused");
    const [link, controller, view, extra, ...rest] = line.split(/\s+/);
    const bad = !LINKS.includes(link) ? `link ${link}` : !Object.hasOwn(PORTS, controller) ? `controller ${controller}`
      : !VIEWS.includes(view) ? `view ${view}` : (extra !== undefined && extra !== "warm-up") || rest.length ? `"${line}"` : null;
    if (bad) throw new Error(`refused: line ${k + 1}, ${bad} — <${LINKS.join("|")}> <${Object.keys(PORTS).join("|")}> <${VIEWS.join("|")}> [warm-up], or pause <why>`);
    loads.push({ link, controller, view, counted: extra === undefined, ...(pauseBefore && { pauseBefore }) });
    pauseBefore = undefined;
  });
  if (pauseBefore) throw new Error(`refused: line ${lines.findLastIndex((l) => /^pause\b/.test(l)) + 1}, a pause with no load after it`);
  return loads;
}

const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Each load with its full origin, its link's address and its controller's port; `addresses` is { tether, wifi }. */
export function withOrigins(loads, addresses) {
  return loads.map((l) => {
    if (!ipv4.test(addresses[l.link])) throw new Error(`refused: the ${l.link} address ${JSON.stringify(addresses[l.link])} — an IPv4 address`);
    return { ...l, origin: `http://${addresses[l.link]}:${PORTS[l.controller]}` };
  });
}

/** The Amendment's arms in Williams rows: A page·cubic-restart, B worker·cubic-restart, C worker·bbr, D page·bbr. */
const ARMS = { A: "cubic-restart page", B: "cubic-restart worker", C: "bbr worker", D: "bbr page" };
const ROWS = { 1: "ABDC", 2: "BCAD", 3: "CDBA", 4: "DACB" };
const COUNTERS = "pause read the device counters (bytes)";

/** `docs/devices.md` §7's Second amendment as a plan: four warm-ups, then six octets, the links alternating load by load. */
export function octetPlan() {
  const warmUps = ["cubic-restart", "bbr"].flatMap((c) => ["tether", "wifi"].map((link) => `${link} ${c} page warm-up`));
  const rows = { tether: "123412", wifi: "341234" };
  const octets = [0, 1, 2, 3, 4, 5].map((o) => {
    const order = o % 2 ? ["wifi", "tether"] : ["tether", "wifi"];
    return [`# octet ${o + 1}`, ...[0, 1, 2, 3].flatMap((i) => order.map((link) => `${link} ${ARMS[ROWS[rows[link][o]][i]]}`))];
  });
  return [COUNTERS, warmUps[0], COUNTERS, warmUps[1], COUNTERS, ...warmUps.slice(2), ...octets.flat()].join("\n");
}

/** The Amendment's blocks, the Second amendment's fallback: two warm-ups and three quads a block, a pause at each link change. */
export function blockPlan() {
  const blocks = [["tether", "123"], ["wifi", "123"], ["wifi", "412"], ["tether", "412"]];
  return blocks.map(([link, rows], b) => [
    ...(b && blocks[b - 1][0] !== link ? [`pause the ${link === "wifi" ? "tether off" : "tether on (its address may change)"}`] : []),
    `# block ${b + 1}: ${link}, rows ${rows.split("").join(" ")}`,
    `${link} cubic-restart page warm-up`,
    `${link} bbr page warm-up`,
    ...[...rows].flatMap((r) => [...ROWS[r]].map((arm) => `${link} ${ARMS[arm]}`)),
  ].join("\n")).join("\n");
}

const encode = (plan) => btoa(JSON.stringify(plan)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = (s) => JSON.parse(atob(s.replaceAll("-", "+").replaceAll("_", "/")));

/** The URL of load `k` of `plan` ({ series, gapS, fillS, loads with their origins }), every lever the load needs in it. */
export function loadUrl(plan, k) {
  const { origin, controller, view } = plan.loads[k];
  const q = new URLSearchParams({ overlay: "1", view, beacon: controller, run: encode(plan), at: String(k) });
  return `${origin}/?${q}`;
}

/** Why a filled load fails `docs/devices.md` §7's rule before any press, or null: every frame received, each through WebCodecs, no error. */
export function fillFailure({ error, frames = [], errors = [] }, frameCount) {
  if (error) return error;
  if (frames.length < frameCount) return `received ${frames.length} of ${frameCount}`;
  const off = frames.find((f) => f.path !== "av1-webcodecs");
  if (off) return `frame ${off.i} through ${off.path}${off.refusal ? ` (${off.refusal})` : ""}`;
  return errors.length ? errors[0] : null;
}

const until = (done, ms) => new Promise((resolve) => {
  const t0 = performance.now();
  const poll = setInterval(() => {
    const ok = done();
    if (ok || performance.now() - t0 > ms) (clearInterval(poll), resolve(Boolean(ok)));
  }, 20);
});

/** The Second amendment's presses after the fill: Lossless within its limit of the first, Optimal quality of the second; why not, or null. */
export async function pressesFailure(quality, lossless, { losslessMs, optimalMs } = DEFAULTS) {
  const shown = () => `${quality.className || "none"} (${quality.textContent})`;
  if (!(await until(() => quality.className === "optimal", 10000))) return `label ${shown()} after the fill, not optimal`;
  if (!(await until(() => !lossless.hidden, 10000))) return "no lossless button: the exact series did not connect";
  lossless.click();
  if (!(await until(() => ["lossless", "failed"].includes(quality.className), losslessMs))) return `no Lossless ${losslessMs / 1000} s after the press: ${shown()}`;
  if (quality.className !== "lossless") return `lossless pressed: ${shown()}`;
  lossless.click();
  return (await until(() => quality.className === "optimal", optimalMs)) ? null : `not Optimal quality ${optimalMs / 1000} s after the second press: ${shown()}`;
}

/** The runner's banner over the page; `go`, a button that opens that URL. */
function banner(text, failed, go) {
  const el = document.getElementById("phone-run") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "phone-run" }));
  el.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9;padding:8px;font:16px sans-serif;color:#fff;background:${failed ? "#b00020" : "#1b5e20"}`;
  el.textContent = text;
  if (go) el.append(" ", Object.assign(document.createElement("button"), { id: "phone-run-continue", textContent: "Continue", onclick: () => location.assign(go) }));
}

/** viewer.js's lab hook for `?run=<plan>&at=<k>`: the load checked as it fills, then pressed, then the next after the gap. */
export function runHooks(q) {
  const plan = decode(q.get("run"));
  const k = Number(q.get("at"));
  const load = plan.loads[k];
  const { recorder, finished } = beaconHooks(q, { series: plan.series, link: load?.link, counted: load?.counted, step: k });
  const of = `load ${k + 1} of ${plan.loads.length}`;
  const stop = (why) => {
    recorder.record("verdict", { ok: false, why });
    recorder.flush({ leaving: true });
    const next = k + 1 < plan.loads.length ? `; not rerun: the start page at load ${k + 2}` : "";
    banner(`stopped at ${of}: ${why}${next}`, true);
  };
  const expected = load && new URL(loadUrl(plan, k));
  if (!expected || expected.origin !== location.origin || expected.search !== location.search) {
    stop(`this page is not ${of} of its plan`);
    return { finished: async () => {} };
  }
  const late = setTimeout(() => stop(`no fill in ${plan.fillS} s`), plan.fillS * 1000);
  return {
    async finished(ledger) {
      clearTimeout(late);
      await finished(ledger);
      const why = fillFailure(ledger, (await globalThis.viewerMetadata).frameCount)
        ?? (await pressesFailure(document.getElementById("quality"), document.getElementById("lossless")));
      if (why) return stop(why);
      recorder.record("verdict", { ok: true });
      recorder.flush();
      if (k + 1 === plan.loads.length) return banner(`run done: ${plan.loads.length} loads`, false);
      const pause = plan.loads[k + 1].pauseBefore;
      if (pause) return banner(`${of} passed; load ${k + 2} waits: ${pause}`, false, loadUrl(plan, k + 1));
      banner(`${of} passed; the next in ${plan.gapS} s`, false);
      setTimeout(() => location.assign(loadUrl(plan, k + 1)), plan.gapS * 1000);
    },
  };
}
