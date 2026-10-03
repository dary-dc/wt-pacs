# ADR: the codec seam, and the group as the client's unit

**Status:** §1–2 built for G = 1 (row DEC; the transforms and WebCodecs by row WCDEC), §3 built in its simplest form (row GOP); departures marked *Built:* · **Date:** 2026-10-03 · **Queue:** row 5 SEAM ([`queue.md`](queue.md))
· **Answers:** [`README.md`](README.md) §A1, the shape half; SIZE and SPEED own the numbers.

Read against [`WIRE.md`](../WIRE.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md),
[`adr-stream-shape.md`](../adr-stream-shape.md) and [`FIXTURES.md`](../FIXTURES.md) §SBND as they
stand at this commit. Nothing below is measured; where a choice needs a number, it says which row
brings it.

## 1 · Where the codec tag lives

**In the bundle's metadata JSON, beside `frameCount`:**

```json
{ "frameCount": 120, "codec": "av1" }
```

* **Values:** `"htj2k"` and `"av1"`. **Absent means `"htj2k"`**, so every bundle and fixture made
  so far reads unchanged and nothing has to be repacked.
* **A bundle carries one codec.** `exact-server --study` serves one bundle, and a bundle is one
  series today, so "the codec belongs to the series" ([`README.md`](README.md) §Decided) needs no
  per-frame field. The envelope stays `[len][index][opaque]`.
* **The server does not read it.** It serves bytes by index; the metadata is opaque to it except
  `frameCount`. The only server-side change is in ingest: `pack-study` reads `DIR/NNN.htj2k`
  today and would read `NNN.<codec>`, the extension taken from the metadata.
* **A transform that makes a series codable is the codec's, and named beside it.** AV1 codes at most
  12 bits and only unsigned ([`README.md`](README.md) §A3), so a signed series needs its offset and
  a series over 12 bits its split carried in metadata for the decoder to undo. Row DEPTH chooses
  which transforms survive and names their fields; this ADR only fixes the rule below for them.
* **A value the client does not know is a refusal, before the dial.** `connect` rejects with
  `unknown codec "<value>"` (or `unknown transform …`) and no frame is asked for. *Built:* the
  check is in `DownloaderClient.connect`, on the page, before the downloader's worker starts — so
  before the dial with nothing to tear down. Not a fallback to
  HTJ2K: a frame handed to the wrong decoder either fails one by one, a failure per frame of a whole
  series, or — the case that matters — decodes to something. Bit-exact or nothing.

**Who reads it.** Not the downloader from the wire: no metadata crosses the session. The caller
already holds the series metadata and already chooses the decoder files and the warm-up for it
([`client/downloader/README.md`](../../client/downloader/README.md) §A warm-up frame). So the
codec rides the same config: `decoder: { codec, glue, wasm, dir }`, and `warmup` is a frame of the
series' codec *and* shape. The downloader checks `codec` against the set it knows at `start` and
refuses there; the decoders never see a codec they cannot decode.

## 2 · How `decoder.js` dispatches

`decoder.js` keeps the worker, the message handling, the `SharedArrayBuffer`, `finish()` and the
reply to the consumer. What is codec-specific today — `init` (glue, factory, decoder object) and
`decodeFrame(bytes)` — moves behind one interface, one module per codec:

```js
// decode-htj2k.js, decode-av1.js
export async function init(m) {}          // compile, construct the decoder object
export function decodeFrame(bytes) {}     // → { info, sab, byteCount, range }
// info: { width, height, bitsPerSample, componentCount, isSigned }
```

`init` in `decoder.js` loads the module by `m.decoder.codec` with a dynamic `import()` (it is a
module worker), so an HTJ2K page never fetches AV1 code and the HTJ2K path is today's code moved,
not changed. *Built:* only AV1 is a separate module (`decode-av1.js`); HTJ2K's half stays in
`decoder.js`, moved into `initHtj2k` and otherwise unchanged, so an HTJ2K decoder's boot fetches
what it did (the worker graph `lab/page-open` preloads). The AV1 module is a relative `import()`,
which resolves nothing from a blob: a page booting `decoder.js` from one serves HTJ2K only. The `frame` message to the consumer is built from that return value exactly as now, so
the contract `{pixels, width, bits, signed, range}` and everything above it are untouched.

