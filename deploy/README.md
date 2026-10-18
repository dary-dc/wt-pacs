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
move because of anything here. TCP 4433 is published for the WebSocket fallback, but `server-start.sh` passes no
`--websocket`, so nothing answers there unless the `server` service is given `command: ["--websocket"]`.

## Run it

From a fresh clone, with docker (or podman; every `docker` below reads `podman` as well):

```bash
bash client/decode/wasm/build/build.sh        # the decoders and the frame check's hasher, checked against their manifest
docker compose -f deploy/compose.yml build
STUDIES=/path/to/studies SERIES=ct docker compose -f deploy/compose.yml up -d
```

`STUDIES` holds what the DICOM ingest writes, `$SERIES.sbnd` and `$SERIES.metadata.json`
([`../docs/FIXTURES.md`](../docs/FIXTURES.md) §From DICOM); without it, the 151-byte smoke series baked into both
images is served, whose frames are placeholders that do not decode. Open `http://127.0.0.1:8765/`. Off this host,
the page needs TLS:

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
| `MEMLOCK` | `67108864` (64 MiB) | the server's locked-memory limit, soft and hard, which its rings are charged to (§Container settings) |
| `NOFILE` | `65535` | the server's open-file limit, soft and hard; a ring holds one (two until row 250) |
| `BUILD_CA` | `/dev/null` (none) | the CA of a TLS-inspecting proxy the build must go through, a build secret |

## A server compiled outside the image

`docker build` runs in the daemon, so the compile cannot be pinned to chosen cores there; `docker run --cpuset-cpus`
can. A deploy host that must keep the compile off its other cores compiles in the pinned rust image of `Containerfile`
and packages the binary with `Containerfile.prebuilt`, which cannot compile and yields the `server` target's image
(`deploy/server_start_test.sh` fails if the two `server` stages part):

```bash
docker run --rm --cpuset-cpus 0 --memory 8g -v "$PWD":/src -v "$HOME/.cache/wt-pacs-cargo":/usr/local/cargo/registry -w /src \
  docker.io/library/rust:1.97-bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 \
  cargo build --release --locked -p series-server
STAGE=$(mktemp -d)
cp target/release/series-server deploy/server-start.sh "$STAGE"/ && cp -r fixtures/us_cine_smoke "$STAGE"/
docker build -f deploy/Containerfile.prebuilt -t wt-pacs-server "$STAGE"   # the image `compose up` runs, given no `--build`
```

A flag on `Containerfile` to skip its compile stage would not do: only BuildKit skips an unused stage, and a daemon on
the legacy builder would compile anyway, unpinned. The binary links glibc, so it must come from that bookworm image.

## The ten fixes, and why

A container test of a deployment of this shape found each one (the deployment test, queue row 92).

