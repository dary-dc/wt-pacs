const { wantFrom, memoryWindow } = await import(process.argv[2] + "/client/view/controller.js");
const meta = { width: 2560, height: 3328, bitsStored: 10, frameCount: 50 };
const W = memoryWindow(meta); console.log("memoryWindow dbts_b1", W);
for (const [name, w] of [["w", W], ["2w", 2 * W]]) for (const c of [0, 25, 49]) {
  const fill = wantFrom(c, 50, true, true, w, 8).length;
  console.log(`${name}=${w} start ${c}: fill ${fill}; fix's held max(W,2G)=${Math.max(w, 16)}; store budget ${Math.max(w, 16)}`);
}
