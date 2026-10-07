// node client/downloader/htj2k.test.mjs — htj2k.js's range pass, without a decoder.
const { finish } = await import("./htj2k.js");

let failed = 0;
const check = (ok, what) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${what}`);
  }
};
const run = (view, bits, signed) => {
  const range = finish(view, bits, signed);
  return `${[...view]} ${range.min}..${range.max}`;
};

// Raw 12-bit two's-complement patterns in 16-bit containers come out sign-extended, range and all.
check(run(new Int16Array([4095, 1, 2048]), 12, true) === "-1,1,-2048 -2048..1", "12-bit signed raw patterns are extended");
// Samples a decoder already extended are left as they are.
check(run(new Int16Array([-1, 1, -2048]), 12, true) === "-1,1,-2048 -2048..1", "12-bit signed extended samples are unchanged");
// A sample as wide as its container is the view's own: 16-bit and 8-bit signed pass through.
check(run(new Int16Array([-32768, 32767]), 16, true) === "-32768,32767 -32768..32767", "16-bit signed passes through");
check(run(new Int8Array([-128, 127]), 8, true) === "-128,127 -128..127", "8-bit signed passes through");
// Unsigned samples are never touched, whatever their width.
check(run(new Uint16Array([4095, 1]), 12, false) === "4095,1 1..4095", "12-bit unsigned is unchanged");

console.log(failed ? `${failed} failed` : "decoder range pass: ok");
process.exit(failed ? 1 : 0);
