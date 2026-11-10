state: started
started: 2026-11-10 10:35
heartbeat: 2026-11-10 11:17
outputs: claude/core-next, draft PR #351 into claude/core
## Resume
Order: plan.md's (demo branches before the M3 merges), not coordination Open 2's.
Done on claude/core-next (pushed), draft PR #351: 09936066 gate.yml; 23bdcd59 core-ci-deploy; c6d62c24 core-int8;
08ee83b7 core-int8-fixes; 87ffecea oq-ingest; 63bf6a22 oq-ingest-fixes; 1c6feddd oq-client-fixes;
83df82ee oq-depth-cut; 92e907ef oq-depth-cut-fixes; d8ac61ae demo-e2e; cfaa6818 phone-setup; 3bbaf011
phone-setup-fixes; f059cc05 phone-pair; 257a73e5 README §Demo phone; ef392e21 #289; d200e57b #299; 67de3166 #302;
3ce7c3d8 av1-unified-mainbase; 9c286a31 main; a82d12f7 line files; 9e0901be glossary + rename.
Gate: full GATE OK on 9e0901be (773 s) and on 257a73e5 (526 s). CI #351: gate green, deploy red (settle.js missing
from deploy/web-files.sh, from #289; reproduced locally; fixed in 3ddc0aed, reproduced before and passing after; CI on it running).
Next (was): full scripts/gate.sh on the tip (decoders built, ingest/tools.sh built); gate at 257a73e5; CI on #351 green;
PR body = merge record (draft in /tmp is lost on restart: rebuild from `git log --first-parent`).
## Result