**What the AV1 module owes the contract**, each against the encoder input's `.sha256`, never
against another decoder:

* **Layout.** The HTJ2K path hands the consumer pixel-interleaved samples. dav1d returns planes;
  4:4:4 with the identity matrix comes out G, B, R. The module interleaves into the order the source
  was in. 4:0:0 is one plane, `componentCount` 1, no chroma.
* **Width.** 8-bit samples as bytes, 10/12-bit in 16-bit containers, as the HTJ2K path does above 8.
* **`bits` and `signed` are the source's, not the stream's.** The stream says 12-bit unsigned;
  after the metadata's offset is undone a series is, say, 12-bit signed, and `finish()` (or the
  module's own pack) sign-extends and takes the range as it does for HTJ2K.
* **The failure rule** of [`decode/README.md`](../decode/README.md) §A frame that did not decode
  holds: a frame whose output is shorter than its header declares is refused, never the previous
  frame's pixels.
* *Built:* **at G = 1 the decoder is flushed before every frame** (`dav1d_flush`: every reference
  and the sequence header dropped), so a frame decodes from its own bytes or fails. Without it a
  frame of a group handed to a G = 1 series decodes against the previous frame's references to
  wrong pixels — the conformance clause sees exactly that when the flush is removed.

### The transforms and the decoder choice, as built (row WCDEC)

Three more fields of `decoder`, from the series' metadata beside `codec`:

```json
{ "codec": "av1", "depth": 10, "split": 3, "offset": 4096 }
```

* **`depth`** — the bits of the deepest stream the series codes (the top stream when split). It
  picks the decoder: WebCodecs where ≤ 10 and the browser has `VideoDecoder`, dav1d-WASM otherwise,
  absent included ([`decode/README.md`](../decode/README.md) §AV1).
* **`split`** — the bits of the low stream. A split frame is `[u32le top length][top unit][low
  unit]`, both units of one store entry; the sample is `top << split | low`. Row DEPTH's top10+low
  at 13 bits is `split: 3`. A frame that is not split in a split series is refused.
* **`offset`** — subtracted after the merge; present means the source is signed, so `signed` and
  the range are the source's.

`bits` out is the stream's plus `split`. The store, the wire and SBND are unchanged: the framing is
inside the opaque frame. The rule above that an unknown transform is refused before the dial is not
built — a field the client does not read is ignored.

## 3 · If a group of G > 1 frames is the unit

Only if SIZE shows inter coding pays on real content, and SPEED shows the ask it costs is
acceptable. Until then G = 1 and §1–2 are the whole change (row DEC).

*Built (row GOP), on the owner's brief of 2026-10-03 — a group is the item, asked and sent whole,
no seek inside one.* Beside G = 1, which dispatches as before (every frame a keyframe, no decoder
ever holding a group); measured on synthetic frames only, nothing timed. Where it departs from the
proposal below:

* **An ask for N asks its whole group, k … k+G−1**, not k … N, cut at the series' end. So
  `connect` takes `groupLength` *and* `frameCount` beside `decoder` and refuses G > 1 without the
  second. The group goes out as G `request_frame` messages in order, not one `request_frames`: the
  transport's batch call holds one batch at a time, and the server serves both the same way.
* **A fill cut by an ask resumes where it was cut**, mid-group, on the decoder still holding that
  group — nothing re-fetched, nothing decoded twice. The ask's own group starts at its keyframe.
* **A group split across two decoders is impossible by construction, and refused if it happens.**
  A frame that is not a keyframe goes only to the decoder that took its predecessor, in index order
  whatever order the frames land in; a decoder holds its group while its next frame is still owed,
  and takes no keyframe meanwhile. `decode-av1.js` refuses a frame unless it is a keyframe (`key`
  in the decode message, `index % G == 0`; it flushes then) or follows the frame it decoded last in
  the same request.
