# early-messages

Messages posted before the other side listens, in the product's own sites: each trial opens the receiver and
posts at once, and a message that never arrives is a loss. Driverless Chromium (a DevTools session pauses every
worker at start), one page per variant per round, variants rotated. `bc-worker.js` is the `BroadcastChannel`
control. The reading is [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §Messages posted before anyone
listens.

```bash
bash client/transport/ts/build.sh    # the client and client/contract/dist, which the page loads
NODE_PATH=$(npm root -g) node lab/early-messages/run.mjs --rounds 5 --n 1000 [--variants bc,downloader]
```

It starts `server/dev-server.py` on `PORT` (default 8774); `CHROME_PATH` picks the browser.
