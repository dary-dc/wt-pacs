"""Resolve a conflict hunk whose branch side only renamed words: PR #34's side, with the same renames."""
import difflib, re

TOK = re.compile(r'\w+|\s+|[^\w\s]')


def rename_map(base, theirs):
    a, b = TOK.findall(base), TOK.findall(theirs)
    m = {}
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == 'equal':
            continue
        if op == 'replace' and i2 - i1 == j2 - j1 and all(re.fullmatch(r'\w+', t) for t in a[i1:i2] + b[j1:j2]):
            for x, y in zip(a[i1:i2], b[j1:j2]):
                if m.get(x, y) != y:
                    return None
                m[x] = y
            continue
        return None
    return m


def apply_map(text, m):
    return ''.join(m.get(t, t) for t in TOK.findall(text))


HUNK = re.compile(r'<<<<<<< ours\n(.*?)\|\|\|\|\|\|\| base\n(.*?)=======\n(.*?)>>>>>>> theirs\n', re.S)


def resolve(conflicted):
    """The file with every rename-only hunk resolved, and the hunks left."""
    left = []

    def f(mo):
        o, b, t = mo.groups()
        m = rename_map(b, t)
        if m is None:
            left.append(mo.group(0))
            return mo.group(0)
        return apply_map(o, m)
    return HUNK.sub(f, conflicted), left
