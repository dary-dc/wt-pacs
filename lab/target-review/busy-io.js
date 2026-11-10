// 17 MB written with a sync access handle every 100 ms; `hash` adds a read-back and a JS sum (a stand-in for XXH3).
const MB17 = 17 * 1024 * 1024;
let io = null;
async function startIo({ file, hash }) {
  try {
    const dir = await navigator.storage.getDirectory();
    const h = await (await dir.getFileHandle(file, { create: true })).createSyncAccessHandle();
    const buf = new Uint8Array(MB17).fill(7);
    const back = new Uint8Array(MB17);
    const words = new Uint32Array(back.buffer);
    const ms = [];
    let sum = 0;
    const timer = setInterval(() => {
      const t = performance.now();
      h.write(buf, { at: 0 });
      h.flush();
      if (hash) {
        h.read(back, { at: 0 });
        for (let i = 0; i < words.length; i++) sum = (sum + words[i]) | 0;
      }
      ms.push(performance.now() - t);
    }, 100);
    io = { h, timer, ms, dir, file, sum: () => sum };
  } catch (e) {
    postMessage({ error: `${e.name}: ${e.message}` });
  }
}
async function stopIo() {
  if (!io) return;
  clearInterval(io.timer);
  io.h.close();
  await io.dir.removeEntry(io.file);
  postMessage({ io: { writes: io.ms.length, medianMs: io.ms.sort((a, b) => a - b)[io.ms.length >> 1] } });
  io = null;
}
