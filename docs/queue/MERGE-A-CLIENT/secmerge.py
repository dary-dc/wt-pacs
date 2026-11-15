import sys,subprocess
# secmerge.py FILE REV: the tip's FILE with every section REV has and the tip lacks inserted where REV has it
# (a section: a heading line absent from the tip, up to the next heading line the tip has). Prints what it did and,
# per tip section, how many of REV's lines in it the tip lacks (edits inside a section are not taken).
f,rev=sys.argv[1:3]
g=lambda r:subprocess.run(['git','-C','/home/user/mac','show',f'{r}:{f}'],capture_output=True,text=True).stdout.split('\n')
H=g('HEAD');B=g(rev);hs=set(x for x in H if x.startswith('#'));Hset=set(H)
i=0;ins=[]
while i<len(B):
    if B[i].startswith('#') and B[i] not in hs:
        j=i+1
        while j<len(B) and not (B[j].startswith('#') and B[j] in hs): j+=1
        nxt=B[j] if j<len(B) else None
        ins.append((B[i:j],nxt)); i=j
    else: i+=1
for sec,nxt in ins:
    at=H.index(nxt) if nxt else len(H)
    if sec[-1]!='' : sec=sec+['']
    H[at:at]=sec; print(f'inserted {sec[0][:80]!r} ({len(sec)} lines) before {nxt[:60] if nxt else "end"!r}')
cur=None;miss={}
for x in B:
    if x.startswith('#'): cur=x
    elif x.strip() and x not in Hset and cur in hs: miss[cur]=miss.get(cur,0)+1
for k,v in miss.items(): print(f'  {v} lines of {rev} not in the tip under {k[:80]!r}')
open('/home/user/mac/'+f,'w').write('\n'.join(H))
