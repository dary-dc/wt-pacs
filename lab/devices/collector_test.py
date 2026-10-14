#!/usr/bin/env python3
"""The collector's claims: nothing is served or taken without the token; the page's code, the bundles and each arm's
transport are served with it, and nothing else of the checkout; posted rows land whole. Run: python3 lab/devices/collector_test.py"""

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOKEN = "t" * 24
failed = 0


def check(ok, what):
    global failed
    print(("ok: " if ok else "FAIL: ") + what)
    failed += not ok


def get(base, path, cookie=None, data=None):
    req = urllib.request.Request(base + path, data=data, headers={"Cookie": cookie} if cookie else {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, b"", e.headers


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "studies").mkdir()
        (tmp / "studies" / "s.htj2k.sbnd").write_bytes(b"SBND-bytes")
        (tmp / "outside.sbnd").write_bytes(b"not for the page")
        (tmp / "wt" / "shared").mkdir(parents=True)
        (tmp / "wt" / "shared" / "dev-transport.json").write_text('{"wt_url": "https://x:4435/", "cert_sha256": ""}')
        (tmp / "wt" / "shared" / "banner.txt").write_text("stream_mode=shared\ntransport=cc=cubic iw=12000\n")
        p = subprocess.Popen([sys.executable, HERE / "collector.py", "--host", "127.0.0.1", "--port", "0", "--studies", tmp / "studies",
                              "--wt", tmp / "wt", "--out", tmp / "out", "--build", "abc"], stdout=subprocess.PIPE, text=True,
                             env={**os.environ, "DEVICES_TOKEN": TOKEN})
        try:
            base = f"http://127.0.0.1:{p.stdout.readline().strip().split('=')[1]}"
            check(get(base, "/")[0] == 403, "no token: the page is refused")
            check(get(base, "/?t=" + "u" * 24)[0] == 403, "a wrong token: refused")
            check(get(base, "/kit.json", cookie="t=" + "u" * 24)[0] == 403, "a wrong cookie: refused")
            check(get(base, "/collect", data=b"[]")[0] == 403, "no token: a post is refused")
            code, body, h = get(base, "/?t=" + TOKEN)
            check(code == 200 and b"device runner" in body, "the token: the runner page")
            cookie = h["Set-Cookie"].split(";")[0]
            check(cookie == "t=" + TOKEN and "HttpOnly" in h["Set-Cookie"], "the page sets the token's cookie")
            check(h["Cross-Origin-Embedder-Policy"] == "require-corp", "cross-origin isolated")
            code, body, h = get(base, "/lab/devices/plan.mjs", cookie)
            check(code == 200 and h["Content-Type"] == "text/javascript", "the kit's modules, as JavaScript")
            check(get(base, "/lab/order.mjs", cookie)[0] == 200, "the lab's order")
            check(get(base, "/server/dev-server.py", cookie)[0] == 404, "the rest of the checkout: not served")
            check(get(base, "/lab/devices/../../server/dev-server.py", cookie)[0] == 404, "a climb out of the kit: not served")
            code, body, _ = get(base, "/kit.json", cookie)
            k = json.loads(body)
            shared = next(a for a in k["arms"] if a["name"] == "shared")
            check(shared["wt_url"] == "https://x:4435/" and shared["cert_sha256"] == "", "an arm's transport file, merged")
            check(shared["settings"]["transport"] == "cc=cubic iw=12000", "an arm's printed settings, merged")
            check(next(a for a in k["arms"] if a["name"] == "asksfirst")["wt_url"] is None, "an arm not started: no URL")
            check(k["build"] == "abc", "the build")
            check(get(base, "/bundles/s.htj2k.sbnd", cookie)[1] == b"SBND-bytes", "a bundle")
            check(get(base, "/bundles/../outside.sbnd", cookie)[0] == 404, "a bundle name that climbs: refused")
            check(get(base, "/collect", cookie, data=b"not json")[0] == 400, "a post that is not rows: refused")
            check(get(base, "/collect", cookie, data=json.dumps([{"a": 1}, {"b": 2}]).encode())[0] == 204, "rows: taken")
            got = [json.loads(l) for l in next((tmp / "out").glob("rows-*.jsonl")).read_text().splitlines()]
            check([r.get("a") or r.get("b") for r in got] == [1, 2] and all("collected" in r for r in got), "rows: written whole, stamped")
        finally:
            p.terminate()
    print("all tests passed" if failed == 0 else f"{failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
