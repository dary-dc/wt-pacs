// KEEPALIVE in the decoder worker (report-plan.md §3.2): a failed check sent from here at once, retried once after
// 1 s, its body handed back to go to the page with the frame, and the page told on the 204.
import { safetyRecord } from "../record.js";
import { wrapCarrier, mutateRecord } from "../mutants.js";
import { post } from "./keepalive.js";

const abs = () => performance.timeOrigin + performance.now();

/** `q`: the worker's query (`base`, `load`, `session`, `build`, `source`, `codec`, `mutant`), §7.1's init constants. */
export function reporter(q, digests, env, { channel, send = post, timer = setTimeout, now = abs,
                                                       random = Math.random } = {}) {
  const ctx = { load: q.get("load"), session: q.get("session"), build: q.get("build"), source: q.get("source"),
                codec: q.get("codec") };
  const mutant = q.get("mutant");
  const go = (body, again) => send(`${q.get("base")}/safety`, body, true)
    .then((ok) => (ok ? channel.postMessage(body) : again && timer(() => go(body, false), 1000)));
  const carrier = wrapCarrier({ safety: (body) => go(body, true) }, mutant, random);

  return (m) => {
    const failure = { frame: m.index, route: m.mismatchOn ?? m.route, check: "xxh3", expected: digests?.[m.index] ?? null,
                      actual: m.reason?.match(/gave ([0-9a-f]+)/)?.[1] ?? null, secondDecode: m.exact === true,
                      followed: m.exact === true ? "rescued" : "blocked", at: now() };
    const body = JSON.stringify(mutateRecord(safetyRecord(ctx, failure, env), mutant));
    carrier.safety(body);
    return body;
  };
}

export const failed = (m) => m?.kind === "frame" && !m.preview && (!!m.mismatchOn || m.exact === false);
