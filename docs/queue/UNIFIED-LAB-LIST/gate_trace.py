"""The lab/ files each scripts/gate.sh step reads, read not run: gate_trace.py TREE OUT.json (docs/decisions/lab-list.md)."""
import os, re, subprocess, sys, json, collections
os.chdir(sys.argv[1])
files=[f for f in subprocess.run(['git','ls-files'],capture_output=True,text=True).stdout.split('\n') if f]
fs=set(files)
CODE=('.rs','.js','.mjs','.ts','.py','.sh','.html','.css','.go','.c','.h','.toml')
def nb(f):
    d=open(f,'rb').read(); return 0 if b'\0' in d[:8000] else sum(1 for l in d.split(b'\n') if l.strip())
pathre=re.compile(r'((?:\.\./)*\.?/?(?:lab|client|scripts|server|deploy|ingest|tools|common|carrier|fixtures)/[\w./@*-]+)')
def strip_js(t):
    t=re.sub(r'/\*.*?\*/','',t,flags=re.S); return re.sub(r'(?m)(^|[^:\\])//.*$',r'\1',t)
def strip_hash(t): return '\n'.join(l for l in t.split('\n') if not l.lstrip().startswith('#'))
def strip_rs(t): return re.sub(r'(?m)//.*$','',t)
pkg={}
for f in files:
    if f.endswith('Cargo.toml'):
        m=re.search(r'^\[package\][^\[]*?^name\s*=\s*"([^"]+)"',open(f).read(),re.M|re.S)
        if m: pkg[m.group(1)]=os.path.dirname(f) or '.'
def crate(d): return [f for f in files if f.startswith(d+'/') and f.endswith(('.rs','.toml'))]
def res(p,base):
    p=p.rstrip('.,;:)\'"`')
    if p.startswith('/'): p=p[1:]
    elif p.startswith('.'): p=os.path.join(base,p)
    p=os.path.normpath(p)
    for c in (p,p+'.js',p+'.mjs',p+'.ts',p+'/index.html'):
        if c in fs: return [c]
    if '*' in p:
        rx=re.compile('^'+re.escape(p).replace(r'\*','[^/]*')+'$'); return [f for f in files if rx.match(f)]
    return []
P={}
def closure(seeds):
    seen=set(); q=[(s,'SEED') for s in seeds]
    while q:
        f,par=q.pop()
        if f in seen or f not in fs or f=='scripts/gate.sh': continue
        seen.add(f); P.setdefault(f,par); base=os.path.dirname(f)
        try: t=open(f,errors='replace').read()
        except Exception: continue
        new=[]
        if f.endswith(('.js','.mjs','.ts')):
            t=strip_js(t)
            for m in re.finditer(r'''(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*|new URL\(\s*|new (?:Shared)?Worker\(\s*)['"`]([^'"`]+)['"`]''',t,re.M): new+=res(m.group(1),base)
            for m in re.finditer(r'''['"`]((?:\.\.?/|/)[\w./-]+\.(?:mjs|js|html|wasm|py|sh|json))['"`]''',t): new+=res(m.group(1),base)
            for m in re.finditer(r'''['"`]((?:lab|client|scripts|fixtures)/[\w./-]+)['"`]''',t): new+=res(m.group(1),'')
        elif f.endswith('.html'):
            t=re.sub(r'<!--.*?-->','',t,flags=re.S)
            for m in re.finditer(r'''(?:src|href)=["']([^"']+)["']''',t): new+=res(m.group(1),base)
            for m in re.finditer(r'''(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]''',t): new+=res(m.group(1),base)
        elif f.endswith(('.sh','.py')):
            t=strip_hash(t)
            for m in pathre.finditer(t): new+=res(m.group(1),base)
            for m in re.finditer(r'''["' ](\.\.?/[\w./-]+)''',t): new+=res(m.group(1),base)
        elif f.endswith('.rs'):
            t=strip_rs(t)
            for m in re.finditer(r'include_(?:str|bytes)!\(\s*"([^"]+)"',t): new+=res(m.group(1),base)
        elif f.endswith('Cargo.toml'):
            for m in re.finditer(r'path\s*=\s*"([^"]+)"',t):
                d=os.path.normpath(os.path.join(base,m.group(1)))
                new+=crate(d) if d+'/Cargo.toml' in fs else []
        q+=[(x,f) for x in new]
    return seen
gate=open('scripts/gate.sh').read().split('\n')
steps=[]; cur=None
for i,l in enumerate(gate,1):
    m=re.match(r'\s*step "(.*)"',l)
    if m: cur=m.group(1); continue
    if l.lstrip().startswith('#') or 'usage:' in l: continue
    seeds=[]
    for m in pathre.finditer(l): seeds+=res(m.group(1),'')
    for m in re.finditer(r'-p ([\w-]+)',l):
        if m.group(1) in pkg: seeds+=crate(pkg[m.group(1)])
    if re.search(r'--features[ =]telemetry',l): seeds+=crate('lab/server-telemetry')
    if 'lab-classify' in l: seeds+=crate('lab/cc-classify')
    m=re.search(r'--manifest-path (\S+)',l)
    if m: seeds+=crate(os.path.dirname(m.group(1)))
    if 'go build' in l:
        for d in ('lab/other-clients/go','lab/page-open/h3-host'): seeds+=[f for f in files if f.startswith(d+'/')]
    if seeds: steps.append((i,cur,closure(seeds)))
res_={}
for i,title,s in steps:
    for f in s:
        if f.startswith('lab/'):
            d=f.split('/')[1] if f.count('/')>=2 else f[4:]
            r=res_.setdefault(d,dict(steps={},files=set()))
            r['steps'][i]=title; r['files'].add(f)
def chain(f):
    c=[f]
    while c[-1] in P and P[c[-1]]!='SEED' and len(c)<10: c.append(P[c[-1]])
    return c
out={}
for d,r in sorted(res_.items()):
    out[d]=dict(steps=r['steps'],nfiles=len(r['files']),code_read=sum(nb(f) for f in r['files'] if f.endswith(CODE)),
      sample=[' <- '.join(chain(f)) for f in sorted(r['files'])[:40]])
json.dump(out,open(sys.argv[2],'w'),indent=1)
for d,o in out.items(): print(f"{d:20} files={o['nfiles']:4} code={o['code_read']:5} steps={sorted(o['steps'])}")
