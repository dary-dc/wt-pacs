// Whether the origin's quota is `mib`: a file truncated to half of it is taken, to 16 MiB over it refused. README.md §The cells
onmessage = async ({ data: { mib } }) => {
  const root = await navigator.storage.getDirectory();
  const h = await (await root.getFileHandle("quota-probe", { create: true })).createSyncAccessHandle();
  const take = (m) => { try { h.truncate(m * 2 ** 20); return "ok"; } catch (e) { return e.name; } };
  const under = take(mib / 2);
  const over = take(mib + 16);
  h.close();
  await root.removeEntry("quota-probe");
  postMessage({ under, over, estimate: await navigator.storage.estimate() });
};
