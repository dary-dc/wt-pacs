# Proposal: nginx in place of the dev host, and an image per project

**2026-09-14 · Status: proposed, nothing built.** Structural, so this is a proposal first
(`CLAUDE.md`). Treat it as one deployment step, not a refactor.

## Why

`server/dev-server.py` is 71 lines of Python that serve the harness, the WASM bundles and
`dev-transport.json`, and set three headers. Deployment will use nginx. Running one thing in
development and a different thing in production means the headers, the path rewrites and the MIME
types are only ever tested in the one that does not ship.

Second, we want an image per project so a run is reproducible off this workstation. This repository
first, because it is where the changes are made.

## What nginx replaces, and what it does not

**Replaces:** static hosting, the path rewrites, the headers.

**Does not:** the transport. This server speaks WebTransport over QUIC on UDP 4433 and **nginx
cannot proxy that** — it has no QUIC upstream. nginx serves the page; the browser dials the
transport endpoint directly, exactly as it does today. Nothing about the data path changes, which
is also why this cannot move a transport number.

## What must be preserved exactly

Three headers, on every response — cross-origin isolation is what gives the page
`SharedArrayBuffer`, and losing it silently degrades the client rather than failing:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

The rewrites `dev-server.py` performs (`/wt/dev-transport.json` → `client/dev-transport.json`, the
`pkg/`, `pkg-telemetry/` and `transport-ts/` aliases) become `location` blocks. They are a
compatibility surface for the harness pages, so they move across unchanged rather than being
tidied; tidying them is a separate change with its own reason.

`scripts/gen_dev_cert.sh` keeps writing the cert and pinning its hash into `dev-transport.json`.
nginx does not need the cert — the page is served plainly on localhost, which is a secure context,
and the pinned hash is what the transport uses.

## Shape

One `Containerfile`, two build targets:

| target | contains | runs |
| --- | --- | --- |
| `web` | nginx + the built client assets + the config | the page, with the headers above |
| `server` | the `exact-server` binary and a fixture mount | UDP 4433 |

A compose file brings both up. The image tags say which project they are; the second project gets
its own image once this shape is proven here.

## Rollout, and how we know it worked

1. Write the nginx config and prove it equivalent: same three headers on every path, every rewrite
   resolving, correct MIME for `.wasm`, and the harness completing a run against it.
2. Add the Containerfile and compose; the same proof from inside the image.
3. Only then delete `dev-server.py`. Keeping both briefly is what makes step 1 checkable.

**A measurement flag.** Page-load timing is part of the page clock, and this changes what serves
the page. Any comparison that spans the change is not comparable across it. Take a before and after
on the same box, in one interleaved run, or accept that the older numbers are a different cell.

## Not in this proposal

Fronting the transport with anything. TLS on the page host — localhost is already a secure context
and adding TLS is a separate decision with its own measurement. Any change to the rewrite surface
itself. The second project's image, which waits on this one.
