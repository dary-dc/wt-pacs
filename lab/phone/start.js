/** The runner's start page: the plan from its fields, then its first load. lab/phone/README.md */
import { blockPlan, DEFAULTS, loadUrl, octetPlan, parseLoads, withOrigins } from "./runner.js";

const field = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
field("gap").value = DEFAULTS.gapS;
field("fill").value = DEFAULTS.fillS;
for (const id of ["tether", "wifi", "series", "gap", "fill", "at"]) if (q.has(id)) field(id).value = q.get(id);
field("loads").value = q.get("loads") ?? octetPlan();
field("octets").onclick = () => (field("loads").value = octetPlan());
field("blocks").onclick = () => (field("loads").value = blockPlan());

field("start").onclick = () => {
  try {
    const addresses = { tether: field("tether").value.trim(), wifi: field("wifi").value.trim() };
    const loads = withOrigins(parseLoads(field("loads").value), addresses);
    const at = Number(field("at").value) - 1;
    if (!(at >= 0 && at < loads.length)) throw new Error(`refused: start at ${at + 1} — 1 to ${loads.length}`);
    const plan = { series: field("series").value.trim(), gapS: Number(field("gap").value), fillS: Number(field("fill").value), loads };
    location.assign(loadUrl(plan, at));
  } catch (e) {
    field("why").textContent = e.message;
  }
};
