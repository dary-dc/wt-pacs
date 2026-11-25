// R=3 node reach-repeat.mjs <controller.js> jumps: reach.mjs, the want recomputed R times at each state, checking it does not change (the page view calls want() more than once a step).
const { wantFrom } = await import(process.argv[2]);
const jumps = process.argv[3] === "jumps";
for (const [n, g, w] of [[50, 8, 15], [50, 8, 24], [69, 8, 54], [50, 16, 40], [64, 8, 15], [20, 8, 15]]) {
  const key = (s) => `${s.c}|${[...s.wanted].sort((a,b)=>a-b)}|${s.last}|${s.t}`;
  const start = { c: 0, wanted: new Set(), last: 0, t: 0 };
  start.wanted = new Set(wantFrom(0, n, true, false, w, g, start.wanted, 0).map((i) => Math.floor(i / g)));
  const seen = new Set([key(start)]); const q = [start]; let bad = 0, ex = null;
  while (q.length) {
    const s = q.pop();
    const targets = jumps ? [...Array(n).keys()] : [s.c - 1, s.c + 1, s.c + 2, s.c - 2];
    for (const raw of targets) {
      const i = (raw + n) % n;
      const sign = Math.sign(i - s.c);
      let t = s.t, last = s.last;
      if (sign) [t, last] = [sign === s.last ? sign : 0, sign];
      let want = wantFrom(i, n, true, false, w, g, s.wanted, t); for (let r = 0; r < +(process.env.R || 0); r++) { const again = wantFrom(i, n, true, false, w, g, new Set(want.map((f) => Math.floor(f / g))), t); if (again.join() !== want.join()) { bad++; ex ??= { unstable: i, t, want: want.slice(0,3), again: again.slice(0,3) }; } want = again; }
      if (want[0] !== i) { bad++; ex ??= { from: s.c, to: i, wanted: [...s.wanted], t, want: want.slice(0, 3) }; }
      const ns = { c: i, wanted: new Set(want.map((f) => Math.floor(f / g))), last, t };
      const k = key(ns); if (!seen.has(k)) { seen.add(k); q.push(ns); }
    }
  }
  console.log(n, g, w, "states", seen.size, "current not wanted:", bad, ex ? JSON.stringify(ex) : "");
}
