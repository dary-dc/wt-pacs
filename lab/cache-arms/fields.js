// The cell's input: FIELDS distinct 16-bit frames in one shared buffer, frame i being field i mod FIELDS.
export const FIELDS = 4;

export function fill(fields, w, h) {
  const v = new Uint16Array(fields);
  for (let k = 0, i = 0; k < FIELDS; k++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) v[i] = (x * 7 + y * 13 + k * 1009) & 0xffff;
}

export const fieldBytes = (fields, i, frameBytes) => new Uint8Array(fields, (i % FIELDS) * frameBytes, frameBytes);

/** The harness's own check beside the store's XXH3: SHA-256, which no arm uses. */
export const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()))].map((b) => b.toString(16).padStart(2, "0")).join("");
