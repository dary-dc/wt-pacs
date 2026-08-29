/** FoD control messages — LE u32 length + JSON (same as common/fod). */

export type FodMsg =
  | { op: "request_frame"; frame: number }
  | { op: "request_frames"; frames: number[] }
  | { op: "end_session" }
  | { op: "frame_error"; frame_index: number; reason?: string };

export function encodeFodMsg(msg: FodMsg): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(msg));
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}

export function decodeFodMsg(bytes: Uint8Array): FodMsg {
  if (bytes.length < 4) throw new Error("FodMsg too short");
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const body = bytes.subarray(4, 4 + len);
  return JSON.parse(new TextDecoder().decode(body)) as FodMsg;
}

/** Frame envelope: [4B BE display_index][codestream…] */
export function unwrapEnvelope(payload: Uint8Array): { index: number; codestream: Uint8Array } {
  if (payload.length < 4) throw new Error("envelope too short");
  const index = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false);
  return { index, codestream: payload.subarray(4) };
}

/** Max media frame length — matches server/harness guard. */
export const MAX_FRAME_LEN = 64 * 1024 * 1024;

/**
 * Parse one `[4B BE len][payload]` from the front of `buf`.
 * Returns null if truncated or invalid.
 */
export function parseLengthPrefixed(
  buf: Uint8Array,
): { payload: Uint8Array; consumed: number } | null {
  if (buf.length < 4) return null;
  const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, false);
  if (len === 0 || len > MAX_FRAME_LEN) return null;
  const total = 4 + len;
  if (buf.length < total) return null;
  return { payload: buf.subarray(4, total), consumed: total };
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
