# decode-bench

What decoding costs in memory. `docs/decode/README.md` says why that is the question.

```bash
lab/decode-bench/fetch_decoder.sh                 # decoder from npm, pinned; not committed
lab/scripts/gen_htj2k_fixtures.sh c512 g2048      # synthetic frames, encoded from source
node lab/decode-bench/decode_bench.mjs lab/fixtures/decode_c512
```

The bench runs 1..4 decoder instances over one fixture set, dealing frames round-robin, and
reports total heap, per-instance heap, and serial ms/frame. It is **serial by design**: the claim
is memory, and a parallel arm would turn it into a throughput claim as well.

Round 0 warms up and builds the pixel oracle; later rounds are timed and every frame is checked
against it. Arm order rotates each round.

**None of these three scripts has been run.** They were written with no `node` on the machine that
wrote them. Validate each before trusting a number, and fix rather than work around.

Two things the bench does not answer: what a threaded build would cost (one instance with N
threads against N instances, the real question), and anything about a phone.