1. **SELinux.** Every bind mount is `:z` (shared, a label both containers may read), never `:Z` (private to one).
2. **Stop.** `stop` measured 0.45–0.49 s on the server and 0.51–0.54 s on web (three and two runs): under a
   second, so there is no `init: true`. PID 1 is `timeout`, which passes SIGTERM to the server, and the server
   ends on it itself (`server/src/main.rs`): it closes every session with `H3_NO_ERROR` (0x100), so a client
   learns of the stop at once rather than from a stall or its idle timeout, waits up to 250 ms for the closes
   to drain, and exits. Without the wait the process ends before the close is sent.
   *2026-10-16, row 270:* before, the server exited without a close, which a test showed (its client saw only its
   idle timeout); the times above are from then. The wait is quinn's drain, three probe timeouts, so it runs to its
   bound on a slow link. *Timed* by `lab/scripts/stop_timing.sh 10` (`MEMLOCK=8388608 NOFILE=20000`, this host's
   limits), the wall time of `docker compose stop server` with a Chromium 141 page mid-fill of a 400-frame series
   under an 18 Mbit/s shape, three arms interleaved, on a 4-core host never below 22 % idle. Today's image took
   453–706 ms (medians 509 and 515 in two runs) and a second build of it 448–682 ms (536, 517). With the wait
   bounded at 500 ms the stop took 961–1 560 ms (median 1 010, five of ten at 1 s or more), so by the row's rule the
   bound was halved; at 250 ms, 693–1 367 ms (median 734, one of ten over 1 s). ~~The stop is not shown under a
   second: the bound or `init: true` is the owner's call.~~ *Corrected 2026-10-17, row 270:* it is, and the
   1 367 ms was not the server's. Timed by phase (the script now records when the server logged the signal and when
   it exited; 30 more rounds on a build stamping each step inside the process), the server's share of every stop
   at 250 ms, signal to exit, is the bound and 3–19 ms more: 253–269 ms in 70 stops, tokio's runtime drop 0–4 ms of
   it. The rest is docker's and alike in every arm: from `compose stop` to the signal, and from the exit to
   `compose stop` returning. Its tail is the host's. In a 20-round run that met a co-tenant's load (idle 0–20 % for
   five minutes), every stop of 1 s or more fell in that window and in docker's phases: today's image's two builds up to 1 248 and
   1 364 ms, the 250 ms build up to 1 240 ms (5 of 20), its server still 253–269 ms; the earlier run was not timed by phase,
   so where its 1 367 ms went is not known. The run after it, on a 4-core host never below 44 % idle, a synthetic
   400-frame HTJ2K series (410 kB a frame, `lab/scripts/gen_htj2k_fixtures.sh g512`): today's image 449–559 ms
   (median 518), a second build 458–570 (488), the 250 ms build 713–820 (780), none at 1 s; docker's phases
   129–216 ms before the signal and 293–398 ms after the exit. So no `init: true`, and the bound stays at 250 ms;
   nothing is claimed for a saturated host. *What the page sees:* Chromium reports the close as
   `WebTransportError: Connection lost.` with no code, since wtransport 0.7 sends QUIC's `CONNECTION_CLOSE` and no
   `CLOSE_WEBTRANSPORT_SESSION` capsule, so the rule's "closed with the server's code" cannot be observed from a
   page. The page does see the session end 195–299 ms after the stop began with the close (20 of 20; a session the
   page opens beside the fill), against about 14.9 s without it (36 of 40; 4 at 217–289 ms).
3. **The certificate's lifetime.** A certificate pinned by hash (`serverCertificateHashes`) must be valid for at
   most 14 days. So `server-start.sh` makes a new one (ECDSA P-256, 10 days) at every start, and runs the server
   under `timeout $RESTART_AFTER` (9 days). The exit restarts the container, with a new certificate, before
   the browser refuses the old one. `server_start_test.sh`, in the gate, runs its two starts against a stub server.
4. **gzip** on every compressible type the page fetches, the series' metadata included: `check_equivalence.sh`
   asserts it on a module, on the WASM, and on metadata over nginx's 1 KiB floor. Nothing is proxied, so there is
   no `gzip_proxied`.
5. **The build cache.**
   * The server's stage copies each workspace member's manifest and sources alone, with cache mounts on the
     cargo registry and `target/`. The bundles stage runs `npm ci` on the lock file before it copies `client/`.
   * The `target/` mount is the daemon's, shared by every checkout built there, and cargo judges a path crate
     fresh by mtime. So the build touches every source it copied before `cargo build`: this tree's are always
     newer than anything in the cache (row BUILDCACHE, §Open).
   * The ignore files keep out `docs/`, every `*.md`, the lab but its four crates' manifests and sources, and the
     decoders' build cache.
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

**What the web image carries.** The files of `client/` the viewer loads, which `web-files.sh` lists and copies: the
page and its modules, the page check's two (`?check=`), and row DECODERBUILD's decoder builds with their notices
(`client/decode/wasm/built/`, the frame check's hasher among them), checked against `build/manifest.sha256` at build
time; and the TS bundles (`build.sh --product`). No test, TypeScript source or build script. Of the
studies, only the smoke series.

**Only what the page loads is reachable**: `/`, those files under `/client/`, `/series/metadata` and
`/wt/dev-transport.json`. Everything else is a 404, the studies' bundles included.

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

`WT_ORIGIN` is `WT_URL`'s scheme, host and port, which the page dials over WebTransport.
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
* 17 paths that must not be served are 404: the lab and its viewer parameters, the fixtures, the checkout, a study's
  bundle, the transport directory, and the files of `client/` the page does not load (the check pages,
  a test, a TypeScript and a Rust source, a build script, a README);
* gzip on a module, the WASM and the metadata;
* the policy on the page and on the downloader's script, connecting to the transport, and the dev host's on the page
  equal to it but for `connect-src`;
* `Server` carries no version.

Each new assertion was mutated and seen to fail it: `server_tokens on`, JSON out of `gzip_types`, a `location /`
that serves and lists, and a page cached otherwise than `dev-server.py`; and for the policy (row VIEWERLOCK), nginx's
`connect-src` without the transport (both paths `MISS`) and the dev host's `script-src` allowing inline (`DIFF`).
`--local` runs a host nginx on the template instead of the image, its root the files `web-files.sh` copies;
`scripts/gate.sh` runs it where nginx is on PATH and the decoder builds are present, and names it
SKIPPED otherwise. Mutated: a root of all of `client/`, as the image carried before row IMAGESLIM (the nine
`client/` paths answer 200), and `viewer.js` left out of the list (its path differs and loses gzip); each fails it.

**A stale image is refused** (exit 2) before anything is compared: every file the image carries from `client/`
(what `web-files.sh` copies) and `deploy/nginx/` is hashed in the image and in the tree, and any that differs, is
missing or is extra is named. It compares content, not time: a cached rebuild keeps the image's
creation time, so a touched file would otherwise be refused after every rebuild. Mutated: a changed module, template
and decoder build, a file added and one removed (each named, exit 2); a touched file, a changed `*.md` and
`*.test.mjs` (passed, as the image leaves them out); no image (exit 2). Re-run on `web-files.sh`'s list (row
IMAGESLIM): a changed module, a file added to the list and one taken off it (each named, exit 2); a changed
`*.test.mjs` (passed).

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

