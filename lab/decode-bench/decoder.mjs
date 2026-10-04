// The decoder under test, loaded from what fetch_decoder.sh put in vendor/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const decoderDir = path.join(here, 'vendor', 'openjph');

// The glue is a classic script and takes `require` / `__dirname` from its scope in Node.
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = decoderDir;
vm.runInThisContext(fs.readFileSync(path.join(decoderDir, 'openjphjs.js'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(decoderDir, 'openjphjs.wasm'));

/** One decoder: its own WASM module, its own linear memory. */
export async function instance() {
  const M = await globalThis.Module({ locateFile: (f) => path.join(decoderDir, f), wasmBinary });
  return {
    module: M,
    heap: () => M.HEAPU8.length,
    /** Decoded samples as a view into this module's heap — valid until the next decode. */
    decodeInPlace(bytes) {
      const d = new M.HTJ2KDecoder();
      try {
        d.getEncodedBuffer(bytes.length).set(bytes);
        d.readHeader();
        d.decode();
        return d.getDecodedBuffer();
      } finally {
        d.delete();
      }
    },
    decode(bytes) {
      return this.decodeInPlace(bytes).slice();
    },
  };
}

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function loadFixture(dir) {
  const names = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.j2c') || f.endsWith('.htj2k'))
    .sort();
  const frames = names.map((f) => new Uint8Array(fs.readFileSync(path.join(dir, f))));
  if (!frames.length) {
    console.error(`no codestreams in ${dir}`);
    process.exit(2);
  }
  // Ground truth from the encoder's input, not from this decoder: docs/decode/README.md.
  const truth = names.map((f) => {
    const s = path.join(dir, f.replace(/\.[^.]+$/, '.sha256'));
    return fs.existsSync(s) ? fs.readFileSync(s, 'utf8').trim() : null;
  });
  if (truth.some((t) => t === null)) {
    console.error(`${dir}: no .sha256 beside every frame — regenerate with gen_htj2k_fixtures.sh`);
    process.exit(2);
  }
  const metaPath = path.join(dir, 'metadata.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  return { frames, truth, meta, name: path.basename(dir) };
}

export const MB = (n) => (n / 1048576).toFixed(1);
export const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
export const range = (a) => [Math.min(...a), Math.max(...a)];
