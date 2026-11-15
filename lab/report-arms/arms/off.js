// The control arm: no load report; the safety report by beacon at once, as the 2026-11-14 decision has it.
export default ({ base }) => ({
  load() {},
  safety: (body) => navigator.sendBeacon(`${base}/safety`, body),
});
