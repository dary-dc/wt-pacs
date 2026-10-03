# deploy

nginx serves the page; the transport server runs beside it. One deployment step, not a refactor:
development and production run the same static host, so the headers, the path rewrites and the MIME
types are tested in the thing that ships.

From a fresh clone, with podman or docker (every `podman` below reads `docker` as well):

```bash
server/scripts/gen_dev_cert.sh            # server/dev-cert/*.pem and client/dev-transport.json
chmod 0644 server/dev-cert/key.pem        # the server runs as uid 10001 and reads it through a mount
podman build -f deploy/Containerfile --target web    -t wt-pacs-web .
podman build -f deploy/Containerfile --target server -t wt-pacs-server .
STUDY=us_cine_smoke podman compose -f deploy/compose.yml up -d
deploy/check_equivalence.sh us_cine_smoke                        # the web image beside dev-server.py
deploy/check_equivalence.sh --local us_cine_smoke                # the template on a host nginx, no image
deploy/check_equivalence.sh --cert path/to/cert.pem              # the PEM's chain alone
```

Then open `http://127.0.0.1:8765/harness/cell.html?autorun=1`. The image builds the TypeScript bundles
itself; the WASM arm (`&transport=wasm`) is served only if `client/transport-wasm/build.sh` ran before
the build, since `client/` is copied as it stands. The certificate and `dev-transport.json` are
mounted, not baked: regenerating the certificate needs a restart, not a rebuild. Making the dev key
world-readable is for the 10-day localhost certificate only; a real key is mounted owned by uid 10001.

| target | contains | serves |
| --- | --- | --- |
| `web` | nginx, the client assets, `fixtures/`, the config | the page on 8765, with the headers below |
| `server` | the `exact-server` binary, run as a non-root user; fixtures and certificate mounted | the transport on UDP 4433, the WebSocket fallback on TCP 4433 |

**nginx is not in the transport's path and cannot be.** The server speaks WebTransport over QUIC on
UDP 4433 and nginx has no QUIC upstream, so the browser dials it directly — the same shape
`server/dev-server.py` had. No data-path number can move because of anything here.

**What must be preserved exactly.** Three headers on every response, error pages and the
content-hashed rule included (`add_header` in a `location` replaces the server's, so the rule repeats
them):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Cross-origin isolation is what gives the page `SharedArrayBuffer`, and losing it degrades the client
silently rather than failing — the downloader refuses to start without it. The rewrites `dev-server.py`
performs (`/wt/dev-transport.json`, `/study/metadata`, `/harness/`) are `location` blocks, moved across
unchanged because the harness pages depend on them. gzip and an immutable cache rule for
content-hashed names are two deliberate divergences from `dev-server.py`, asserted rather than compared
([`../lab/page-open/README.md`](../lab/page-open/README.md) §Compression and cache headers).

**TLS on the page host.** The page is served plainly **on localhost only**, which is a secure context.
Served from any other host over `http://` it is not, `SharedArrayBuffer` is gone, and the client
degrades silently; the first run off this workstation needs a certificate for the page. The transport's
certificate is separate: `server/scripts/gen_dev_cert.sh` writes it and pins its hash into
`client/dev-transport.json`.

## The checks

`check_equivalence.sh` runs `dev-server.py` and the web image side by side and compares status, the
three isolation headers, content type and body bytes on every path the harness uses; it passes on 8
paths. Two things it treats as equal on purpose: an error page's body is each server's own, so 404 is
compared on status and headers only; and `dev-server.py`'s aliases for `pkg/` and
`transport-ts/` were identity mappings under the root, so the config carries no rule for them.

`--local` verifies the config, not the image: it runs `nginx` from `PATH` on the template with `root`
pointed at this tree. It passes, and each assertion was mutated (`gzip off`, the immutable rule deleted,
`always` dropped from a header) and seen to fail. **The images were built and run on 2026-10-03** with
docker 29 (podman was not available, so the podman lines are unrun): both targets build from a clean
context, `compose up` starts both, the server prints `wt_url=` and `ws_url=`, TCP 4433 answers a
WebSocket upgrade with 101, the check passes against the image on its 8 paths, and
`cell.html?autorun=1` in headless Chromium delivers 3 of 3 frames over `transport=ts` and over
`transport=ws`, with the same checksum. `dev-server.py` stays: it is what the check compares against.

The build context is filtered by `.containerignore` (podman) and `deploy/Containerfile.dockerignore`
(docker reads only that name or a root `.dockerignore`, and does not follow a symlink); keep the two
equal. Without them the context ships `target/`, `node_modules/` and the dev key.

**The transport's PEM.** The same script checks `${CERT_PEM:-server/dev-cert/cert.pem}` before it
compares any path. One self-signed certificate is today's dial and passes; two or more is a chain and
passes; **one certificate issued by something else warns** — a browser then fetches that intermediate
over AIA on every cold open ([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §What production
adds, which also says to issue an ECDSA chain: an RSA-2048 chain costs a round trip on every cold
open). Checked on all three shapes and a missing file. A missing PEM is skipped when it is the default path
and fails when it was named (`--cert /nope.pem`, or `CERT_PEM`); each of the two was mutated to skip and
seen to pass. The chain check was mutated twice: reading the subject where it
reads the issuer blinded it to a leaf-only PEM, and raising the multi-certificate early return made it
warn on a good chain.

**Two levers the page open leaves on the table** ([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
§What production adds): a `<link rel=dns-prefetch>` to the transport's origin (`https://host:4433`)
takes a lookup off every cold dial, and an HTTPS DNS record with `alpn=h3` takes a round trip off the
first visit once the static host speaks HTTP/3 (nginx 1.25 or later). Neither is in this deployment.

**A measurement flag.** Page-load timing is part of the page clock. A comparison spanning a switch
from one host to the other is not comparable across it — take a before and after in one interleaved
run, or treat the older numbers as a different cell.

## Open

Found by reading the built shape; still open. Fixed on 2026-10-03: the private `Z` label (now `z`),
the certificate hash baked into the image (now mounted), and the two uncommented Containerfile decisions.

| what | why it matters | fix |
| --- | --- | --- |
| the check does not compare caching headers | nginx sends `ETag`, `dev-server.py` does not, so repeat loads can revalidate differently across the swap and the check still passes — and page-load timing is part of the page clock | compare them, or say the check does not cover them |
| `/harness/` has two names | aliased at `/harness/` and also reachable at `/client/harness/` under `root` | one name, or a line saying both are kept |
| `dev-server.py` serves the whole tree | it is rooted at the repository, so `server/dev-cert/key.pem` and `.git/` answer 200 on the quick start's host (bound to 127.0.0.1). The web image copies only `client/` and `fixtures/` | a deny-list, or retire `dev-server.py` once the image has run |

Keep: the server runs as a non-root user, and `fixtures/` is small enough (32 KB) that baking it into
the web image costs nothing.
