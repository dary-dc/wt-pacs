"""The per-file section of MAINBASE.md: each of PR #34's files, kept or changed, each hunk's commit.

report_files.py NEW_TIP > section.md
"""
import re, subprocess, sys

MB, MAIN = '8407095d17b424a9fc0d655077036045789852ae', 'c7230a982d9ab3f269bebab874f00e1110f0da56'
tip = sys.argv[1]


def git(*a):
    return subprocess.check_output(('git',) + a, text=True, errors='replace')


in_range = set(git('rev-list', MAIN + '..' + tip).split())
subject = {}


def subj(c):
    if c not in subject:
        s = git('log', '-1', '--format=%s', c).strip()
        subject[c] = s if len(s) <= 140 else s[:137].rsplit(' ', 1)[0] + ' …'
    return subject[c]


pr34 = [l.split('\t') for l in git('diff', '--name-status', MB, MAIN).strip().split('\n')]
# where each of PR #34's paths lives on the new tip
moved = {}
for l in git('diff', '--name-status', '-M', MAIN, tip).strip().split('\n'):
    p = l.split('\t')
    if p[0].startswith('R'):
        moved[p[1]] = p[2]
moved.setdefault('ingest/study-bundle/Cargo.toml', 'common/series-bundle/Cargo.toml')


def exists(rev, path):
    return subprocess.run(['git', 'cat-file', '-e', '%s:%s' % (rev, path)], capture_output=True).returncode == 0


def blame(path, start, count):
    out = git('blame', '--porcelain', '-L', '%d,+%d' % (start, count), tip, '--', path)
    return {l.split()[0] for l in out.split('\n') if re.match(r'^[0-9a-f]{40} \d+ \d+', l)}


def removed_by(path, line):
    if not line.strip():
        return set()
    out = git('log', '--format=%H', '-S', line, MAIN + '..' + tip, '--', path).split()
    return set(out[-1:])


print('| PR #34 | on the new tip | |')
print('| --- | --- | --- |')
rows, details = [], []
for st, path in pr34:
    new = moved.get(path, path)
    if st == 'D' or not exists(tip, new):
        same = not exists(tip, new) and st == 'D'
        rows.append((path, '—', 'deleted, as `main` has it' if same else 'deleted by the branch (see §The conflicts)'))
        continue
    diff = git('diff', '-U0', MAIN, tip, '--', path, new) if new != path else git('diff', '-U0', MAIN, tip, '--', path)
    if not diff.strip():
        rows.append((path, '`%s`' % new if new != path else 'same path', 'as `main` has it'))
        continue
    hunks = re.findall(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', diff, re.M)
    blocks = re.split(r'^@@ .*$', diff, flags=re.M)[1:]
    rows.append((path, '`%s`' % new if new != path else 'same path', 'changed by the branch, %d hunk%s' % (len(hunks), '' if len(hunks) == 1 else 's')))
    lines = ['* `%s`%s' % (path, ' → `%s`' % new if new != path else '')]
    groups = {}
    for (a, b, c, d), body in zip(hunks, blocks):
        b = 1 if b == '' else int(b); d = 1 if d == '' else int(d)
        cs = blame(new, int(c), d) if d else set()
        if not d:
            gone = '\n'.join(l[1:] for l in body.split('\n') if l.startswith('-'))
            cs = removed_by(new, gone) or removed_by(path, gone)
        key = tuple(sorted(x for x in cs if x in in_range))
        groups.setdefault(key, []).append('+%s' % c if d else '−%s' % a)
    for key, at in groups.items():
        who = '; '.join('`%s` %s' % (x[:8], subj(x)) for x in key) or 'the resolution (§The conflicts)'
        lines.append('  * %s: %s' % (', '.join(at), who))
    details.append('\n'.join(lines))
for path, where, how in rows:
    print('| `%s` | %s | %s |' % (path if exists(tip, path) else MAIN[:7] + ':' + path, where, how))
print()
print('\n'.join(details))
