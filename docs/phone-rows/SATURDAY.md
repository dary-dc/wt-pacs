# The phone round of 2026-11-21, on one screen

Written 2026-11-19 by PHONE-RUN-OWNER (`claude/work-ledger:docs/queue-client-2026-11-14.md`). The protocol:
[`next-round.md`](next-round.md). The tools: [`../../lab/devices/README.md`](../../lab/devices/README.md) §The round.

**The run commit** is the tip of `claude/phone-run` on the evening; its code is `d706d7e5` (the preflight prints it as
`RUN_CODE`), and every later commit touches `docs/` only. `round_plan.mjs` writes the served tree's `HEAD` into the plan, and `round.py` refuses
before load 1 if the tree is anywhere else (§1).

**What it carries**: `claude/unified` + PR 378 (a lost exact ask asked again once; FIX-378-DIAL) + `claude/phone-round`
(PR 400: the one-press runner, the levers C2, `decoders`, `bench`) + `round_plan.mjs`. PR 376 (the late deadline) is
already in `claude/unified`, so a hidden page's load counts (§1).

**What does not run, and why**: cell 5 (the runner has no cache arms; CACHE-VERDICT-REVIEW: no store passes, the
cache stays off), so no `adb reboot` and no P1; the report cells (the ending levers R1, R2, R4 are not built); the
decode-option asks M1–M22 (no units built); cell 2's `getStats()` and the configure's `hardwareAcceleration` (not
recorded: inside workers). **Cell 3's guard is form (a)**, the 52 ms first-picture bound, an *assumption*; the
worker's first-picture delay is reported beside it, and a verdict that turns on the guard alone is *provisional*.

## The evening, in order (~3 h)

| step | what | time |
| --- | --- | --- |
| 0 | preflight on the laptop (below), from any state | 15 min |
| 1 | the probe's shell reads (PHONE-PROBE-RUN): AV1 codecs, `logcat`'s names, Chrome's `/proc/<pid>/stat` | 5 min |
| 2 | the dry run (PHONE-DRY-RUN): the whole round in quick mode, 28 loads, read back | 15 min |
| 3 | the round: one press, cells 1, 2, 3 (144 loads) | 2 h 10 min |
| 4 | cell 4, the hardware-decode probe, opened by the laptop | 10 min |

## 0 · Preflight (the laptop; any state)

```bash
cd ~/wt-pacs && git fetch origin && git checkout claude/phone-run && git pull --ff-only   # a dirty tree: git stash first
git log -1 --format=%H -- . ':!docs'                                                     # RUN_CODE, as above
bash client/decode/wasm/build/build.sh && bash client/decode/wasm/fetch_xxh3.sh && bash client/transport/ts/build.sh
cargo build --release -p series-server
ls demo-series/{dbts_b1-q8-g8,dbts_b1,dbts_a1-q8-g8-cut,dbts_a1}.sbnd || scripts/demo-series.sh   # ~20 min if missing
./server/scripts/gen_dev_cert.sh --if-needed
pkill -f 'release/series-server' ; pkill -f 'server/dev-server.py' ; pkill -f 'lab/devices/round.py'   # servers down
```

The phone: on the home Wi-Fi, **USB tethering off** (never toggled during the round), on its charger and on USB,
power saving off, every other app closed. The laptop wired to the same router:

```bash
read -r IF LAPTOP_IP < <(ip -4 route get 192.0.2.1 | awk '{for (i = 1; i < NF; i++) {if ($i == "dev") d = $(i + 1); if ($i == "src") s = $(i + 1)}} END {print d, s}')
adb devices                                   # "device"; "unauthorized": allow on the phone, run again
if sudo firewall-cmd --state >/dev/null 2>&1; then
  ZONE=$(sudo firewall-cmd --get-zone-of-interface="$IF" 2>/dev/null | grep -vx 'no zone') || ZONE=$(sudo firewall-cmd --get-default-zone)
  sudo firewall-cmd --zone="$ZONE" --add-port=4433-4436/udp --timeout=12h
fi
for p in 8765 8766 8767 8768 8780 8443; do adb reverse tcp:$p tcp:$p; done                # pages over USB, the dial over Wi-Fi
adb shell dumpsys wifi | grep -m3 -E 'mWifiInfo|Frequency|RSSI' > target/round-wifi-before.txt   # band, speed, RSSI (§2)
```

Write in `target/round-notes.txt` the distance to the access point in metres and the walls between (§2).

## 1 · The probe's shell reads (untimed; *not sourced*: each read's outcome is the record)

