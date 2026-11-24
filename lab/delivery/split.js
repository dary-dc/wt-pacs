/**
 * SPLIT's fill (A2.3; route-policy.md §4.6): each group of the series asked as the view's group or as its exact frames,
 * by which resource is idle — bytes waiting for a decoder ask the next group exact, decoders waiting for bytes the view.
 * Both sessions dialled at load carry bytes alone (decode: false); `decoders` decode jobs at once, of either form.
 * docs/client/evidence/delivery-comparison.md A2.3, A2.5
 */
import { built } from "../../client/decode/wasm-glue.js";
import { DownloaderClient } from "../../client/transport/consumer.js";
import { pairOf } from "../../client/viewer/pair.js";

const epochMs = () => performance.timeOrigin + performance.now();

/** A product decoder worker, initialised as the downloader initialises its own. */
function decoderWorker(init) {
  const worker = new Worker(new URL("../../client/decode/decoder.js", import.meta.url), { type: "module" });
  const ch = new MessageChannel();
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.kind === "ready" ? resolve({ worker, port: ch.port2 }) : reject(new Error(`a decoder did not start: ${data.reason}`)));
    worker.onerror = (e) => reject(new Error(`a decoder did not start: ${e.message}`));
    worker.postMessage({ kind: "init", toConsumer: ch.port1, ...init }, [ch.port1]);
  });
}

/**
 * The fill, its frames as beacon.js records a load's, and each group's form. `aheadBytes`: the wire kept this full
 * ahead of the groups landed (the form's bandwidth-delay product), at least one group; `viewOnly`, a mutant.
 */
export async function splitFill({ meta, transport, decoders, aheadBytes, viewOnly = false }) {
  const p = pairOf(meta);
  const [exactMeta, exactTransport] = await Promise.all([p.metadata, p.transport].map((u) => fetch(u).then((r) => r.json())));
  const g = meta.lossy.g;
  const n = meta.frameCount;
  const groups = Math.ceil(n / g);
  const forms = [];
  const frames = new Map();
  const errors = [];
  let settle;
  const done = new Promise((resolve) => (settle = resolve));
  const fail = (why) => (errors.push(why), settle());

  const [av1, openjph] = await Promise.all([built("dav1d"), built("openjph")]);
  const pools = {
    view: await Promise.all(Array.from({ length: decoders }, () => decoderWorker({ decoder: { codec: "av1", optimal: true, ...av1 }, groupLength: g, digests: meta.digests?.frames }))),
    exact: await Promise.all(Array.from({ length: decoders }, () => decoderWorker({ decoder: openjph, groupLength: 1, digests: exactMeta.digests.frames }))),
  };
  // A job: a view group, its frames to one decoder in order, or one exact frame; it holds a slot until its last frame is out.
  let free = decoders;
  const ready = [];
  const jobs = new Map();
  const start = () => {
    while (free > 0 && ready.length) {
      const job = ready.shift();
      free -= 1;
      const w = pools[job.form].find((x) => !x.busy);
      w.busy = true;
      job.worker = w;
      // A view group's frames go key first and in order, as they land.
      job.flush = () => {
        for (let f; (f = job.arrived.find((a) => a.i === job.frames[job.sent])); job.sent++) {
          w.worker.postMessage({ kind: "decode", index: f.i, gen: 0, key: f.i % g === 0, bytes: f.bytes, stamps: {} }, [f.bytes.buffer]);
        }
      };
      job.flush();
    }
  };
  const delivered = (job, f) => {
    const rec = frames.get(f.index);
    Object.assign(rec, { decodeMs: f.stamps.decodeEnd - f.stamps.decodeStart, decoded: f.stamps.decodeEnd, route: f.route, exact: f.exact });
    // As the product: a frame without a digest is unchecked, a mismatch fails.
    if (f.exact === false) return fail(`${job.form} frame ${f.index} decoded not exact${f.reason ? `: ${f.reason}` : ""}`);
    if (++job.out < job.frames.length) return;
    job.worker.busy = false;
    free += 1;
    start();
    if ([...frames.values()].filter((r) => r.decoded).length === n) settle();
  };
  for (const form of ["view", "exact"]) for (const w of pools[form]) {
    w.port.onmessage = ({ data: f }) => !f.preview && delivered(jobs.get(`${form}/${f.index}`), f);
    w.worker.onmessage = ({ data }) => data.kind === "failed" && fail(`${form} frame ${data.index}: ${data.reason}`);
  }

  const fillFrom = epochMs();
  const [view, exact] = await Promise.all([[transport, meta], [exactTransport, exactMeta]].map(([t, m]) => DownloaderClient.connect(t.wt_url, t.cert_sha256, {
    transport: transport.module, decode: false, ...(m === meta && { groupLength: g, frameCount: n }) })));
  // Bytes asked and not landed, by each form's frames landed so far; before any has landed, a group fills the window.
  let onWire = 0;
  let next = 0;
  const landedBytes = { view: [0, 0], exact: [0, 0] };
  const estimate = (form, frames) => (landedBytes[form][1] ? (frames * landedBytes[form][0]) / landedBytes[form][1] : Infinity);
  const ask = () => {
    while (next < groups && (onWire === 0 || onWire < aheadBytes)) {
      const k = next++;
      const form = !viewOnly && k > 0 && ready.length > 0 ? "exact" : "view";
      forms.push(form);
      const idx = Array.from({ length: Math.min(g, n - k * g) }, (_, j) => k * g + j);
      const units = form === "view" ? [idx] : idx.map((i) => [i]);
      for (const unit of units) {
        const job = { form, frames: unit, arrived: [], sent: 0, out: 0, worker: null };
        for (const i of unit) jobs.set(`${form}/${i}`, job);
      }
      const expect = Math.min(estimate(form, idx.length), aheadBytes);
      onWire += expect;
      let landed = 0;
      for (const i of idx) {
        (form === "view" ? view : exact).requestFrame(i).then((f) => {
          frames.set(i, { i, form, wireBytes: f.bytes.length, lastByte: f.timing.lastChunkMs });
          landedBytes[form][0] += f.bytes.length;
          landedBytes[form][1] += 1;
          const job = jobs.get(`${form}/${i}`);
          job.arrived.push({ i, bytes: f.bytes });
          if (job.worker) job.flush();
          else if (!ready.includes(job)) ready.push(job);
          start();
          if (++landed === idx.length) {
            onWire -= expect;
            ask();
          }
        }, (e) => fail(`${form} frame ${i}: ${e.message}`));
      }
    }
  };
  ask();
  await done;
  view.close();
  exact.close();
  for (const form of ["view", "exact"]) for (const w of pools[form]) w.worker.terminate();
  const end = Math.max(...[...frames.values()].map((r) => r.decoded ?? 0));
  const x = forms.filter((f) => f === "exact").length / forms.length;
  return { fillFrom, fillMs: end - fillFrom, frames: [...frames.values()].sort((a, b) => a.i - b.i), forms, x, errors };
}
