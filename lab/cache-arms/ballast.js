// The cell Q's ballast: a file in the same origin grown by 1 MiB every 10 ms until the engine refuses it.
const h = await (await (await navigator.storage.getDirectory()).getFileHandle("ballast", { create: true })).createSyncAccessHandle();
const MiB = 2 ** 20;
let size = h.getSize();
for (;;) {
  try {
    h.truncate(size + MiB);
    size += MiB;
  } catch (e) {
    h.close();
    postMessage({ grownMiB: size / MiB, refusal: e.name });
    break;
  }
  await new Promise((r) => setTimeout(r, 10));
}
