# frames_500x250k

Synthetic SBND: 500 frames × 250000 bytes. Lab only.

Exists to test a falsifiable prediction of the retransmit-deferral mechanism in
`docs/transport/transport-conclusions.md` §2: the per-frame penalty is "wait behind up to D-1 whole
frames", so it should scale with frame size. At 64 KB, depth 8, 20 Mbps that is
7 x 64000 x 8 / 20e6 = 179 ms; at 250 KB it is 700 ms. If the measured penalty does not
grow accordingly, the mechanism is wrong and the stream-shape conclusion needs revisiting.

250 KB is also the realistic figure: `transport-optimization-spec.md` uses it for a CT
slice throughout, against the 64 KB the campaigns actually ran.

Regenerate: FRAMES=500 gen_one 250000 frames_500x250k  (lab/scripts/gen_tf_fixtures.sh)
