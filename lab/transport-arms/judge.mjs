/** A visit's verdict under stacks.md §5.2 and §5.4: the reasons it is VOID, and the failures that stop the run instead. */

/** The pilot's check of the relay against what it was asked: loss within a factor of 3 of the mean, given 30 expected losses. */
export function relayHeld(form, t) {
  if (!form.loss || !t.down) return null;
  const sent = t.down.sent + t.up.sent;
  const lost = t.down.lost + t.up.lost;
  const expect = (sent * form.loss) / 100;
  if (expect < 30) return `too few packets to check ${form.loss} % loss (${sent})`;
  const seen = (100 * lost) / sent;
  return seen > form.loss / 3 && seen < form.loss * 3 ? null : `relay loss ${seen.toFixed(3)} %, asked ${form.loss} %`;
}

export function pooledRelay(form, rows) {
  const sum = (dir, k) => rows.reduce((a, r) => a + (r.relayTally?.[dir]?.[k] ?? 0), 0);
  const side = (dir) => ({ sent: sum(dir, "sent"), lost: sum(dir, "lost") });
  return relayHeld(form, { up: side("up"), down: side("down") });
}

/**
 * Sets `row.void` and `row.flags`; returns why the run stops, or null. `proto`: what the arm's `nextHopProtocol` must
 * read; `opening`: every frame was asked before the dial, so the fill rode its URL; `tcp`: the server's sockets ran
 * `cubic` (§5.1).
 */
export function judge(form, row, { proto, opening = false, tcp = false, pilot = false, pilotMedian } = {}) {
  const voids = [];
  if (row.relayTally.late) voids.push("relay guard p99 over 1 ms");
  if (row.busiestCore > 0.95) voids.push(`a core ${(100 * row.busiestCore).toFixed(0)} % busy`);
  if (row.crash) voids.push(`crash: ${row.error}`);
  else if (proto && !(row.protocols.length && row.protocols.every((p) => p === proto))) voids.push(`spoke ${row.protocols.join(",") || "nothing"}, not ${proto}`);
  if (pilotMedian && row.wallMs > 3 * pilotMedian) voids.push(`visit ${row.wallMs} ms past 3x the pilot's ${pilotMedian}`);
  row.void = voids.length ? voids : undefined;
  // A one-frame visit can pass in under a tick of the server; only the cells CPU reads (CLEAN) flag a zero.
  if (form.cpu && row.serverTicks === 0) row.flags = [...(row.flags ?? []), "CPU ZERO: the sampler read nothing (wrong pid?)"];
  // §5.2: a frame that failed its check stops the run whatever else voids the visit.
  const unchecked = (row.frames ?? []).filter((f) => f.exact !== true);
  if (unchecked.length) return `STOP: frame ${unchecked.map((f) => `${f.i} ${f.exact}`).join(", ")} failed its check`;
  // `ad` and `aa` ask the last frame after the fill: that ask is the cell's, not the dial's.
  const fillOf = (f) => !["ad", "aa"].includes(form.action) || f.i !== form.n - 1;
  const late = opening ? (row.frames ?? []).filter((f) => fillOf(f) && !(f.ask <= row.dial)) : [];
  if (late.length) return `STOP: frame ${late.map((f) => f.i).join(", ")} asked after the dial, not by the opening ask`;
  if (tcp && !row.crash && row.tcpCongestion?.join() !== "cubic") return `STOP: the server's TCP ran ${row.tcpCongestion?.join(",") || "nothing read"}, not cubic`;
  const owed = form.action === "first" ? 1 : form.n;
  if (!row.void && row.exact !== owed) return `STOP: ${row.exact} of ${owed} frames exact (${row.error ?? ""} ${JSON.stringify(row.failures)})`;
  if (pilot && !row.void) {
    const held = relayHeld(form, row.relayTally);
    if (held && !held.startsWith("too few")) return `PILOT REFUSES: ${held}`;
  }
  return null;
}
