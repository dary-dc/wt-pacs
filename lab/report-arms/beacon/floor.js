// BEACON's floor (report-plan.md §7.2): a sendBeacon of the arm's own bytes, under a fresh load id and reportId of
// the same lengths, so the read tool files it apart and the sink times it from `at` to its append.
const sendBeacon = (url, body) => navigator.sendBeacon(url, body);
const hex = () => crypto.randomUUID().replaceAll("-", "");

export function floor({ base, load, body, send = sendBeacon }) {
  const own = crypto.randomUUID();
  const bytes = body.replaceAll(load, own).replace(/"reportId":"[0-9a-f]{32}"/, `"reportId":"${hex()}"`);
  const at = performance.timeOrigin + performance.now();
  const ok = send(`${base}/load`, bytes);
  return { load: own, at, ok, callMs: performance.timeOrigin + performance.now() - at };
}
