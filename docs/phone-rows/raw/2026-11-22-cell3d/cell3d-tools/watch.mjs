// Attach to the round's page tab over DevTools and print console errors, exceptions and /lab/beacon + /next requests.
const seen = new Set();
const out = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function attach() {
  const tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const t = tabs.find((x) => /^http:\/\/127\.0\.0\.1:876[5-8]\//.test(x.url) && !seen.has(x.id));
  if (!t) return setTimeout(attach, 300);
  seen.add(t.id);
  out("attach", t.url.replace(/\?.*/, ""), t.url.match(/[?&]at=(\d+)/)?.[0]);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.onopen = () => { send("Runtime.enable"); send("Network.enable"); send("Log.enable");
    send("Runtime.evaluate", { expression: "import('/lab/devices/beacon.js').then(m => 'beacon.js has drain: ' + String(m.recorder).includes('drain'))", awaitPromise: true }); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.result?.result?.value) out(m.result.result.value);
    if (m.method === "Runtime.exceptionThrown") out("EXCEPTION", m.params.exceptionDetails.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) out("console." + m.params.type, m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
    if (m.method === "Log.entryAdded" && m.params.entry.level !== "verbose" && !/link preload/.test(m.params.entry.text)) out("log", m.params.entry.level, m.params.entry.text.slice(0, 300));
    if (m.method === "Network.requestWillBeSent" && /\/lab\/beacon|\/next/.test(m.params.request.url)) out("request", m.params.request.method, m.params.request.url.replace(/^http:\/\/[^/]+/, ""), m.params.request.postData?.length ?? (m.params.request.hasPostData ? "has body" : ""), m.params.type ?? "");
    if (m.method === "Network.loadingFailed") out("loadingFailed", m.params.type, m.params.errorText, m.params.blockedReason ?? "", m.params.canceled ? "canceled" : "");
    if (m.method === "Network.responseReceived" && /\/lab\/beacon/.test(m.params.response.url)) out("response", m.params.response.status, "beacon");
  };
  ws.onclose = () => { out("detached"); setTimeout(attach, 300); };
}
attach();
setTimeout(() => process.exit(0), 75000);
