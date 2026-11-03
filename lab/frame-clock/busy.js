/** §7's busy page: a long task every period from the call, each one's measured length kept. docs/adr/frame-path.md §7 */
import { now } from "../../client/view/clock.js";

/** ms */
export const LONG_TASK_MS = 200;
export const BUSY_PERIOD_MS = 500;

/** Starts the long tasks; returns the array their lengths are pushed to, and pushes each one's `[start, end]` to `spans`. */
export function busyPage(spans = []) {
  const tasks = [];
  setInterval(() => {
    const a = now();
    while (now() - a < LONG_TASK_MS);
    const b = now();
    tasks.push(b - a);
    spans.push([a, b]);
  }, BUSY_PERIOD_MS);
  return tasks;
}
