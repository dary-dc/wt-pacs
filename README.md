# wt-pacs

WebTransport PACS — web-native medical imaging transport (MIT).

## Quick start (harness)

```bash
# Terminal 1 — dev TLS + dev-transport.json
./server/scripts/gen_dev_cert.sh

# Terminal 2 — pack or use smoke bundle
cargo run -p pack-study -- \
  --metadata fixtures/us_cine_smoke/metadata.json \
  --frames fixtures/us_cine_smoke/frames \
