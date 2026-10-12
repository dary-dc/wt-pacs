"""Commit a tree change onto a replayed tip, its blobs' hash tokens carried by the map.

stack.py MAP PARENT FROM_TREE TO_TREE MESSAGE_FILE  -> prints the new commit
The change is FROM_TREE -> TO_TREE (paths added, changed or removed), applied to PARENT's tree.
"""
import bisect, re, subprocess, sys, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gitobj import cat, write, tree_get, tree_edit

TOKEN = re.compile(rb'(?<![0-9A-Za-z_])[0-9a-f]{7,40}(?![0-9A-Za-z_])')
IDENT = b'dary-dc <crespoydelgado@gmail.com>'

mp, parent, frm, to, msgf = sys.argv[1:6]
old = dict(l.split('\t') for l in open(mp).read().split('\n') if l)
commits = sorted(set(subprocess.check_output(['git', 'rev-list', '--all'], text=True).split()) | set(old) | set(old.values()))


def carry(data):
    def f(m):
        t = m.group(0).decode()
        i = bisect.bisect_left(commits, t); hits = []
        while i < len(commits) and commits[i].startswith(t):
            hits.append(commits[i]); i += 1
        return old[hits[0]][:len(t)].encode() if len(hits) == 1 and hits[0] in old else m.group(0)
    return TOKEN.sub(f, data)


edits = {}
for l in subprocess.check_output(['git', 'diff', '--name-status', '--no-renames', frm, to], text=True).split('\n'):
    if not l:
        continue
    st, path = l.split('\t', 1)
    if st == 'D':
        edits[path] = None
    else:
        mode, sha = tree_get(to, path)
        edits[path] = (mode, write('blob', carry(cat.get(sha)[1])))
ptree = cat.get(parent)[1].split(b'\n')[0][5:].decode()
tree = tree_edit(ptree, edits)
stamp = b'%d +0000' % int(time.time())
body = b'tree %s\nparent %s\nauthor %s %s\ncommitter %s %s\n\n' % (tree.encode(), parent.encode(), IDENT, stamp, IDENT, stamp)
print(write('commit', body + open(msgf, 'rb').read()))
