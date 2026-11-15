import sys,difflib
# for each conflict hunk: the branch's own change (base -> theirs), with "+" lines already in ours' whole file marked "=".
W=200
f=sys.argv[1]; L=open('/home/user/mac/'+f).read().split('\n')
blocks=[];i=0;out=[]
while i<len(L):
    if L[i].startswith('<<<<<<< '):
        o=[];b=[];t=[];cur=o;i+=1
        while not L[i].startswith('>>>>>>> '):
            if L[i].startswith('||||||| '): cur=b
            elif L[i]=='=======': cur=t
            else: cur.append(L[i])
            i+=1
        blocks.append((o,b,t)); out.extend(o)
    else: out.append(L[i])
    i+=1
ours='\n'.join(out)
for k,(o,b,t) in enumerate(blocks,1):
    d=[x for x in difflib.unified_diff(b,t,lineterm='',n=0)][2:]
    new=[x for x in d if x.startswith('+') and x[1:].strip()]
    missing=[x for x in new if x[1:].strip() not in ours]
    print(f"### {f} #{k}: ours {len(o)} lines, branch +{len(new)} lines, {len(missing)} not in ours")
    for x in d:
        if x.startswith('@@'): continue
        mark = '=' if x.startswith('+') and x[1:].strip() in ours else x[0]
        print(mark+' '+x[1:][:W])
