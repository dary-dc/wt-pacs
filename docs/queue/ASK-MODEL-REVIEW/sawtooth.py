import sys
def run(policy, W, leg, v, mu, legs=60, warm=10):
    N=1000; lo=400; hi=lo+leg
    rho=min(1,mu/v)
    s=lo; d=1; held={s}; t=0.0
    def key(i):
        delta=(i-s)*d
        if policy=='ahead34': return delta/3 if delta>=0 else -delta
        if policy=='centred': return abs(delta)
        if policy=='rule': return delta/rho if delta>=0 else -delta
        if policy=='allahead': return delta if delta>=0 else 1e9-delta
    def target(): # next frame on the path
        n=s+d
        if n>hi or n<lo: return s-d
        return n
    fetch_done=None; fetching=None
    next_step=1/v; waits=[]; wait=0.0; legs_done=0; waiting_since=None
    def pick():
        cands=[i for i in range(max(0,s-3*W),min(N,s+3*W+1)) if i not in held]
        if not cands: return None
        c=min(cands,key=key)
        if len(held)>=W:
            far=max((h for h in held if h!=s),key=key)
            if key(c)>=key(far): return None
        return c
    while legs_done<legs:
        if fetching is None:
            fetching=pick(); fetch_done=t+1/mu if fetching is not None else None
        ev=[x for x in (fetch_done,next_step) if x is not None]
        t=min(ev)
        if fetch_done is not None and t==fetch_done:
            held.add(fetching); fetching=None; fetch_done=None
            while len(held)>W: held.remove(max((h for h in held if h!=s),key=key))
        if t>=next_step:
            n=target()
            if n in held:
                if waiting_since is not None: wait+=t-waiting_since; waiting_since=None
                nd=d if lo<=s+d<=hi else -d
                s=n; d=nd if n==s else d
                if s==hi or s==lo:
                    d=-d; legs_done+=1
                    if legs_done>warm: waits.append(wait)
                    wait=0.0
                next_step=t+1/v
            else:
                if waiting_since is None: waiting_since=t
                next_step=t+1e-4
    return sum(waits)/len(waits)
W=15; v=25
for rho in (0.216,0.8):
    mu=rho*v
    for leg in (12,20,40):
        print(f"rho={rho} leg={leg}: "+"  ".join(f"{p}={run(p,W,leg,v,mu):.2f}s" for p in ('allahead','ahead34','centred','rule')))
