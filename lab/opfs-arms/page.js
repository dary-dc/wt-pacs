// The page: it starts the workers, hands each its ports, and sends the view worker intents only; it holds no frame.
const q = new URLSearchParams(location.search);
const num = (k, d) => Number(q.get(k) ?? d);

async function run() {
  if (q.get("cell") === "probe") return probe();
  const c = {
    cell: q.get("cell"), arm: q.get("arm"), order: q.get("order") ?? "arrival", mutant: q.get("mutant") ?? "",
    w: num("w", 512), h: num("h", 512), n: num("n", 64), held: num("held", 4), rateMBps: num("rate", 125),
    seconds: num("seconds", 10), cineEvery: num("cineEvery", 1), budgetMs: num("budgetMs", 8), chunkBytes: num("chunkBytes", 1 << 20),
    misses: num("misses", 16), decoders: num("decoders", 3),
  };
  const view = new Worker("view.js", { type: "module" });
  const toFeeders = [...Array(c.decoders)].map(() => new MessageChannel());
  const toPage = new MessageChannel();
  let store = null;
  if (c.arm === "C") {
    const s = new MessageChannel();
    new Worker("store-port.js", { type: "module" }).postMessage({ port: s.port1 }, [s.port1]);
    store = s.port2;
  }
  for (const ch of toFeeders) new Worker("feeder.js", { type: "module" }).postMessage({ port: ch.port1, config: c }, [ch.port1]);
  const el = document.getElementById("view");
  const canvas = el.transferControlToOffscreen();
  const feeders = toFeeders.map((ch) => ch.port2);
  view.postMessage({ config: c, canvas, feeders, page: toPage.port1, store }, [canvas, ...feeders, toPage.port1, ...(store ? [store] : [])]);
  el.onpointermove = (e) => e.buttons && view.postMessage({ kind: "window", level: e.offsetX / el.clientWidth, inputAt: performance.timeOrigin + e.timeStamp });
  const intents = toPage.port2;
  const painted = [];
  return new Promise((resolve) => {
    intents.onmessage = async ({ data }) => {
      if (data.kind === "result") return resolve({ config: c, ...data, misses: painted });
      if (data.kind !== "ready") return;
      const order = [...Array(c.n - c.held).keys()].map((i) => i + c.held).sort((a, b) => ((a * 2654435761) % 997) - ((b * 2654435761) % 997));
      for (const index of order.slice(0, c.misses)) {
        const note = new Promise((r) => (intents.onmessage = ({ data: m }) => m.kind === "painted" && r(m)));
        view.postMessage({ kind: "show", index, sentAt: performance.timeOrigin + performance.now() });
        painted.push(await note);
      }
      intents.onmessage = ({ data: m }) => m.kind === "result" && resolve({ config: c, ...m, misses: painted });
      view.postMessage({ kind: "intents-done" });
    };
  });
}

/** What each engine allows, run once: probe.js in a worker the page starts, and again in one that worker starts. */
function probe() {
  const w = new Worker("probe.js", { type: "module" });
  return new Promise((resolve) => (w.onmessage = ({ data }) => resolve(data)));
}

globalThis.result = run().catch((e) => ({ error: String(e?.message ?? e) }));
