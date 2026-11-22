import json, sys, statistics as st, math
rows = [json.loads(l) for l in open(sys.argv[1])]; rows = [r for r in rows if "unit" in r]
off = {r["round"]: r["fillMs"] for r in rows if r["unit"] == "off"}
offp = {r["round"]: r["fillMs"] for r in rows if r["unit"] == "off'"}
def binom_two_sided(k, n):
    p = sum(math.comb(n, i) for i in range(0, min(k, n - k) + 1)) / 2 ** n
    return min(1, 2 * p)
for u in ["off'","beacon:H","beacon:Y","keepalive:H","keepalive:Y","session:1","session:Y","session:H"]:
    f = {r["round"]: r["fillMs"] for r in rows if r["unit"] == u}
    above_off = sum(1 for k in f if f[k] > off[k])
    above_offp = sum(1 for k in f if f[k] > offp[k])
    ratios = sorted(f[k] / off[k] for k in f)
    print(f"{u:12} >off {above_off}/18 p={binom_two_sided(above_off,18):.3f}  >off' {above_offp}/18 p={binom_two_sided(above_offp,18):.3f}  ratio IQR {ratios[4]:.3f}-{ratios[13]:.3f} diff med {st.median(f[k]-off[k] for k in f):+.1f} ms")
