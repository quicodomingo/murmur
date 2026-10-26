#!/usr/bin/env bash
# Publishes Murmur's shared links on your Cloudflare account (docs/COMPARTIR.md): signs in,
# creates the KV store, sets a new API key and deploys. Run it again to rotate the key.
set -euo pipefail
cd "$(dirname "$0")"

npm install --silent
WRANGLER="npx wrangler"

$WRANGLER whoami >/dev/null 2>&1 || $WRANGLER login

if grep -q 'id = "KV_NAMESPACE_ID"' wrangler.toml; then
  echo "› Creant on es guarden les reunions compartides (Workers KV)"
  ID=$($WRANGLER kv namespace create SHARES 2>&1 | grep -oE '[0-9a-f]{32}' | head -1)
  if [ -z "$ID" ]; then
    echo "No s'ha pogut crear el KV. Si ja existeix, posa'n l'id a wrangler.toml (npx wrangler kv namespace list)." >&2
    exit 1
  fi
  sed -i.bak "s/KV_NAMESPACE_ID/$ID/" wrangler.toml && rm wrangler.toml.bak
fi

echo "› Publicant el Worker"
OUT=$($WRANGLER deploy 2>&1) || { echo "$OUT" >&2; exit 1; }
URL=$(echo "$OUT" | grep -oE 'https://[^ ]+\.workers\.dev' | head -1)

echo "› Clau d'API nova"
KEY="mm_$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-40)"
echo "$KEY" | $WRANGLER secret put API_KEY >/dev/null

cat <<DONE

Fet. A Murmur, ves a Configuració › Compartir i hi enganxes:

  Adreça:      ${URL:-la que surt a dalt, acabada en .workers.dev}
  Clau d'API:  $KEY

La clau no es desa enlloc més: si la perds, torna a executar aquest script per fer-ne una de nova.
DONE
