#!/usr/bin/env python3
"""Every hash token left naming a replaced commit, in the given tips' trees and their commit messages.

  python3 docs/av1/rehash_check.py MAP TIP... [--since BASE]

MAP is rehash-map.tsv (old <tab> new). A 7-40 hex token is printed when it is the prefix of exactly
one commit, that commit is an old one in MAP, and no new commit shares the prefix: a reference
the replay did not carry. Messages are read for every commit reachable from a TIP and not from
BASE (default origin/main). Prints nothing and exits 0 when every reference follows.
"""
import bisect, re, subprocess, sys

TOKEN = re.compile(rb'(?<![0-9A-Za-z_])[0-9a-f]{7,40}(?![0-9A-Za-z_])')
SKIP = {'docs/av1/rehash-map.tsv', 'docs/cloud-queue.md'}  # the map itself; another queue's record


def git(*a):
    return subprocess.check_output(('git',) + a)


def main(argv):
    base = 'origin/main'
    if '--since' in argv:
        i = argv.index('--since'); base = argv[i + 1]; del argv[i:i + 2]
    mp, tips = argv[0], argv[1:]
    old = dict(l.split('\t') for l in open(mp).read().split('\n') if l)
    new = set(old.values())
    commits = sorted(set(git('rev-list', '--all').decode().split()) | set(old) | new)

    def stale(tok):
        t = tok.decode()
        i = bisect.bisect_left(commits, t)
        hits = []
        while i < len(commits) and commits[i].startswith(t):
            hits.append(commits[i]); i += 1
        return len(hits) == 1 and hits[0] in old

    cat = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def read(sha):
        cat.stdin.write(sha.encode() + b'\n'); cat.stdin.flush()
        size = int(cat.stdout.readline().split()[2])
        data = cat.stdout.read(size); cat.stdout.read(1)
        return data

    found = 0
    for tip in tips:
        for line in git('ls-tree', '-r', tip).decode().split('\n'):
            if not line:
                continue
            meta, path = line.split('\t', 1)
            mode, typ, sha = meta.split()
            if typ != 'blob' or mode == '120000' or path in SKIP:
                continue
            data = read(sha)
            if b'\0' in data[:8000]:
                continue
            for n, text in enumerate(data.split(b'\n'), 1):
                for m in TOKEN.finditer(text):
                    if stale(m.group(0)):
                        print('%s:%s:%d: %s' % (tip, path, n, m.group(0).decode())); found += 1
    for c in git('rev-list', *tips, '^' + base).decode().split():
        msg = read(c).partition(b'\n\n')[2]
        for m in TOKEN.finditer(msg):
            if stale(m.group(0)):
                print('%s (message): %s' % (c, m.group(0).decode())); found += 1
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
