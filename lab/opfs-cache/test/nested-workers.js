// A worker that starts `?n=` workers one after another, each ended once it answers: the count the page shows.
if (globalThis.document) {
  const n = new URLSearchParams(location.search).get("n") ?? "300";
  globalThis.started = 0;
  new Worker(import.meta.url, { type: "module", name: `parent ${n}` }).onmessage = ({ data }) => (globalThis.started = data);
} else if (self.name.startsWith("parent")) {
  for (let i = 1; i <= Number(self.name.split(" ")[1]); i++) {
    const child = new Worker(import.meta.url, { type: "module", name: "child" });
    await new Promise((resolve) => (child.onmessage = resolve));
    child.terminate();
    postMessage(i);
  }
} else {
  postMessage("up");
}
