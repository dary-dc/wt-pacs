# T4 — Bytes per displayed frame: prefix delivery, rungs, stride

**Status:** open, product · **Needs:** the viewer's decoder, the cloud rig · **Size:** weeks; the
prototype cell is one rig day

## Question

On a 20 Mbps link a 250 KB frame is 100 ms of wire, and nothing below the wire moves that. The
levers above it are the ones [`../transport/transport-conclusions.md` §4](../transport/transport-conclusions.md)
names: a truncated HTJ2K codestream is a viewable image (progressive delivery), a lower
resolution rung is fewer bytes, and stride skips frames a fast reader would never see
([`../adr-stride-is-bandwidth-conservation.md`](../adr-stride-is-bandwidth-conservation.md)).
None is a transport change, and each needs the render path to accept less than the whole
frame.

## Decision rule

Prototype cell at 20 Mbit / 50 ms on the rig, 250 KB frames: time from ask to a viewable image
with a prefix of 25 % of the codestream against the whole frame. Apply prefix delivery if it
is at least 2× faster to first viewable and the viewer accepts the prefix as an image; then
the full frame follows on the same stream. The rung and stride decisions follow from the same
number at their own byte counts.

## Steps

1. **What a prefix is worth.** With the viewer's decoder, decode the fixture frames truncated
   at 10 / 25 / 50 % and record which truncations decode to an image and at what quality —
   the codestream's progression order decides this, and the packer sets it.
2. **Wire.** A prefix ask is `RequestFrame` plus a byte or rung bound, and the server serves
   the prefix then the rest; on a shared stream the rest queues behind later prefixes, so this
   is the transport piece of T3: on a per-frame stream the rest is the same stream's tail, and
   `RESET_STREAM_AT` (reliable partial reset, required by the draft; quinn and wtransport do
   not carry it yet, Chromium's version to check) is how the server abandons a tail the reader
   has moved past.
3. **Prototype** the prefix ask on the branch, no default change, and run the cell above.
4. **Stride** keeps its own design record outside this repository; the cell's number is the
   input it was waiting for.

## Report

Per truncation: decodes yes/no, bytes, time to viewable at 20 Mbit; the reading in
`transport-conclusions.md` §4.

## Stop conditions

No truncation of the packed fixtures decodes — then the packer's progression order is the
first change, not the transport.
