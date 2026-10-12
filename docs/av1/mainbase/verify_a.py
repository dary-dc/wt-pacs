"""(a): old tip against replayed tip, outside PR #34's files, differs only by hash replacements.

verify_a.py MAP OLD_TIP NEW_TIP  — prints each differing path and whether the map explains it.
"""
import bisect, re, subprocess, sys

TOKEN = re.compile(rb'(?<![0-9A-Za-z_])[0-9a-f]{7,40}(?![0-9A-Za-z_])')
MB, MAIN = '8407095d17b424a9fc0d655077036045789852ae', 'c7230a982d9ab3f269bebab874f00e1110f0da56'


def git(*a):
    return subprocess.check_output(('git',) + a)


mp, old_tip, new_tip = sys.argv[1:4]
old = dict(l.split('\t') for l in open(mp).read().split('\n') if l)
commits = sorted(set(git('rev-list', '--all').decode().split()) | set(old) | set(old.values()))
pr34 = set(git('diff', '--name-only', '--find-renames', MB, MAIN).decode().split())
# PR #34's paths under the names the branch gave them.
renames = {}
for l in git('diff', '--name-status', '-M', MB, old_tip).decode().split('\n'):
    p = l.split('\t')
    if p[0].startswith('R'):
        renames[p[1]] = p[2]
renames.setdefault('ingest/study-bundle/Cargo.toml', 'common/series-bundle/Cargo.toml')  # renamed and rewritten, so not paired
pr34 |= {renames.get(p, p) for p in pr34}


new = set(old.values())


def full(data, side):
    """Every token naming one replaced (side 'old') or replayed (side 'new') commit, written in full."""
    def f(m):
        t = m.group(0).decode()
        i = bisect.bisect_left(commits, t); hits = []
        while i < len(commits) and commits[i].startswith(t):
            hits.append(commits[i]); i += 1
        if len(hits) == 1 and side == 'old' and hits[0] in old:
            return old[hits[0]].encode()
        if len(hits) == 1 and side == 'new' and hits[0] in new:
            return hits[0].encode()
        return m.group(0)
    return TOKEN.sub(f, data)


bad = explained = 0
for l in git('diff', '--name-status', '--no-renames', old_tip, new_tip).decode().split('\n'):
    if not l:
        continue
    st, path = l.split('\t', 1)
    if path in pr34:
        continue
    if st != 'M':
        print('NOT EXPLAINED', st, path); bad += 1; continue
    a = git('show', '%s:%s' % (old_tip, path)); b = git('show', '%s:%s' % (new_tip, path))
    if path == 'docs/cloud-queue.md' or full(a, 'old') != full(b, 'new'):
        print('NOT EXPLAINED', path); bad += 1
    else:
        explained += 1
print('%d paths outside PR #34 differ, each only by hash replacements; %d not explained' % (explained, bad))
sys.exit(1 if bad else 0)
