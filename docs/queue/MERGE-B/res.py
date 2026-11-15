import sys,difflib
# res.py FILE MODES : MODES comma list, one per hunk (or one for all): ours | theirs | union (ours, then the branch's
# lines not in ours) | patch (the branch's base->theirs line edits applied inside ours where the base lines match)
f=sys.argv[1]; modes=sys.argv[2].split(',')
L=open('/home/user/mb/'+f).read().split('\n')
out=[];i=0;k=0
while i<len(L):
    if L[i].startswith('<<<<<<< '):
        o=[];b=[];t=[];cur=o;i+=1
        while not L[i].startswith('>>>>>>> '):
            if L[i].startswith('||||||| '): cur=b
            elif L[i]=='=======': cur=t
            else: cur.append(L[i])
            i+=1
        m=modes[k] if k<len(modes) else modes[-1]; k+=1
        if m=='ours': out+=o
        elif m=='theirs': out+=t
        elif m=='both': out+=o+t
        elif m=='theirs+ournew': out+=t+[x for x in o if x not in b and x not in t]
        elif m=='union':
            out+=o+[x for x in t if x not in o and x not in b]
        elif m=='patch':
            r=o[:]
            sm=difflib.SequenceMatcher(None,b,t,autojunk=False)
            for tag,i1,i2,j1,j2 in reversed(sm.get_opcodes()):
                if tag=='equal': continue
                old=b[i1:i2]; new=t[j1:j2]
                if old:
                    pos=next((p for p in range(len(r)-len(old)+1) if r[p:p+len(old)]==old),None)
                    if pos is None: sys.exit(f"patch: hunk {k} base lines not found in ours: {old[:1]}")
                    r[pos:pos+len(old)]=new
                else:
                    anchor=b[i1-1] if i1>0 else None
                    pos=(r.index(anchor)+1) if anchor in r else len(r)
                    r[pos:pos]=new
            out+=r
        else: sys.exit('mode?')
    else: out.append(L[i])
    i+=1
open('/home/user/mb/'+f,'w').write('\n'.join(out))
print(f, k, 'hunks', ','.join(modes))
