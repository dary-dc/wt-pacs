#!/usr/bin/env bash
cd /home/user/wt226
export CARGO_TARGET_DIR=/home/user/cargo-target-shared
command -v wasm-pack || ls ~/.cargo/bin/wasm-pack || cargo install wasm-pack --version 0.15.0 --locked; echo "wasm-pack: $?"
bash client/decode/wasm/fetch_openjph.sh; echo "openjph: $?"
bash client/decode/wasm/fetch_xxh3.sh; echo "xxh3: $?"
bash client/transport/wasm/build.sh; echo "transport wasm: $?"
bash client/transport/ts/build.sh; echo "ts: $?"
bash client/decode/wasm/build/build.sh; echo "decoder build: $?"
