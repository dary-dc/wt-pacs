/**
 * An Emscripten module from its classic glue, in a module worker, which has no importScripts: the
 * glue's factory is a `var`, local in a Function body, so the body returns it by `name`.
 */
export async function instantiate(d, name, options = {}) {
  const src = await (await fetch(d.glue)).text();
  const factory = new Function(`${src}\nreturn ${name};`).call(globalThis);
  const wasmBinary = await (await fetch(d.wasm)).arrayBuffer();
  return factory({ locateFile: (f) => d.dir + "/" + f, wasmBinary, ...options });
}
