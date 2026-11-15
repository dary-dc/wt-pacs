// BEACON, report-plan.md §3.1 as its advocate left it: every record one sendBeacon inside the call, nothing awaited.
const sendBeacon = (url, body) => navigator.sendBeacon(url, body);

export default function beacon({ base }, { send = sendBeacon, doc = document, win = globalThis, timer = setTimeout } = {}) {
  const pending = [];
  let retry = null;

  // A refused safety report stays whole and first in line: `false` means the 64 KiB keepalive budget is in flight.
  const flush = () => {
    while (pending.length && send(`${base}/safety`, pending[0])) pending.shift();
    if (pending.length && retry === null) retry = timer(() => { retry = null; flush(); }, 1000);
  };
  doc.addEventListener("visibilitychange", () => doc.visibilityState === "hidden" && flush());
  win.addEventListener("pagehide", flush);

  return {
    load(body) {
      flush();
      if (send(`${base}/load`, body)) return;
      const r = JSON.parse(body);
      if (r.frames) send(`${base}/load`, JSON.stringify({ ...r, frames: null, truncated: true }));
    },
    safety(body) {
      pending.push(body);
      flush();
    },
  };
}
