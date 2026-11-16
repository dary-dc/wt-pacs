// KEEPALIVE, report-plan.md §3.2 as its advocate left it: the load report from the page; the safety report at once
// from the decoder worker that found it (worker.js), held by the page and sent again at each hide until its 204.
const BUDGET = { bytes: 60_000, requests: 9 }; // OpenTelemetry's headroom under the 64 KiB keepalive budget, §1.4
const size = (s) => new TextEncoder().encode(s).length;

export const acks = (load) => `report-arms:keepalive:${load}`;

export const post = (url, body, keepalive) =>
  fetch(url, { method: "POST", keepalive, headers: { "Content-Type": "application/json" }, body })
    .then((r) => r.status === 204, () => false);

export default function keepalive({ base, load }, { send = post, doc = document, win = globalThis, timer = setTimeout,
                                                    channel = new BroadcastChannel(acks(load)) } = {}) {
  const inflight = { bytes: 0, requests: 0 };
  const held = new Map(); // a safety body → true while a send of it is in flight
  const acked = new Set();
  let hiding = false;

  const fits = (n) => inflight.bytes + n <= BUDGET.bytes && inflight.requests < BUDGET.requests;
  // Past the budget a record goes as an ordinary fetch, which lives only as long as the page.
  const go = (kind, body) => {
    const n = size(body);
    const keep = fits(n);
    if (keep) inflight.bytes += n, inflight.requests++;
    return send(`${base}/${kind}`, body, keep).finally(() => keep && (inflight.bytes -= n, inflight.requests--));
  };

  const settle = (body) => { held.delete(body); acked.add(body); };
  const sendSafety = (body, again) => {
    held.set(body, true);
    go("safety", body).then((ok) => {
      if (ok) return settle(body);
      held.set(body, false);
      if (again) timer(() => held.get(body) === false && sendSafety(body, false), 1000);
    });
  };
  const flush = () => {
    hiding = true;
    for (const [body, busy] of held) if (!busy) sendSafety(body, false);
  };
  channel.onmessage = ({ data }) => settle(data);
  doc.addEventListener("visibilitychange", () => (doc.visibilityState === "hidden" ? flush() : (hiding = false)));
  win.addEventListener("pagehide", flush);
  win.addEventListener("pageshow", () => (hiding = false));

  return {
    // A send while visible (the hybrid's at the fill's end) is retried once on its answer; a hide send never waits.
    load(body) {
      const r = fits(size(body)) ? null : JSON.parse(body);
      const out = r?.frames ? JSON.stringify({ ...r, frames: null, truncated: true }) : body;
      const attempt = (again) => go("load", out).then((ok) => ok || !again || timer(() => attempt(false), 1000));
      attempt(!hiding);
    },
    // `fromWorker`: the decoder worker has sent it already; the page holds it for the next hide until the 204.
    safety(body, fromWorker) {
      if (acked.has(body)) return;
      if (fromWorker) held.set(body, false);
      else sendSafety(body, !hiding);
    },
  };
}
