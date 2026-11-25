// node toward.mjs <controller.js as a URL or ./path>: wantFrom alone, fed the controller's `toward` (a step's sign once two
// steps agree, else 0), for each group the steps between its entering the want and the reader reaching it, on a forward and a
// backward pass and for a reader reversing p frames into group 2 (WINDOW-WHOLE-GROUPS-FIX-2). An older wantFrom ignores `toward`.
const { wantFrom } = await import(process.argv[2]);
const groups = (want, g) => new Set(want.map((i) => Math.floor(i / g)));

/** The want's groups after each step of `path`. */
function wants(path, n, g, w) {
  let wanted = new Set(), last = 0, toward = 0, prev = path[0];
  return path.map((c) => {
    const sign = Math.sign(c - prev);
    if (sign) [toward, last] = [sign === last ? sign : 0, sign];
    prev = c;
    return (wanted = groups(wantFrom(c, n, true, false, w, g, wanted, toward), g));
  });
}

/** Steps group j was wanted without a break before step r reached it; "held" if since step 0. */
function lead(ws, j, r) {
  let s = r;
  while (s > 0 && ws[s - 1].has(j)) s--;
  return s === 0 && ws[0].has(j) ? "held" : r - s;
}

for (const [n, g, w] of [[50, 8, 15], [50, 8, 24], [69, 8, 54], [50, 16, 40]]) {
  const fwd = [...Array(n).keys()], back = [...fwd].reverse();
  const groupsOf = [...Array(Math.ceil(n / g)).keys()];
  const wf = wants(fwd, n, g, w), wb = wants(back, n, g, w);
  const f = groupsOf.slice(1).map((j) => `${j}:${lead(wf, j, fwd.indexOf(j * g))}`);
  const b = groupsOf.slice(0, -1).reverse().map((j) => `${j}:${lead(wb, j, back.indexOf(j * g + g - 1))}`);
  const k = 2, r = [];
  for (let p = 1; p < g; p++) {
    const path = [...Array(k * g + p + 1).keys()];
    for (let c = k * g + p - 1; c >= (k - 1) * g; c--) path.push(c);
    r.push(`p${p}:${lead(wants(path, n, g, w), k - 1, path.length - 1 - (g - 1))}`);
  }
  console.log(`n ${n} G ${g} W ${w} | forward, group:lead ${f.join(" ")} | backward ${b.join(" ")} | reversing in group ${k}, group ${k - 1} ${r.join(" ")}`);
}
