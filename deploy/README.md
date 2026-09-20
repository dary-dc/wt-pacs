# deploy

nginx serves the page; the transport server runs beside it. `docs/proposal-nginx-and-images.md`
says why, and what this deliberately does not do.

```bash
podman build -f deploy/Containerfile --target web    -t wt-pacs-web .
podman build -f deploy/Containerfile --target server -t wt-pacs-server .
STUDY=us_cine_smoke podman-compose -f deploy/compose.yml up      # or docker compose
deploy/check_equivalence.sh us_cine_smoke                        # needs the web image built
deploy/check_equivalence.sh --local us_cine_smoke                # the template on a host nginx, no image
deploy/check_equivalence.sh --cert path/to/cert.pem              # the PEM's chain alone
```

`--local` verifies the config, not the image: it runs `nginx` from `PATH` on the template with
`root` pointed at this tree. It passed 2026-09-19, and each assertion was mutated
(`gzip off`, the immutable rule deleted, `always` dropped from a header) and seen to fail.

**The transport's PEM.** The same script checks `${CERT_PEM:-server/dev-cert/cert.pem}` before it
compares any path. One self-signed certificate is today's dial and passes; two or more is a chain
and passes; **one certificate issued by something else warns** — a browser then fetches that
intermediate over AIA on every cold open (`docs/proposal-session-open.md` §What production adds).
Checked 2026-09-19 on all three shapes and on a missing file, and mutated twice: reading the
subject where it reads the issuer blinded it to a leaf-only PEM, and raising the
multi-certificate early return made it warn on a good chain.

**nginx is not in the transport's path and cannot be.** The server speaks WebTransport over QUIC on
UDP 4433 and nginx has no QUIC upstream, so the browser dials it directly — the same shape
`server/dev-server.py` had. No data-path number can move because of anything here.

`check_equivalence.sh` runs `dev-server.py` and the image side by side and compares status, the
three isolation headers, content type and body bytes on every path the harness uses. It passes on
8 paths. Two things it treats as equal on purpose: an error page's body is each server's own, so
404 is compared on status and headers only; and `dev-server.py`'s aliases for `pkg/`,
`pkg-telemetry/` and `transport-ts/` were identity mappings under the root, so the config carries
no rule for them.

`dev-server.py` stays until someone has run the harness against the image. Keeping both is what
makes the check above meaningful.

**A measurement flag.** Page-load timing is part of the page clock. A comparison spanning a switch
from one host to the other is not comparable across it — take a before and after in one interleaved
run, or treat the older numbers as a different cell.
