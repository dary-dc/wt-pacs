# The phone round of 2026-11-22, on one screen

From [`SATURDAY.md`](SATURDAY.md) (never run); the protocol [`next-round.md`](next-round.md), the short counts its
*Amendment, 2026-11-22*. **NODE** is the container wrapper for `node` the local session sets (node is not on the
laptop's PATH); it runs from the worktree with the worktree mounted at its own path (the plan holds absolute paths,
and `round_plan.mjs` runs `git`). **Owner** marks the owner's hands; every other step is the run session's.

**The run code** is `493f5ed5` (`git log -1 --format=%H -- . ':!docs'`); later commits touch `docs/` only. What runs
and does not (cell 5, the report cells, M1–M22; cell 3's guard form (a), an *assumption*) is SATURDAY.md's.

| choice | steps | phone time |
| --- | --- | --- |
| **SHORT** | 0, 1, the short round with its smoke check (3S), cell 4 only if time is left | ~1 h (+10 min) |
| **FULL** | 0, 1, the dry run (2), the full round (3F, unattended after Start), cell 4 | ~3 h |

**Never, once step 0 is done:** toggle USB debugging or tethering (the 11-11 run lost a load to it), let the screen
sleep (`round.py` holds it on during a round, step 4 holds it itself), or `pkill` a pattern that is not anchored.

## 0 · Connect (any state)

```bash
cd ~/Desktop/projects/wt-pacs-phone-962 && git fetch origin && git checkout claude/phone-run && git pull --ff-only   # dirty: git stash first
pkill -f '^/[^ ]*/target/release/series-server ' ; pkill -f '^python3 [^ ]*server/dev-server\.py ' ; pkill -f '^python3 lab/devices/(round|collector)\.py ' ; true
```

The binaries and bundles are the local session's build at the run code (SATURDAY.md §0's build lines). **Owner:** the
phone on the home Wi-Fi, tethering off, on its charger and on USB, power saving off, other apps closed; allow USB
debugging if `adb devices` says "unauthorized". The `sudo` lines are the **owner's**:

```bash
read -r IF LAPTOP_IP < <(ip -4 route get 192.0.2.1 | awk '{for (i = 1; i < NF; i++) {if ($i == "dev") d = $(i + 1); if ($i == "src") s = $(i + 1)}} END {print d, s}')
if sudo firewall-cmd --state >/dev/null 2>&1; then
  ZONE=$(sudo firewall-cmd --get-zone-of-interface="$IF" 2>/dev/null | grep -vx 'no zone') || ZONE=$(sudo firewall-cmd --get-default-zone)
  sudo firewall-cmd --zone="$ZONE" --add-port=4433-4436/udp --timeout=12h
fi
adb devices                                            # "device"
for p in 8765 8766 8767 8768 8780 8443; do adb reverse tcp:$p tcp:$p; done
mkdir -p target/phone-state && for s in battery thermalservice; do adb shell dumpsys $s > target/phone-state/$s-before.txt; done
adb shell dumpsys wifi | grep -m1 mWifiInfo > target/round-wifi-before.txt
```

**Owner:** one line in `target/round-notes.txt`: the distance to the access point in metres and the walls between.

## 1 · The shell reads (untimed; *not sourced*: each read's outcome is the record)

```bash
cd ~/Desktop/projects/wt-pacs-phone-962 && mkdir -p target/probe-shell
adb shell 'cat /vendor/etc/media_codecs*.xml /odm/etc/media_codecs*.xml 2>/dev/null' > target/probe-shell/codecs.xml
adb shell dumpsys media.player > target/probe-shell/media.player.txt
PID=$(adb shell pidof com.android.chrome); adb shell cat /proc/$PID/stat > target/probe-shell/chrome.stat   # empty: "not read"
```

## 2 · FULL only: the dry run (28 loads, 15 min)

SATURDAY.md §2 with each `node` written `NODE`; its read-back and its rule on a failure hold.

## 3 · The round

```bash
cd ~/Desktop/projects/wt-pacs-phone-962 && LAPTOP_IP=$(ip -4 route get 192.0.2.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p'); test -n "$LAPTOP_IP"
R=target/short; COUNTS="--bench-reps 1 --rounds 12 --pairs 1"     # 3S; for 3F: R=target/round; COUNTS=
NODE lab/devices/round_plan.mjs demo-series $R --dial "$LAPTOP_IP" $COUNTS
python3 lab/devices/round.py $R/plan.json $R/out --bind 127.0.0.1 --host http://127.0.0.1:8780
```

**Owner:** Chrome, `http://127.0.0.1:8780/`, **Start**, once. 3S: 66 loads, ~46 min; 3F: 144 loads, ~2 h 10 min.

**3S's smoke check**, in a second shell, in place of the dry run (it sees the page, the runner, the beacon and
HTJ2K's bench; the first fill over Wi-Fi is load 13, a warm-up, so its verdict is read too):

```bash
cd ~/Desktop/projects/wt-pacs-phone-962 && B=target/short/beacon.jsonl
until [ "$(cat $B 2>/dev/null | grep -c '"kind":"verdict"')" -ge 2 ]; do sleep 5; done; grep '"kind":"verdict"' $B | head -2
until [ "$(cat $B 2>/dev/null | grep -c '"kind":"verdict"')" -ge 13 ]; do sleep 5; done; grep '"kind":"verdict"' $B | sed -n 13p
```

All `"ok":true`: leave it. A failure: Ctrl-C `round.py`, `mv target/short target/short-smoke-$(date +%H%M)` (kept,
committed with the rest), its `why`, then SATURDAY.md §2's rule on a failure, and step 3 again.

At "round done": `for s in battery thermalservice; do adb shell dumpsys $s > target/phone-state/$s-after.txt; done;
adb shell dumpsys wifi | grep -m1 mWifiInfo > target/round-wifi-after.txt`. If `round.py` stops mid-round: SATURDAY.md
§3's restart with `target/round` read as `$R`; nothing committed between the stop and the restart.

## 4 · Cell 4 (3S: only if time is left; decides nothing)

```bash
S=$(adb shell settings get global stay_on_while_plugged_in); adb shell settings put global stay_on_while_plugged_in 7
```

then SATURDAY.md §4 as written, then `adb shell settings put global stay_on_while_plugged_in "$S"`.

## Raw rows

```bash
cd ~/Desktop/projects/wt-pacs-phone-962 && D=docs/phone-rows/raw/2026-11-22
LAPTOP_IP=$(ip -4 route get 192.0.2.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p'); test -n "$LAPTOP_IP"
P=target/phone-state; ! grep -r -q -i -E 'serial|imei' $P 2>/dev/null || { P=; echo "phone-state: not copied"; }
python3 lab/devices/raw_rows.py $D target/{dry,round,short,short-smoke-*,probe,probe-shell} $P target/round-*.txt \
  --strip "$PWD=WORKTREE" --strip "$HOME=HOME" --strip "$LAPTOP_IP=LAPTOP" --strip "$(adb get-serialno)=PHONE" &&
git add $D && git commit -m "phone round 2026-11-22: raw rows" && git pull --rebase && git push origin claude/phone-run
```

`raw_rows.py` filters the Wi-Fi and `logcat` files to what a cell reads and refuses a MAC or an SSID left. It allows
the `dumpsys battery` and `thermalservice` reads but copies them whole (temperatures, level, throttling status), so
the first line leaves them out, in `target/` only and noted *not copied*, if either names a serial or an IMEI. The
plan's absolute paths are stripped to `WORKTREE` and `HOME`. Missing sources are skipped, so the line runs after
either choice.
