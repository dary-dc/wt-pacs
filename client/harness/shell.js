/**
 * One harness shell, two adapters.
 *
 * `index.html` (WASM) and `ts.html` (TypeScript) each supply `loadSession`; everything a run
 * does — the ask schedule, depth, using the bytes, the telemetry marks, closing the session —
 * lives here, so the two arms cannot be driven differently by accident.
 *
 * Query parameters:
 *   telemetry=1        load the telemetry build and harvest via window.__wtpacsTelemetry
 *   stream_mode=…      shared | per-frame (must match the server; recorded in the report)
 *   cell=…             ondemand (one RequestFrame per step, `d` in flight) | fill (one StreamFrames)
 *   d=…                outstanding asks for on-demand (default 1 — the control)
 *   n=…                steps to run (default: one pass over the study)
 *   frames=…           study frame count (default: control `study`, else /study/metadata)
 *   trace=…            URL of a lab trace (steps[].frame, step_interval_ms) instead of n/frames
 *   interval_ms=…      pacing between steps becoming due (default: the trace's, else 0)
 *   autorun=1          run the cell on load, then close the session and set window.__wtpacsDone
 */

const params = new URLSearchParams(location.search);
const telemetry = params.get("telemetry") === "1";
const streamMode = params.get("stream_mode") || "shared";
const cell = params.get("cell") || "ondemand";
const autorun = params.get("autorun") === "1";
const depth = Math.max(1, Number(params.get("d") || 1));

const logEl = document.getElementById("log");
export function log(...a) {
  logEl.textContent += a.join(" ") + "\n";
}

/** Touch one byte per 4 KiB and the last byte, so the bytes are used and the copy is real. */
let checksum = 0;
function touch(bytes) {
  for (let i = 0; i < bytes.length; i += 4096) checksum = (checksum * 31 + bytes[i]) >>> 0;
  if (bytes.length) checksum = (checksum * 31 + bytes[bytes.length - 1]) >>> 0;
}

function heapBytes() {
  const m = performance.memory;
  return m && typeof m.usedJSHeapSize === "number" ? m.usedJSHeapSize : null;
}

/**
 * Track the JS-heap peak on a timer, not per delivered frame: `performance.memory` walks the
 * heap and cost ~45 µs per call, which put 3–11 % of the run's main-thread time into the
 * harness itself (Chromium 141 profile, 2026-09-06). 100 ms keeps the peak within a few
 * frames of the truth at any rate this harness runs at.
 */
function heapPeakSampler(stats) {
  const sample = () => {
    stats.heap_peak = Math.max(stats.heap_peak ?? 0, heapBytes() ?? 0);
  };
  sample();
  const timer = setInterval(sample, 100);
  return () => {
    clearInterval(timer);
    sample();
  };
}

