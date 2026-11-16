#!/bin/sh
# Reproduces prs.tsv: every open PR's head against claude/unified. Needs prs.json (number, title) from the search API.
set -e
git fetch -q origin '+refs/pull/*/head:refs/remotes/pr/*'
U=$(git rev-parse origin/claude/unified)
python3 - "$U" <<'PY'
import json, subprocess as sp, sys
u = sys.argv[1]
for p in sorted(json.load(open("prs.json")), key=lambda p: -p["n"]):
    h = sp.run(["git", "rev-parse", "refs/remotes/pr/%d" % p["n"]], capture_output=True, text=True).stdout.strip()
    anc = sp.run(["git", "merge-base", "--is-ancestor", h, u]).returncode == 0
    ahead = sp.run(["git", "rev-list", "--count", u + ".." + h], capture_output=True, text=True).stdout.strip()
    plus = sum(l.startswith("+") for l in sp.run(["git", "cherry", u, h], capture_output=True, text=True).stdout.split("\n"))
    print(p["n"], h[:10], "carried" if anc else "no", ahead, plus, sep="\t")
PY
