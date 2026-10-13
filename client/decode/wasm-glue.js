/**
 * An Emscripten module from its classic glue, in a module worker, which has no importScripts: the
 * glue's factory is a `var`, local in a Function body, so the body returns it by `name`.
 * `d.sha256`, when given, holds the `glue` and `wasm` digests a build must have: anything else is refused.
 */
export async function instantiate(d, name, options = {}) {
  const [glue, wasmBinary] = await Promise.all([d.glue, d.wasm].map(async (u) => (await fetch(u)).arrayBuffer()));
  if (d.sha256) await Promise.all([pinned(d.glue, glue, d.sha256.glue), pinned(d.wasm, wasmBinary, d.sha256.wasm)]);
  const factory = new Function(`${new TextDecoder().decode(glue)}\nreturn ${name};`).call(globalThis);
  return factory({ locateFile: (f) => d.dir + "/" + f, wasmBinary, ...options });
}

async function pinned(url, bytes, want) {
  const got = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (got !== want) throw new Error(`${url} is not the pinned build: sha256 ${got}, not ${want}`);
}

/** The manifest's digest of a built file, by its path under wasm/built; a file it does not name is refused. */
async function manifest() {
  const text = await (await fetch(new URL("./wasm/build/manifest.sha256", import.meta.url))).text();
  return (path) => {
    const line = text.split("\n").find((l) => l.endsWith(`  ${path}`));
    if (!line) throw new Error(`no ${path} in the decoder manifest`);
    return line.slice(0, 64);
  };
}

/** The product's build of `name` (`openjph`, `dav1d`) with the digests its manifest pins: wasm/build/README.md */
export async function built(name) {
  const sum = await manifest();
  const dir = new URL(`./wasm/built/${name}`, import.meta.url).pathname;
  return { glue: `${dir}/${name}.js`, wasm: `${dir}/${name}.wasm`, dir, sha256: { glue: sum(`${name}/${name}.js`), wasm: sum(`${name}/${name}.wasm`) } };
}

/** The bytes of a build with no glue (`xxh3`), refused unless the manifest pins them. */
export async function builtWasm(name) {
  const sum = await manifest();
  const url = new URL(`./wasm/built/${name}/${name}.wasm`, import.meta.url).pathname;
  const bytes = await (await fetch(url)).arrayBuffer();
  await pinned(url, bytes, sum(`${name}/${name}.wasm`));
  return bytes;
}