* **A failure fails the rest of its group by name** (invariant 4): a frame that does not decode
  drops its decoder's state, so each later frame is refused; a frame whose predecessor never
  reached a decoder is failed by the downloader. A frame refused for its order leaves the state.
* **A series in groups decodes through dav1d-WASM**, whatever its depth: the WebCodecs module
  flushes after every frame, and a flush makes the next chunk a keyframe. A split series is G = 1.
* Not built: an ask served from a held state (an ask always starts at its keyframe unless its
  frames are already in hand), the wire ring's re-size (invariant 6), the compressed-group cache.

### The proposal: the group is the client's unit, not the transport's

**G is fixed per series and a keyframe sits at every multiple of G.** One more metadata field,
`"groupLength": G` (absent means 1). The keyframe of frame N is `k = G·⌊N/G⌋`; nothing needs to be
looked up.

**An ask for N is a batch the client names: `request_frames [k … N]`.** No new message, no server
change, no store change:

* **The store** keeps one table entry per frame. A group is an arithmetic range of indices, so the
  bundle needs no group table; SBND is unchanged.
* **Which bytes first** is forced by decode order: the keyframe, then each frame to N. That is the
  batch's own order, served as one ask per index in order ([`WIRE.md`](../WIRE.md) §FoD messages),
  with the planner naming the rest as upcoming so the tile reader reads ahead as it does today.
* **Not past N.** Frames N+1 … k+G−1 are not fetched for the ask. A step forward to N+1 continues
  from the decoder state the ask left (below); a step back is a frame already delivered.
* **An ask during a fill** ends the fill, as any message does, and the downloader re-issues what is
  not yet delivered ([`WIRE.md`](../WIRE.md) §An ask during a fill). Unchanged — but the re-issued
  run must start at a keyframe or at a frame whose predecessor's state a decoder still holds.

**Why not the server.** A server that answered `request_frame N` with the group from k would need
to know G (a metadata read it does not do), would change what one ask returns on the wire, and
would save one JSON array of at most G integers in a message the client sends anyway, in the same
round trip. The client already owns which frames it wants; the group is that decision.

### The decoder pool: a group to one decoder

* **Affinity.** A group's keyframe goes to the first free decoder (first-free, as today), and every
  later frame of that group goes to the same decoder, in index order. `perDecoder` still bounds what
  is outstanding on it; a frame whose decoder is full waits **even while another decoder is idle**.
* **One decoder state per decoder worker.** A decoder holds one group at a time: a new keyframe
  replaces the state (a keyframe with its sequence header resets references). The decoder must hand
  a frame back for every frame it is given — no frame delay held for reordering — so the AV1 module
  runs dav1d with a frame delay of 1. *Corrected by row WASM:* libaom's lossless inter streams are
  coded **with** hidden alt-reference frames (a temporal unit carries up to 3 frames), and that is
  harmless — every temporal unit still shows exactly one frame and dav1d at a frame delay of 1 hands
  it back before the next goes in ([`lab/av1/dav1d-wasm`](../../lab/av1/dav1d-wasm/README.md)). What
  it changes is size: a group's bytes are not even across its frames.
* **The fill's order** is still ascending, one `stream_frames` run. Groups land one after another on
  the shared stream, so the first G frames decode serially on one decoder: frame G−1 of a fill shows
  after about G decodes, not one. Decoders run in parallel across groups only, so parallelism is at
  most `min(decoders, groups in flight)`.
* **The downloader's record** gains, per group, the decoder bound to it and the last index decoded
  in it. An ask for N is served from that state when `last = N−1` on a decoder still bound to the
  group; otherwise from k.

### What the cache holds

Decoded pixels per frame, as now: **every frame a group decodes is delivered**, k … N, not only N,
so the frames decoded on the way to N are not decoded again. Asked frame N settles the ask; k … N−1
reach the consumer as fill frames do, at background priority. Compressed bytes are released after
their decode as today, so a group whose decoder was taken by another group is re-fetched from k and
the frames already delivered are decoded again and dropped. No compressed group is kept to avoid
that until SPEED says what the re-decode costs.

