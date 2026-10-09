// Imported before the product's decoder worker: keeps every WebAssembly memory it instantiates, and answers the
// page's asks for those memories' size and for the worker's own resource timing.
const memories = [];
const keep = (r) => {
  const instance = r.instance ?? r;
  for (const v of Object.values(instance.exports)) if (v instanceof WebAssembly.Memory) memories.push(v);
  return r;
};
for (const name of ["instantiate", "instantiateStreaming"]) {
  const real = WebAssembly[name];
  WebAssembly[name] = (...a) => real(...a).then(keep);
}

addEventListener("message", (e) => {
  if (e.data.kind === "heap") postMessage({ kind: "heap", bytes: memories.reduce((s, m) => s + m.buffer.byteLength, 0), memories: memories.length });
  if (e.data.kind === "resources") postMessage({ kind: "resources", entries: performance.getEntriesByType("resource").map((r) => ({
    name: r.name.slice(r.name.lastIndexOf("/") + 1), transfer: r.transferSize, body: r.encodedBodySize, ms: r.duration })) });
});
