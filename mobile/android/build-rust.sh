#!/usr/bin/env bash
# Builds murmur-mobile (mobile/ffi) for Android phones (arm64), puts it in jniLibs with
# sherpa-onnx's libraries, and writes its Kotlin side (app/src/generated). Gradle runs it before
# each build; by hand: ./build-rust.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$(ls -d "$sdk"/ndk/* | sort -V | tail -1)}"
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
cd "$here/../ffi"
nice -n 15 cargo ndk -t arm64-v8a --platform 28 build --release --lib
libs="$here/app/src/main/jniLibs/arm64-v8a"
mkdir -p "$libs"
# The engine and what it links: sherpa-onnx's C API and onnxruntime (its JNI library isn't used).
for so in libmurmur_mobile.so libsherpa-onnx-c-api.so libonnxruntime.so; do
  cp -p "target/aarch64-linux-android/release/$so" "$libs/"
done
cargo run -q --release --bin uniffi-bindgen -- generate --library target/aarch64-linux-android/release/libmurmur_mobile.so \
  --language kotlin --no-format --out-dir "$here/app/src/main/kotlin"
