/**
 * The wire buffer ring, against both session implementations: what the consumer hands back is
 * read into again, the free list never grows past the size the session was given, and a frame
 * read into a buffer of another size is still a view of its own length. The downloader's rig
 * cannot drive these — the ring is the session's. docs/decode/README.md §The wire buffer ring
 */
import { FakeTransport, installFakeTransport } from "./fake-transport.ts";
import type { Implementation } from "./adapters.ts";
import type { Check, ConformantFrame } from "./clauses.ts";

const CERT = "ab".repeat(32);
const settle = () => new Promise((r) => setTimeout(r, 30));

/** Each frame's own pattern, so a frame read into another frame's buffer is visible as its bytes. */
function body(index: number, len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (index * 31 + i) & 0xff;
  return out;
}

function correct(index: number, len: number, f: Landed | undefined): boolean {
  const want = body(index, len);
  return f?.length === len && want.every((b, i) => f.bytes[i] === b);
}

/** What a frame was at the moment it landed: a released buffer is another frame's by then. */
type Landed = { buffer: ArrayBuffer; capacity: number; length: number; bytes: Uint8Array };

/**
 * One fill of `sizes.length` frames, all on one stream so the reads are sequential, with each
 * buffer handed back as its frame lands when `release` says so.
 */
async function fill(
  impl: Implementation,
  wireBuffers: number | undefined,
  sizes: number[],
  release: boolean,
): Promise<Landed[]> {
  installFakeTransport();
  const s = await impl.connect(
    "https://conformance.invalid/",
    CERT,
    wireBuffers === undefined ? undefined : { wireBuffers },
  );
  const landed: Landed[] = [];
  s.fillFrames(0, sizes.length - 1, (f: ConformantFrame) => {
    landed.push({
      buffer: f.bytes.buffer as ArrayBuffer,
      capacity: f.bytes.buffer.byteLength,
      length: f.bytes.length,
      bytes: Uint8Array.from(f.bytes),
    });
    if (release) s.releaseWireBuffer?.(f.bytes.buffer as ArrayBuffer);
  });
  FakeTransport.last.pushOnOneStream(sizes.map((n, i) => [i, body(i, n)] as [number, Uint8Array]));
  for (let i = 0; i < 40 && landed.length < sizes.length; i++) await settle();
  s.close();
  return landed;
}

const distinct = (landed: Landed[]) => new Set(landed.map((f) => f.buffer)).size;

export async function runRing(impl: Implementation, check: Check): Promise<void> {
  const twelve = Array(12).fill(4096);

  const ring = await fill(impl, 4, twelve, true);
  check(ring.length === 12, `ring: the fill lands whole (${ring.length}/12)`);
  check(ring.every((f, i) => correct(i, 4096, f)), `ring: every frame is its own bytes`);
  check(distinct(ring) === 1, `ring: a buffer handed back is read into again (${distinct(ring)} buffers for 12 frames)`);

  const unset = await fill(impl, undefined, twelve, true);
  check(
    unset.length === 12 && distinct(unset) === 12,
    `ring: unset keeps none — one buffer per frame, as before (${distinct(unset)} for ${unset.length})`,
  );

  const held = await fill(impl, 3, twelve, false);
  check(distinct(held) === 12, `ring: a buffer still held is not reused (${distinct(held)} for 12 frames)`);

  // Every one of the twelve released at once, none taken: the free list keeps three.
  installFakeTransport();
  const s = await impl.connect("https://conformance.invalid/", CERT, { wireBuffers: 3 });
  const first: ArrayBuffer[] = [];
  s.fillFrames(0, 11, (f: ConformantFrame) => first.push(f.bytes.buffer as ArrayBuffer));
  FakeTransport.last.pushOnOneStream(twelve.map((n, i) => [i, body(i, n)] as [number, Uint8Array]));
  for (let i = 0; i < 40 && first.length < 12; i++) await settle();
  for (const b of first) s.releaseWireBuffer?.(b);
  const second: ArrayBuffer[] = [];
  s.fillFrames(12, 23, (f: ConformantFrame) => second.push(f.bytes.buffer as ArrayBuffer));
  FakeTransport.last.pushOnOneStream(twelve.map((n, i) => [12 + i, body(12 + i, n)] as [number, Uint8Array]));
  for (let i = 0; i < 40 && second.length < 12; i++) await settle();
  s.close();
  const kept = second.filter((b) => first.includes(b)).length;
  check(first.length === 12 && second.length === 12, `ring: both fills land whole (${first.length}, ${second.length})`);
  check(kept === 3, `ring: the free list keeps at most the size it was given (kept ${kept} of 12 released, cap 3)`);

  // 4096 then 16 then 8192, one buffer kept: the second frame is a view over the first's buffer,
  // and the third is too big for it, so it is dropped rather than grown.
  const sizes = await fill(impl, 1, [4096, 16, 8192], true);
  check(sizes.length === 3, `ring: the mixed-size fill lands whole (${sizes.length}/3)`);
  check(
    [4096, 16, 8192].every((n, i) => correct(i, n, sizes[i])),
    `ring: a reused buffer carries the new frame's bytes, not the old one's`,
  );
  check(
    sizes[1]?.length === 16 && sizes[1]?.capacity === 4096,
    `ring: a frame read into a larger buffer is a view of its own length (${sizes[1]?.length} of ${sizes[1]?.capacity})`,
  );
  check(
    sizes[2]?.buffer !== sizes[0]?.buffer && sizes[2]?.capacity === 8192,
    `ring: a buffer smaller than the frame is dropped, not grown (${sizes[2]?.capacity} for 8192)`,
  );
}
