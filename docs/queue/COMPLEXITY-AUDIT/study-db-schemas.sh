#!/usr/bin/env bash
# study-db-schemas.sh UNIFIED_WORKTREE PACS_VERIFY_BIN: a study.db in the receiver's schema, read by pacs-verify
set -euo pipefail
D=$(mktemp -d); mkdir "$D/study"
python3 - "$D/study/study.db" "$1/ingest/receiver/src/study_db.rs" <<'PY'
import re, sqlite3, sys
schema = re.search(r'const SCHEMA: &str = "(.*?)";', open(sys.argv[2]).read(), re.S).group(1)
c = sqlite3.connect(sys.argv[1]); c.executescript(schema)
c.execute("INSERT INTO series VALUES ('1A', '1A', '0123456789abcdef', ?)", (b'group',)); c.commit()
PY
"$2" "$D" || true
