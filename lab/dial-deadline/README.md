# A dial that never settles

K1 (row 45). WebKit bug 319879 leaves `WebTransport.ready` pending for ever. `exact-server
--hold-sessions` makes the same hang in any browser: it takes each CONNECT and never answers it.
`run.mjs` dials it with a bare `WebTransport`, the TS client, the WASM client and the downloader
side by side, then does the same against a server that answers.

```bash
NODE_PATH=$(npm root -g) node lab/dial-deadline/run.mjs 60000   # the cap, in ms
```

Results and the deadline they led to:
[`docs/proposal-session-survival.md`](../../docs/proposal-session-survival.md) §A dial that never settles.
