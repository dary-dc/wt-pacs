// The built store worker, client/viewer/store.js, answering on a port the page hands it rather than on its own scope.
// Each reply carries the time the store spent on its message, ms, on this thread: from the later of its arrival and the
// previous reply.
onmessage = async ({ data }) => {
  const { port } = data;
  const arrived = new Map();
  let last = 0;
  globalThis.postMessage = (m) => {
    const t = performance.now();
    port.postMessage({ ...m, serviceMs: t - Math.max(arrived.get(m.id) ?? t, last) });
    arrived.delete(m.id);
    last = t;
  };
  await import("../../client/viewer/store.js");
  port.onmessage = (e) => (arrived.set(e.data.id, performance.now()), globalThis.onmessage(e));
};
