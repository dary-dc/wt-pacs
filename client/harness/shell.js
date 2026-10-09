/**
 * The harness cell: one run of asks over the downloader, the lab's only client. `cell.html` loads it.
 *
 * Query parameters:
 *   transport=…        ts (default) | ws | wasm | a module URL exporting TransportSession
 *   telemetry=1        record in the downloader's worker; harvest via window.__wtpacsTelemetry (transport=ts only)
 *   stream_mode=…      shared | per-frame (must match the server; recorded in the report)
 *   cell=…             ondemand (one ask per step, `d` in flight) | fill (one pushed fill) | refuse (ondemand past the series: no media)
 *   d=…                outstanding asks for on-demand (default 1 — the control)
 *   n=…                steps to run (default: one pass over the series)
 *   frames=…           series frame count (default: /series/metadata frameCount)
 *   trace=…            URL of a lab trace (steps[].frame, step_interval_ms) instead of n/frames
 *   interval_ms=…      pacing between steps becoming due (default: the trace's, else 0)
 *   autorun=1          run the cell on load, then close the session and set window.__wtpacsDone
 */

import { DownloaderClient } from "/client/transport/consumer.js";

const params = new URLSearchParams(location.search);
const telemetry = params.get("telemetry") === "1";
const streamMode = params.get("stream_mode") || "shared";
const cell = params.get("cell") || "ondemand";
const autorun = params.get("autorun") === "1";
const depth = Math.max(1, Number(params.get("d") || 1));
const transportName = params.get("transport") || "ts";
const TRANSPORTS = {
  ts: undefined,
  ws: "/client/transport/ts/dist/ws-session.js",
  wasm: "/client/transport/wasm/session-adapter.js",
};

function transportModule() {
  if (!telemetry) return transportName in TRANSPORTS ? TRANSPORTS[transportName] : transportName;
  if (transportName !== "ts") throw new Error(`telemetry=1 records the TS transport only, not transport=${transportName}`);
  return `/client/transport/ts/dist/session.telemetry.js?stream_mode=${streamMode}`;
}

const logEl = document.getElementById("log");
function log(...a) {
  logEl.textContent += a.join(" ") + "\n";
}

/** Milestones since navigation, in ms. What R2 counts round trips from — lab/page-open/. */
const open = (globalThis.__wtpacsOpen = {});
const mark = (name) => (open[name] ??= Math.round(performance.now() * 10) / 10);

/** Touch one byte per 4 KiB and the last byte, so the bytes are used and the copy is real. */
let checksum = 0;
function touch(bytes) {
  mark("frame");
  for (let i = 0; i < bytes.length; i += 4096) checksum = (checksum * 31 + bytes[i]) >>> 0;
  if (bytes.length) checksum = (checksum * 31 + bytes[bytes.length - 1]) >>> 0;
}

function heapBytes() {
  const m = performance.memory;
  return m && typeof m.usedJSHeapSize === "number" ? m.usedJSHeapSize : null;
}

/** On a timer, not per frame: `performance.memory` walks the heap, ~45 µs a call. */
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

async function seriesFrameCount() {
  const p = params.get("frames");
  if (p) return Number(p);
  const meta = await fetch("/series/metadata").then((r) => r.json());
  return Number(meta.frameCount);
}

/** Step list and pacing: a lab trace, or `n` steps cycling over the series. */
async function schedule() {
  const traceUrl = params.get("trace");
  const frames = await seriesFrameCount();
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
 * On-demand: steps become due on the pacing timer; an ask goes out when fewer than `depth` are
 * in flight. The same index never overlaps itself in flight.
 */
function runOndemand(client, steps, interval, stats) {
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
        client.requestExactFrame(frame).then(
          (r) => {
            touch(r.bytes);
            stats.delivered += 1;
            finish(frame);
          },
          (err) => {
            stats.failed += 1;
            if (cell !== "refuse") log("frame", frame, "failed:", err?.message ?? String(err));
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
      due.push(steps[nextStep++]);
      pump();
      if (nextStep < steps.length) {
        if (interval > 0) setTimeout(makeDue, interval);
        else makeDue();
      }
    };
    makeDue();
  });
}

