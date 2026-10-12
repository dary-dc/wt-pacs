import os, subprocess, zlib, hashlib, re

GITDIR = subprocess.check_output(['git', 'rev-parse', '--git-common-dir'], text=True).strip()
GITDIR = os.path.abspath(GITDIR)


class Cat:
    def __init__(self):
        self.p = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.cache = {}

    def get(self, sha):
        if sha in self.cache:
            return self.cache[sha]
        self.p.stdin.write((sha + '\n').encode()); self.p.stdin.flush()
        hdr = self.p.stdout.readline().decode().split()
        if hdr[1] == 'missing':
            raise KeyError(sha)
        typ, size = hdr[1], int(hdr[2])
        data = self.p.stdout.read(size); self.p.stdout.read(1)
        r = (typ, data)
        if typ in ('tree', 'commit'):
            self.cache[sha] = r
        return r


cat = Cat()


def write(typ, data):
    body = b'%s %d\0' % (typ.encode(), len(data)) + data
    sha = hashlib.sha1(body).hexdigest()
    d = os.path.join(GITDIR, 'objects', sha[:2]); f = os.path.join(d, sha[2:])
    if not os.path.exists(f):
        os.makedirs(d, exist_ok=True)
        tmp = f + '.tmp%d' % os.getpid()
        with open(tmp, 'wb') as fh:
            fh.write(zlib.compress(body))
        os.replace(tmp, f)
    if typ in ('tree', 'commit'):
        cat.cache[sha] = (typ, data)
    return sha


def parse_tree(data):
    out = []; i = 0
    while i < len(data):
        sp = data.index(b' ', i); nul = data.index(b'\0', sp)
        mode = data[i:sp].decode(); name = data[sp + 1:nul]; sha = data[nul + 1:nul + 21].hex()
        out.append((mode, name, sha)); i = nul + 21
    return out


def make_tree(entries):
    def key(e):
        return e[1] + (b'/' if e[0] == '40000' else b'')
    return b''.join(b'%s %s\0' % (m.encode(), n) + bytes.fromhex(s) for m, n, s in sorted(entries, key=key))


def tree_get(tree, path):
    parts = path.split('/')
    for i, p in enumerate(parts):
        ents = {n.decode(): (m, s) for m, n, s in parse_tree(cat.get(tree)[1])}
        if p not in ents:
            return None
        m, s = ents[p]
        if i == len(parts) - 1:
            return (m, s)
        tree = s
    return None


def tree_edit(tree, edits):
    """edits: {path: (mode, sha) or None}"""
    groups = {}
    for path, v in edits.items():
        head, _, rest = path.partition('/')
        groups.setdefault(head, {})[rest] = v
    ents = {n.decode(): (m, s) for m, n, s in parse_tree(cat.get(tree)[1])} if tree else {}
    for head, sub in groups.items():
        if '' in sub:
            v = sub['']
            if v is None:
                ents.pop(head, None)
            else:
                ents[head] = v
        else:
            cur = ents.get(head)
            new = tree_edit(cur[1] if cur else None, sub)
            if new is None:
                ents.pop(head, None)
            else:
                ents[head] = ('40000', new)
    if not ents:
        return None
    return write('tree', make_tree([(m, n.encode(), s) for n, (m, s) in ents.items()]))