### Invariants this breaks

Each holds today and is named so that nothing relying on it is changed by accident.

1. **A frame decodes alone** ([`ARCHITECTURE.md`](../ARCHITECTURE.md) §The decoders). First-free
   dispatch of any frame to any decoder, and the reason it beats round-robin
   ([`decode/README.md`](../decode/README.md) §Dispatch), hold per group, not per frame.
2. **One ask, one frame.** `requestExactFrame(N)` puts up to G frames on the wire and costs up to G
   serial decodes; an ask behind it waits for its whole batch ([`WIRE.md`](../WIRE.md): "an ask sent
   after a 200-frame batch waits for all 200"). A fast scroll across groups pays G per step.
3. **Frames are decoded once** — only while a group's decoder keeps its state; otherwise up to G − 1
   frames are decoded twice (§What the cache holds).
4. **A failure is one frame.** A frame refused, truncated
   ([`CLIENTS.md`](../CLIENTS.md#a-truncated-frame-is-a-failure)) or undecodable fails every later
   frame of its group that depends on it; the downloader fails them by name rather than decoding
   them against a broken reference.
5. **The decoders are not told of a cancel** ([`ARCHITECTURE.md`](../ARCHITECTURE.md) §Messages).
   Generations still drop stale results, but a decoder's group binding must be dropped with the
   cancel, or the next request's frame is decoded against the old group's state.
6. **The wire buffer ring** is sized `decoders × perDecoder + 2` on the premise that a frame waits
   only for *a* decoder ([`decode/README.md`](../decode/README.md) §The wire buffer ring). With
   affinity it waits for *its* decoder, so more buffers can be out; the ring never pauses the reader,
   so this costs allocations, not a deadlock. Re-sized when built.
7. **A prefix draws a smaller image** ([`decode/README.md`](../decode/README.md) §A prefix draws a
   smaller image) is a property of the HTJ2K progression. AV1 has no resolution prefix, at any G,
   so a series coded as AV1 is outside the resolution-fitting path of
   [`adr-resolution-fitting-for-large-frames.md`](../adr-resolution-fitting-for-large-frames.md).

Not broken: a frame is still identified by its index and never by its stream; the envelope, the
stream shape ([`adr-stream-shape.md`](../adr-stream-shape.md)), the planner and the store are
unchanged; the server stays codec-blind.

## 4 · What has to be measured before a G is chosen

| needed | from | for |
| --- | --- | --- |
| bytes per frame against HTJ2K at G = 1, 2, 4, 8, 16, 32, per content | SIZE (6) | whether any G > 1 pays, and the smallest G that collects most of it |
| decode time per frame, dav1d-WASM and WebCodecs against OpenJPH, n ≥ 15, interleaved | SPEED (9): **5.4–9.7× OpenJPH** (dav1d-WASM), 4.1–4.2× (WebCodecs, 8-bit only), 16 rounds, every frame exact | whether G = 1 alone is affordable — the fill is decoder-bound |
| an ask's cost at G: bytes and serial decodes from k to N, mean (G + 1)/2 frames | SIZE × SPEED | the latency a mid-group ask pays, against today's one decode |
| the fill's decode time with `min(decoders, groups)` in parallel and the first G serial | SPEED | the fill's cost of affinity |
| a frame delay of 1 returns one frame per temporal unit, hidden frames or not | WASM (4): **yes**, dav1d-WASM, threads on and off | that a decoder returns one frame per frame given |

**The rule to choose by, proposed for the owner's review and set before the numbers:** G > 1 is adopted for a content only if its bytes
fall by at least a fifth against AV1 intra *and* against HTJ2K on that content, and the mid-group
ask's serial decodes at that G stay inside what SPEED measures for one HTJ2K frame's ask plus the
wire time saved. Otherwise G = 1, and AV1 earns its place, if at all, on intra size and decode
speed alone.