/** Fill: one pushed fill through the schedule's last index, waited until every frame settles. */
function runFill(fill, client, steps, stats) {
  const last = Math.max(...steps);
  return new Promise((resolve) => {
    fill.settle = () => {
      if (stats.delivered + stats.failed === last + 1) resolve(last + 1);
    };
    client.fill(Array.from({ length: last + 1 }, (_, i) => i));
  });
}

/** The report lives in the downloader's worker, which a closed session ends: ask before closing.
 *  No answer within 5 s is no recorder, and resolves null. */
function harvestTelemetry() {
  const ch = new BroadcastChannel("wtpacs-telemetry");
  return new Promise((resolve) => {
    const done = (report) => {
      ch.close();
      resolve(report);
    };
    const timer = setTimeout(() => done(null), 5_000);
    ch.onmessage = (e) => {
      clearTimeout(timer);
      done(e.data.report);
    };
    ch.postMessage("harvest");
  });
}

async function boot() {
  try {
    const cfg = await fetch("/wt/dev-transport.json").then((r) => r.json());
    mark("config");
    log("connecting", cfg.wt_url, telemetry ? "telemetry=1" : "telemetry=0", "cell=" + cell, "transport=" + transportName);
    const stats = { delivered: 0, failed: 0, heap_peak: heapBytes() };
    const fill = { settle: () => {} };
    const client = await DownloaderClient.connect(cfg.wt_url, cfg.cert_sha256, {
      decode: false,
      decoders: 0,
      transport: transportModule(),
      onFrame: (f) => {
        touch(f.bytes);
        stats.delivered += 1;
        fill.settle();
      },
      onError: ({ frameIndex, reason }) => {
        stats.failed += 1;
        log("frame", frameIndex, "failed:", reason);
        fill.settle();
      },
    });
    mark("session");
    log("connect", cfg.wt_url, telemetry ? "telemetry=1" : "telemetry=0", "cell=" + cell);
    if (telemetry) globalThis.__wtpacsTelemetry = harvestTelemetry;

    const frame0 = async () => {
      const r = await client.requestExactFrame(0);
      touch(r.bytes);
      log("frame0 bytes", r.bytes.length);
    };

    const runCell = async () => {
      const { steps: due, interval, frames, name } = await schedule();
      const steps = cell === "refuse" ? due.map((_, i) => 1_000_000 + i) : due;
      Object.assign(stats, { delivered: 0, failed: 0, heap_peak: heapBytes() });
      const heapStart = heapBytes();
      log("run", cell, "steps", steps.length, "frames", frames, "d", depth, "interval_ms", interval, "schedule", name);
      const stopHeapSampler = heapPeakSampler(stats);
      const t0 = performance.now();
      let asked = steps.length;
      if (cell === "fill") asked = await runFill(fill, client, steps, stats);
      else await runOndemand(client, steps, interval, stats);
      const wallMs = performance.now() - t0;
      stopHeapSampler();
      const summary = {
        client: `downloader/${transportName}`,
        cell,
        depth: cell === "fill" ? asked : depth,
        interval_ms: interval,
        schedule: name,
        steps: steps.length,
        asked,
        delivered: stats.delivered,
        failed: stats.failed,
        series_frames: frames,
        wall_ms: Math.round(wallMs),
        checksum,
        js_heap_bytes: { start: heapStart, end: heapBytes(), peak: stats.heap_peak },
      };
      globalThis.__wtpacsShell = summary;
      log("run_end", JSON.stringify(summary));
      return summary;
    };

    document.getElementById("frame0").onclick = () => frame0().catch((e) => log("error", e));
    document.getElementById("run").onclick = () => runCell().catch((e) => log("error", e));

    if (autorun) {
      await runCell();
      if (telemetry) {
        const report = await harvestTelemetry();
        globalThis.__wtpacsTelemetry = () => report;
      }
      // Closing ends the session now, so the server flushes its Tap instead of waiting out the idle timeout.
      client.close();
      log("session closed");
      globalThis.__wtpacsDone = true;
    }
  } catch (e) {
    log("boot error", e?.stack ?? e);
    globalThis.__wtpacsError = String(e);
  }
}

boot();
