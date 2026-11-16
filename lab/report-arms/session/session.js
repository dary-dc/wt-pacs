// SESSION, report-plan.md §3.3 as its advocate left it: the page hands every record to the downloader
// (downloader.js), which writes it on the series' WebTransport session and holds it until the server's byte.
import { schedule as http } from "../timing.js";

export const reportsOf = (load) => `report-arms:session:${load}`;

export default function session({ load }, { channel = new BroadcastChannel(reportsOf(load)) } = {}) {
  return {
    load: (body) => channel.postMessage({ kind: "load", body }),
    // `fromWorker`: the decoder handed it to the downloader already (decoder.js).
    safety: (body, fromWorker) => fromWorker || channel.postMessage({ kind: "safety", body }),
  };
}

/** `1`, SESSION's own: the hybrid, plus a delta every second while anything changed. `H` and `Y` are timing.js's. */
export function schedule(o, { every = setInterval } = {}) {
  if (o.timing !== "1") return http(o);
  const hybrid = http({ ...o, timing: "Y" });
  const mutate = o.mutate ?? ((r) => r);
  const tick = () => { const r = o.load.delta(); if (r) o.carrier.load(JSON.stringify(mutate(r))); };
  return { fillEnded() { hybrid.fillEnded(); every(tick, 1000); } };
}
