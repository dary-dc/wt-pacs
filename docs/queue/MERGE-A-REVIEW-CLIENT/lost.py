#!/usr/bin/env python3
"""lost.py: per merge, per conflicted file, the branch's added lines (vs the merge base) absent from the merge result,
and of those, absent from every tracked text file of the final tip (lost from the tree, not moved)."""
import subprocess, sys, collections
W = "/home/user/mac"
def g(*a): return subprocess.run(["git", "-C", W, *a], capture_output=True, text=True, errors="replace").stdout
tip = "HEAD"
final = set()
for f in g("ls-files").split("\n"):
    if f.endswith((".md", ".html", ".txt", ".py", ".js", ".mjs", ".sh", ".rs", ".ts")):
        try: final.update(l.strip() for l in open(f"{W}/{f}", errors="replace"))
        except (IsADirectoryError, FileNotFoundError): pass
tot = collections.Counter()
for line in g("log", "--first-parent", "--reverse", "--format=%H %P %s", "e5b20cba8d..HEAD").splitlines():
    c, p1, *rest = line.split(" ")
    if not rest or len(rest[0]) != 40 or "-s ours" in line: continue
    p2 = rest[0]; mb = g("merge-base", p1, p2).strip()
    out = g("merge-tree", "--write-tree", "--name-only", p1, p2).split("\n\n")[0].splitlines()[1:]
    for f in sorted(set(out)):
        res = set(l.strip() for l in g("show", f"{c}:{f}").splitlines())
        added = [l[1:].strip() for l in g("diff", "-U0", mb, p2, "--", f).splitlines() if l.startswith("+") and not l.startswith("+++") and l[1:].strip()]
        lost = [l for l in added if l not in res]
        gone = [l for l in lost if l not in final and len(l) > 3]
        if lost:
            print(f"{c[:8]} {f} branch-added={len(added)} not-in-result={len(lost)} not-in-final-tree={len(gone)}")
            for l in gone[:3]: print("     -", l[:150])
        tot["added"] += len(added); tot["lost"] += len(lost); tot["gone"] += len(gone)
print("TOTAL", dict(tot))
