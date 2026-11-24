state: done
started: 2026-11-24T12:47Z
heartbeat: 2026-11-24T13:36Z
by: anen2iBQ
outputs: claude/decode-overlap cfb7c6a04, draft PR 447 into claude/unified
## Resume
Done. Nothing left for this row; DECODE-OVERLAP-MEASURE is next (a session that did not build it).
## Result
Share after frame-out, measured (dbts_b1-q8-g8, headless Chromium, 4-core cloud host, 4 interleaved rounds):
39.1-45.6 % at 1x, 74.3-76.3 % at 4x (the page thread only throttled), over the 10 % bar, so built.
Built: inside a group the next AV1 unit goes to WebCodecs once the last frame is out, one frame in flight; keyframes
wait; a failed read fails the rest of its group by name. Tests mutated (M1-M6, D1, out()); the gate found two of my
bugs (an out-of-order refusal poisoning the next unit; a null in the catch), both fixed.
Function check, the bench and not the view: samples identical; span +3.5 % at 1x (6733 to 6968 ms), -21.5 % at 4x,
an artefact of the throttle idling the thread. The decode and the read slow each other on this host (busy cores
1.14 to 1.98 of 4): a miss against the -14 to -27 % prediction here; the phone not measured.
Gate at cfb7c6a04 green but the decoders' rebuild (Docker Hub 429, not run); absence checks run by hand, OK.
Limits: one series, the bench not the product view, no Firefox, no ultrasound, no phone.
