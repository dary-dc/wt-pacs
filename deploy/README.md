# deploy

The product run unattended on one host: nginx serves the viewer, and the transport server runs beside it.
Development and production run the same static host shape (`server/dev-server.py` here, the web image
there), so the headers and the paths are tested in the thing that ships.

```text
                 ┌──────────── web (nginx 1.29) ────────────┐
 browser ─ HTTPS 443 / HTTP 8765 ─▶ /  /client/**  /series/metadata  /wt/dev-transport.json
    │                              │         ▲ /studies (ro)          ▲ volume `transport` (ro)
    │                              └─────────┼────────────────────────┼─┘
    │                                        │                        │
    └─ WebTransport, UDP 4433 ─▶ ┌── server (series-server, uid 10001) ─┐
       (WebSocket, TCP 4433)     │ start: a new certificate (10 days),   │
                                 │ the transport file written whole,    │
                                 │ then `timeout $RESTART_AFTER` server  │
                                 └─ /studies (ro) ─ /certs ─ /run/wt-pacs ┘
```

**nginx is not in the transport's path and cannot be.** The server speaks WebTransport over QUIC on UDP 4433
and nginx has no QUIC upstream, so the browser dials it directly, as in development. No data-path number can
move because of anything here.

## Run it

From a fresh clone, with docker (or podman; every `docker` below reads `podman` as well):

```bash
bash client/decode/wasm/build/build.sh        # the decoders the page loads, checked against their manifest
bash client/decode/wasm/fetch_xxh3.sh         # the frame check's hasher
docker compose -f deploy/compose.yml build
STUDIES=/path/to/studies SERIES=ct docker compose -f deploy/compose.yml up -d
```

`STUDIES` holds what row INGEST writes, `$SERIES.sbnd` and `$SERIES.metadata.json`
([`../docs/FIXTURES.md`](../docs/FIXTURES.md) §From DICOM); without it, the 32 KB smoke series baked into both
images is served. Open `http://127.0.0.1:8765/`. Off this host, the page needs TLS:

```bash
PUBLISH_ADDR=203.0.113.7 WT_URL=https://203.0.113.7:4433/ TLS_DIR=/etc/wt-pacs/tls \
  STUDIES=... SERIES=... docker compose -f deploy/compose.yml up -d     # https://203.0.113.7/
```

| variable | default | what |
| --- | --- | --- |
| `STUDIES` | `../fixtures/us_cine_smoke` | the host directory mounted read-only at `/studies` in both containers |
| `SERIES` | `us_cine_smoke` | the series served: `$STUDIES/$SERIES.sbnd` and `$SERIES.metadata.json` |
| `PUBLISH_ADDR` | `127.0.0.1` | the address 8765, 443 and 4433 (UDP and TCP) are published on |
| `WT_URL` | `https://127.0.0.1:4433/` | the address the transport file tells the browser to dial |
| `TLS_DIR` | `./no-tls` (none) | `cert.pem` (the chain) and `key.pem` for the page; absent, web speaks HTTP on 8765 alone |
| `TLS_PORT` | `443` | the host port published for web's 443 |
| `RESTART_AFTER` | `9d` | the server exits after this and is restarted with a new certificate |
| `REGISTRY` | `docker.io/library` | where the pinned base images are pulled from: a mirror serves the same digests |
| `BUILD_CA` | `/dev/null` (none) | the CA of a TLS-inspecting proxy the build must go through, a build secret |

## The ten fixes, and why

A container test of a deployment of this shape found each one (queue row 92).

1. **SELinux.** Every bind mount is `:z` (shared, a label both containers may read), never `:Z` (private to one).
2. **Stop.** `stop` measured 0.45–0.49 s on the server and 0.51–0.54 s on web (three and two runs): under a
   second, so there is no `init: true`. PID 1 is `timeout`, which passes SIGTERM to the server, and the server
   ends on it itself (`server/src/main.rs`).
3. **The certificate's lifetime.** A certificate pinned by hash (`serverCertificateHashes`) must be valid for at
   most 14 days. So `server-start.sh` makes a new one (ECDSA P-256, 10 days) at every start, and runs the server
   under `timeout $RESTART_AFTER` (9 days). The exit restarts the container, with a new certificate, before
   the browser refuses the old one.
4. **gzip** on every compressible type the page fetches, the series' metadata included: `check_equivalence.sh`
   asserts it on a module, on the WASM, and on metadata over nginx's 1 KiB floor. Nothing is proxied, so there is
   no `gzip_proxied`.
5. **The build cache.**
   * The server's stage copies each workspace member's manifest and sources alone, with cache mounts on the
     cargo registry and `target/`. The bundles stage runs `npm ci` on the lock file before it copies `client/`.
   * The ignore files keep out `docs/`, every `*.md`, the lab's results and the decoders' build cache.
   * After an edit to `docs/glossary.md` and `lab/av1/README.md`, 23 of 23 steps were cached and the build took
     1 s.
6. **`restart: unless-stopped`** on both services.
7. **The start order.**
   * The start script removes the previous transport file (the volume outlives the container) and writes the
     new one whole, through a temporary file and a rename.
   * The server is healthy once the file exists, and web once `/` answers 200.
   * Web waits on `service_healthy`, so it never serves a transport file that names a dead certificate.
8. **Non-root.** The server runs as uid 10001 and owns `/certs` (0700) and `/run/wt-pacs`. Both are made in the
   image, as is web's mount point for the same volume. A fresh named volume takes its owner from whichever
   container mounts it first, so web's must be 10001 too. Found by running it: the first start could not write
   the file. The key is 0600.