```bash
mkdir -p target/probe-shell
adb shell 'cat /vendor/etc/media_codecs*.xml /odm/etc/media_codecs*.xml 2>/dev/null' > target/probe-shell/codecs.xml
adb shell dumpsys media.player > target/probe-shell/media.player.txt
PID=$(adb shell pidof com.android.chrome); adb shell cat /proc/$PID/stat > target/probe-shell/chrome.stat   # empty: "not read"
```

`logcat`'s component names are read by the dry run (its `OUT/adb/*.logcat.txt`).

## 2 · The dry run

```bash
node lab/devices/round_plan.mjs demo-series target/dry --dial "$LAPTOP_IP" --quick
python3 lab/devices/round.py target/dry/plan.json target/dry/out --bind 127.0.0.1 --host http://127.0.0.1:8780
```

On the phone: Chrome, `http://127.0.0.1:8780/`, **Start**. At "round done", Ctrl-C, then read back:

```bash
grep -c '"kind":"verdict"' target/dry/beacon.jsonl                 # 28
grep '"kind":"verdict"' target/dry/beacon.jsonl | grep -v '"ok":true'   # each failure with its why
grep -h -o -E '(c2|OMX)\.[A-Za-z0-9._-]+' target/dry/out/adb/*.logcat.txt | sort -u   # nothing: cell 1's route "not read"
cat target/dry/out/adb/*-after-*.stat | head -2                         # empty: CPU per process "not read"
```

A failure here: its `why`, then **`git log origin/claude/phone-run`** for a fix pushed since; nothing else is changed
on the evening. `round.py` puts `stay_on_while_plugged_in` back when it ends (and on Ctrl-C).

## 3 · The round

```bash
node lab/devices/round_plan.mjs demo-series target/round --dial "$LAPTOP_IP"
python3 lab/devices/round.py target/round/plan.json target/round/out --bind 127.0.0.1 --host http://127.0.0.1:8780
```

The phone: `http://127.0.0.1:8780/`, **Start**, once. Nothing until "round done" (~2 h 10 min). Then
`adb shell dumpsys wifi | grep -m3 -E 'mWifiInfo|Frequency|RSSI' > target/round-wifi-after.txt`.

If `round.py` itself stops mid-round, the loads not yet started run as a plan of their own (their beacon apart; the
read adds `K` to their steps), and the phone presses **Start** again:

```bash
K=$(python3 -c 'import json, sys; print(sum(json.loads(l)["event"] == "load ended" for l in open(sys.argv[1])))' target/round/out/round.jsonl)
python3 -c 'import json, sys; p = json.load(open(sys.argv[1])); b = p["blocks"][0]; b["loads"] = b["loads"][int(sys.argv[2]):]
for s in b["servers"]: s["cmd"] = [a.replace("beacon.jsonl", "beacon-rest.jsonl") for a in s["cmd"]]
json.dump(p, open(sys.argv[3], "w"))' target/round/plan.json "$K" target/round/plan-rest.json
python3 lab/devices/round.py target/round/plan-rest.json target/round/out-rest --bind 127.0.0.1 --host http://127.0.0.1:8780
```

## 4 · Cell 4, the probe (after the round; decides nothing)

```bash
mkdir -p target/probe && TOKEN=$(openssl rand -hex 8)
DEVICES_TOKEN=$TOKEN python3 lab/devices/collector.py --studies target/probe --wt target/probe --out target/probe/rows \
  --host 127.0.0.1 --port 8443 &
adb shell am start -a android.intent.action.VIEW -d "'http://127.0.0.1:8443/?t=$TOKEN&link=wifi&run=D0'" com.android.chrome
until ls target/probe/rows/*.jsonl >/dev/null 2>&1; do sleep 10; done; sleep 30   # D0's row posted (~10 min)
adb logcat -d > target/probe/logcat.txt; kill %1
```

## Where rows go

Strip the laptop's address and the phone's serial (`docs/devices.md` §4), then commit the raw files to
`claude/phone-run` under docs/phone-rows/raw/2026-11-21/ (made on the evening) and push after each step;
`claude/work-ledger:docs/queue/PHONE-ROUND.md` holds the state:

```bash
D=docs/phone-rows/raw/2026-11-21; mkdir -p $D && cp -r target/{dry,round,probe,probe-shell} target/round-*.txt $D/
grep -rl -e "$LAPTOP_IP" -e "$(adb get-serialno)" $D | xargs -r sed -i -e "s/$LAPTOP_IP/LAPTOP/g" -e "s/$(adb get-serialno)/PHONE/g"
git add $D && git commit -m "phone round 2026-11-21: raw rows" && git pull --rebase && git push origin claude/phone-run
```
