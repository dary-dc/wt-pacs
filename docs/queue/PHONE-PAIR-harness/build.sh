set -x
cd "$(dirname "$0")/mix"
(dockerd >/tmp/dockerd.log 2>&1 &)
pip install -q meson==1.9.1
python3 -m venv .venv && .venv/bin/pip install -q --require-hashes -r ingest/requirements.txt
ln -sfn .venv lab/av1/.venv
cargo build --release -q -p series-server -p pack-series &
CB=$!
ingest/tools.sh > ../tools.log 2>&1; echo "tools rc=$?"
bash client/decode/wasm/fetch_openjph.sh; bash client/decode/wasm/fetch_xxh3.sh
for i in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
client/decode/wasm/build/build.sh > ../wasm.log 2>&1; echo "wasm rc=$?"
wait $CB; echo "cargo rc=$?"
echo BUILD-DONE