**Row IMAGESLIM (2026-10-14).** The web image carries 34 files of `client/` (1.3 MB) where it carried all 85 the
ignore file let through; `wt-pacs-web` is 94.4 MB (26.4 MB of content). Both images built, and on the gate's grey
series (`client/viewer/run_check.sh`'s, packed into `STUDIES`) `check.mjs --url` passed through them in Chromium 141:
3/3 exact, readbacks equal to the CPU reference; `check_equivalence.sh` passed against the image and with `--local`
(nginx 1.24.0).

**Row BUILDCACHE (2026-10-15), each image its own checkout's binary.** Two worktrees of one commit, the second's
banner reading `buildcache235_mode=` for `stream_mode=`, edited before the first was built; `--target server` built
from the first, then the second, on one daemon, the string read off each image's `series-server`. Before the touch,
the second image carried the first's string: cargo found it fresh in 1.1 s. With it, each carried its own (57 and
58 s). Mutated, the touch replaced by `true`: the first checkout's image then carried the second's string, from a
build of the second left in the cache. **Cost, the server image alone, interleaved, three rounds:** after a doc edit,
0.4–1.0 s with and without (every step cached, as before); after a one-line edit of `server/`, 59.5–61.2 s with
against 53.5–56.9 s without, since every path crate is rebuilt where one was: fat LTO's link dominates both. The web
stages are unchanged.

**The page check against the deployment.** `client/viewer/check.mjs --url`, on the DICOM ingest's CT bundle (76 frames,
HTJ2K): 76/76 exact, and the first, middle and last readback equal the CPU reference.

* **On loopback:** `http://127.0.0.1:8765/`, headless Chromium 141, no certificate flag.
* **Off loopback:** the host's second address, published and dialled there (`PUBLISH_ADDR=192.0.2.2`, `WT_URL`
  naming it), the page over TLS with HTTP/2 on 8443. Its certificate was issued by a test CA trusted in Chromium's
  NSS store, not by a flag.

The check now reads its result off the page as well as from the page's POST. Chrome 141's Local Network Access
refuses a page on a public address a request to `127.0.0.1`, where the check's collector listens.

**Restart.** `restart server` wrote a new certificate (hash `4ab2c24e…` became `8f39cd57…`) and transport file,
and the next page open connected and passed.

