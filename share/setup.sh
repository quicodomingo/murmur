#!/usr/bin/env bash
# Publishes Murmur's shared links on your Cloudflare account (docs/COMPARTIR.md): signs in,
# creates the KV store, sets a new API key and deploys. Run it again to rotate the key.
set -euo pipefail
cd "$(dirname "$0")"

npm install --silent
WRANGLER="npx wrangler"

$WRANGLER whoami >/dev/null 2>&1 || $WRANGLER login

# Never stop without saying where.
trap 'echo "S'"'"'ha aturat a la línia $LINENO. Torna-ho a provar; si es repeteix, envia el que surt a dalt." >&2' ERR

KV_NAME="murmur-shares"
# The id of the KV store, if it exists (also left over from an earlier run).
kv_id() {
  $WRANGLER kv namespace list 2>/dev/null </dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const n = JSON.parse(s.slice(s.indexOf("["))).find((n) => n.title === process.argv[1]); process.stdout.write(n ? n.id : ""); } catch {}
    });' "$KV_NAME"
}

if grep -q 'id = "KV_NAMESPACE_ID"' wrangler.toml; then
  echo "› Creant on es guarden les reunions compartides (Workers KV)"
  ID=$(kv_id)
  if [ -z "$ID" ]; then
    if ! OUT=$($WRANGLER kv namespace create "$KV_NAME" </dev/null 2>&1); then
      echo "$OUT" >&2
      echo "No s'ha pogut crear el KV." >&2
      exit 1
    fi
    ID=$(kv_id)
  fi
  if [ -z "$ID" ]; then
    echo "${OUT:-}" >&2
    echo "S'ha creat el KV però no en trobo l'id. Busca'l amb «npx wrangler kv namespace list» (es diu $KV_NAME) i posa'l a wrangler.toml." >&2
    exit 1
  fi
  sed -i.bak "s/KV_NAMESPACE_ID/$ID/" wrangler.toml && rm wrangler.toml.bak
fi

echo "› Publicant el Worker"
OUT=$($WRANGLER deploy </dev/null 2>&1) || { echo "$OUT" >&2; exit 1; }
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
