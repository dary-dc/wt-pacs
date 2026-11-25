// node entries.mjs <path to client/view/controller.js, as a URL or ./ from client/view/>: the frame at which each group first enters the want on a forward and a backward pass, wantFrom alone (WINDOW-WHOLE-GROUPS-FIX-REVIEW).
const { wantFrom } = await import(process.argv[2]);
const groups = (want, g) => new Set(want.map((i) => Math.floor(i / g)));
for (const asc of [false, true]) for (const [n, g, w] of [[50, 8, 15], [50, 8, 24], [69, 8, 54], [50, 16, 40]]) {
  const out = [];
  for (const dir of ["fwd", "back"]) {
    const path = dir === "fwd" ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
    let wanted = new Set(), seen = new Set(), entries = [];
    for (const c of path) {
      const s = groups(wantFrom(c, n, true, asc, w, g, wanted), g);
      for (const j of s) if (!seen.has(j)) { seen.add(j); if (c !== path[0]) entries.push(`${j}@${c}`); }
      wanted = s;
    }
    out.push(`${dir} ${entries.join(" ")}`);
  }
  console.log(`asc ${asc} n ${n} G ${g} W ${w}: ${out.join(" | ")}`);
}
