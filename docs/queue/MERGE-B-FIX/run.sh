#!/usr/bin/env bash
set -uo pipefail
W=/tmp/claude-0/-home-user-wt-pacs/eef7c355-700c-50fd-bac1-e3429720230b/scratchpad/uni; O=/tmp/claude-0/-home-user-wt-pacs/eef7c355-700c-50fd-bac1-e3429720230b/scratchpad/out; cd "$W"; git rev-parse HEAD > $O/commit
ts() { date -u +%H:%M:%SZ; }
echo "$(ts) start" > $O/progress
(dockerd >/tmp/dockerd.log 2>&1 &)
for i in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
python3.13 -m pip install -q meson==1.9.1 >$O/setup.log 2>&1; python3.13 -m pip install -q --require-hashes -r ingest/requirements.txt >>$O/setup.log 2>&1; echo "pip $?" >> $O/progress
pip install -q meson==1.9.1 >>$O/setup.log 2>&1
apt-get update -q >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -q nginx mesa-vulkan-drivers xdotool libxkbcommon-x11-0 strace xvfb >>$O/setup.log 2>&1; echo "apt $?" >> $O/progress
rustup target add wasm32-unknown-unknown >>$O/setup.log 2>&1
command -v wasm-pack >/dev/null || cargo install -q wasm-pack --version 0.15.0 --locked >>$O/setup.log 2>&1; echo "$(ts) setup done" >> $O/progress
export PYTHON=python3.13 NODE_PATH=/opt/node22/lib/node_modules
bash client/transport/wasm/build.sh > $O/wasm-transport.log 2>&1; echo "transport-wasm $?" >> $O/progress
for f in client/decode/wasm/fetch_openjph.sh client/decode/wasm/fetch_xxh3.sh; do [[ -f $f ]] && bash $f >> $O/vendor.log 2>&1; echo "vendor $f $?" >> $O/progress; done
bash client/decode/wasm/build/build.sh > $O/wasm-decode.log 2>&1; echo "decode-wasm $?" >> $O/progress
bash ingest/tools.sh > $O/ingest-tools.log 2>&1; echo "$(ts) ingest-tools $?" >> $O/progress
git status --porcelain > $O/dirty-after-builds
t=$SECONDS; scripts/gate.sh > $O/gate.log 2>&1; rc=$?; echo "$(ts) gate $rc $((SECONDS-t))s" >> $O/progress
echo "$(ts) end" >> $O/progress