async function studyFrameCount(session) {
  const p = params.get("frames");
  if (p) return Number(p);
  if (session && typeof session.studyFrames === "function") {
    for (let i = 0; i < 40; i++) {
      const n = session.studyFrames();
      if (n != null) return Number(n);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  const meta = await fetch("/study/metadata").then((r) => r.json());
  return Number(meta.frameCount);
}

/** Step list and pacing: a lab trace, or `n` steps cycling over the study. */
async function schedule(session) {
  const traceUrl = params.get("trace");
  const frames = await studyFrameCount(session);
  let steps;
  let interval = 0;
  let name;
  if (traceUrl) {
    const trace = await fetch(traceUrl).then((r) => r.json());
    steps = trace.steps.map((s) => Number(s.frame) % frames);
    interval = Number(trace.step_interval_ms || 0);
    name = trace.name || traceUrl;
  } else {
    const n = Number(params.get("n") || frames);
    steps = Array.from({ length: n }, (_, i) => i % frames);
    name = `cycle:${n}/${frames}`;
  }
  const override = params.get("interval_ms");
  if (override != null) interval = Number(override);
  return { steps, interval, frames, name };
}

/**
 * On-demand: steps become due on the pacing timer (gesture = due time); an ask goes out when
 * fewer than `depth` are in flight. The same index never overlaps itself in flight.
 */
function runOndemand(session, steps, interval, stats) {
  const tap = globalThis.__wtpacsTap ?? null;
  const due = [];
  const inflight = new Set();
  let nextStep = 0;
  let settled = 0;
  return new Promise((resolve) => {
    const pump = () => {
      while (inflight.size < depth && due.length > 0) {
        const frame = due[0];
        if (inflight.has(frame)) break;
        due.shift();
        inflight.add(frame);
        session.requestExactFrame(frame).then(
          (r) => {
            touch(r.bytes);
            stats.delivered += 1;
            finish(frame);
          },
          (err) => {
            stats.failed += 1;
            log("frame", frame, "failed:", err && err.message ? err.message : String(err));
            finish(frame);
          },
        );
      }
    };
    const finish = (frame) => {
      inflight.delete(frame);
      settled += 1;
      if (settled === steps.length) resolve();
      else pump();
    };
    const makeDue = () => {
      if (nextStep >= steps.length) return;
      const frame = steps[nextStep++];
      if (tap) tap.gesture(frame); // intent, at the time the reader wanted it
      due.push(frame);
      pump();
      if (nextStep < steps.length) {
        if (interval > 0) setTimeout(makeDue, interval);
        else makeDue();
      }
    };
    makeDue();
  });
}

/** Fill: one StreamFrames {}, waited start to end through the schedule's last index. */
async function runFill(session, steps, stats) {
  const last = Math.max(...steps);
  const askMs = session.startStreamFrames(last);
  for (let i = 0; i <= last; i++) {
    try {
      const r = await session.waitExactFrame(i, askMs);
      touch(r.bytes);
      stats.delivered += 1;
    } catch (err) {
      stats.failed += 1;
      log("frame", i, "failed:", err && err.message ? err.message : String(err));
    }
  }
  return last + 1;
}

export async function bootShell({ arm, loadSession, memoryBytes }) {
  try {
    const cfg = await fetch("/wt/dev-transport.json").then((r) => r.json());
    log("connecting", cfg.wt_url, telemetry ? "telemetry=1" : "telemetry=0", "cell=" + cell);
    const session = await loadSession({ telemetry, streamMode, cfg });
    log("connect", cfg.wt_url, telemetry ? "telemetry=1" : "telemetry=0", "cell=" + cell);

    const frame0 = async () => {
      const r = await session.requestExactFrame(0);
      touch(r.bytes);
      log("frame0 bytes", r.bytes.length);
    };
    const bulk = async () => {
      const indices = Uint32Array.from([0, 1, 2]);
      const askMs = session.startExactFrames(indices);
      for (const i of indices) {
        const r = await session.waitExactFrame(i, askMs);
        touch(r.bytes);
        log("bulk", r.frameIndex, r.bytes.length);
      }
    };

    const runCell = async () => {
      const { steps, interval, frames, name } = await schedule(session);
      const stats = { delivered: 0, failed: 0, heap_peak: heapBytes() };
      const heapStart = heapBytes();
      const wasmStart = memoryBytes ? memoryBytes() : null;
      log("run", cell, "steps", steps.length, "frames", frames, "d", depth, "interval_ms", interval, "schedule", name);
      const stopHeapSampler = heapPeakSampler(stats);
      const t0 = performance.now();
      let asked = steps.length;
      if (cell === "fill") asked = await runFill(session, steps, stats);
      else await runOndemand(session, steps, interval, stats);
      const wallMs = performance.now() - t0;
      stopHeapSampler();
      const summary = {
        arm,
        cell,
        depth: cell === "fill" ? asked : depth,
        interval_ms: interval,
        schedule: name,
        steps: steps.length,
        asked,
        delivered: stats.delivered,
        failed: stats.failed,
        study_frames: frames,
        wall_ms: Math.round(wallMs),
        checksum,
        js_heap_bytes: { start: heapStart, end: heapBytes(), peak: stats.heap_peak },
        wasm_memory_bytes: { start: wasmStart, end: memoryBytes ? memoryBytes() : null },
      };
      globalThis.__wtpacsShell = summary;
      log("run_end", JSON.stringify(summary));
      return summary;
    };

    document.getElementById("frame0").onclick = () => frame0().catch((e) => log("error", e));
    document.getElementById("bulk").onclick = () => bulk().catch((e) => log("error", e));
    document.getElementById("run").onclick = () => runCell().catch((e) => log("error", e));

    if (autorun) {
      await runCell();
      // Close the session so the server ends it now and flushes its Tap — otherwise it only
      // notices at the QUIC idle timeout (~30 s) and the harvest misses the server report.
      session.close();
      log("session closed");
      globalThis.__wtpacsDone = true;
    }
  } catch (e) {
    log("boot error", e && e.stack ? e.stack : e);
    globalThis.__wtpacsError = String(e);
  }
}
