/** §7's busy page: a long task every period from the call, each one's measured length kept. docs/adr/frame-path.md §7 */
import { now } from "../../client/view/clock.js";

/** ms */
export const LONG_TASK_MS = 200;
export const BUSY_PERIOD_MS = 500;

/** Starts the long tasks; returns the array their lengths are pushed to. */
export function busyPage() {
  const tasks = [];
  setInterval(() => {
    const a = now();
    while (now() - a < LONG_TASK_MS);
    tasks.push(now() - a);
  }, BUSY_PERIOD_MS);
  return tasks;
}
