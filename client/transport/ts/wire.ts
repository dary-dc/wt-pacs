/** FoD control messages — LE u32 length + JSON (same as common/fod). */

export type FodMsg =
  | { op: "request_frame"; frame: number }
  | { op: "stream_frames"; from?: number; to?: number }
  | { op: "end_stream" }
  | { op: "frame_error"; frame_index: number; reason?: string };

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function encodeFodMsg(msg: FodMsg): Uint8Array {
  const body = utf8Encoder.encode(JSON.stringify(msg));
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, true);
  out.set(body, 4);
  return out;
}

/** Decode a framed message: `[4B LE len][JSON body]`. */
export function decodeFodMsg(bytes: Uint8Array): FodMsg {
  if (bytes.length < 4) throw new Error("FodMsg too short");
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  return decodeFodBody(bytes.subarray(4, 4 + len));
}

/** Decode the JSON body alone — for a reader that has already consumed the length prefix. */
export function decodeFodBody(body: Uint8Array): FodMsg {
  return JSON.parse(utf8Decoder.decode(body)) as FodMsg;
}

/** Max media frame length — matches server/harness guard. */
export const MAX_FRAME_LEN = 64 * 1024 * 1024;

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
