// The read tool, one for every receiver: the dedup by reportId and the join with the server's link line, at read
// (report-plan.md §3.5, §7.1). node lab/report-arms/read.mjs FILE... prints one JSON line per load.
import { readFileSync } from "node:fs";

const FIELDS = JSON.parse(readFileSync(new URL("./report-fields.json", import.meta.url)));

/** Records from the sink's lines (`{t, r}`), NGINX's (`r` a JSON string) and the server's link lines (bare). */
export function readLines(lines) {
  const records = [];
  let malformed = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      const r = typeof o.r === "string" ? JSON.parse(o.r) : (o.r ?? o);
      if (r === null || typeof r !== "object" || Array.isArray(r)) throw 0;
      records.push(r);
    } catch {
      malformed++;
    }
  }
  return { records, malformed };
}

export function byLoad(records) {
  const loads = new Map();
  const entry = (id) => loads.get(id) ?? loads.set(id, { load: id, records: [], safety: [], seqs: [], link: null,
    duplicates: 0, unkeyed: 0, outside: [], keys: new Set() }).get(id);
  for (const r of records) {
    const e = entry(r.load);
    if (r.kind === "link") { e.link = r; continue; }
    for (const k of Object.keys(r)) {
      const name = `${r.kind}.${k}`;
      if (!FIELDS[r.kind]?.includes(k) && !e.outside.includes(name)) e.outside.push(name);
    }
    if (r.reportId == null) e.unkeyed++;
    const key = r.reportId ?? JSON.stringify(r);
    if (e.keys.has(key)) { e.duplicates++; continue; }
    e.keys.add(key);
    if (r.kind === "safety") e.safety.push(r);
    else { e.records.push(r); e.seqs.push(r.seq); }
  }
  for (const e of loads.values()) { e.seqs.sort((a, b) => a - b); delete e.keys; }
  return loads;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { records, malformed } = readLines(process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").split("\n")));
  for (const e of byLoad(records).values()) console.log(JSON.stringify({ ...e, records: e.records.length }));
  if (malformed) console.error(`malformed lines: ${malformed}`);
}
