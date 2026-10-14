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
| `WT_URL` | `https://127.0.0.1:4433/` | the address the transport file tells the browser to dial, and the one origin besides the page's that web's policy lets it connect to |
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

**A Content-Security-Policy on every response**, so the workers carry it as well as the page:

```
default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
connect-src 'self' ${WT_ORIGIN}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
```

`WT_ORIGIN` is `WT_URL`'s scheme, host and port; an `https:` source also covers the WebSocket fallback's `wss:`.
`'unsafe-eval'` is the decoders' glue, evaluated through `new Function` (`client/decode/wasm-glue.js`), and lets
WebAssembly compile; the inline `<style>` is the page's. `dev-server.py` sends the same policy on the viewer's page
alone, connecting anywhere on loopback, where the lab's relays and collectors listen; the lab's pages, which share
the viewer's workers and run inline scripts, carry none. The page's lab parameters are not served here at all:
`client/README.md` §The viewer.

## The checks

`check_equivalence.sh [STUDIES SERIES]` runs `dev-server.py` and the web image side by side, given the same studies
and the same transport file. It checks five things:

* status, the three isolation headers, content type, `Cache-Control` and body bytes are equal on every path the
  viewer loads (10);
* 9 paths that must not be served are 404: the lab and its viewer parameters, the fixtures, the checkout, a study's bundle, the transport
  directory, the tests;
* gzip on a module, the WASM and the metadata;
* the policy on the page and on the downloader's script, connecting to the transport, and the dev host's on the page
  equal to it but for `connect-src`;
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

## Container settings

