#!/bin/sh
# The iPhone screenshots for the landing: each app screenshot inside the phone's frame, on a transparent
# background (phone.html), with Chrome, into data/captures-landing/<lang>-30-iphone-<name>.png.
# The app screenshots must be in docs/appstore/<lang>/ first (see docs/APPSTORE.md).
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="$PWD/../../../data/captures-landing"
mkdir -p "$OUT"
for lang in ${@:-ca es en}; do
  for shot in 1-llista 2-resum 3-transcripcio 4-notes 5-cerca; do
    name="${shot#?-}"
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --default-background-color=00000000 --allow-file-access-from-files \
      --window-size=908,1921 --virtual-time-budget=2000 \
      --screenshot="$OUT/$lang-30-iphone-$name.png" "file://$PWD/phone.html?lang=$lang&shot=$shot" 2>/dev/null
  done
  echo "$lang"
done
