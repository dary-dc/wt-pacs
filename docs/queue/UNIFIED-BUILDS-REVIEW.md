state: started
started: 2026-11-22T15:17Z
heartbeat: 2026-11-22T15:21Z
outputs: findings in the bodies of PRs 423, 424, 425
## Resume
PR 425 checked (findings not yet written to its body): tag 0.33.0 = 345a8bcd (ls-remote); commit quotes match
upstream's diff; built/ matches manifest; 80 frames encoded by upstream 0.33.0 ojph_compress (10 sizes, odd
heights, 8/10/12/16 bits, blocks 32/64, 5 levels RPCL reversible) decode identically under both builds and equal
their raw input; node decode-time ratio new/old over 6 interleaved pairs 0.80-1.24, median ~0.99 (unresolved).
PR 424: lock (name,version) sets checked, no version added or moved. Next: 423's mutants and default build;
424's gate lab step and its mutant; then a test merge of all three into claude/unified; then the PR bodies.
Worktrees /home/user/r-<branch>; scratch harness in the session scratchpad (h/dec.mjs).
## Result
