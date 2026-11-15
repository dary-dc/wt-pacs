import sys
# moved.py FILE: per hunk, how many of theirs' non-blank lines exist anywhere in ours' docs tree
A=set(open('/home/user/mb-work/ours-doc-lines').read().split('\n'))
f=sys.argv[1]; L=open(f).read().split('\n'); i=0;k=0
while i<len(L):
  if L[i].startswith('<<<<<<<'):
    o=[];t=[];cur=o;i+=1
    while not L[i].startswith('>>>>>>>'):
      if L[i]=='=======': cur=t
      elif L[i].startswith('|||||||'): cur=[]
      else: cur.append(L[i])
      i+=1
    k+=1; nb=[x for x in t if x.strip()]; miss=[x for x in nb if x not in A]
    print(f,'hunk',k,'theirs-nonblank',len(nb),'anywhere-in-ours',len(nb)-len(miss)); [print('   MISSING:',x[:150]) for x in miss[:int(sys.argv[2]) if len(sys.argv)>2 else 3]]
  i+=1
