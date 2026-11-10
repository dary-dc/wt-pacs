/** The display's phase: a worker's rAF times, on `now()`'s clock, painting nothing. lab/frame-clock/README.md §Phase */
const times = [];
let on = true;
const frame = (t) => {
  times.push(performance.timeOrigin + t);
  if (on) requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

/** `{ at }`: half an interval before the first vsync after `at`, projected by the median interval; `{}`: stop, and the log. */
onmessage = ({ data }) => {
  if (data.at === undefined) {
    on = false;
    return void postMessage(times);
  }
  const d = times.slice(-31).map((t, k, a) => t - a[k - 1]).slice(1).sort((a, b) => a - b);
  const interval = d[d.length >> 1];
  const last = times.at(-1);
  postMessage(last + Math.ceil((data.at - last) / interval) * interval - interval / 2);
};
