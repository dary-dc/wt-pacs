/** The load report: one JSON object per sampled page load, sent once when the page hides. docs/adr/telemetry-in-production.md §8 */

const epochMs = () => performance.timeOrigin + performance.now();
const sendBeacon = (url, body) => navigator.sendBeacon(url, body);
const withoutUrls = (message) => String(message).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>");

/** A frame as the overlay shows it: its decode route, why WebCodecs refused it, KB on the wire, decode ms. */
const frameRow = ({ i, path, refusal, wireBytes, decodeMs }) =>
  ({ i, route: path, ...(refusal && { refusal }), kb: wireBytes === undefined ? null : +(wireBytes / 1024).toFixed(1), decodeMs: decodeMs ?? null });

/** The report for this load, or null when the configuration `{rate, url}` does not draw it; `fields` name the load. */
export function loadReport(config, fields, { random = Math.random, send = sendBeacon, now = epochMs } = {}) {
  if (!(config?.rate > 0) || !config.url || !(random() < config.rate)) return null;
  const report = { ...fields, received: 0, routes: {}, frames: [], fillFrom: null, fillTo: null, fillMs: null, statusFillMs: null,
    labels: [], presses: [], errors: [], rate: config.rate, truncated: false };
  let sent = false;
  return {
    label: (quality, text) => report.labels.push({ at: now(), quality, text }),
    press: (text) => report.presses.push({ at: now(), text }),
    error: (source, message) => report.errors.push({ at: now(), source, message: withoutUrls(message) }),
    progress: (have) => (report.received = have),
    /** The fill's end: `dial` and `issuedAt` epoch ms, `fillMs` from `issuedAt` to the last frame stored. */
    filled({ dial, issuedAt, fillMs, frames }) {
      report.frames = frames.map(frameRow);
      for (const f of frames) report.routes[f.path] = (report.routes[f.path] ?? 0) + 1;
      if (fillMs === null || fillMs === undefined) return;
      report.fillTo = issuedAt + fillMs;
      report.statusFillMs = fillMs;
      report.fillFrom = dial ?? null;
      report.fillMs = dial === undefined || dial === null ? null : report.fillTo - dial;
    },
    /** A refusal (the page's keepalive budget taken) is sent again once without the frames; Fetch's limit binds a keepalive fetch alike. */
    end() {
      if (sent) return;
      sent = true;
      if (!send(config.url, JSON.stringify(report))) send(config.url, JSON.stringify({ ...report, frames: null, truncated: true }));
    },
  };
}
