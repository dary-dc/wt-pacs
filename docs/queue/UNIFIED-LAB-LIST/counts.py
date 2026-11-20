"""Each lab/ directory's non-blank code and other lines, and the files outside lab/ naming it: counts.py TREE."""
import collections, os, re, subprocess, sys

os.chdir(sys.argv[1])
files = [f for f in subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split("\n") if os.path.isfile(f)]
CODE = (".rs", ".js", ".mjs", ".ts", ".py", ".sh", ".html", ".css", ".go", ".c", ".h", ".toml")


def nonblank(f):
    d = open(f, "rb").read()
    return None if b"\0" in d[:8000] else sum(1 for line in d.split(b"\n") if line.strip())


dirs = sorted({f.split("/")[1] for f in files if f.startswith("lab/") and f.count("/") >= 2})
code, other = collections.Counter(), collections.Counter()
for f in files:
    if f.startswith("lab/") and f.count("/") >= 2:
        n = nonblank(f)
        if n is not None:
            (code if f.endswith(CODE) else other)[f.split("/")[1]] += n
docs = collections.Counter()
for f in files:
    if f.startswith("lab/") or not (f.startswith("docs/") or f.endswith(".md")):
        continue
    for d in set(re.findall(r"lab/([\w.-]+)", open(f, errors="replace").read())):
        docs[d] += 1
print("dir\tcode\tother\tdocs")
for d in dirs:
    print(f"{d}\t{code[d]}\t{other[d]}\t{docs[d]}")
print(f"total\t{sum(code.values())}\t{sum(other.values())}\t")
