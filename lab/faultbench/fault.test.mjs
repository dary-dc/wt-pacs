// node lab/faultbench/fault.test.mjs — the faulted frame's first decode flips a sample and, as it returns, says when
// on the channel `faultbench` (the moment the check that follows finds the mismatch); the rescue decode, another
// frame, and no fault say nothing.
globalThis.self = { location: { search: "?fault=sample&at=3" } };
const { inject } = await import("./decode/fault.js");

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));
const heard = [];
const ear = new BroadcastChannel("faultbench");
ear.onmessage = ({ data }) => heard.push(data);
const settle = () => new Promise((r) => setTimeout(r, 20));

let returned = 0;
const decode = inject(async () => { await settle(); returned = performance.timeOrigin + performance.now(); return { sab: new Uint8Array(2).buffer }; });
const first = await decode(new Uint8Array(1), { index: 3 }, null, null);
await settle();
check(new Uint8Array(first.sab)[0] === 1, "the first decode of frame 3 has a sample flipped");
check(heard.length === 1 && heard[0].index === 3, `one fault heard, for frame 3 (${JSON.stringify(heard)})`);
check(heard[0]?.at >= returned && heard[0]?.at - returned < 5, "stamped as the faulted decode returns");
await decode(new Uint8Array(1), { index: 3 }, null, "htj2k");
await decode(new Uint8Array(1), { index: 4 }, null, null);
await settle();
check(heard.length === 1, "the rescue decode and another frame say nothing");
ear.close();

if (failed) process.exit(1);
console.log("faultbench: the fault says when it is found");
process.exit(0); // fault.js's channel stays open
