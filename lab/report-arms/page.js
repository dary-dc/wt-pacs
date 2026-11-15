// One load through the product's downloader with the fault bench's decoder (lab/faultbench/README.md), one carrier
// arm behind the seam, the load report on the arm's timing and the safety report at once (report-plan.md §7.2).
// ?arm=&timing=&mutant=&wt=&hash=&dir=&fault=&at=[&forced=page]  — run.mjs drives it through window.rig.
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";
import { Load, safetyRecord } from "./record.js";
import { schedule } from "./timing.js";
import { wrapCarrier, mutateRecord } from "./mutants.js";

const q = new URLSearchParams(location.search);
const mutant = q.get("mutant");
const mutate = (r) => mutateRecord(r, mutant);
const rig = (globalThis.rig = { state: "starting", safety: 0, frames: 0, error: null });

try {
  if (!globalThis.crossOriginIsolated) throw new Error("not cross-origin isolated");
  const meta = await (await fetch(`${q.get("dir")}/metadata.json`)).json();
  const ctx = { base: "/report", load: crypto.randomUUID(), session: crypto.randomUUID(), build: "report-arms",
                source: meta.sourceFingerprint ?? null, frameCount: meta.frameCount, codec: meta.codec ?? "htj2k" };
  const env = { engine: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
  const arm = (await import(`./arms/${q.get("arm")}.js`)).default;
  const carrier = wrapCarrier(arm(ctx), mutant);
  const load = new Load(ctx);
  const timing = schedule({ timing: q.get("arm") === "off" ? "off" : q.get("timing"), carrier, load, mutate });
  const safety = (failure) => { rig.safety++; carrier.safety(JSON.stringify(mutate(safetyRecord(ctx, failure, env)))); };
  Object.assign(rig, { load: ctx.load, press: (text) => load.press({ at: Date.now(), text }) });
  // D8 has no session, so no decode to fail: the failure is forced on the page at once.
  if (q.get("forced") === "page") {
    safety({ frame: Number(q.get("at")), route: "forced", check: "xxh3", expected: null, actual: null, secondDecode: false,
             followed: "forced", at: performance.timeOrigin + performance.now() });
  }

  const n = meta.frameCount;
  const wt = new URL(q.get("wt"));
  wt.searchParams.set("load", ctx.load);
  const decoderWorker = `/lab/faultbench/decode/decoder.js?fault=${q.get("fault") ?? "none"}&at=${q.get("at") ?? -1}`;
  const fillFrom = performance.timeOrigin + performance.now();
  const done = () => {
    if (rig.frames < n) return;
    const fillTo = performance.timeOrigin + performance.now();
    load.fill = { fillFrom, fillTo, fillMs: fillTo - fillFrom };
    rig.state = "filled";
    timing.fillEnded();
  };
  const c = await DownloaderClient.connect(wt.href, q.get("hash"), {
    decoder: ctx.codec === "av1" ? { codec: "av1", ...(await built("dav1d")) } : await built("openjph"),
    digests: meta.digests.frames,
    decoderWorker,
    onFrame: (f) => {
      const { route, exact, mismatchOn, reason } = f.info;
      rig.frames++;
      load.frame({ i: f.frameIndex, route, kb: Math.round((f.info.wireBytes ?? 0) / 1024) });
      load.check(mismatchOn ?? route, exact === true && !mismatchOn);
      if (mismatchOn || exact === false) {
        safety({ frame: f.frameIndex, route: mismatchOn ?? route, check: "xxh3", expected: meta.digests.frames[f.frameIndex],
                 actual: reason?.match(/gave ([0-9a-f]+)/)?.[1] ?? null, secondDecode: exact === true,
                 followed: exact === true ? "rescued" : "blocked", at: performance.timeOrigin + performance.now() });
      }
      done();
    },
    onError: (e) => {
      rig.frames++;
      safety({ frame: e.frameIndex, route: null, check: "decode", expected: meta.digests.frames[e.frameIndex],
               actual: null, secondDecode: false, followed: "failed", at: performance.timeOrigin + performance.now() });
      done();
    },
  });
  rig.state = "filling";
  c.fill([...Array(n).keys()]);
} catch (e) {
  rig.state = "error";
  rig.error = String(e?.stack || e);
}