**Row VIEWERLOCK (2026-10-14), the policy in place.** The web image built from that tree passed
`check_equivalence.sh`, and `client/viewer/check.mjs --url` through it on the gate's three-frame grey series passed
in headless Chromium 141 and in Firefox 157.0.1 under `xvfb-run` (archive.mozilla.org's
`firefox-157.0.1.tar.xz`, SHA-256 `0d92bf39cdd174f5f361008509310bdefbce72a57ca10523a43b32d62dc699b6`; the host's llvmpipe): 3/3 exact, the three readbacks equal
to the CPU reference, Firefox's result read off its stdout. `/lab/viewer/levers.js` answered 404. The policy governs the dial: an image
whose `connect-src` left out the transport failed the same check in Chromium, "Refused to connect to
'https://127.0.0.1:…/?ask=fill:0-2' because it violates the document's Content Security Policy".

## Container settings

**The container settings theory (queue row 199, 2026-10-14), measured in a cloud container by row 208
([`../docs/adr/disk-access.md`](../docs/adr/disk-access.md) §6, *Measured in a cloud container*; the owner's rig is row
216).** The server's read path has two fast paths ([`../docs/adr/disk-access.md`](../docs/adr/disk-access.md) §1):
`RWF_NOWAIT` serves a page-cache hit inline, and io_uring serves a tile's miss. A container can take either away
without an error. The fall is correct and slower:
the pool instead of the inline read costs **132.5 against 48.4 µs a frame**, every frame. The pool instead of the ring
costs **+106 to +138 % CPU per tile miss** in the agent container, and **ties** on the workstation (the ADR's §5). A fill
never builds a ring, so io_uring matters only to tile misses. In order of cost:

| setting | what it keeps | where it is lost | security cost |
| --- | --- | --- | --- |
| series on a bind mount or named volume (ext4, XFS) | `RWF_NOWAIT`: every warm frame inline | the image's own layer (overlayfs) and tmpfs refuse it | none |
| `seccomp=./seccomp-uring.json` | io_uring on a tile miss | Docker ≥ 25, Podman, containerd ≥ 2.0 refuse it by default | the kernel's io_uring surface, below |
| `memlock` sized to the rings, one uid per server | io_uring past ~1 000 rings | a uid's ~1 000th concurrent ring, host-wide | locked memory up to the limit |
| `nofile` ≥ sessions that miss + sockets | the ring's fd (two until row 250 dropped the eventfd) | the daemon's default, whatever it is | none |
| on an SELinux-enforcing host, `io_uring { allowed }` for the container's domain | io_uring on a tile miss | container-selinux grants it to no container domain: `EACCES` even under the profile (probed on Fedora 43, disk-access.md §6 *In a container*) | `label=disable` drops the container's SELinux confinement; a module granting that one permission to `container_t` (untried) reaches every container on the host |

**Verified on this host** (Docker 29.8.2, containerd 2.3.6, runc 1.5.1, Linux 6.18, cgroup v1, ext4). A static probe
(`io_uring_setup`, `_register`, `_enter`, then rings until refused, then `preadv2(RWF_NOWAIT)`), run as uid 10001 with
each setting alone. The server's own read-path tests ran under each profile too.

* **Storage.** A bind mount and a named volume (`/var/lib/docker/volumes`, ext4 here) honour `RWF_NOWAIT`. The
  container's layer (overlayfs) and `--tmpfs` refuse it (`EOPNOTSUPP`). This Containerfile `COPY`s the smoke series
  into `/studies` in the image's layer, where the fast path is lost; compose mounts `STUDIES` over it, which keeps it.
  The page cache is the host's, per inode, so folios are the underlying filesystem's (the folio count's findings,
  disk-access.md §6, hold as on the host, and held in a cloud container's bind mount and volume). The pages are
  charged to the container's memory cgroup: a tight `mem_limit` evicts
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
narrows nothing about the server's own ring. The trade is that exposure against tile misses through the pool, which
are free on the workstation and up to +138 % CPU in the agent container. **The owner took it on 2026-10-14** (queue
row 231), on row 208's reading in a cloud container: the ring on 84 of 84 cold passes, a cold 32 kB tile 28.8 against
19.1 µs and ×0.67 the CPU, a tie at 163–503 kB ([`../docs/adr/disk-access.md`](../docs/adr/disk-access.md) §6). P0
still decides whether the ring earns its keep on the target. *Corrected 2026-10-14:* this paragraph called the profile
the owner's call and said `compose.yml` does not load it; it does since row 231.

**What `compose.yml` gives the server** (`docker run` takes the same as `--security-opt` and `--ulimit`):

```yaml
  server:
    security_opt: ["seccomp=./seccomp-uring.json"]   # relative to compose.yml
    ulimits:
      memlock: "${MEMLOCK:-67108864}"   # 64 MiB: ~7 500 rings at 8.7 KiB, for this uid
      nofile: "${NOFILE:-65535}"        # ≥ sessions that miss + sockets
```

A daemon that cannot raise a limit refuses the container at start (`error setting rlimit type 8: operation not
permitted`): set `MEMLOCK` and `NOFILE` to what it allows, and the banner's `read_ring=` still says whether a ring is
built. **One uid per server:** the `memlock` counter is the uid's, host-wide, so two of these servers on one host share
64 MiB unless one is built with another uid. `no-new-privileges:true` and `cap_drop: [ALL]` cost the read path nothing
with the profile (the probe above), and are not set: untried with the server itself.

**Verified through the image** (row 231, on the host above). `compose up` from the repository's root, so the profile's
path resolves against `compose.yml`: the banner says `read_ring=available`, and the server's `/proc/<pid>/limits` hold
the limits given, under `Seccomp: 2`. Mutated, the same `up` with `security_opt: !reset []` says
`read_ring=refused (io_uring setup: Operation not permitted (os error 1))`. The server's 30 store and read-path tests
(`media::`), built on the image's Debian and run in it as uid 10001 with `/tmp` on ext4: **30 of 30 run under the
profile; under Docker's default, 7 skip** for io_uring. This host's daemon holds hard limits of 8 MiB and 20 000 and
cannot raise them, so the defaults were refused at start; it ran with `MEMLOCK=8388608 NOFILE=20000`. **Not run here:**
64 MiB and 65 535 themselves.

Kubernetes (not run here): copy the profile to each node's `/var/lib/kubelet/seccomp/`, and set
`securityContext.seccompProfile: {type: Localhost, localhostProfile: seccomp-uring.json}`. Kubernetes has no
per-pod `ulimit`, so `memlock` is the node runtime's. Podman: `--security-opt seccomp=deploy/seccomp-uring.json`;
rootless Podman 5.8.4 accepts it, and on its SELinux-enforcing host the ring then needs the row above
(`docs/adr/disk-access.md` §In a container). The rest of rootless podman is unchecked (§Open). `seccomp-uring.json` is Docker's Apache-2.0 profile with one
entry added. `seccomp-uring.sh` writes it from the pinned, checksummed fetch, and `--check` says whether it is
current (a changed entry and a wrong checksum each failed it). Regenerate it when the pinned Docker moves.

**Which path is live.** The startup banner says `read_fast_path=preadv2` or `pooled_pread`, and `read_ring=available`
or `read_ring=refused (<why>)` from one ring built and dropped at start (15.6 µs; row 231). A tile session still tries
`io_uring_setup` once on its first miss: a ring the probe got can still be refused later, past the `memlock` budget.
The first refusal warns `io_uring refused; tile misses go to the pool (warned once)` with its errno, once per process;
every refused session's line says `ring=false`. `/proc/1/limits` inside the container is the
server's (with no `ulimits` set they are the daemon's). **Proposed, not built:**

* the `memlock` limit beside `read_ring=`, and sessions that start with the pool when the probe was refused, so none
  of them tries `io_uring_setup`. *Corrected 2026-10-16:* this also promised the per-session warning would go; row 254
  made it once per process instead.
* the same probe in `check-fastpath`, shipped in the server image, so `docker compose exec server check-fastpath
  /studies` gates a rollout: 0 with both fast paths, 1 with either lost.
* compose's health check stays the transport file. A slow path is not an unhealthy one, and failing it would hold
  `web` from starting.

## Open

| what | why it matters | what would close it |
| --- | --- | --- |
| rootless podman | the brief's first runtime is unchecked | a host with it: build, `up`, the page check |
| io_uring on an SELinux-enforcing host | the profile is not enough there: `EACCES` (§Container settings) | the owner's call: `label=disable` or a policy module granting `io_uring { allowed }`; neither ships. The module's source is [`wtpacs_io_uring.te`](wtpacs_io_uring.te) (row 262, untried); `lab/scripts/workstation_run.sh` tries `label=disable` on such a host and prints the root steps that load the module |
| ~~a stale server binary~~ *closed by row BUILDCACHE, 2026-10-15* | the build stage's `target` cache mount is shared by every build on the daemon; cargo trusts mtimes, so a tree whose sources are older than the cache's last build ships the old binary, silently (row 231: its `read_ring=` line was missing until the sources were touched and the build ran with `--no-cache-filter build,server`) | closed: the build touches every source it copied before `cargo build` (§5), proved in §Verified *Row BUILDCACHE* |
| studies by name | one server serves one series (`SERIES`) | a study index, proposed in `docs/FIXTURES.md` §From DICOM |
| HTTP/3 for the page, and a `dns-prefetch` to the transport's origin | each takes a round trip off a cold open ([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §What production adds) | nginx's QUIC listener; one `<link>` in the viewer |
| the decoders are built on the host | the image checks them against the manifest but does not make them | the decoder build's container (`client/decode/wasm/build/`) as a stage, once it runs inside BuildKit |

**A measurement flag.** Page-load timing is part of the page clock. A comparison spanning a switch from one host
to the other is not comparable across it: take a before and after in one interleaved run.
