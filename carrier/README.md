# carrier

Receives the PCS's packages by resumable upload (draft-ietf-httpbis-resumable-upload-14, interop version 10) and
answers *received*, then the receiver's *committed* or *refused*. The protocol, the hand-off to the receiver, the
tests and every reason are [`docs/ingest/link.md`](../docs/ingest/link.md) §12; this file runs it.

```text
main.rs        flags; the allow list; one Carrier; the listeners the flags name
upload.rs      Carrier::handle — the one handler: create, HEAD, PATCH, DELETE, the poll
handoff.rs     the files shared with the receiver: incoming/, status/, uploads/
tls.rs         TLS 1.3, each PCS's certificate pinned by its SHA-256, per site
tcp.rs         HTTP/1.1 on hyper over TLS            (always)
quic.rs        HTTP/3 on h3 and h3-quinn             (--features quic; experimental)
pcs/send-package.sh   the PCS's side: POSIX sh and stock curl
sender/               the PCS's side in Rust: builds the package from the exam tree, keeps it, sends it by the script
```

## Run it

```bash
# At each PCS: its own key and certificate, and the line its site's operator adds to the allow list.
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3650 \
  -subj /CN=pcs-1 -keyout pcs.key -out pcs.pem
echo "site-a $(openssl x509 -in pcs.pem -outform DER | sha256sum | cut -d' ' -f1)"

# At the PACS: the allow list (`<site> <sha256-hex>` per line), then the carrier.
cargo build --release -p carrier                    # add --features quic for the HTTP/3 listener
target/release/carrier --root /srv/pacs --tcp '[::]:443' \
  --cert carrier.pem --key carrier.key --allow allow.txt
#   --quic '[::]:443'   a second listener, HTTP/3 on UDP (only with --features quic)
#   --max-size BYTES    Upload-Limit max-size, default 8 GiB
#   --stall-secs N      a request's content silent this long is ended, default 60
#   RUST_LOG=info       one line per received package

# At the PCS, one run per package: exit 0 committed, 3 refused, 4 gave up.
CARRIER=https://pacs.example:443 CERT=pcs.pem KEY=pcs.key CACERT=carrier.pem \
  carrier/pcs/send-package.sh U1.1.0123456789abcdef.tar
```

`--root` must be on the receiver's filesystem; the receiver reads `incoming/` and writes `status/` through
`carrier::handoff`.

## Test it

```bash
cargo test -p carrier                     # the handler over TCP, the PCS script through a faulty proxy
cargo test -p carrier --features quic     # and the same upload over HTTP/3
```

The script's tests need `curl` and `sh` on the path.

## The sender

Builds each named series' package (layout 2) from the PCS's exam tree, keeps it in the outbox until stored, and sends
it with `pcs/send-package.sh`; why and how is [`docs/adr/pcs-transfer.md`](../docs/adr/pcs-transfer.md) §15.

```bash
cat > profile <<'END'
transport tcp                     # quic is refused: the upload is the script's, over curl
metadata  zstd                    # or plain
carrier   https://pacs.example:443
cert      pcs.pem
key       pcs.key
cacert    carrier.pem
outbox    /var/spool/pcs-sender   # packages until stored, and what each revision carried, for good
END
cargo build --release -p sender
target/release/sender --profile profile /data/PbPb/STUDY SERIES...
#   exit 0 every series stored, 3 refused (an operator's), 4 gave up for now, 5 the tree cannot be packed, 2 usage
cargo test -p sender                      # the build, and the sender through the carrier and the script
```
