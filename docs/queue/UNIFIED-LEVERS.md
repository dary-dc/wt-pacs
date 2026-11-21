state: done
started: 2026-11-21T11:17Z
heartbeat: 2026-11-21T12:03Z
outputs: claude/lab-levers-one-field 010eb2c94, fc5618d81, f179beb99, 78215e1c1; draft PR 423 into claude/unified
## Resume
Done. Nothing left; UNIFIED-BUILDS-REVIEW reviews PR 423 (a session whose commits are not these).
## Result
Sessions::new's five lab-lever cfg pairs become one line under lab-levers, `config.lab.onto(sessions)`; cfg(not(lab-levers)) in server/src 6 -> 1, net -10 lines.
Departure from the brief: one always-compiled `lab: LabLevers` field (010eb2c94) failed the gate, since check_telemetry_absent.sh found a lever's flag in the default binary; fc5618d81 keeps lab_levers.rs feature-only.
Default build unchanged: tests 153/160 (lab-levers)/156 (telemetry) green and unchanged; served bytes identical to 4a2b4277f's (native-fill, every frame checked, us_cine_smoke and queue_large, interleaved twice; small tracked fixtures, loopback); banner and --help identical; binary same size, bytes differ.
Mutants: 5 of 6 killed; M5 (--advise-tile-names through Sessions) survives, as on the base: no test reaches it.
Gate: scripts/gate.sh OK at fc5618d81, 58 steps; skips named in PR 423.
For the owner: whether the never-adopted --advise-tile-names lever gets a test, or nothing (the review may ask).
