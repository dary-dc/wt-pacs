// M5's page: the view worker's status shown where the rig reads the viewer's, its result and second check on call.
const view = new Worker("/lab/opfs-cache/arms-view.js", { type: "module" });
const statusEl = document.getElementById("status");
let settle = {};
const waiting = (k) => new Promise((resolve) => (settle[k] = resolve));
globalThis.armsResult = waiting("result");
view.onmessage = ({ data }) => {
  if (data.status) statusEl.textContent = data.status;
  if (data.result) settle.result(data.result);
  if (data.verified) settle.verified(data.verified);
};
view.onerror = (e) => (statusEl.textContent = `error: the view worker: ${e.message}`);
globalThis.verify = () => (view.postMessage({ verify: true }), waiting("verified"));
view.postMessage(Object.fromEntries(new URLSearchParams(location.search)));
