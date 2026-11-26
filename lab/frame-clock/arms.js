/** Each arm's start on the page: the page's clocks post their ticks, the worker's are named. lab/frame-clock/README.md */
import { now } from "../../client/view/clock.js";

/** In `lab/order.mjs` unit order; `page-raf′` is `page-raf` again, the A/A pair. */
export const ARMS = ["page-raf", "page-raf′", "page-interval", "worker-raf", "worker-timeout", "worker-channel", "worker-wait"];

/** Starts `arm`'s cine on `view` (a `ViewWorker`), frame 0 due at `t0`; returns its stop. */
export function start(arm, view, fps, t0) {
  if (!ARMS.includes(arm)) throw new Error(`no arm ${arm}`);
  if (arm.startsWith("worker-")) {
    view.play(fps, t0, arm.slice("worker-".length));
    return () => view.pause();
  }
  view.play(fps, t0, "posted");
  if (arm === "page-interval") {
    const id = setInterval(() => view.tick(now()), 1000 / fps);
    return () => (clearInterval(id), view.pause());
  }
  let on = true;
  const frame = (t) => {
    if (!on) return;
    view.tick(performance.timeOrigin + t, performance.timeOrigin + t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => ((on = false), view.pause());
}
