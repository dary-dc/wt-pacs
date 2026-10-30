// The page's lab parameters load from lab/, which only the dev host serves: client/README.md §The viewer.
// The metadata names the codec: only that codec's modules and WASM are fetched ahead (lab/page-open/codec.html).
{
  const q = new URLSearchParams(location.search);
  const asked = ["opts", "wt", "hash", "metadata", "post", "origin", "writer"].filter((k) => q.has(k));
  globalThis.viewerLab = !asked.length ? Promise.resolve({ opts: {} }) : import("/lab/viewer/levers.js").then((m) => m.levers(q), () => {
    throw new Error(`refused: ?${asked.join(", ?")} — lab parameters, which this host does not honour`);
  });
  globalThis.viewerMetadata = globalThis.viewerLab.then((lab) => fetch(lab.metadata ?? "/series/metadata")).then((r) => r.json());
  const link = (rel, href, as) => {
    const l = Object.assign(document.createElement("link"), { rel, href, crossOrigin: "anonymous" });
    if (as) l.as = as;
    document.head.append(l);
  };
  // The transport file names the client; its module is the first file, TS's preloaded by the HTML. docs/CLIENTS.md §Choosing the client
  const CLIENTS = {
    ts: ["/client/transport/ts/dist/session.js"],
    wasm: ["/client/transport/wasm/session-adapter.js", "/client/transport/wasm/pkg/transport_wasm.js", "/client/transport/wasm/pkg/transport_wasm_bg.wasm"],
  };
  globalThis.viewerTransport = globalThis.viewerLab.then((lab) => lab.transport ?? fetch("/wt/dev-transport.json").then((r) => r.json())).then((t) => {
    const client = t.client ?? "ts";
    if (!Object.hasOwn(CLIENTS, client)) throw new Error(`refused: client ${JSON.stringify(client)} — ts or wasm`);
    if (client === "wasm") for (const f of CLIENTS.wasm) link("preload", f, f.endsWith(".wasm") ? "fetch" : "script");
    return { ...t, client, module: CLIENTS[client][0] };
  });
  globalThis.viewerMetadata.then((m) => {
    const dec = "/client/decode";
    const av1 = m.codec === "av1";
    const name = av1 ? "dav1d" : "openjph";
    const modules = av1 ? ["av1.js", "av1-payload.js", "av1-frame.js", "av1-dav1d.js", "av1-webcodecs.js", "av1-probe.js"] : ["htj2k.js"];
    for (const f of [...modules, "wasm-glue.js", ...(m.digests ? ["xxh3.js"] : [])]) link("preload", `${dec}/${f}`, "script");
    link("preload", `${dec}/wasm/built/${name}/${name}.js`, "fetch");
    link("preload", `${dec}/wasm/built/${name}/${name}.wasm`, "fetch");
    if (m.digests) link("preload", `${dec}/wasm/built/xxh3/xxh3.wasm`, "fetch");
  }, () => {});
}
