#!/usr/bin/env python3
"""The doc's tables from streams.py's and run.mjs's rows. usage: report.py STREAMS.jsonl BROWSER.jsonl"""
import json
import sys


def verdict(r):
    if r.get("error"):
        return "refused: " + r["error"].split(":")[0] + (" (key chunk)" if "key frame" in r["error"] else "")
    s = f"{r['differ']} / {r['samples']:,}"
    return s + (f", max \\|Δ\\| {r['max_abs']}" if r["differ"] else "")


def main():
    streams = [json.loads(line) for line in open(sys.argv[1])]
    browser = [json.loads(line) for line in open(sys.argv[2])]
    order = {"dbts_a1": 0, "dbts_b1": 1, "dbts_c1": 2}
    streams.sort(key=lambda r: (order[r["set"]], r["form"] == "top10", r["q"], r["g"]))
    print("| fixture | form | Q | G | frames | samples | VL bytes | keyframes | grain | dav1d `--threads=4` | aomdec |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in streams:
        a = r["against"]
        print(f"| `{r['set']}` | {r['form']} | {r['q']} | {r['g']} | {r['frames']} | {r['native']['samples']:,} | "
              f"{sum(r['units']):,} | {r['keyframes']} | {r['seq']['film_grain']} | {verdict(a['dav1d-t4'])} | "
              f"{verdict(a['aomdec'])} |")
    arms = [("dav1d-wasm", None), ("webcodecs", "prefer-software"), ("webcodecs", "no-preference")]
    print("\n| fixture | form | Q | G | dav1d-WASM | WebCodecs `prefer-software` | WebCodecs `no-preference` | "
          "decoder (media log) | `copyTo` format |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for s in streams:
        name = f"{s['set']}-{s['form']}-q{s['q']}-g{s['g']}"
        got = {(r["decoder"], r["accel"]): r for r in browser if r["cell"] == name}
        cells = [verdict(got[a]) + ("" if got[a].get("error") or got[a]["sha_match"] == s["frames"] else " **sha**")
                 if a in got else "—" for a in arms]
        logs = {f"{p.get('kVideoDecoderName')}, platform {p.get('kIsPlatformVideoDecoder')}"
                for a in arms[1:] if a in got for p in got[a]["media_log"] if p.get("kVideoDecoderName")}
        fmts = {f.split(" ")[0] for a in arms[1:] if a in got for f in got[a]["formats"]}
        print(f"| `{s['set']}` | {s['form']} | {s['q']} | {s['g']} | {' | '.join(cells)} | "
              f"{'; '.join(sorted(logs)) or 'none (refused before decode)'} | {', '.join(sorted(fmts)) or '—'} |")
    ok = [r for r in browser if not r.get("error")]
    total = sum(r["samples"] for r in ok) + sum(v["samples"] for s in streams for v in s["against"].values())
    differ = sum(r["differ"] for r in ok) + sum(v["differ"] for s in streams for v in s["against"].values())
    frames = sum(r["frames"] for r in ok) + sum(v["frames"] for s in streams for v in s["against"].values())
    sha = sum(r["sha_match"] for r in ok)
    print(f"\nall compared decodes: {differ} of {total:,} samples differ, {frames:,} frames; "
          f"browser frames whose SHA-256 equals native dav1d's: {sha} of {sum(r['frames'] for r in ok)}; "
          f"refused arms: {len(browser) - len(ok)}; browser {browser[0]['chromium'] if browser else '—'}")


if __name__ == "__main__":
    main()
