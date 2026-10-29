#!/usr/bin/env bash
# Builds the Share menu's extension (share-extension/) into a built Murmur.app, signs it, and
# signs the app again so its seal covers it. release.sh runs it between building and notarizing.
#
#   app/scripts/share-extension.sh src-tauri/target/release/bundle/macos/Murmur.app
set -euo pipefail
cd "$(dirname "$0")/.."

APP="$1"
IDENTITY=$(node -p "require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity")
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
MIN=$(node -p "require('./src-tauri/tauri.conf.json').bundle.macOS.minimumSystemVersion")
APPEX="$APP/Contents/PlugIns/MurmurShare.appex"

rm -rf "$APPEX"
mkdir -p "$APPEX/Contents/MacOS"
sed "s/VERSION/$VERSION/g" share-extension/Info.plist > "$APPEX/Contents/Info.plist"
swiftc -O -module-name MurmurShare -parse-as-library -application-extension \
  -target "arm64-apple-macos$MIN" \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -framework AppKit \
  share-extension/ShareViewController.swift \
  -o "$APPEX/Contents/MacOS/MurmurShare"

codesign --force --sign "$IDENTITY" --options runtime --timestamp \
  --entitlements share-extension/Entitlements.plist "$APPEX"
codesign --force --sign "$IDENTITY" --options runtime --timestamp \
  --entitlements src-tauri/Entitlements.plist "$APP"
codesign --verify --deep --strict "$APP"
