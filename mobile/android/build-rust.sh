#!/usr/bin/env bash
# Builds murmur-mobile (mobile/ffi) for Android phones, puts it in jniLibs with sherpa-onnx's
# libraries, and writes its Kotlin side (app/src/main/kotlin/uniffi). Gradle runs it before each
# build; by hand: ./build-rust.sh
#
# Two architectures: arm64, the only one the published app ships, and 32-bit ARM, only for debug
# builds on phones that run 32-bit Android (Samsung's Galaxy A13, for one): too slow to transcribe live.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$(ls -d "$sdk"/ndk/* | sort -V | tail -1)}"
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
cd "$here/../ffi"
for pair in arm64-v8a:aarch64-linux-android armeabi-v7a:armv7-linux-androideabi; do
  abi="${pair%%:*}" triple="${pair##*:}"
  nice -n 15 cargo ndk -t "$abi" --platform 28 build --release --lib
  libs="$here/app/src/main/jniLibs/$abi"
  mkdir -p "$libs"
  # The engine and what it links: sherpa-onnx's C API and onnxruntime (its JNI library isn't used).
  for so in libmurmur_mobile.so libsherpa-onnx-c-api.so libonnxruntime.so; do
    cp -p "target/$triple/release/$so" "$libs/"
  done
done
cargo run -q --release --bin uniffi-bindgen -- generate --library target/aarch64-linux-android/release/libmurmur_mobile.so \
  --language kotlin --no-format --out-dir "$here/app/src/main/kotlin"
