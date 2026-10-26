# Compartir reunions amb un enllaç

Murmur pot publicar una reunió en una pàgina web perquè qualsevol persona amb l'enllaç la llegeixi al navegador, sense tenir Murmur. Cada usuari la publica al **seu** compte de Cloudflare, en un Worker propi. No hi ha cap servidor de Murmur pel mig.

## Com funciona

1. Murmur prepara el que tries (portada, notes, transcripció) tal com sortirà a la pàgina.
2. **Ho xifra al Mac** (AES-GCM de 256 bits, després de comprimir-ho).
   - Sense contrasenya: es genera una clau a l'atzar que va a l'enllaç, després del `#`. Els navegadors no envien mai aquesta part al servidor.
   - Amb contrasenya: la clau surt de la contrasenya (PBKDF2, 600.000 voltes). L'enllaç no porta cap clau i la contrasenya no surt mai del Mac.
3. Envia el resultat xifrat al Worker, amb la clau d'API que tens al clauer de macOS.
4. El Worker el desa a Workers KV. Si has triat una caducitat, KV l'esborra sol quan arriba el moment.
5. Qui obre l'enllaç rep una pàgina fixa, que baixa les dades, les desxifra **al seu navegador** i les mostra.

Així, ni Cloudflare ni el Worker no poden llegir el que guarden. A més, el Worker només accepta reunions xifrades per Murmur: no serveix per allotjar cap altra cosa.

L'àudio i les captures no es comparteixen mai.

## Posar-ho en marxa (un sol cop, uns 5 minuts)

Cal un compte gratuït de Cloudflare (no demana targeta) i Node.js.

S'ha d'executar des de l'app Terminal, perquè iniciar sessió obre el navegador i espera la resposta:

```bash
cd share
./setup.sh
```

L'script:
1. Obre el navegador per iniciar sessió a Cloudflare.
2. Crea el KV on es guarden les reunions i n'apunta l'id a `wrangler.toml`.
3. Publica el Worker a `https://murmur-share.<el-teu-compte>.workers.dev`. No cal tenir cap domini.
4. Hi posa una clau d'API nova (un secret del Worker).
5. En acabar, mostra l'adreça i la clau.

A Murmur, ves a **Configuració › Compartir**, enganxa-hi l'adreça i la clau i prem «Connecta». Murmur les comprova i les desa al clauer.

- **Canviar la clau:** torna a executar `./setup.sh`. Fa una clau nova (l'antiga deixa de funcionar) i cal tornar a connectar Murmur.
- **Un domini propi:** al tauler de Cloudflare, Workers › murmur-share › Settings › Domains & Routes. Després, connecta Murmur a la nova adreça.
- **Provar-ho en local:** `npm run dev` (amb `API_KEY=…` a `share/.dev.vars`) aixeca el Worker a `http://localhost:8787`, i Murmur s'hi pot connectar.

## Límits del pla gratuït

| | Gratuït |
|---|---|
| Reunions compartides al dia | 1.000 |
| Visites al dia | 100.000 |
| Espai total | 1 GB (una reunió d'una hora, xifrada, ocupa unes desenes de kB) |
| Mida màxima d'una reunió | 20 MB |

## Retirar un enllaç

Al diàleg «Comparteix la reunió», cada enllaç té el botó **Retira**, que l'esborra del Worker. També es retiren els enllaços d'una reunió quan l'esborres. Si en aquell moment no hi ha connexió, caducaran igualment quan toqui, però els que no caduquen es quedarien publicats: retira'ls a mà abans.

Desconnectar Murmur del Worker no retira res. Els enllaços continuen funcionant, però no se'n poden crear de nous ni retirar-ne fins que el tornis a connectar.

## Fitxers

| Fitxer | Què fa |
|---|---|
| `share/src/worker.js` | L'API (`/api/ping`, `/api/shares`) i les adreces de les reunions |
| `share/public/viewer.*` | La pàgina que desxifra i mostra la reunió |
| `share/setup.sh` | La instal·lació |
| `app/src/lib/share.ts` | Què es comparteix, el xifratge i la connexió |
| `app/src-tauri/src/share.rs` | El clauer i les crides al Worker |
| `app/src/components/ShareDialog.tsx` | El diàleg «Comparteix la reunió» |
