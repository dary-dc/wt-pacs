// A frame's stage stamps as spans, and what the protocol reads from them. lab/av1/decode/breakdown/README.md

/** [[name, t], …] → [{ name, start, end }]; dav1d's stages run once a stream, the top's first. */
export function spans(stamps) {
  const open = new Map();
  const seen = new Map();
  const out = [];
  for (const [k, t] of stamps) {
    const base = k.slice(0, -2);
    if (k.endsWith(":s")) {
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const name = base.startsWith("dav1d.") ? `${n ? "low" : "top"}.${base.slice(6)}` : base;
      open.set(base, { name, start: t });
    } else if (open.has(base)) {
      out.push({ ...open.get(base), end: t });
      open.delete(base);
    }
  }
  return out;
}

/** ms per stage name, summed over the frame's spans. */
export function durations(list) {
  const d = {};
  for (const s of list) d[s.name] = (d[s.name] ?? 0) + (s.end - s.start);
  return d;
}

/** The share of the frame its stages cover, overlaps once: `codec` encloses the rest, so it counts only alone. */
export function coverage(list, ms) {
  const leaves = list.filter((s) => s.name !== "codec");
  const use = leaves.some((s) => s.name !== "digest") ? leaves : list;
  return coverageOf(use) / ms;
}

function coverageOf(list) {
  const iv = list.map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let at = -Infinity;
  for (const [a, b] of iv) {
    if (b <= at) continue;
    covered += b - Math.max(a, at);
    at = b;
  }
  return covered;
}

const get = (d, k) => d[k] ?? 0;

/**
 * The protocol's stage groups, ms: decode is a stream's decoder call; on WebCodecs the two streams overlap, so a
 * frame waits on the longer decode and the longer flush, and the copies are summed; JS passes are always summed.
 */
export function groups(list, webcodecs) {
  const d = durations(list);
  const merge = get(d, "place1") + get(d, "place2") + get(d, "fused") + get(d, "z.unpack");
  if (!webcodecs) {
    return {
      "top decode": get(d, "top.decode"),
      "low decode": get(d, "low.decode") + exclusive(list, "z.inflate"),
      flush: get(d, "top.flush") + get(d, "low.flush"),
      "chroma + merge + range": get(d, "top.held") + get(d, "low.held") + merge,
      digest: get(d, "digest"),
      parse: get(d, "parse"),
      "copy in": get(d, "top.copyin") + get(d, "low.copyin"),
    };
  }
  return {
    "max(top, low) decode": Math.max(get(d, "top.decode"), get(d, "low.decode"), get(d, "z.inflate")),
    "top decode": get(d, "top.decode"),
    "low decode": get(d, "low.decode") + get(d, "z.inflate"),
    flush: Math.max(get(d, "top.flush"), get(d, "low.flush")),
    copyTo: get(d, "top.copyTo") + get(d, "low.copyTo"),
    "chroma + merge + range": get(d, "top.neutral") + get(d, "low.neutral") + merge,
    digest: get(d, "digest"),
    parse: get(d, "parse"),
    config: get(d, "top.config") + get(d, "low.config"),
  };
}

/** A stage's time outside every other stage: an inflate is in flight while dav1d holds the thread. */
function exclusive(list, name) {
  let t = 0;
  for (const s of list.filter((x) => x.name === name)) {
    const others = list.filter((x) => x.name !== name && x.name !== "codec" && x.end > s.start && x.start < s.end);
    t += coverageOf([s]) - coverageOf(others.map((o) => ({ start: Math.max(o.start, s.start), end: Math.min(o.end, s.end) })));
  }
  return t;
}

/** Each stream's own time, config to flush, and their sum: what one core would spend. */
export function streams(list) {
  const t = {};
  for (const s of list) {
    const which = s.name.split(".")[0];
    if (!["top", "low"].includes(which)) continue;
    t[which] ??= [Infinity, -Infinity];
    t[which] = [Math.min(t[which][0], s.start), Math.max(t[which][1], s.end)];
  }
  const ms = Object.fromEntries(Object.entries(t).map(([k, [a, b]]) => [k, b - a]));
  return { ...ms, sum: (ms.top ?? 0) + (ms.low ?? 0) };
}

export const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
