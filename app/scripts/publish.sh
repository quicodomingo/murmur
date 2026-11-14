#!/usr/bin/env bash
# Publishes a version. On a Mac, with the release made by app/scripts/release.sh: the GitHub
# release on quicodomingo/murmur-releases (public) gets the .dmg (new installs) and the update
# package + latest.json (installed apps find it at releases/latest/download/latest.json). Then the
# code and the tag v<version> go to the code repo (quicodomingo/murmur), which starts
# .github/workflows/release.yml: it builds Windows and Linux, adds them to both releases and to
# latest.json, keeping the Mac in it.
#
#   RELEASE_NOTES="Què hi ha de nou" app/scripts/publish.sh
#   RELEASE_NOTES="Què hi ha de nou" app/scripts/publish.sh --no-mac   (only the tag: CI does it all)
#
# Uploading is public and can't be taken back from the computers that already updated: run it
# only when this version is ready for everyone.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=quicodomingo/murmur-releases
CODE=${CODE_REPO:-quicodomingo/murmur}
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v$VERSION"
NOTES="${RELEASE_NOTES:-Murmur $VERSION}"
OUT=src-tauri/target/release/bundle/release
MAC=true
[ "${1:-}" = "--no-mac" ] && MAC=false

if $MAC; then
  for f in "Murmur-$VERSION.dmg" Murmur.app.tar.gz Murmur.app.tar.gz.sig latest.json; do
    [ -f "$OUT/$f" ] || { echo "Falta $OUT/$f: executa primer scripts/release.sh" >&2; exit 1; }
  done
  if [ "$(node -p "require('./$OUT/latest.json').version")" != "$VERSION" ]; then
    echo "latest.json no és de la versió $VERSION: torna a executar scripts/release.sh" >&2
    exit 1
  fi

  # latest.json: the Mac added to whatever is already published for this version (Windows and
  # Linux, if CI got there first), with the notes given here.
  PREVIOUS=$(mktemp -d)
  gh release download "$TAG" --repo "$REPO" --pattern latest.json --dir "$PREVIOUS" 2>/dev/null || true
  RELEASE_NOTES="$NOTES" node scripts/latest-json.mjs "$OUT" "$VERSION" \
    "https://github.com/$REPO/releases/download/$TAG" "$PREVIOUS/latest.json" > "$PREVIOUS/merged.json"
  mv "$PREVIOUS/merged.json" "$OUT/latest.json"
  rm -rf "$PREVIOUS"

  if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    gh release upload "$TAG" --repo "$REPO" --clobber \
      "$OUT/Murmur-$VERSION.dmg" "$OUT/Murmur.app.tar.gz" "$OUT/Murmur.app.tar.gz.sig" "$OUT/latest.json"
  else
    gh release create "$TAG" --repo "$REPO" --title "Murmur $VERSION" --notes "$NOTES" \
      "$OUT/Murmur-$VERSION.dmg" "$OUT/Murmur.app.tar.gz" "$OUT/Murmur.app.tar.gz.sig" "$OUT/latest.json"
  fi
  echo "Publicat: https://github.com/$REPO/releases/tag/$TAG"
fi

# The code repo: the code at this version, and the tag, whose message carries the notes. Pushing
# the tag starts the Windows and Linux builds.
git push --quiet origin HEAD
git tag -a "$TAG" -m "$NOTES" 2>/dev/null || echo "L'etiqueta $TAG ja hi era"
git push --quiet origin "$TAG"
if gh release view "$TAG" --repo "$CODE" >/dev/null 2>&1; then
  $MAC && gh release upload "$TAG" --repo "$CODE" --clobber "$OUT/Murmur-$VERSION.dmg"
else
  gh release create "$TAG" --repo "$CODE" --verify-tag --title "Murmur $VERSION" --notes "$NOTES" \
    $($MAC && echo "$OUT/Murmur-$VERSION.dmg")
fi
echo "Repositori del codi: https://github.com/$CODE/releases/tag/$TAG"
echo "Windows i Linux: https://github.com/$CODE/actions/workflows/release.yml"
