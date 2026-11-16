// Before the product's downloader runs: every WebTransport it makes, and every decoder it spawns, feeds the reports.
import { Reports } from "./report.js";
import { reportsOf } from "./session.js";

const reports = new Reports();
const Transport = globalThis.WebTransport;
globalThis.WebTransport = class extends Transport {
  constructor(...a) { super(...a); reports.adopt(this); }
};
const Spawned = globalThis.Worker;
globalThis.Worker = class extends Spawned {
  constructor(...a) {
    super(...a);
    this.addEventListener("message", ({ data }) => data?.kind === "report" && reports.send(data.body));
  }
};
new BroadcastChannel(reportsOf(new URLSearchParams(location.search).get("load"))).onmessage = ({ data }) => reports.send(data.body);
