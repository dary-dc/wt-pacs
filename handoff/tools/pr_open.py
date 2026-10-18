import json, re, subprocess, sys, urllib.request
# usage: pr_open.py HEAD_BRANCH "title" < body.md   (draft PR into claude/av1-unified-mainbase)
head, title = sys.argv[1], sys.argv[2]
tok = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                     capture_output=True, text=True).stdout
tok = re.search(r"^password=(.*)$", tok, re.M).group(1)
hdr = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"}
data = {"title": title, "head": head, "base": "claude/av1-unified-mainbase", "body": sys.stdin.read(), "draft": True}
r = json.load(urllib.request.urlopen(urllib.request.Request(
    "https://api.github.com/repos/dary-dc/wt-pacs/pulls", data=json.dumps(data).encode(), headers=hdr, method="POST")))
print(r["number"], r["html_url"], r["head"]["sha"][:8])
