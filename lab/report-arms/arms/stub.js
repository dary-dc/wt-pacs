// A stand-in carrier, no candidate: a plain fetch of each record at once, to show the rig end to end.
export default ({ base }) => ({
  load: (body) => fetch(`${base}/load`, { method: "POST", body }),
  safety: (body) => fetch(`${base}/safety`, { method: "POST", body }),
});
