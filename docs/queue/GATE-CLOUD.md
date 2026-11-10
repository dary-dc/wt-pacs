state: started
started: 2026-11-10 04:21
heartbeat: 2026-11-10 04:40
outputs: claude/gate-cloud (not yet pushed)
## Resume
Traced (main 017a3ca6): the 7 "exact … undefined" FAILs are dispatch-rig checks (client/contract/dispatch-rig.ts
aFrameSaysWhetherItIsExact) run on "the package" decoder; with digests set, client/decode/decoder.js init() calls
xxh3.js hasher() = builtWasm("xxh3"), which needs client/decode/wasm/built/xxh3 from build.sh (docker). Without it
init fails, no frame arrives, info is undefined. So: the rig does not skip by name what needs the build (the gate's
documented promise), and a fresh cloud session has no docker daemon running.
Next: (1) start dockerd (`dockerd >/tmp/dockerd.log 2>&1 &`), run client/decode/wasm/build/build.sh; (2) on
claude/gate-cloud from main: rig skips the frame check by name without built/xxh3 (failing check first);
(3) one setup script scripts/cloud_setup.sh or README lines; (4) full gate on main and claude/oq-depth-cut.
## Result
