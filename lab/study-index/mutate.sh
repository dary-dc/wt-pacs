#!/usr/bin/env bash
# Each mutation breaks one rule on purpose; the tests must fail on every one. Needs SI_TEST_MYSQL (README §Checks).
set -euo pipefail
cd "$(dirname "$0")"
: "${SI_TEST_MYSQL:?}"

mutate() {
  local file=$1 from=$2 to=$3 what=$4
  cp "$file" "$file.orig"
  python3 - "$file" "$from" "$to" <<'EOF'
import sys
path, old, new = sys.argv[1:]
s = open(path).read()
assert s.count(old) == 1, f"{old!r} not unique in {path}"
open(path, "w").write(s.replace(old, new))
EOF
  if cargo test --release -q -- --test-threads 1 >/dev/null 2>&1; then
    echo "SURVIVED: $what"; status=1
  else
    echo "caught: $what"
  fi
  mv "$file.orig" "$file"
}

status=0
mutate src/index.rs 's >= r.revision' 's > r.revision' "an equal revision re-applied"
mutate src/index.rs 'stored.is_some_and(|s| s >= r.revision)' 'stored.is_some_and(|_| false)' "no revision check"
mutate src/index.rs 'tx.exec_drop("DELETE FROM series WHERE study_uid = ?", (r.uid.as_str(),)).await?;' '' "series not replaced whole"
mutate src/receiver.rs 'tx.execute("INSERT INTO outbox VALUES (?1)", params![s.revision as i64])?;' '' "no outbox row in the receiver commit"
mutate src/receiver.rs 'DELETE FROM outbox WHERE revision <= ?1' 'DELETE FROM outbox WHERE revision < ?1' "outbox row kept after publish"
mutate src/receiver.rs 'index::remove(pool, uid).await?;
        out.removed' 'out.removed' "orphans left by reconcile"
mutate src/receiver.rs '        remove_files(path);
    } else {' '    } else {' "tombstoned file kept"
mutate src/query.rs "'*' => \"%\".to_string()," "'*' => \"\".to_string()," "wild card dropped"
mutate src/query.rs "'ñ' | 'Ñ' => 'n'," "'Ñ' => 'n'," "check's accent folding broken"
exit $status
