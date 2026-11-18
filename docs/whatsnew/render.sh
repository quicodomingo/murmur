#!/bin/sh
# Les imatges de «Murmur per a iPhone» a les novetats: mobil.html amb Chrome sense finestra,
# a app/public/whatsnew/mobil-<idioma>.png i mobil-<idioma>-fosc.png (880 × 400).
# Calen les captures de la landing a data/captures-landing/ i les de l'App Store a docs/appstore/.
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="$PWD/../../app/public/whatsnew"
mkdir -p "$OUT"
for lang in ${@:-ca es en}; do
  for mode in light dark; do
    suffix=$([ "$mode" = dark ] && echo "-fosc" || echo "")
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --allow-file-access-from-files --window-size=880,400 --virtual-time-budget=3000 \
      --screenshot="$OUT/mobil-$lang$suffix.png" "file://$PWD/mobil.html?lang=$lang&mode=$mode" 2>/dev/null
  done
  echo "$lang"
done
