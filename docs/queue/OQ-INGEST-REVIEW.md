state: started
started: 2026-11-14T23:09Z
heartbeat: 2026-11-14T23:13Z
outputs: claude/oq-ingest (findings in PR #390's body)
## Resume
Built (ingest/tools.sh into /home/user/oqi/ingest/.build, .venv). cargo test -p from-parser 11 ok; same_test.py 4 ok.
Flag off vs claude/unified-client's from-parser (e5b20cba) on same_test's six synthetic sets at --jobs 2: same bundle
bytes, files, stdout and exit code; with the flag the exact bundle is unchanged. Next: own mutants (sed on a copy,
cargo test + same_test.py), the PR body's distinction, findings into PR #390's body, status done.
## Result
