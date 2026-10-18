import json, re, subprocess, sys, urllib.request
# usage: pr_merge.py N SHA "title" — mark ready, merge with method merge pinned to SHA
n, sha, title = sys.argv[1:4]
tok = re.search(r"^password=(.*)$", subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
    capture_output=True, text=True).stdout, re.M).group(1)
H = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"}
def call(url, data=None, method="GET"):
    body = json.dumps(data).encode() if data is not None else None
    return json.load(urllib.request.urlopen(urllib.request.Request(url, data=body, headers=H, method=method)))
pr = call(f"https://api.github.com/repos/dary-dc/wt-pacs/pulls/{n}")
assert pr["head"]["sha"] == sha, f"head is {pr['head']['sha']}, not {sha}"
if pr["draft"]:
    call("https://api.github.com/graphql", {"query": "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}",
                                            "variables": {"id": pr["node_id"]}}, "POST")
print(call(f"https://api.github.com/repos/dary-dc/wt-pacs/pulls/{n}/merge",
           {"merge_method": "merge", "sha": sha, "commit_title": title}, "PUT"))
