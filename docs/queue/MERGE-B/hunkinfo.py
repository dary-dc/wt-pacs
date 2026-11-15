import sys,subprocess
# hunkinfo.py FILE: per conflict hunk, line counts and how many of theirs' non-blank lines already sit in ours' whole file
f=sys.argv[1]; L=open(f).read().split('\n'); i=0;k=0
O=set(subprocess.run(['git','show',':2:'+f],capture_output=True,text=True).stdout.split('\n'))
while i<len(L):
  if L[i].startswith('<<<<<<<'):
    o=[];t=[];cur=o;i+=1
    while not L[i].startswith('>>>>>>>'):
      if L[i]=='=======': cur=t
      elif L[i].startswith('|||||||'): cur=[]
      else: cur.append(L[i])
      i+=1
    k+=1; nb=[x for x in t if x.strip()]; print(f,'hunk',k,'ours',len(o),'theirs',len(t),'theirs-nonblank',len(nb),'already-in-ours',sum(1 for x in nb if x in O))
  i+=1
