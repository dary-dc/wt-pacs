// The protocol's mutants on the page's side (report-plan.md §7.4); `ack-before-write` is the sink's.
export function wrapCarrier(carrier, mutant, random = Math.random) {
  if (mutant === "never-sent") return { ...carrier, load() {} };
  if (mutant === "safety-sampled") return { ...carrier, safety: (b, fromWorker) => random() < 0.1 && carrier.safety(b, fromWorker) };
  return carrier;
}

export function mutateRecord(r, mutant) {
  if (mutant === "field-outside") return { ...r, labOnly: 1 };
  if (mutant === "no-reportId") { const { reportId, ...rest } = r; return rest; }
  return r;
}
