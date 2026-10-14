# A device evening, in order

D0 → D1 → D2 ([`../../docs/devices.md`](../../docs/devices.md)), quick mode first: a provisional reading on the phone in
about 15 minutes, then full mode where the quick one asks for it. The kit: [`README.md`](README.md).

## Once, before the first evening (local machine)

1. A name you control pointing at the Oracle machine, and a Let's Encrypt certificate for it by DNS-01:
   `cert.pem` (full chain) and `key.pem` in a directory outside the checkout.
2. The cloud's security list: TCP 8443 and UDP 4435, 4436, 4438, 4439 open to the internet (4437 stays off).
3. ```bash
   bash client/decode/wasm/build/build.sh && bash client/decode/wasm/fetch_xxh3.sh && client/transport/ts/build.sh
   docker compose -f deploy/compose.yml build server
   lab/av1/tools/tools.sh && FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160
   OUT=~/wt-pacs-bundles lab/devices/make_bundles.sh             # ~20 min at cpu0
   ```

## Each evening (local machine, ~3 min)

```bash
export CLOUD_HOST=… SSH_KEY=… PUBLIC_NAME=… TLS_DIR=… STUDIES=~/wt-pacs-bundles
export DEVICES_TOKEN=$(openssl rand -hex 16)
lab/devices/deploy.sh up      # ports, image, kit, four arms, collector; prints each arm's URL and the phone's
```

`up` stops on any port that is taken or that the host firewall rejects, and says which. Then, before picking up the
phone, the same quick evening in headless Chromium from the local machine (~1 min; its rows carry a desktop user
agent):

```bash
NODE_PATH=$(npm root -g) node lab/devices/dry_run.mjs "https://$PUBLIC_NAME:8443/?t=$DEVICES_TOKEN"   # "dry run ok"
```

## On the phone (Samsung, Android 16; Chrome first, then Firefox)

1. Plugged in, screen on, on a stand; every other app closed. Open `https://PUBLIC_NAME:8443/?t=TOKEN`.
2. Tap the link as it is now: **Wi-Fi**.
3. Mode **Quick**, then **Evening: D0 → D1 → D2**. Leave it (~15 min). The screen shows each reading as its run ends.
4. Read the D0 lines: every arm's dial `ready`? If one reads an error, stop: the security list or the certificate
   (a refused hash → `SUPPLY_CERT=1 lab/devices/deploy.sh up`, then reload).
5. If the quick reading is worth the time: **Full**, **D1 decode** (~30 min), then **D2 field** on each link —
   **Wi-Fi**; **Cellular** (Wi-Fi off, indoors, at rest); **Cellular + video** (a video playing in another app) —
   each a fresh tap of the link, then **D2 field**.
6. The same page on the local machine's Chrome, same Wi-Fi, **D2 field** between the phone's blocks: the control.
7. Firefox: steps 1–4 (D0 and quick), then as the time allows.
8. If a post failed (the line under the readings says so): **Save results**, and copy the file to the local machine.

## After (local machine)

```bash
lab/devices/deploy.sh fetch lab/devices/raw/$(date +%F)     # the host's names replaced, checked gone
lab/devices/deploy.sh down
```

Before committing the rows: no serial, location or account in them (the page records none), and the reading goes in
the doc that owns its subject ([`../../docs/devices.md`](../../docs/devices.md) §5).
