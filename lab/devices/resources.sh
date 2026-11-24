#!/bin/bash
# lab/devices/resources.sh ROUND_JSONL OUT_JSONL (ADB names adb if not on PATH; needs jq). lab/devices/README.md §The round
# One phone snapshot at the start and after each "load ended" (between loads, as round.py's own adb reads).
A="${ADB:-adb}"
snap() {
  local label=$1 t0 raw
  t0=$(date +%s%3N)
  raw=$($A shell '
    echo "@meminfo"; grep -E "^(MemTotal|MemFree|MemAvailable|Cached|SwapTotal|SwapFree):" /proc/meminfo
    echo "@psi"; cat /proc/pressure/memory 2>/dev/null
    echo "@vmstat"; grep -E "^(pswpin|pswpout|pgmajfault) " /proc/vmstat
    echo "@thermal"; dumpsys thermalservice | grep -E "Thermal Status:|mName=(SKIN|AP|BAT)," | head -4
    echo "@chrome"; for p in $(pgrep -f chrome); do grep -hE "^(Name|VmRSS|VmSwap):" /proc/$p/status 2>/dev/null | tr "\n" " "; echo; done
    echo "@top"; ps -A -o RSS,NAME -k -rss | head -9' 2>&1 | tr -d '\r')
  python3 -c '
import json, re, sys
label, t0, t1, raw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
sec, cur = {}, None
for l in raw.splitlines():
    if l.startswith("@"): cur = l[1:]; sec[cur] = []; continue
    if cur and l.strip(): sec[cur].append(l.strip())
kb = lambda name: next((int(re.findall(r"\d+", l)[0]) for l in sec.get("meminfo", []) if l.startswith(name + ":")), None)
mib = lambda v: None if v is None else round(v / 1024)
vm = dict(l.split() for l in sec.get("vmstat", []) if len(l.split()) == 2)
th = sec.get("thermal", [])
temp = lambda n: next((float(m[1]) for l in th for m in [re.search(r"mValue=([0-9.]+), mType=\d+, mName=" + n + ",", l)] if m), None)
chrome = []
for l in sec.get("chrome", []):
    f = dict(re.findall(r"(Name|VmRSS|VmSwap):\s+(\S+)", l))
    if f: chrome.append({"name": f.get("Name"), "rssMiB": mib(int(f.get("VmRSS", 0))), "swapMiB": mib(int(f.get("VmSwap", 0)))})
top = [dict(zip(("rssMiB", "name"), (round(int(x.split()[0]) / 1024), x.split(None, 1)[1]))) for x in sec.get("top", [])[1:] if x.split()[0].isdigit()]
print(json.dumps({"kind": "resources", "label": label, "at": t0, "readMs": t1 - t0,
  "memTotalMiB": mib(kb("MemTotal")), "memFreeMiB": mib(kb("MemFree")), "memAvailableMiB": mib(kb("MemAvailable")),
  "cachedMiB": mib(kb("Cached")), "swapUsedMiB": None if kb("SwapTotal") is None else mib(kb("SwapTotal") - kb("SwapFree")),
  "psiMemory": sec.get("psi", []), "pswpin": int(vm.get("pswpin", 0)), "pswpout": int(vm.get("pswpout", 0)), "pgmajfault": int(vm.get("pgmajfault", 0)),
  "thermalStatus": next((int(l.split(":")[1]) for l in th if l.startswith("Thermal Status:")), None),
  "skinC": temp("SKIN"), "apC": temp("AP"), "batC": temp("BAT"), "chrome": chrome, "top": top}))
' "$label" "$t0" "$(date +%s%3N)" "$raw"
}
snap start >> "$2"
tail -n0 -F "$1" 2>/dev/null | grep --line-buffered '"event": "load ended"' | while read -r l; do
  k=$(jq -r .load <<<"$l"); snap "after-$k" >> "$2"; jq -c '{label, readMs, memAvailableMiB, swapUsedMiB, thermalStatus, skinC}' <<<"$(tail -1 "$2")"
done
