#!/bin/sh
# The iPhone screenshots in dark mode, in the simulator, with the sample meetings (-demo, debug builds only).
# shoot-dark.sh <simulator id> <out dir> [ca es en]
# Build first: xcodebuild -scheme Murmur -sdk iphonesimulator -configuration Debug -derivedDataPath build
set -e
SIM="$1"; OUT="$2"; shift 2
APP="$(dirname "$0")/Murmur/build/Build/Products/Debug-iphonesimulator/Murmur.app"
ID=com.quicodomingo.murmur.ios
mkdir -p "$OUT"
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl ui "$SIM" appearance dark
xcrun simctl status_bar "$SIM" override --time 9:41 --dataNetwork wifi --wifiBars 3 --cellularBars 4 --batteryState discharging --batteryLevel 100
xcrun simctl install "$SIM" "$APP"
sleep 5

shot() { # lang name args...
  lang="$1"; name="$2"; shift 2
  xcrun simctl terminate "$SIM" "$ID" 2>/dev/null || true
  # Right after installing, SpringBoard can take a few seconds to know the app.
  for try in 1 2 3 4 5 6 7 8 9 10; do
    xcrun simctl launch "$SIM" "$ID" -AppleLanguages "($lang)" -AppleLocale "${lang}_ES" \
      -onboarded YES -analytics NO -appearance dark -demo "$@" >/dev/null 2>&1 && break
    [ "$try" = 10 ] && { echo "Murmur doesn't open in the simulator" >&2; exit 1; }
    sleep 3
  done
  sleep 6
  xcrun simctl io "$SIM" screenshot "$OUT/$lang-$name.png" >/dev/null 2>&1
}

for lang in ${@:-ca es en}; do
  case $lang in ca) q=preus;; es) q=precios;; en) q=pricing;; esac
  # Empty data for each language, so the sample meetings come in that language. (Uninstalling and
  # installing again leaves SpringBoard without the app, so only its data goes.)
  xcrun simctl terminate "$SIM" "$ID" 2>/dev/null || true
  DATA="$(xcrun simctl get_app_container "$SIM" "$ID" data)"
  [ -n "$DATA" ] && rm -rf "$DATA/Documents" "$DATA/Library/Application Support" "$DATA/Library/Preferences"
  shot "$lang" 1-llista
  shot "$lang" 2-resum -open demo-launch -tab summary
  shot "$lang" 3-transcripcio -open demo-launch -tab transcript
  shot "$lang" 4-notes -open demo-launch -tab notes
  shot "$lang" 5-cerca -search "$q"
  echo "$lang"
done
