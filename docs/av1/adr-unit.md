# ADR: the codec seam, and the group as the client's unit

**Status:** §1–2 built for G = 1 (row DEC; the transforms and WebCodecs by row WCDEC), §3 built in its simplest form (row GOP); departures marked *Built:*; §5 proposed (row SVCORDER) · **Date:** 2026-10-03 · **Queue:** row 5 SEAM ([`queue.md`](queue.md))
· **Answers:** [`README.md`](README.md) §Frame groups, the shape half; SIZE and SPEED own the numbers.

Read against [`WIRE.md`](../WIRE.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md),
[`adr-stream-shape.md`](../adr/stream-shape.md) and [`FIXTURES.md`](../FIXTURES.md) §SBND as they
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
  12 bits and only unsigned ([`README.md`](README.md) §Samples over 12 bits), so a signed series needs its offset and
  a series over 12 bits its split carried in metadata for the decoder to undo. Row DEPTH chooses
  which transforms survive and names their fields; this ADR only fixes the rule below for them.
* **A value the client does not know is a refusal, before the dial.** `connect` rejects with
  `unknown codec "<value>"` (or `unknown transform …`) and no frame is asked for. *Built:* the
  check is in `DownloaderClient.connect`, on the page, before the downloader's worker starts — so
  before the dial with nothing to tear down. Not a fallback to
  HTJ2K: a frame handed to the wrong decoder either fails one by one, a failure per frame of a whole
  series, or — the case that matters — decodes to something. Bit-exact or nothing.

**Who reads it.** Not the downloader from the wire: no metadata crosses the session. The caller
already holds the series metadata and already chooses the decoder files for it. So the codec rides
the same config: `decoder: { codec, glue, wasm, dir }`. (A warm-up frame of the series' codec and
shape rode it too until `main` removed the warm-up on 2026-10-03.) The downloader checks `codec` against the set it knows at `start` and
refuses there; the decoders never see a codec they cannot decode.

## 2 · How `decoder.js` dispatches

`decoder.js` keeps the worker, the message handling, the `SharedArrayBuffer`, `finish()` and the
reply to the consumer. What is codec-specific today — `init` (glue, factory, decoder object) and
`decodeFrame(bytes)` — moves behind one interface, one module per codec:

```js
// decode-htj2k.js, av1-dav1d.js
export async function init(m) {}          // compile, construct the decoder object
export function decodeFrame(bytes) {}     // → { info, sab, byteCount, range }
// info: { width, height, bitsPerSample, componentCount, isSigned }
```

`init` in `decoder.js` loads the module by `m.decoder.codec` with a dynamic `import()` (it is a
module worker), so an HTJ2K page never fetches AV1 code and the HTJ2K path is today's code moved,
not changed. *Built:* only AV1 is a separate module (`av1-dav1d.js`); HTJ2K's half stays in
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

Three more fields of `decoder`, from the series' metadata beside `codec`. *Superseded by row 39 (UNIFY):
they live in each payload's header ([`payload-format.md`](payload-format.md)), `split` is 0–2 low bits, and the decoder is
chosen per payload; the fields below are the series-wide form this section first built.*

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
* **`rct`** — *built since (row TOTAL2):* 8-bit RGB coded as JPEG 2000's reversible colour
  transform, row LLSIZE's best coding on RGB: planes Y = ⌊(R + 2G + B)/4⌋, B − G + 256, R − G + 256 in
  a 10-bit 4:4:4 identity stream, tagged sRGB as any RGB series for WebCodecs; `depth: 10`. Undone in
  `av1-frame.js` to the contract's 8-bit R, G, B; a frame that is not three 10-bit planes is refused.

`bits` out is the stream's plus `split`. The store, the wire and SBND are unchanged: the framing is
inside the opaque frame. The rule above that an unknown transform is refused before the dial is not
built — a field the client does not read is ignored.

## 3 · If a group of G > 1 frames is the unit

