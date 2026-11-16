set -x
cd /home/user/unified
(dockerd >/tmp/dockerd.log 2>&1 &)
pip install -q meson==1.9.1
(apt-get install -y -q mesa-vulkan-drivers xvfb xdotool libxkbcommon-x11-0 nginx >/dev/null 2>&1 || true)
rustup target add wasm32-unknown-unknown
command -v wasm-pack || cargo install -q --locked wasm-pack --version 0.15.0
python3 -m venv .venv && .venv/bin/pip install -q --require-hashes -r ingest/requirements.txt
bash client/decode/wasm/build/build.sh
bash client/transport/wasm/build.sh
bash client/transport/ts/build.sh
ingest/tools.sh
echo PREREQ-DONE
