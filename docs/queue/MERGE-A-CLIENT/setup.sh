#!/usr/bin/env bash
# the baseline's prerequisites for a fresh container (MERGE-BASELINE §Resume)
exec > /home/user/mac-out/setup.log 2>&1
set -x
(dockerd >/tmp/dockerd.log 2>&1 &)
for i in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 2; done; docker info >/dev/null 2>&1 && echo DOCKER-UP
python3.13 -m pip install -q meson==1.9.1 && python3.13 -m pip install -q --require-hashes -r /home/user/mac/ingest/requirements.txt; echo "pip $?"
pip install -q meson==1.9.1; echo "pip-default $?"
apt-get update -q >/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y -q nginx mesa-vulkan-drivers xdotool libxkbcommon-x11-0 strace xvfb >/dev/null; echo "apt $?"
rustup target add wasm32-unknown-unknown; echo "rustup $?"
command -v wasm-pack || cargo install -q wasm-pack --version 0.15.0 --locked; echo "wasm-pack $?"
echo SETUP-DONE
