# worker-leak

What closed downloader clients leave behind in the renderer: its threads and resident memory after
`--clients` are opened and closed, against an idle page, variants interleaved. `--driver none` launches Chromium
with no DevTools session attached to any worker; `playwright` also counts the worker targets. The reading is
[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §Closing a client.

```bash
bash client/transport/ts/build.sh    # the client and client/contract/dist, which the page loads
NODE_PATH=$(npm root -g) node lab/worker-leak/run.mjs --clients 40 --rounds 3 --driver none [--decoders 3]
```

It starts `server/dev-server.py` on `PORT` (default 8772) and reads the renderer from `/proc`; `CHROME_PATH`
picks the browser.
