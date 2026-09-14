# Decode — codestream to pixels

`disk-access/` owns how a frame is brought in and `transport/` how it is sent. This owns what
happens after it arrives: turning a codestream into samples, what that costs, and where those
samples live.

## The decoder

OpenJPH, through the `@cornerstonejs/codec-openjph` WASM build (wrapper MIT, OpenJPH
BSD-2-Clause). `lab/decode-bench/fetch_decoder.sh` pulls a pinned version from npm and records
the tarball's checksum; nothing is committed, so provenance is the checksum rather than trust in
bytes in this repo. That build reports SIMD level 1, which OpenJPH returns only from its WASM SIMD
build, so SIMD is already on and is not a lever.

It is a **decoder only** — no encoder ships in it. `lab/scripts/gen_htj2k_fixtures.sh` therefore
builds OpenJPH from source for `ojph_compress` and encodes synthetic images, so a fixture can be
made anywhere from nothing. The profile is part 15, reversible 5/3, 5 levels, 64×64 code-blocks,
RPCL, one layer, one tile per frame.

## What is known, and where it was measured

Two findings are structural and hold regardless of fixture:

* **Each decoder instance is its own WASM module with its own linear memory, and WASM memory only
  grows.** Emscripten's allocator does not return pages, so an instance climbs to its high-water
  mark and holds it for as long as it lives. N instances is N heaps, permanently. On a phone this
  is the binding resource, not decode time.
* **Handing out a view of decoded samples instead of copying them requires the heap be shared, and
  making it shared is not free.** Measured as a controlled set — the same binary with only the
  memory's limits flag changed — the shared-memory tax and the copy saved were the same size and
  cancelled. So "avoid the copy" and "use shared memory" are one decision, not two, and on time it
  is a wash.

The numbers behind the second were taken elsewhere, on an 87-frame 512×512×3 series: 4.78 ms per
frame all in, 4.84 shared with the copy kept, 4.79 shared with the pixels left in place; ~50 MB of
heap per instance, 86 MB when frames are retained. **They have not been reproduced on this repo's
own fixtures** — that is what `lab/decode-bench/` is for, and nothing here should be quoted as
this project's measurement until it has been.

## Open

* **One multithreaded instance against N single-threaded ones**, at equal decode width. N heaps
  against one is the whole question, and no threaded build has been made. Aimed at memory, not
  milliseconds.
* **Copy cost against frame size**, 50 KB to 8 MB. Only one size has ever been measured.
* **Total resident memory of a pipeline that retains frames.** The bench above reported heap only
  while releasing each frame, so it measured a decoder, not a viewer. Retaining changes the sign of
  the comparison: copying holds the heap *plus* every copied buffer, keeping holds one heap.
* **Nothing has been measured on a phone.**

## The BYOB read path

`client/transport-wasm` can read media frames with a BYOB reader instead of the default one
(`byob`, `byob-min`, `byob-count`, all off by default). It removes both compressed-frame copies:
the frame is read straight into its own JS buffer and no byte passes through WASM memory.

On time it is a tie — both fixtures, both cells, route-matched. `byob-min` adds `read(view, {min})`
and is also a tie, because the receive stream already coalesces: reads per frame fall only from
2.30 to 2.00 on a 49 KB frame and 4.70 to 2.00 on a 250 KB one.

**Not adopted, for one reason.** The first frame of a session costs about 12 ms more on this path,
reproduced across two independent campaigns, in the worse direction on 8 of 8 rounds with
non-overlapping ranges. It is undiagnosed; the places to look are acquiring a BYOB reader on a
fresh stream, and the first per-frame buffer allocation against a cold allocator. Until that is
explained the path stays behind its feature.

It is kept because adopting it would **delete** more than it adds: the default path needs a
partial-frame state machine, a compaction heuristic and a reserve policy to reassemble frames from
chunks that do not align with them, all of which BYOB makes unnecessary — about 140 lines removed
against 93 added. That argument is independent of every measurement above.
