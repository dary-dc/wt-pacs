"""Replay claude/av1-unified onto origin/main and re-author both AV1 branches, hashes following.

Usage: replay.py OLD_UNIFIED_TIP OLD_AV1_TIP OUT_DIR
Writes OUT_DIR/map.tsv (old -> new for every replaced commit), OUT_DIR/refs.tsv (every token
rewritten: commit, where, old, new), OUT_DIR/late.tsv (tokens naming a commit not yet replayed)
and OUT_DIR/tips (the new tips).
"""
import bisect, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gitobj import cat, write, parse_tree, make_tree, tree_get, tree_edit
import table as T

IDENT = b'dary-dc <crespoydelgado@gmail.com>'
KEEP_PATHS = {'docs/cloud-queue.md'}  # another queue's record: never edited here
TOKEN = re.compile(rb'(?<![0-9A-Za-z_])[0-9a-f]{7,40}(?![0-9A-Za-z_])')


def git(*a):
    return subprocess.check_output(('git',) + a, text=True)


old_unified, old_av1, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
order = git('rev-list', '--date-order', '--reverse', old_unified, old_av1, '^' + T.MAIN).split()
OLD = set(order)
D = set(git('rev-list', '--ancestry-path', T.MB + '..' + old_unified).split())
ALL = sorted(set(git('rev-list', '--all').split()) | OLD)
mapping = {T.MB: T.MAIN}
refs, late = [], []


def unique_len(sha, n, pool):
    while True:
        p = sha[:n]
        i = bisect.bisect_left(pool, p)
        hits = 0
        while i < len(pool) and pool[i].startswith(p):
            hits += 1; i += 1
        if hits <= 1:
            return n
        n += 1


new_shas = []


def rewrite(data, where, commit):
    def f(m):
        t = m.group(0).decode()
        i = bisect.bisect_left(ALL, t)
        hits = []
        while i < len(ALL) and ALL[i].startswith(t):
            hits.append(ALL[i]); i += 1
        if len(hits) != 1 or hits[0] not in OLD:
            return m.group(0)
        old = hits[0]
        if old not in mapping:
            late.append((commit, where, t))
            return m.group(0)
        new = mapping[old]
        n = max(unique_len(new, len(t), ALL), unique_len(new, len(t), new_shas))
        refs.append((commit, where, t, new[:n]))
        return new[:n].encode()
    return TOKEN.sub(f, data)


blob_memo, tree_memo = {}, {}


def h_blob(sha, path, commit):
    if path in KEEP_PATHS:
        return sha
    if sha in blob_memo:
        return blob_memo[sha]
    data = cat.get(sha)[1]
    if b'\0' in data[:8000]:
        blob_memo[sha] = sha
        return sha
    new = rewrite(data, path, commit)
    r = write('blob', new) if new != data else sha
    blob_memo[sha] = r
    return r


def h_tree(sha, prefix, commit):
    key = (sha, prefix)
    if key in tree_memo:
        return tree_memo[key]
    ents = []
    for mode, name, s in parse_tree(cat.get(sha)[1]):
        p = prefix + name.decode()
        if mode == '40000':
            s = h_tree(s, p + '/', commit)
        elif mode in ('100644', '100755'):
            s = h_blob(s, p, commit)
        ents.append((mode, name, s))
    r = write('tree', make_tree(ents))
    tree_memo[key] = r
    return r


def resolved_tree(commit, table):
    tree, keys = T.merge_tree(commit)
    edits = {}
    for path, k in keys.items():
        r = table[k]
        if r['kind'] == 'blob':
            mode = tree_get(tree, path)[0] if tree_get(tree, path) else '100644'
            edits[path] = (mode, r['sha'])
        elif r['kind'] == 'frame_out':
            edits[path] = None
            edits['server/src/transport/link.rs'] = tree_get(T.tip_tree(old_unified), 'server/src/transport/link.rs')
        elif r['kind'] == 'cargo_toml':
            edits[path] = None
            target = 'common/series-bundle/Cargo.toml'
            mode, s = tree_get(tree, target)
            data = cat.get(s)[1]
            dep = b'frame-envelope = { path = "../frame-envelope" }\n'
            if dep not in data:
                data = data.rstrip(b'\n') + b'\n' + dep
            edits[target] = (mode, write('blob', data))
    return tree_edit(tree, edits) if edits else tree


def commit_obj(old, tree, parents, message=None):
    data = cat.get(old)[1]
    head, _, msg = data.partition(b'\n\n')
    lines, extra = head.split(b'\n'), []
    author = committer = None
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith(b'author '):
            author = l[7:]
        elif l.startswith(b'committer '):
            committer = l[10:]
        elif l.startswith(b'encoding '):
            extra.append(l)
        elif l.startswith((b'gpgsig', b'mergetag')):
            while i + 1 < len(lines) and lines[i + 1].startswith(b' '):
                i += 1
        i += 1
    date = lambda who: who[who.rindex(b'>') + 2:]
    body = [b'tree ' + tree.encode()] + [b'parent ' + p.encode() for p in parents]
    body += [b'author ' + IDENT + b' ' + date(author), b'committer ' + IDENT + b' ' + date(committer)] + extra
    m = message if message is not None else rewrite(msg, '(message)', old)
    return write('commit', b'\n'.join(body) + b'\n\n' + m)


def old_parents(c):
    return [l[7:].decode() for l in cat.get(c)[1].split(b'\n\n')[0].split(b'\n') if l.startswith(b'parent ')]


if __name__ == '__main__':
    commits = [c for c in order if c in D]
    _, table, open_ = T.build(commits, old_unified)
    assert not open_, open_
    for n, c in enumerate(order):
        old_tree = cat.get(c)[1].split(b'\n')[0][5:].decode()
        base = resolved_tree(c, table) if c in D else old_tree
        if c == old_unified:
            assert base == T.tip_tree(c), base
        tree = h_tree(base, '', c)
        parents = [mapping.get(p, p) for p in old_parents(c)]
        mapping[c] = commit_obj(c, tree, parents)
        new_shas.append(mapping[c]); new_shas.sort()
        if n % 100 == 0:
            print(n, len(order), flush=True)
    with open(os.path.join(out, 'map.tsv'), 'w') as f:
        for c in order:
            f.write('%s\t%s\n' % (c, mapping[c]))
    with open(os.path.join(out, 'refs.tsv'), 'w') as f:
        for r in refs:
            f.write('\t'.join(r) + '\n')
    with open(os.path.join(out, 'late.tsv'), 'w') as f:
        for r in late:
            f.write('\t'.join(r) + '\n')
    with open(os.path.join(out, 'tips'), 'w') as f:
        f.write('unified %s\nav1 %s\n' % (mapping[old_unified], mapping[old_av1]))
    print('done', len(order), 'commits;', len(refs), 'tokens rewritten;', len(late), 'late')
