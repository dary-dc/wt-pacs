// KEEPALIVE's decoder worker: the fault bench's decoder as it is, each failed check reported from here as its frame
// leaves for the page, the record riding the frame message as `report` (page.js passes it to the arm).
import "/lab/faultbench/decode/decoder.js";
import { reporter, failed } from "./worker.js";
import { acks } from "./keepalive.js";

const q = new URLSearchParams(location.search);
let report = null;
addEventListener("message", ({ data }) => {
  if (data.kind !== "init") return;
  const env = { engine: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
  report = reporter(q, data.digests, env, { channel: new BroadcastChannel(acks(q.get("load"))) });
});

const post = MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage = function (m, transfer) {
  if (report && failed(m)) m.report = report(m);
  return post.call(this, m, transfer);
};
