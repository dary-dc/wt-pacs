// The pattern 851668f found lossy: a channel built, then the page told over postMessage.
const bc = new BroadcastChannel(new URL(import.meta.url).searchParams.get("ch"));
bc.onmessage = (e) => postMessage({ pong: e.data });
postMessage({ constructed: true });
