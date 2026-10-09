# svcdec

The scalable frames the client's dispatch rig decodes (`client/conformance/av1/scalable/`): `make_frames.sh`
encodes them with `lab/av1/delivery/scalable/encoder`'s patched `svc_encoder_rtc`, `units.py` writes each temporal unit and its
checksum. Queue row 24 (SVCDEC) of [`docs/av1/queue.md`](../../../../../docs/av1/queue.md); the client side is
`client/README.md` §A scalable AV1 series.