**Queue row 199 (theory, 2026-10-14); row 195 measures it on the owner's machine.** The server's read path has two fast
paths ([`../docs/adr/disk-access.md`](../docs/adr/disk-access.md) §1): `RWF_NOWAIT` serves a page-cache hit inline,
and io_uring serves a tile's miss. A container can take either away without an error. The fall is correct and slower:
the pool instead of the inline read costs **132.5 against 48.4 µs a frame**, every frame. The pool instead of the ring
costs **+106 to +138 % CPU per tile miss** in the agent container, and **ties** on the workstation (the ADR's §5). A fill
never builds a ring, so io_uring matters only to tile misses. In order of cost:

| setting | what it keeps | where it is lost | security cost |
| --- | --- | --- | --- |
| series on a bind mount or named volume (ext4, XFS) | `RWF_NOWAIT`: every warm frame inline | the image's own layer (overlayfs) and tmpfs refuse it | none |
| `seccomp=./seccomp-uring.json` | io_uring on a tile miss | Docker ≥ 25, Podman, containerd ≥ 2.0 refuse it by default | the kernel's io_uring surface, below |
| `memlock` sized to the rings, one uid per server | io_uring past ~1 000 rings | a uid's ~1 000th concurrent ring, host-wide | locked memory up to the limit |
| `nofile` ≥ 2 × sessions that miss + sockets | the ring's two fds | the daemon's default, whatever it is | none |
| on an SELinux-enforcing host, `io_uring { allowed }` for the container's domain | io_uring on a tile miss | container-selinux grants it to no container domain: `EACCES` even under the profile (row 195, probed on Fedora 43) | `label=disable` drops the container's SELinux confinement; a module granting that one permission to `container_t` (untried) reaches every container on the host |

**Verified on this host** (Docker 29.8.2, containerd 2.3.6, runc 1.5.1, Linux 6.18, cgroup v1, ext4). A static probe
(`io_uring_setup`, `_register`, `_enter`, then rings until refused, then `preadv2(RWF_NOWAIT)`), run as uid 10001 with
each setting alone. The server's own read-path tests ran under each profile too.

* **Storage.** A bind mount and a named volume (`/var/lib/docker/volumes`, ext4 here) honour `RWF_NOWAIT`. The
  container's layer (overlayfs) and `--tmpfs` refuse it (`EOPNOTSUPP`). This Containerfile `COPY`s the smoke series
  into `/studies` in the image's layer, where the fast path is lost; compose mounts `STUDIES` over it, which keeps it.
  The page cache is the host's, per inode, so folios are the underlying filesystem's (row 172's findings hold as on
  the host; row 195 counts them). The pages are charged to the container's memory cgroup: a tight `mem_limit` evicts
  the series inside it.
* **seccomp.** Under Docker's default profile `io_uring_setup` fails with `EPERM`. The server's read-path tests then
  pass with 6 of 29 skipped for io_uring, and 4 more where `/tmp` is the overlay layer. One failed: its ring assert
  lacked the skip its siblings have, fixed in `f3689796`. Under `seccomp-uring.json` all three calls work and 29 of 29
  run. `seccomp=unconfined` works too, and drops the whole filter: never use it.
* **memlock.** Rings are charged to the uid's locked memory against `RLIMIT_MEMLOCK` (kernel 6.18, `io_uring/memmap.c`
  and `rsrc.c`): **1 024 bare four-entry rings at 8 MiB, 512 at 4 MiB** (8 KiB each). The ADR's ~940 is the server's
  own ring. Three findings change the ADR's advice:
  * **The counter is per uid, host-wide.** While one uid-10001 container held its 1 024 rings, a second uid-10001
    container's first ring failed (`ENOMEM`), and a uid-10002 container got 1 024. Two servers on one host share one
    budget unless their uids differ.
  * **`--cap-add IPC_LOCK` does nothing for `USER 10001`.** Docker gives a non-root user no effective capabilities,
    so the probe got 1 024 rings either way. As root with `IPC_LOCK`, rings were bounded only by `nofile` (19 996).
  * **The exemption counts only in the initial user namespace** (`ns_capable_noaudit(&init_user_ns, CAP_IPC_LOCK)`).
    Rootless Docker, rootless Podman and `userns-remap` can never escape the limit, read from the source and not run.
  * **Not measured here:** raising the limit. This host refused it outright (`--ulimit memlock=` above 8 MiB failed in
    runc, and the host's own root cannot raise its hard limit). A daemon that may raise it passes `ulimits` through.
    Rootless, the ceiling is the daemon's own hard limit.
* **Hardening that costs the read path nothing:** `no-new-privileges:true` and `cap_drop: [ALL]` with the profile
  still give io_uring, `RWF_NOWAIT` and 1 024 rings. The server needs no capability (non-root, port 4433). Untried with
  the server itself: a read-only root, since the start script writes `/certs`.

**What the runtimes do by default**, read from their sources at the named commits:

| runtime | io_uring under its default profile | errno | since |
| --- | --- | --- | --- |
| Docker | refused | `EPERM` (`defaultErrnoRet: 1`) | 25.0: moby #46762, `891241e` (2023-11-02). Allowed from moby #39415 to 24.0.9. Docker 29.8.2 vendors `moby/profiles` `seccomp/v0.2.3` |
| containerd `RuntimeDefault` (Kubernetes) | refused | `EPERM` | 2.0.0: containerd #9320, `a48ddf4a` (2023-11-02). The 1.7 line (1.7.36) still allows it |
| Podman, CRI-O (`containers/common`) | refused | `ENOSYS` (`defaultErrnoRet: 38`) | `v0.40.1`: `399bd59e` (2021-06-16) |
| Kubernetes with no `seccompProfile` | the pod is `Unconfined` unless the kubelet sets `seccompDefault: true` | — | kubelet configuration; not run here |
| any, kernel ≥ 6.6 | `kernel.io_uring_disabled=2` refuses everyone, `=1` all but `CAP_SYS_ADMIN` and `kernel.io_uring_group` | `EPERM` | host-wide; a container cannot change it (`io_uring/io_uring.c`, `io_uring_allowed`) |

**Why they refuse it, and what allowing it costs.** Both runtimes cite Google's kCTF report (2023-06): 60 % of its
kernel-exploit submissions used io_uring, and so did every one that bypassed its mitigations. Google disabled io_uring
on ChromeOS and on its production servers, and Android's seccomp filter keeps it from apps. The profile here allows
the three calls and nothing else (`seccomp-uring.sh` diffs it against the pinned default). But seccomp cannot see the
operations a ring runs: open, socket and connect run without a system call the filter could judge. So allowing
`io_uring_setup` gives code that already runs in the container the whole io_uring interface and its kernel bugs. It
narrows nothing about the server's own ring. **Adopting the profile is the owner's call.** The trade is that exposure
against tile misses through the pool, which are free on the workstation and up to +138 % CPU in the agent container.
Row 195 measures what it buys on the owner's machine. Until then `compose.yml` does not load it.

**The settings, for a deployment that takes the trade** (compose; `docker run` takes the same as `--security-opt`
and `--ulimit`):

```yaml
  server:
    security_opt: ["seccomp=./seccomp-uring.json", "no-new-privileges:true"]   # relative to this file: verified
    cap_drop: [ALL]
    ulimits:
      memlock: { soft: 67108864, hard: 67108864 }   # 64 MiB, ~7 500 rings for this uid; not run here
      nofile: { soft: 65535, hard: 65535 }
```

Kubernetes (not run here): copy the profile to each node's `/var/lib/kubelet/seccomp/`, and set
`securityContext.seccompProfile: {type: Localhost, localhostProfile: seccomp-uring.json}`. Kubernetes has no
per-pod `ulimit`, so `memlock` is the node runtime's. Podman: `--security-opt seccomp=deploy/seccomp-uring.json`;
rootless Podman 5.8.4 accepts it, and on its SELinux-enforcing host the ring then needs the row above
(`docs/adr/disk-access.md` §In a container). The rest of rootless podman is unchecked (§Open). `seccomp-uring.json` is Docker's Apache-2.0 profile with one
entry added. `seccomp-uring.sh` writes it from the pinned, checksummed fetch, and `--check` says whether it is
current (a changed entry and a wrong checksum each failed it). Regenerate it when the pinned Docker moves.

**Which path is live.** The startup banner says `read_fast_path=preadv2` or `pooled_pread`. Nothing reports the ring
until a tile session misses; then each such session tries `io_uring_setup` once and warns
`io_uring unavailable; this session reads through the pool`. `ulimit -l` and `ulimit -n` inside the container are the
daemon's, so read `/proc/1/limits` there. **Proposed, not built** (a row to take after 195):

* a `read_ring=available` or `read_ring=refused (<errno>)` line in the banner, from one ring built and dropped at start
  (15.6 µs), with the `memlock` limit beside it. On a refusal, sessions start with the pool, and the per-session warning
  goes.
* the same probe in `check-fastpath`, shipped in the server image, so `docker compose exec server check-fastpath
  /studies` gates a rollout: 0 with both fast paths, 1 with either lost.
* compose's health check stays the transport file. A slow path is not an unhealthy one, and failing it would hold
  `web` from starting.

## Open

| what | why it matters | what would close it |
| --- | --- | --- |
| rootless podman | the brief's first runtime is unchecked | a host with it: build, `up`, the page check |
| io_uring and `memlock` in the deployment | Docker ≥ 25 refuses the tile ring by default; the fix reopens io_uring (§Container settings) | row 195's measurement, then the owner's call on `seccomp-uring.json`; the `read_ring=` probe |
| studies by name | one server serves one series (`SERIES`) | a study index, proposed in `docs/FIXTURES.md` §From DICOM |
| HTTP/3 for the page, and a `dns-prefetch` to the transport's origin | each takes a round trip off a cold open ([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §What production adds) | nginx's QUIC listener; one `<link>` in the viewer |
| the decoders are built on the host | the image checks them against the manifest but does not make them | row DECODERBUILD's container as a stage, once its build runs inside BuildKit |

**A measurement flag.** Page-load timing is part of the page clock. A comparison spanning a switch from one host
to the other is not comparable across it: take a before and after in one interleaved run.
