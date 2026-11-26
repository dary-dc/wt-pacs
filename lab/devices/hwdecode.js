// D0's hardware-decode probe: each unit of hw-units.json under each hardwareAcceleration, every outcome as the
// browser gave it, each cell in a worker of its own. lab/devices/README.md §The hardware-decode probe
import { codecString, sequence } from "/client/decode/av1-payload.js";

const ACCELERATIONS = ["no-preference", "prefer-hardware", "prefer-software"];
// VideoPixelFormat, WebCodecs §9.8: https://www.w3.org/TR/webcodecs/#enumdef-videopixelformat
const FORMATS = ["I420", "I420P10", "I420P12", "I420A", "I420AP10", "I420AP12", "I422", "I422P10", "I422P12", "I422A",
  "I422AP10", "I422AP12", "I444", "I444P10", "I444P12", "I444A", "I444AP10", "I444AP12", "NV12", "RGBA", "RGBX",
  "BGRA", "BGRX"];
const TASK_MS = 10000;
const DECODE_MS = 30000;
const MUTATE = new URLSearchParams(location.search).get("mutate");

/**
 * A worker that answers one task at a time. A task that does not answer in time ends the worker: a call that blocks
 * its thread (Chromium 141's `copyTo({format: "I420P10"})` of a 10-bit frame does) is recorded as `hung`.
 */
function worker() {
  const w = new Worker("/lab/devices/hwdecode-worker.js", { type: "module" });
  const ask = (task, ms = TASK_MS) => new Promise((resolve) => {
    const t = setTimeout(() => (w.terminate(), resolve({ error: { name: "hung", message: `no answer in ${ms} ms; the worker was ended` } })), ms);
    w.onmessage = ({ data }) => (clearTimeout(t), resolve(data));
    w.onerror = (e) => (clearTimeout(t), resolve({ error: { name: "worker error", message: e.message } }));
    w.postMessage({ ...task, mutate: MUTATE });
  });
  return { ask, end: () => w.terminate() };
}

/** One unit under one acceleration: the decode, then each copy and paint of its first frame. */
async function cell(u, acceleration) {
  let w = worker();
  const decode = () => w.ask({ task: "decode", u, acceleration }, DECODE_MS);
  const d = await decode();
  const row = d.error ? { unit: u.name, acceleration, error: d.error } : d.value;
  /** A task; after a hang, a fresh worker decodes again so the next task has a frame. */
  const step = async (task) => {
    const r = await w.ask(task);
    if (r.error?.name === "hung") {
      w = worker();
      const again = await decode();
      if (!again.value?.frame) row.redecode = again.error ?? again.value;
    }
    return r.error ? { ok: false, error: r.error } : r.value;
  };
  if (row.frame) {
    row.copyTo = [];
    for (const format of [null, ...FORMATS]) row.copyTo.push({ format, ...(await step({ task: "copy", format })) });
    row.paint = { webgl2: await step({ task: "webgl2" }), webgpu: await step({ task: "webgpu" }) };
  }
  w.end();
  return row;
}

const decoded = (u) => Uint8Array.from(atob(u.unit), (c) => c.charCodeAt(0));

/** Media Capabilities' answer per codec string: `powerEfficient` is the engine's own hint of a hardware path. */
async function capabilities(units) {
  const out = {};
  for (const u of units) {
    const video = { contentType: `video/mp4; codecs="${codecString(sequence(decoded(u)))}"`, width: u.width, height: u.height,
      bitrate: 1e6, framerate: 30 };
    try {
      const r = await navigator.mediaCapabilities.decodingInfo({ type: "file", video });
      out[u.name] = { supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient };
    } catch (e) {
      out[u.name] = { error: { name: e.name, message: e.message } };
    }
  }
  return out;
}

function webglInfo() {
  const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
  return gl && { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION), extensions: gl.getSupportedExtensions() };
}

export async function hardwareDecode(say = () => {}) {
  const units = await (await fetch("/lab/devices/hw-units.json")).json();
  const report = { mutate: MUTATE, encoder: { aom: units.aom, decoders: units.decoders }, cells: [] };
  const w = worker();
  const once = async (task) => { const r = await w.ask(task); return r.value ?? { error: r.error }; };
  report.environment = { webgl2: webglInfo(), ...(await once({ task: "environment" })) };
  report.sourceCheck = await once({ task: "sources", units: units.units });
  w.end();
  report.units = units.units.map(({ unit, ...u }) => u);
  report.mediaCapabilities = await capabilities(units.units);
  const total = units.units.length * ACCELERATIONS.length;
  for (const u of units.units) {
    for (const acceleration of ACCELERATIONS) {
      say(`D0 hardware decode ${report.cells.length + 1}/${total}: ${u.name} ${acceleration}`);
      report.cells.push(await cell(u, acceleration));
    }
  }
  return report;
}

/** One line a cell, for the runner page. */
export function lines(report) {
  const paint = (p) => (p?.error ? p.error.name : `${p.distinct} levels ${p.exact}/${p.of} exact`);
  return report.cells.map((c) => {
    const outcomes = c.error ? `${c.error.name}: ${c.error.message}` : c.configure?.error ? `configure ${c.configure.error.name}`
      : (c.decodes ?? []).map((d) => (d.error ? d.error.name : d.outcome)).join(",");
    const own = c.copyTo?.find((k) => k.format === null);
    const copy = !own ? "" : own.ok && Array.isArray(own.planes)
      ? ` ${own.as} ${own.planes.map((p) => `${p.plane}${"exact" in p ? (p.exact ? "=" : "≠") : "?"}`).join("")}` : ` copy ${own.error?.name ?? own.planes}`;
    const gl = c.paint ? `; webgl2 ${paint(c.paint.webgl2.RGBA16F ?? c.paint.webgl2)}; webgpu ${paint(c.paint.webgpu)}` : "";
    return `${c.unit} ${c.acceleration}: supported ${c.isConfigSupported?.supported ?? c.isConfigSupported?.error?.name}; ${outcomes}${copy}${gl}`;
  });
}
