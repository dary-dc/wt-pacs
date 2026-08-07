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
  --output fixtures/us_cine_smoke/us_cine_smoke.sbnd

# Terminal 3 — WebTransport server
cargo run --release -p exact-server -- \
  --port 4433 \
  --study fixtures/us_cine_smoke/us_cine_smoke.sbnd

# Terminal 4 — clients (after changes)
client/transport-wasm/build.sh   # web_sys WASM client
client/transport-ts/build.sh     # TypeScript client → dist/

# Terminal 5 — static host
python3 server/dev-server.py --port 8765 --study us_cine_smoke
