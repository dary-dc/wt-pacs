import json, re, subprocess, sys, time, urllib.request
# usage: ci_wait.py SHA... ; prints each sha's check results once all are completed
tok = re.search(r"^password=(.*)$", subprocess.run(["git", "credential", "fill"],
    input="protocol=https\nhost=github.com\n\n", capture_output=True, text=True).stdout, re.M).group(1)
def runs(sha):
    req = urllib.request.Request(f"https://api.github.com/repos/dary-dc/wt-pacs/commits/{sha}/check-runs",
                                 headers={"Authorization": f"Bearer {tok}"})
    try:
        return json.load(urllib.request.urlopen(req))["check_runs"]
    except Exception:
        return []
while True:
    res = {s: runs(s) for s in sys.argv[1:]}
    if all(len(r) >= 3 and all(x["status"] == "completed" for x in r) for r in res.values()):
        for s, r in res.items():
            print(s, " ".join(f"{x['name']}={x['conclusion']}" for x in r))
        break
    time.sleep(90)
