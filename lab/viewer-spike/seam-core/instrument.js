/** Imported before Cornerstone3D, so what it does on the page from its first line is counted. */
export const seen = { contexts: [], violations: [], longTasks: [] };

for (const C of [HTMLCanvasElement, OffscreenCanvas]) {
  const own = C.prototype.getContext;
  C.prototype.getContext = function (kind, ...rest) {
    seen.contexts.push(`${C.name}:${kind}`);
    return own.call(this, kind, ...rest);
  };
}
addEventListener("securitypolicyviolation", (e) => seen.violations.push(`${e.violatedDirective} ${e.blockedURI}`));
new PerformanceObserver((list) => list.getEntries().forEach((e) => seen.longTasks.push({ start: e.startTime, ms: e.duration }))).observe({ type: "longtask", buffered: true });