9. **Every base image pinned by digest**: `rust:1.97-bookworm`, `debian:bookworm-slim` (the server's runtime,
   the builder's release), `node:22.22.0-bookworm-slim` and `nginx:1.29-alpine` (1.29.8). `REGISTRY` names a
   mirror; a digest is the same wherever it is pulled from.
10. **The small ones.** `cargo build --locked`, `npm ci`, `server_tokens off` and `charset utf-8`. The routes
    nothing used are gone: the content-hashed asset rule, since nothing emits a hashed name, and `/harness/`,
    which the lab runs against `dev-server.py`.

**What the web image carries.** `client/` whole except its tests (`client/contract/`, `*.test.mjs`) and dev files,
and the TS bundles (`build.sh --product`). It carries row DECODERBUILD's decoder builds with their notices
(`client/decode/wasm/built/`), checked against `build/manifest.sha256` at build time, and the hasher. Of the
studies, only the smoke series.

**Only what the page loads is reachable**: `/`, `/client/**`, `/series/metadata` and `/wt/dev-transport.json`.
Everything else is a 404, the studies' bundles included.

**What must be preserved exactly.** Three headers on every response, error pages included:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Cross-origin isolation is what gives the page `SharedArrayBuffer`. Losing it degrades the client silently rather
than failing, since the downloader refuses to start without it. Pages and the metadata are revalidated
(`Cache-Control: no-cache` on `text/html` and `application/json`); modules and WASM keep heuristic caching. The
`types` block is there because nginx's `mime.types` answers `.js` as `application/javascript` and has no `.mjs`.

## The checks

`check_equivalence.sh [STUDIES SERIES]` runs `dev-server.py` and the web image side by side, given the same studies
and the same transport file. It checks four things:

* status, the three isolation headers, content type, `Cache-Control` and body bytes are equal on every path the
  viewer loads (10);
* 8 paths that must not be served are 404: the lab, the fixtures, the checkout, a study's bundle, the transport
  directory, the tests;
* gzip on a module, the WASM and the metadata;
* `Server` carries no version.

Each new assertion was mutated and seen to fail it: `server_tokens on`, JSON out of `gzip_types`, a `location /`
that serves and lists, and a page cached otherwise than `dev-server.py`. `--local` runs a host nginx on the
template instead of the image.

**A stale image is refused** (exit 2) before anything is compared: every file the Containerfile copies from
`client/` and `deploy/nginx/`, less what its ignore file keeps out, is hashed in the image and in the tree, and any
that differs, is missing or is extra is named. It compares content, not time: a cached rebuild keeps the image's
creation time, so a touched file would otherwise be refused after every rebuild. Mutated: a changed module, template
and decoder build, a file added and one removed (each named, exit 2); a touched file, a changed `*.md` and
`*.test.mjs` (passed, as the image leaves them out); no image (exit 2).

**The transport's PEM.** The same script checks `${CERT_PEM:-server/dev-cert/cert.pem}` before it compares any
path. One self-signed certificate passes; two or more is a chain and passes; one certificate issued by something
else warns, since a browser then fetches the intermediate over AIA on every cold open
([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §What production adds). The page's own certificate in
`TLS_DIR` should carry its chain for the same reason.

## Verified (2026-10-09)

**Runtime.** Docker 29.8.2 with compose v5.6.0, through a TLS-inspecting proxy: `BUILD_CA`, and
`REGISTRY=mirror.gcr.io/library` because Docker Hub answered 429. Rootless podman is not installed here, so its
run is unchecked.

**Images and build.** `wt-pacs-server` is 132 MB and `wt-pacs-web` 95.8 MB (33.6 and 26.7 MB of content). A cold
build, the builder's cache pruned, takes 114 s; a rebuild after a doc edit takes 1 s.

**The page check against the deployment.** `client/viewer/check.mjs --url`, on row INGEST's CT bundle (76 frames,
HTJ2K): 76/76 exact, and the first, middle and last readback equal the CPU reference.

* **On loopback:** `http://127.0.0.1:8765/`, headless Chromium 141, no certificate flag.
* **Off loopback:** the host's second address, published and dialled there (`PUBLISH_ADDR=192.0.2.2`, `WT_URL`
  naming it), the page over TLS with HTTP/2 on 8443. Its certificate was issued by a test CA trusted in Chromium's
  NSS store, not by a flag.

The check now reads its result off the page as well as from the page's POST. Chrome 141's Local Network Access
refuses a page on a public address a request to `127.0.0.1`, where the check's collector listens.

**Restart.** `restart server` wrote a new certificate (hash `4ab2c24e…` became `8f39cd57…`) and transport file,
and the next page open connected and passed.

## Open

| what | why it matters | what would close it |
| --- | --- | --- |
| rootless podman | the brief's first runtime is unchecked | a host with it: build, `up`, the page check |
| studies by name | one server serves one series (`SERIES`) | a study index, proposed in `docs/FIXTURES.md` §From DICOM |
| HTTP/3 for the page, and a `dns-prefetch` to the transport's origin | each takes a round trip off a cold open ([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §What production adds) | nginx's QUIC listener; one `<link>` in the viewer |
| the decoders are built on the host | the image checks them against the manifest but does not make them | row DECODERBUILD's container as a stage, once its build runs inside BuildKit |

**A measurement flag.** Page-load timing is part of the page clock. A comparison spanning a switch from one host
to the other is not comparable across it: take a before and after in one interleaved run.
