// KEEPALIVE's floor (report-plan.md §7.2): a bare keepalive fetch of the arm's own bytes, from the page or a decoder
// worker, under a fresh load id and reportId of the same lengths, so the read tool files it apart.
import { post } from "./keepalive.js";

const hex = () => crypto.randomUUID().replaceAll("-", "");

export function floor({ base, load, body, send = post }) {
  const own = crypto.randomUUID();
  const bytes = body.replaceAll(load, own).replace(/"reportId":"[0-9a-f]{32}"/, `"reportId":"${hex()}"`);
  const at = performance.timeOrigin + performance.now();
  const done = send(`${base}/load`, bytes, true);
  return { load: own, at, done, callMs: performance.timeOrigin + performance.now() - at };
}
