/** The phone run's runner: each load of a plan in turn, its step carried in the URL across the two origins. lab/phone/README.md */
import { beaconHooks } from "./beacon.js";

/** The page's port per controller, as `docs/devices.md` §7's amendment serves them. */
export const PORTS = { "cubic-restart": 8765, bbr: 8766 };
const LINKS = ["tether", "wifi"];
const VIEWS = ["page", "worker"];

/** A plan's text, one load a line, `<link> <controller> <view>`, `warm-up` after a load not counted; `#` starts a comment. */
export function parseLoads(text) {
  return text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean).map((line, k) => {
    const [link, controller, view, extra, ...rest] = line.split(/\s+/);
    const bad = !LINKS.includes(link) ? `link ${link}` : !Object.hasOwn(PORTS, controller) ? `controller ${controller}`
      : !VIEWS.includes(view) ? `view ${view}` : (extra !== undefined && extra !== "warm-up") || rest.length ? `"${line}"` : null;
    if (bad) throw new Error(`refused: line ${k + 1}, ${bad} — <${LINKS.join("|")}> <${Object.keys(PORTS).join("|")}> <${VIEWS.join("|")}> [warm-up]`);
    return { link, controller, view, counted: extra === undefined };
  });
}

/** The amendment's quads, Williams rows of arms A page·cubic-restart, B worker·cubic-restart, C worker·bbr, D page·bbr. */
const ARMS = { A: "cubic-restart page", B: "cubic-restart worker", C: "bbr worker", D: "bbr page" };
const ROWS = { 1: "ABDC", 2: "BCAD", 3: "CDBA", 4: "DACB" };
const BLOCKS = [["tether", "123"], ["wifi", "123"], ["wifi", "412"], ["tether", "412"]];

/** `docs/devices.md` §7's amended timed run as a plan's text: four blocks, each two warm-ups and three quads. */
export const amendedPlan = () => BLOCKS.map(([link, rows]) => [
  `# block: ${link}, rows ${rows.split("").join(" ")}`,
  `${link} cubic-restart page warm-up`,
  `${link} bbr page warm-up`,
  ...[...rows].flatMap((r) => [...ROWS[r]].map((arm) => `${link} ${ARMS[arm]}`)),
].join("\n")).join("\n");

const encode = (plan) => btoa(JSON.stringify(plan)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = (s) => JSON.parse(atob(s.replaceAll("-", "+").replaceAll("_", "/")));

/** The URL of load `k` of `plan` ({ addresses: { tether, wifi }, series, gapS, loads }), every lever the load needs in it. */
export function loadUrl(plan, k) {
  const { link, controller, view } = plan.loads[k];
  const q = new URLSearchParams({ overlay: "1", view, beacon: controller, run: encode(plan), at: String(k) });
  return `http://${plan.addresses[link]}:${PORTS[controller]}/?${q}`;
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

/** The label's course on two presses: optimal, then fetching and lossless, then optimal again; why not, or null. */
async function pressesFailure() {
  const quality = document.getElementById("quality");
  const lossless = document.getElementById("lossless");
  const is = (c) => () => quality.className === c;
  if (!(await until(is("optimal"), 10000))) return `label ${quality.className || "none"} after the fill, not optimal`;
  if (!(await until(() => !lossless.hidden, 10000))) return "no lossless button: the exact series did not connect";
  lossless.click();
  if (!(await until(() => quality.className !== "optimal", 5000))) return "lossless pressed, the label did not move";
  if (!(await until(() => quality.className !== "asking", 30000))) return "fetching lossless for 30 s";
  if (quality.className !== "lossless") return `lossless pressed: ${quality.textContent}`;
  lossless.click();
  return (await until(is("optimal"), 10000)) ? null : `lossless pressed again: ${quality.textContent}`;
}

function banner(text, failed) {
  const el = document.getElementById("phone-run") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "phone-run" }));
  el.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9;padding:8px;font:16px sans-serif;color:#fff;background:${failed ? "#b00020" : "#1b5e20"}`;
  el.textContent = text;
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
    banner(`stopped at ${of}: ${why}`, true);
  };
  const expected = load && new URL(loadUrl(plan, k));
  if (!expected || expected.port !== location.port || expected.search !== location.search) {
    stop(`this page is not ${of} of its plan`);
    return { finished: async () => {} };
  }
  const late = setTimeout(() => stop(`no fill in ${plan.fillS} s`), plan.fillS * 1000);
  return {
    async finished(ledger) {
      clearTimeout(late);
      await finished(ledger);
      const why = fillFailure(ledger, (await globalThis.viewerMetadata).frameCount) ?? (await pressesFailure());
      if (why) return stop(why);
      recorder.record("verdict", { ok: true });
      recorder.flush();
      if (k + 1 === plan.loads.length) return banner(`run done: ${plan.loads.length} loads`, false);
      banner(`${of} passed; the next in ${plan.gapS} s`, false);
      setTimeout(() => location.assign(loadUrl(plan, k + 1)), plan.gapS * 1000);
    },
  };
}
