const tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const t = tabs.find((x) => x.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(x.url));
const ws = new WebSocket(t.webSocketDebuggerUrl);
ws.onopen = () => { console.log("connected to", t.url.slice(0, 40)); ws.send(JSON.stringify({ id: 1, method: "Network.clearBrowserCache" })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { console.log(m.error ? "error " + JSON.stringify(m.error) : "browser cache cleared"); process.exit(0); } };
setTimeout(() => { console.log("timeout"); process.exit(1); }, 90000);