Only if SIZE shows inter coding pays on real content, and SPEED shows the ask it costs is
acceptable. Until then G = 1 and §1–2 are the whole change (row DEC).

*Built (row GOP), on the owner's brief of 2026-10-03 — a group is the payload, asked and sent whole,
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
  and takes no keyframe meanwhile. `av1-dav1d.js` refuses a frame unless it is a keyframe (`key`
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
  it back before the next goes in ([`client/decode/wasm/dav1d`](../../client/decode/wasm/dav1d/README.md)). What
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
   [`adr-resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md).

Not broken: a frame is still identified by its index and never by its stream; the envelope, the
stream shape ([`adr-stream-shape.md`](../adr/stream-shape.md)), the planner and the store are
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

## 5 · Bases first: a scalable frame's layers as separate entries

*Proposed (row SVCORDER), not built, nothing measured.* A scalable payload (row SVCQ: a lossy base
layer and a lossless top in one temporal unit) buys a preview only if **the bases of a whole cine
arrive before the tops**. Stored as one entry per frame, as row SVCQ coded it, base and top travel
together and the fill's last preview lands with its last exact frame.

**The base is a prefix of its temporal unit.** The spec orders a temporal unit's layers by
ascending `spatial_id` (AV1 §7.5), so the base's OBUs — the temporal delimiter, the sequence header
on a keyframe, the frame OBUs with `spatial_id` 0 — come before the top's. *Not checked on libaom's
output here*; the splitter below refuses a unit where it does not hold.

### The options

| | A · base and top as entries, top alone | **B · base and exact as entries, exact whole** | C · a byte range per layer in one entry |
| --- | --- | --- | --- |
| store | 2F entries; the top entry holds only the top's OBUs | 2F entries; the exact entry is the whole temporal unit, base included | F entries, the table gains a per-layer length: SBND version 2 |
| wire, server | unchanged | unchanged | a layer in the ask and in the envelope; the server reads the table's layers, so it is no longer codec-blind |
| bytes over the scalable payload | 0 | **the base's share again**: 0.07–2.4 % of HTJ2K's at a half-size base, q 40 (row SVCQ); up to 10.4 % at q 20 on the ultrasound | 0 |
| the exact frame decodes from | the base's entry *and* the top's, joined; the base's compressed bytes held until then, or fetched again | **its own entry**, as a single-layer frame does today | its own entry |
| an ask for exact N, G = 1 | two entries, two decodes if the base is not in hand | **one entry, one decode** | one entry, one partial |

**B, recommended.** It costs the base's bytes a second time — the same order as row PREVIEW's
separate preview — and in exchange
the exact frame needs nothing from its preview: no bytes held across entries, no join, no order
between a frame's two entries, a failure confined to its entry, and the wire, the store's format and
the server unchanged. A carries the same delivery for those bytes and breaks each of those. C moves
the change into the wire and the server for the same delivery, and is structural twice over.

B also settles what row SVCQ left open: **WebCodecs cannot be asked for an operating point, but it
returns the base when fed the base alone and the top when fed the whole unit** (row SVCQ, 8-bit), so
separate entries choose the picture by what is fed, on either decoder. dav1d-WASM decodes the
exact entry at operating point 0 with `all_layers` 0 and the base at operating point 1 (row SVCQ);
whether one decoder at operating point 0 also returns a base fed alone is row SVCDEC's to find
(*it does, as a preview, and then fails the frame:* §6).

### The layout: layer-major

**Entry i < F is frame i's base; entry F + i is frame i's exact unit.** Not interleaved (2i, 2i+1):

* **A bases-first fill is `stream_frames` over the bundle**, in index order: entries 0 … F−1 are
  every base, F … 2F−1 every exact frame. The downloader's one contiguous run (`nextRun`) is
  already that order; nothing in the planner or the server changes. Interleaved would need a
  `request_frames` batch of every even index, which an ask then waits behind ([`WIRE.md`](../WIRE.md)).
* **The bases are contiguous on disk**, so the read-ahead of a bases run reads one small region.
* **The metadata** gains `"layers": 2`; `frameCount` stays the entry count the bundle and
  `pack-study` mean, so the series has `frameCount / layers` frames. Absent means 1: entry = frame,
  and every HTJ2K and single-layer AV1 bundle reads unchanged.
* **Ingest** splits each temporal unit at the first OBU with `spatial_id` > 0 and writes the prefix
  as entry i, the whole unit as entry F + i; `pack-study` itself does not change.

### What each part changes

* **The wire and the server: nothing.** The envelope's `display_index` is the entry index; the
  server serves entries by index as now. The opening ask's `?ask=fill:A-B` names entries.
* **The downloader** maps. The consumer keeps naming frames: `fill([…])` wants entries {i, F + i},
  `requestExactFrame(N)` asks F + N only — an ask is for the exact frame, so its base is not fetched
  for it. Frame N's base leaves the wanted set once N's exact unit is delivered. Groups (§3, G > 1)
  are index arithmetic on `i mod F`: a base group decodes from its base keyframe and an exact group
  from its own, each on one decoder, independent of each other.
* **The decoders.** A base entry decodes to a frame marked `preview: true` with the base's own width
  and height (row SVCDEC's contract); an exact entry decodes as a single-layer frame does.
* **The consumer and the cache.** Pixels go from a decoder to the consumer directly, so it is the
  consumer, not the downloader, that **drops a preview for a frame whose exact pixels it already
  holds** — a base decoded late on a slow decoder must never replace an exact frame on screen. A
  preview is held only until its frame's exact pixels arrive.
* **The ask during a fill.** Unchanged in kind: the ask ends the fill, is served next, and the
  downloader re-issues the rest — the remaining bases, then the exact run.

### Invariants this breaks

1. **An entry is a frame.** The index on the wire, in `frame_error` and in the downloader's records
   is an entry; the frame is `i mod F`. Everything below the consumer must map, and a check that
   compares an entry's pixels against a frame's `.sha256` by index compares the wrong one.
2. **Frames are decoded once.** Every base is decoded twice — alone as a preview, again inside its
   exact unit: 2–13 % of a lossless frame's decode for a half-size base (row SVCQ, dav1d-WASM).
3. **A frame's bytes cross the wire once.** The base's do twice; `wire bytes` per delivery stays
   per entry, and a frame's traffic is the sum of its two.
4. **`frameCount` is the series' frame count.** It stays the entry count; a client reading it as
   frames shows twice the series.
5. **Every delivered frame is exact.** A delivery marked `preview` is not, and is never the last
   delivery for its frame unless the exact unit failed — then the frame fails by name and the preview
   stays marked (row SVCDEC).

Not broken: the envelope, the stream shape, the store's format, the planner, a frame decoding from
its own entry, a failure being one entry, and an ask being one entry at G = 1.

### The smallest arm that measures it

Row SVCQ's streams split by a lab script into layer-major bundles, served by the unchanged server
through row FILL's harness ([`lab/av1/delivery/fill`](../../lab/av1/delivery/fill/README.md)), after row SVCDEC's
decoder and row SVCSHAPE's shape: two arms per series, **single-layer lossless AV1 in frame order**
(today) against **B layer-major, bases first**, on fluoroscopy (dav1d-WASM) and the ultrasound
(WebCodecs and dav1d-WASM), 5/20/50 Mbit/s, 1× and 4×, Williams-ordered. Report the time to every
preview on screen, to every frame exact, and the exact fill's delay against the first arm — every
exact frame against its source's checksum, every preview replaced. The arithmetic it tests: every
base is in after the bases' share of the exact fill's wire time plus a round trip, and the last
exact frame is late by that share.

## 6 · A scalable frame: its base as a preview, then the exact frame, from the same bytes

*Built (row SVCDEC), not timed.* A scalable temporal unit (row SVCQ: a lossy base layer, a lossless
top predicted from it) reaches the page twice through dav1d-WASM: its base as a **preview**, then
its exact frame. One entry, one decode, no wire, store or server change.

**Why dav1d returned the base and then failed (row SVCQ).** dav1d at its default `all_layers` 1
outputs every spatial layer as it decodes it, so `dav1d_get_picture` gives the base while the top's
OBUs are still in the decoder's input. The wrapper took that one picture and returned; the next
unit then found the previous unit's top still queued (`EAGAIN`), took *that* as its picture, and
dropped its own bytes. At G = 1 the flush before each keyframe discarded the top instead, so every
frame came back as its base.

**What changed.**

* `dav1d_wrap.c` gains `av1_next()` (the unit's next picture, or `EAGAIN` when none is left),
  `av1_layer()` (the picture's `spatial_id`) and `av1_top_layer()` (the highest spatial layer of
  operating point 0, from the sequence header's `operating_point_idc`; 0 for a single-layer stream).
  The build is otherwise unchanged (623 146 B).
* `av1-dav1d.js` decodes the unit, and while the picture's layer is below the top it hands that
  picture to a `preview` callback and asks for the next. A single-layer stream's first picture is
  its top, so it decodes as before. A unit that ends below the top fails by name:
  `spatial layer 0 of 1 is the unit's last`.
* `decoder.js` posts a preview to the consumer as a frame message with **`preview: true`**, at the
  base's own `width` and `height`, before the exact frame's message on the same port.
* `consumer.js` hands a preview to **`opts.onPreview`** and never to a waiter: `requestExactFrame`
  resolves with the exact frame only, and `onFrame` receives exact frames only.

**What holds, and why.** A frame's preview and its exact pixels leave one decoder in order on one
port, so a preview always reaches the page before its frame and never after it: nothing in the
consumer has to drop a late one. That stops holding under §5's layout, where a base and its exact
unit are two entries that may reach two decoders; there the consumer must drop a preview for a
frame it already holds exactly. When the top is missing the page has seen the preview, marked, and
the frame fails as any undecodable frame does — at G > 1 the rest of its group with it.

**What §5 asked.** One decoder at operating point 0 *does* return a base fed alone — as a preview —
but then fails the frame, because operating point 0 promises a top. §5's base entry therefore needs
the decoder told that the entry ends at the base (the `layers` in its metadata would say so); not
built.

**Not covered.** WebCodecs (a ≤ 10-bit series at G = 1) returns the top exactly and no preview: it
outputs the highest layer it is fed (row SVCQ). *Row WCBASE:* fed the unit's prefix before the
first OBU with `spatial_id` 1, it returns the base, identical to native dav1d's at operating point 1
([`README.md`](README.md) §Preview); not built. A split series
takes no preview. Three or more spatial layers send every layer below the top as a preview; only two
were made.

**Checked** (the dispatch arm, headless Chromium; units from
[`lab/av1/delivery/scalable/client/make_frames.sh`](../../lab/av1/delivery/scalable/client/make_frames.sh): libaom 3.15.1's
`svc_encoder_rtc`, two spatial layers, a half-size base at q 40, a lossless top, 64×48 grey): a
10-bit G = 1 stream asked frame by frame and a 12-bit G = 8 stream of 20 filled — every exact frame
its source's checksum, at 64×48, never marked; one preview a frame, before it, marked, 32×24, the
same samples native dav1d returns at operating point 1; nothing left on screen as a preview. A unit
with the top's OBUs dropped shows its preview, still marked, and fails by name between two exact
frames. A single-layer G = 8 series sends no preview. The 10-bit stream through WebCodecs: 4 units
reach it, every frame exact, no preview. 18 checks, 199/199; 8 mutations caught 8/8 (a preview
resolving the ask, a preview not marked, no preview, the missing top returning the base, previews
posted after the frame, a preview checksum corrupted, WebCodecs never taken, the wrapper's top layer
read as 0).
