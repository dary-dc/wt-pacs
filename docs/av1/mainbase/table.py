"""Conflict instances of the snapshot replay and their resolutions.

An instance is (path, base blob, main blob, branch blob) as `git merge-tree` reports it for one
commit's tree merged onto origin/main with MB as base. The tip's are resolved by hand (`resolution/`);
every other instance is resolved from its own conflict when the branch's side of each hunk only
renamed words (PR #34's side, renamed the same way), else carries the branch's change from its
version to the tip's onto the tip's resolution (a three-way merge), else is resolved by hand.
"""
import json, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from gitobj import cat, write, tree_get, tree_edit
import renamer

HERE = os.path.dirname(os.path.abspath(__file__))
MB = '8407095d17b424a9fc0d655077036045789852ae'
MAIN = 'c7230a982d9ab3f269bebab874f00e1110f0da56'
GONE = ('server/src/transport/frame_out.rs', 'ingest/study-bundle/Cargo.toml')  # PR #34 moved one; the branch the other
RENAMED = {'ingest/study-bundle/src/writer.rs': 'common/series-bundle/src/writer.rs'}
MANUAL_DIR = os.path.join(HERE, 'manual')
_tip_trees = {}


def merge_tree(commit):
    out = subprocess.run(['git', 'merge-tree', '--write-tree', '--merge-base=' + MB, MAIN, commit],
                         capture_output=True, text=True)
    lines = out.stdout.split('\n')
    tree = lines[0]
    inst = {}
    for l in lines[1:]:
        if not l:
            break
        meta, path = l.split('\t', 1)
        mode, sha, stage = meta.split()
        inst.setdefault(path, {})[stage] = sha
    keys = {path: (path, st.get('1'), st.get('2'), st.get('3')) for path, st in inst.items()}
    return tree, keys


def tip_tree(tip):
    """The old tip merged onto main, its 24 conflicts as `resolution/` resolves them."""
    if tip not in _tip_trees:
        tree, _ = merge_tree(tip)
        edits = {p: None for p in GONE}
        root = os.path.join(HERE, 'resolution')
        for d, _, files in os.walk(root):
            for f in files:
                path = os.path.relpath(os.path.join(d, f), root)[:-len('.resolved')]
                mode = (tree_get(tree, path) or ('100644',))[0]
                edits[path] = (mode, write('blob', open(os.path.join(d, f), 'rb').read()))
        _tip_trees[tip] = tree_edit(tree, edits)
    return _tip_trees[tip]


def merge_file(ours, base, theirs):
    with tempfile.TemporaryDirectory() as d:
        fs = []
        for n, sha in (('o', ours), ('b', base), ('t', theirs)):
            p = os.path.join(d, n); open(p, 'wb').write(cat.get(sha)[1]); fs.append(p)
        r = subprocess.run(['git', 'merge-file', '-p', '--diff3', '-L', 'ours', '-L', 'base', '-L', 'theirs'] + fs,
                           capture_output=True)
        return r.returncode, r.stdout


def key_id(k):
    return '%s@%s' % (k[0].replace('/', '_'), (k[3] or 'none')[:10])


def build(commits, tip):
    """Every instance over `commits`; resolutions for each, or a list of the ones still open."""
    _, tip_keys = merge_tree(tip)
    tip_by_path = {k[0]: k for k in tip_keys.values()}
    instances = {}
    for c in commits:
        _, keys = merge_tree(c)
        for k in keys.values():
            instances.setdefault(k, c)
    table, open_ = {}, []
    for k, first in instances.items():
        path = k[0]
        if path == 'server/src/transport/frame_out.rs':
            assert k == tip_by_path[path], k
            table[k] = {'kind': 'frame_out'}
            continue
        if path == 'ingest/study-bundle/Cargo.toml':
            assert k[3] is None, k
            table[k] = {'kind': 'cargo_toml'}
            continue
        manual = os.path.join(MANUAL_DIR, key_id(k))
        if os.path.exists(manual):
            table[k] = {'kind': 'blob', 'sha': write('blob', open(manual, 'rb').read()), 'how': 'manual'}
            continue
        tpath = RENAMED.get(path, path)
        res = tree_get(tip_tree(tip), tpath)[1]
        if k in tip_keys.values():
            table[k] = {'kind': 'blob', 'sha': res, 'how': 'tip'}
            continue
        rc, conflicted = merge_file(k[2], k[1], k[3])
        resolved, left = renamer.resolve(conflicted.decode())
        if not left:
            table[k] = {'kind': 'blob', 'sha': write('blob', resolved.encode()), 'how': 'renames'}
            continue
        tk = tip_by_path[tpath]
        rc, out = merge_file(res, tk[3], k[3])
        if rc == 0:
            table[k] = {'kind': 'blob', 'sha': write('blob', out), 'how': 'carried from the tip'}
        else:
            open_.append((k, first, out))
    return instances, table, open_
