// SESSION's decoder worker: the fault bench's decoder as it is, each failed check handed to the downloader as its
// frame leaves for the page; the record rides the frame message as `report`, so the page sends no second copy.
import "/lab/faultbench/decode/decoder.js";
import { reporter, failed } from "../keepalive/worker.js";
import { forward } from "./decoder-report.js";

const q = new URLSearchParams(location.search);
let report = null;
addEventListener("message", ({ data }) => {
  if (data.kind !== "init") return;
  const env = { engine: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
  // The downloader acknowledges nothing back: it holds the record until the server's byte.
  report = reporter(q, data.digests, env, { send: forward((m) => postMessage(m)), channel: { postMessage() {} } });
});

const post = MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage = function (m, transfer) {
  if (report && failed(m)) m.report = report(m);
  return post.call(this, m, transfer);
};
