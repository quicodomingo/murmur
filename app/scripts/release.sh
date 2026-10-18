#!/usr/bin/env bash
# Murmur for other Macs: build and sign with the Developer ID (tauri.conf.json), notarize and
# staple the app, then make a signed and notarized .dmg, and the update package the installed
# apps download (Murmur.app.tar.gz, its updater signature and latest.json). Nothing is uploaded:
# app/scripts/publish.sh does that.
#
#   app/scripts/release.sh
#
# Notarization uses the credentials saved in the keychain once with
#   xcrun notarytool store-credentials murmur --key AuthKey_….p8 --key-id … --issuer …
# Update packages are signed with ~/.tauri/murmur-updater.key, whose password is in the
# keychain as "murmur-updater" (its public key is in tauri.conf.json › plugins.updater).
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="${NOTARY_PROFILE:-murmur}"
IDENTITY=$(node -p "require('./src-tauri/tauri.conf.json').bundle.macOS.signingIdentity")
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
APP=src-tauri/target/release/bundle/macos/Murmur.app
OUT=src-tauri/target/release/bundle/release
mkdir -p "$OUT"

notarize() {
  local log
  log=$(xcrun notarytool submit "$1" --keychain-profile "$PROFILE" --wait 2>&1) || true
  echo "$log" | tail -4
  if ! grep -q "status: Accepted" <<<"$log"; then
    id=$(grep -m1 -oE "id: [0-9a-f-]{36}" <<<"$log" | cut -d' ' -f2 || true)
    [ -n "${id:-}" ] && xcrun notarytool log "$id" --keychain-profile "$PROFILE"
    echo "La notarització ha fallat" >&2
    exit 1
  fi
}

echo "› Compilant i signant amb «${IDENTITY}»"
npm run tauri build -- --bundles app

echo "› Notaritzant l'app"
ditto -c -k --keepParent "$APP" "$OUT/Murmur.zip"
notarize "$OUT/Murmur.zip"
xcrun stapler staple "$APP"
rm "$OUT/Murmur.zip"

echo "› Fent el .dmg"
DMG="$OUT/Murmur-$VERSION.dmg"
STAGING=$(mktemp -d)
ditto "$APP" "$STAGING/Murmur.app"
ln -s /Applications "$STAGING/Applications"
rm -f "$DMG"
hdiutil create -volname Murmur -srcfolder "$STAGING" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGING"
codesign --sign "$IDENTITY" --timestamp "$DMG"
notarize "$DMG"
xcrun stapler staple "$DMG"

echo "› Paquet d'actualització"
KEY="${UPDATER_KEY:-$HOME/.tauri/murmur-updater.key}"
TARBALL="$OUT/Murmur.app.tar.gz"
rm -f "$TARBALL" "$TARBALL.sig"
tar -czf "$TARBALL" -C "$(dirname "$APP")" Murmur.app
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(security find-generic-password -s murmur-updater -w) \
  npx tauri signer sign -f "$KEY" "$TARBALL" >/dev/null
NOTES="${RELEASE_NOTES:-Murmur $VERSION}"
node -e '
const fs = require("fs");
const [version, notes, sig] = process.argv.slice(1);
fs.writeFileSync(process.argv[4], JSON.stringify({
  version, notes, pub_date: new Date().toISOString(),
  platforms: { "darwin-aarch64": {
    signature: fs.readFileSync(sig, "utf8").trim(),
    url: `https://github.com/quicodomingo/murmur-releases/releases/download/v${version}/Murmur.app.tar.gz`,
  } },
}, null, 2));
' "$VERSION" "$NOTES" "$TARBALL.sig" "$OUT/latest.json"

echo "› Comprovació de Gatekeeper"
spctl -a -vv "$APP"
spctl -a -vv -t open --context context:primary-signature "$DMG"
echo "Fet: $DMG"
