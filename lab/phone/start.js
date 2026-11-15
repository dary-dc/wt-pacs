/** The runner's start page: the plan from its fields, then its first load. lab/phone/README.md */
import { amendedPlan, loadUrl, parseLoads } from "./runner.js";

const field = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
for (const id of ["tether", "wifi", "series", "gap", "fill", "at"]) if (q.has(id)) field(id).value = q.get(id);
field("loads").value = q.get("loads") ?? amendedPlan();
const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;

field("start").onclick = () => {
  try {
    const loads = parseLoads(field("loads").value);
    const addresses = { tether: field("tether").value.trim(), wifi: field("wifi").value.trim() };
    for (const link of new Set(loads.map((l) => l.link))) if (!ipv4.test(addresses[link])) throw new Error(`refused: the ${link} address ${JSON.stringify(addresses[link])} — an IPv4 address`);
    const at = Number(field("at").value) - 1;
    if (!(at >= 0 && at < loads.length)) throw new Error(`refused: start at ${at + 1} — 1 to ${loads.length}`);
    const plan = { addresses, series: field("series").value.trim(), gapS: Number(field("gap").value), fillS: Number(field("fill").value), loads };
    location.assign(loadUrl(plan, at));
  } catch (e) {
    field("why").textContent = e.message;
  }
};
