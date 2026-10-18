#!/usr/bin/env bash
# Publishes the release made by app/scripts/release.sh: a GitHub release on
# quicodomingo/murmur-releases with the .dmg (new installs) and the update package + latest.json
# (installed apps find it at releases/latest/download/latest.json).
#
#   RELEASE_NOTES="Què hi ha de nou" app/scripts/publish.sh
#
# Uploading is public and can't be taken back from the Macs that already updated: run it only
# when this version is ready for everyone.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=quicodomingo/murmur-releases
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
OUT=src-tauri/target/release/bundle/release
for f in "Murmur-$VERSION.dmg" Murmur.app.tar.gz Murmur.app.tar.gz.sig latest.json; do
  [ -f "$OUT/$f" ] || { echo "Falta $OUT/$f: executa primer scripts/release.sh" >&2; exit 1; }
done
if [ "$(node -p "require('./$OUT/latest.json').version")" != "$VERSION" ]; then
  echo "latest.json no és de la versió $VERSION: torna a executar scripts/release.sh" >&2
  exit 1
fi

gh release create "v$VERSION" \
  --repo "$REPO" \
  --title "Murmur $VERSION" \
  --notes "${RELEASE_NOTES:-Murmur $VERSION}" \
  "$OUT/Murmur-$VERSION.dmg" "$OUT/Murmur.app.tar.gz" "$OUT/Murmur.app.tar.gz.sig" "$OUT/latest.json"
echo "Publicat: https://github.com/$REPO/releases/tag/v$VERSION"
