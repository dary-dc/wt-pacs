# Proposal: nginx in place of the dev host, and an image per project

**2026-09-14 · Status: built, `98abbf5`.** Structural, so this was a proposal first
(`CLAUDE.md`). Treat it as one deployment step, not a refactor. §Open after building holds what
reviewing the built shape turned up; none of it is fixed.

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

Fronting the transport with anything. Any change to the rewrite surface itself. The second
project's image, which waits on this one.

TLS on the page host, **on localhost only**: localhost is a secure context, so the page needs no
certificate there and adding one is a separate decision with its own measurement. It is not
optional anywhere else. Served from any other host over `http://`, the page is not a secure
context, `SharedArrayBuffer` is gone, and the client degrades silently rather than failing — the
config's own comment says why that is the dangerous direction. Since the reason for an image is a
run that is reproducible **off** this workstation, the first such run needs a certificate.

## Open after building

**2026-09-18**, from reading the built shape against a sibling deployment of it. Ordered by what
would bite first. Nothing here is fixed.

| what | why it matters | fix |
| --- | --- | --- |
| `compose.yml` mounts fixtures `:ro,Z` | `Z` is a **private** SELinux label: it relabels the host directory for one container and revokes every other reader. It passes today only because one container mounts it while `web` bakes its copy in. On the sibling deployment this exact flag revoked two running containers mid-session — nginx answered 403 on the metadata route and the server would not restart | `:ro,z`, the shared form |
| the certificate hash is baked into the web image | `gen_dev_cert.sh` writes `client/dev-transport.json` and the Containerfile `COPY`s `client`. `serverCertificateHashes` caps a pinned certificate at 14 days, so the file changes at least that often and the image keeps serving the stale hash until someone rebuilds. The page then dials with a wrong pin and fails with nothing naming the cause | serve that one file from a mount, not a `COPY` |
| two decisions in the Containerfile carry no comment | `rust:1-bookworm` → `debian:bookworm-slim` is the same Debian release on purpose — the binary links glibc and a mismatch fails at start, in the container only. And a build with no `--target` stops at the last stage, which is `web`, so a bare build silently produces one image of the two | a line above each |
| `check_equivalence.sh` does not compare caching headers | it compares status, the three isolation headers, content type and body bytes. nginx sends `ETag`; `dev-server.py` does not. Repeat loads can therefore revalidate differently across the swap and the check still passes — and page-load timing is part of the page clock, which is the measurement flag this document already raises | compare the caching headers too, or state that the check does not cover them |
| `/harness/` has two names | it is aliased at `/harness/` and also resolves at `/client/harness/` under `root`. Two entry points to one page is a thing to decide, not necessarily to change | one name, or a line saying both are kept deliberately |

Two things the built shape gets right and should not be traded away: the server runs as a
non-root user, and `fixtures/` is small enough (20 KB) that baking it into the web image costs
nothing.
