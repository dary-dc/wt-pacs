#!/usr/bin/env bash
# Each mutation breaks one rule on purpose; the tests must fail on every one. Needs SI_TEST_MYSQL, and for the
# engines' mutations SI_TEST_PG and SI_TEST_SQLITE (README §Run (§Engines)).
set -euo pipefail
cd "$(dirname "$0")"
: "${SI_TEST_MYSQL:?}" "${SI_TEST_PG:?}" "${SI_TEST_SQLITE:?}"

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
mutate src/pg.rs 's as u64 >= r.revision' 's as u64 > r.revision' "PostgreSQL: an equal revision re-applied"
mutate src/pg.rs 'run("DELETE FROM series WHERE study_uid = ?".into(), vec![r.uid.as_str().into()]).await?;' '' "PostgreSQL: series not replaced whole"
mutate src/lite.rs 's as u64 >= r.revision' 's as u64 > r.revision' "SQLite: an equal revision re-applied"
mutate src/lite.rs 'tx.prepare_cached("DELETE FROM series WHERE study_uid = ?1")?.execute([&r.uid])?;' '' "SQLite: series not replaced whole"
mutate pg.sql "lower(public.unaccent('public.unaccent'::regdictionary, \$1))" 'lower($1)' "PostgreSQL: accents not folded"
mutate src/query.rs '< pn_fold(?) || chr(1114111)' '< pn_fold(?)' "PostgreSQL: the prefix range empty"
mutate src/lite.rs 's.nfd().filter(|c| !is_combining_mark(*c))' 's.nfd()' "SQLite: accents not folded"
mutate src/lite.rs 'params.push(P::Text(pn_key(&r.patient_name)));' 'params.push(P::Text(r.patient_name.clone()));' "SQLite: name_key not folded on publish"
mutate src/query.rs 'format!("{literal}\u{10FFFF}")' 'literal.clone()' "SQLite: the prefix range empty"
exit $status
