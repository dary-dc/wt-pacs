// D0: what this browser offers the client, and whether each arm's port answers a dial. docs/devices.md §2 D0
import { probe } from "/client/decode/av1-webcodecs.js";
import { PROBES } from "/client/decode/av1-probe.js";

// The smallest module using a SIMD128 instruction (i32x4.splat): it validates only where SIMD does.
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 17, 253, 98, 11]);

/** The smallest step `performance.now()` takes, in ms. */
function clockStep() {
  let step = Infinity;
  let last = performance.now();
  for (let i = 0; i < 200000 && step > 0.001; i++) {
    const t = performance.now();
    if (t > last) step = Math.min(step, t - last);
    last = t;
  }
  return step;
}

/** A module worker that starts a module worker of its own. */
function nestedWorkers() {
  const inner = "postMessage('inner')";
  const outer = `const w = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(inner)}], {type: 'text/javascript'})), {type: 'module'});
    w.onmessage = (e) => postMessage(e.data); w.onerror = (e) => postMessage('inner failed: ' + e.message);`;
  return new Promise((resolve) => {
    try {
      const w = new Worker(URL.createObjectURL(new Blob([outer], { type: "text/javascript" })), { type: "module" });
      const done = (v) => (w.terminate(), resolve(v));
      w.onmessage = (e) => done(e.data === "inner" ? true : String(e.data));
      w.onerror = (e) => done(`outer failed: ${e.message}`);
      setTimeout(() => done("no answer in 5 s"), 5000);
    } catch (e) {
      resolve(String(e.message));
    }
  });
}

/** A dial to each arm: `ready` and its ms, or the error. */
async function dials(arms) {
  const out = {};
  for (const a of arms) {
    const t0 = performance.now();
    try {
      const opts = a.cert_sha256
        ? { serverCertificateHashes: [{ algorithm: "sha-256", value: Uint8Array.from(a.cert_sha256.match(/../g), (h) => parseInt(h, 16)) }] }
        : {};
      const wt = new WebTransport(a.wt_url, opts);
      await Promise.race([wt.ready, new Promise((_, no) => setTimeout(() => no(new Error("no ready in 10 s")), 10000))]);
      out[a.name] = { ready: true, ms: performance.now() - t0, pinned: Boolean(a.cert_sha256) };
      wt.close();
    } catch (e) {
      out[a.name] = { ready: false, error: String(e?.message ?? e), pinned: Boolean(a.cert_sha256) };
    }
  }
  return out;
}

async function webcodecs() {
  if (typeof VideoDecoder !== "function") return "absent";
  const out = {};
  for (const layout of Object.keys(PROBES)) out[layout] = await probe(layout).catch((e) => `error: ${e.message}`);
  return out;
}

async function device() {
  const ua = navigator.userAgentData;
  const high = ua ? await ua.getHighEntropyValues(["model", "platformVersion", "fullVersionList"]).catch(() => null) : null;
  const battery = navigator.getBattery ? await navigator.getBattery().catch(() => null) : null;
  const c = navigator.connection;
  return {
    userAgent: navigator.userAgent,
    model: high?.model ?? null,
    platformVersion: high?.platformVersion ?? null,
    browsers: high?.fullVersionList ?? null,
    deviceMemory: navigator.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    connection: c ? { type: c.type ?? null, effectiveType: c.effectiveType, rtt: c.rtt, downlink: c.downlink } : null,
    battery: battery ? { level: battery.level, charging: battery.charging } : null,
    devicePixelRatio: devicePixelRatio,
  };
}

/** The capability line: recorded with every round, and D0's result. */
export async function capabilities(arms) {
  return {
    ...(await device()),
    webTransport: typeof WebTransport === "function",
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer === "function",
    wasmSimd: WebAssembly.validate(SIMD),
    nestedModuleWorkers: await nestedWorkers(),
    webCodecs: await webcodecs(),
    measureMemory: typeof performance.measureUserAgentSpecificMemory === "function",
    clockStepMs: clockStep(),
    dials: arms && typeof WebTransport === "function" ? await dials(arms) : null,
  };
}

/** What is cheap to read again before every round. */
export const roundLine = device;
