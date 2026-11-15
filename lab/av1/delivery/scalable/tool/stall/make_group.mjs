/**
 * A 16-frame 10-bit grey series at dbts_b1's size, coded lossless by libaom in groups of 8 (keyframe every 8, no
 * look-ahead): the units a slow decode of a group is reproduced on.
 *
 *   node make_group.mjs OUT_DIR      writes OUT_DIR/src.gray10 and OUT_DIR/g8.ivf (ffmpeg with libaom-av1)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const W = 2560, H = 3328, F = 16;
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const src = path.join(out, "src.gray10");
let seed = 1;
const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) % 24;
const fd = fs.openSync(src, "w");
for (let i = 0; i < F; i++) {
  const frame = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = 512 + 300 * Math.sin(x / 97) * Math.cos(y / 131) + ((((x + 3 * i) / 41) | 0) % 7) * 9 + noise();
      frame[y * W + x] = Math.max(0, Math.min(1023, v | 0));
    }
  }
  fs.writeSync(fd, new Uint8Array(frame.buffer));
}
fs.closeSync(fd);
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray10le", "-s", `${W}x${H}`,
  "-r", "25", "-i", src, "-c:v", "libaom-av1", "-aom-params", "lossless=1", "-cpu-used", "8", "-g", "8", "-keyint_min", "8",
  "-lag-in-frames", "0", "-auto-alt-ref", "0", "-row-mt", "1", "-f", "ivf", path.join(out, "g8.ivf")], { stdio: "inherit" });
