import sys
# per conflict hunk: line, size and the headings/bold leads of ours, base, theirs
f=sys.argv[1]; L=open('/home/user/mac/'+f).read().split('\n');i=0;k=0
while i<len(L):
    if L[i].startswith('<<<<<<<'):
        k+=1;s=i
        b=next(j for j in range(i,len(L)) if L[j].startswith('|||||||'))
        m=next(j for j in range(b,len(L)) if L[j]=='=======')
        e=next(j for j in range(m,len(L)) if L[j].startswith('>>>>>>>'))
        print(f'## hunk {k} @{s+1} after: {L[s-2][:80]!r}')
        for n,X in (('ours',L[s+1:b]),('base',L[b+1:m]),('theirs',L[m+1:e])):
            print(f'  {n} {len(X)}:', [x[:70] for x in X if x.startswith('#') or x.startswith('**')][:6], '|', X[0][:150] if X else '')
        i=e
    i+=1
