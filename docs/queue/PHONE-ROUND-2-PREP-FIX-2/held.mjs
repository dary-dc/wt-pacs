const { wantFrom, memoryWindow } = await import(process.argv[2] + "/client/view/controller.js");
const b1 = { width: 2560, height: 3328, bitsStored: 10, frameCount: 50 };
const W = memoryWindow(b1);
for (const [name, n, w, g] of [["dbts_b1 w", 50, W, 8], ["dbts_b1 2w", 50, 2 * W, 8], ["pair 6", 20, 6, 8], ["pair 19", 20, 19, 8], ["pair 20", 20, 20, 8]])
  console.log(`${name}: budget ${w}; held by the want, start 0: ${wantFrom(0, n, true, true, w, g).length}, start ${n - 1}: ${wantFrom(n - 1, n, true, true, w, g).length}; max(W, 2G) ${Math.min(n, Math.max(w, 2 * g))}`);
