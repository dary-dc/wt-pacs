// The built store worker, client/viewer/store.js, answering on a port the page hands it rather than on its own scope.
onmessage = async ({ data }) => {
  const { port } = data;
  globalThis.postMessage = (m) => port.postMessage(m);
  await import("../../client/viewer/store.js");
  port.onmessage = (e) => globalThis.onmessage(e);
};
