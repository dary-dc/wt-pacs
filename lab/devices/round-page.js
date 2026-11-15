/** The round's hook in the viewer, `?round=<host>&at=<k>`: one load recorded, then the host's next. lab/devices/README.md §The round */
import { beaconHooks } from "./beacon.js";
import { TICK_MS, fillFailure, largestGap, losslessFailure, verdict } from "./round.mjs";

export function roundHooks(q) {
  const k = Number(q.get("at"));
  const fillS = Number(q.get("fillS") ?? 120);
  const { recorder, finished } = beaconHooks(q, { step: k, cell: q.get("cell"), arm: q.get("arm"), counted: q.get("counted") !== "0" });
  holdScreen(recorder);
  const ticks = [performance.now()];
  const ticker = setInterval(() => ticks.push(performance.now()), TICK_MS);
  let left = false;
  const leave = (failure) => {
    if (left) return;
    left = true;
    clearInterval(ticker);
    ticks.push(performance.now());
    recorder.record("verdict", verdict(failure, largestGap(ticks)));
    recorder.flush({ leaving: true });
    location.assign(new URL(`/next?after=${k}`, q.get("round")));
  };
  const late = setTimeout(() => leave(`no fill in ${fillS} s`), fillS * 1000);
  return {
    async finished(ledger) {
      clearTimeout(late);
      await finished(ledger);
      const failure = fillFailure(ledger, (await globalThis.viewerMetadata).frameCount)
        ?? (q.get("press") === "lossless" ? await losslessFailure(document.getElementById("quality"), document.getElementById("lossless")) : null);
      if (q.has("stall")) stall(Number(q.get("stall")));
      leave(failure);
    },
  };
}

/** The screen wake lock, asked at load, on each return to visible and after each release; every outcome recorded. */
function holdScreen(r) {
  const ask = async (why) => {
    try {
      const lock = await navigator.wakeLock.request("screen");
      r.record("wakeLock", { event: "acquired", why });
      lock.addEventListener("release", () => (r.record("wakeLock", { event: "released" }), document.visibilityState === "visible" && ask("released")));
    } catch (e) {
      r.record("wakeLock", { event: "refused", why, error: `${e.name}: ${e.message}` });
    }
  };
  ask("load");
  document.addEventListener("visibilitychange", () => {
    r.record("visibility", { state: document.visibilityState });
    if (document.visibilityState === "visible") ask("visible");
  });
}

/** The lab's stall: the page's thread held for `ms`, so the runner's timers stop as a screen turned off would stop them. */
function stall(ms) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms);
}
