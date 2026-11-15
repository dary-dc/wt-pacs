// When the load report leaves, the same for every HTTP carrier (report-plan.md §3.1, §7.1). `H`: the whole record at
// the first hide, once. `Y`: the whole record at the fill's end, then a delta per hide. `off`: no listener at all.
// SESSION's at-once batching is its own build's (§3.3).
export function schedule({ timing, carrier, load, doc = document, win = globalThis, mutate = (r) => r }) {
  const send = (r) => r && carrier.load(JSON.stringify(mutate(r)));
  if (timing === "off") return { fillEnded() {} };
  let whole = false;
  let hides = 0;

  const sendWhole = () => { whole = true; send(load.record()); };
  // Both events fire for one hide; the second finds no change, so its delta is no record.
  const onHide = () => {
    if (timing === "H" && hides++ > 0) return;
    whole ? send(load.delta()) : sendWhole();
  };
  doc.addEventListener("visibilitychange", () => doc.visibilityState === "hidden" && onHide());
  win.addEventListener("pagehide", onHide);
  return { fillEnded() { if (timing === "Y" && !whole) sendWhole(); } };
}
