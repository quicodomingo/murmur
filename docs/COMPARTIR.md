# Compartir reunions amb un enllaç

Murmur pot publicar una reunió en una pàgina web perquè qualsevol persona amb l'enllaç la llegeixi al navegador, sense tenir Murmur. Cada usuari la publica al **seu** compte de Cloudflare, en un Worker propi. No hi ha cap servidor de Murmur pel mig.

## Com funciona

1. Murmur prepara el que tries (portada, notes, transcripció, captures, àudio) tal com sortirà a la pàgina.
2. **Ho xifra al Mac** (AES-GCM de 256 bits; el text, després de comprimir-lo).
   - Sense contrasenya: es genera una clau a l'atzar que va a l'enllaç, després del `#`. Els navegadors no envien mai aquesta part al servidor.
   - Amb contrasenya: la clau surt de la contrasenya (PBKDF2, 600.000 voltes). L'enllaç no porta cap clau i la contrasenya no surt mai del Mac.
3. Envia el resultat xifrat al Worker, amb la clau d'API que hi ha al clauer de macOS. Les captures i l'àudio van a part, xifrats amb la mateixa clau. L'àudio (en .m4a) va en trossos de 8 MB.
4. El Worker ho desa a Workers KV. Si has triat una caducitat, KV ho esborra sol quan arriba el moment.
5. Qui obre l'enllaç rep una pàgina fixa, que baixa les dades, les desxifra **al seu navegador** i les mostra. L'àudio només es baixa si el vol escoltar, i cada minut de la pàgina hi salta.

Així, ni Cloudflare ni el Worker no poden llegir el que guarden. A més, el Worker només accepta reunions xifrades per Murmur: no serveix per allotjar cap altra cosa.

## Posar-ho en marxa (un sol cop, uns 2 minuts)

Cal un compte de Cloudflare, que és gratuït i no demana targeta. A Murmur, ves a **Configuració › Compartir**:

1. **Obre Cloudflare.** S'obre el formulari de crear un token ja omplert: es diu «Murmur» i només té permís per a Workers (`workers_scripts`) i KV (`workers_kv_storage`), a més de llegir el compte. Si no tens compte, primer te'n demana un. Prem «Create Token» i copia'l.
2. **Enganxa'l i prem «Configura».** Murmur (`share.rs`):
   - crea el KV `murmur-shares`, o reaprofita el que hi hagi;
   - publica el Worker `murmur-share` amb la pàgina, el KV i una clau d'API nova;
   - activa l'adreça `https://murmur-share.<el-teu-compte>.workers.dev`, i si el compte encara no té nom a workers.dev, n'hi posa un;
   - comprova que respon. La primera vegada, l'adreça pot trigar uns minuts.

No cal tenir cap domini. Murmur desa el token al clauer, i quan una versió nova de Murmur porta canvis al Worker, el torna a publicar abans de compartir. Configurar-ho de nou també canvia la clau d'API.

- **Un domini propi:** al tauler de Cloudflare, Workers › murmur-share › Settings › Domains & Routes. Després, connecta Murmur a la nova adreça a mà (opció «Ja tinc un Worker publicat amb setup.sh»).
- **Sense l'assistent:** `cd share && ./setup.sh`, des de l'app Terminal, fa el mateix amb wrangler i mostra l'adreça i la clau per connectar-les a mà.
- **Provar-ho en local:** `npm run dev` (amb `API_KEY=…` a `share/.dev.vars`) aixeca el Worker a `http://localhost:8787`, i Murmur s'hi pot connectar a mà.

## Límits del pla gratuït

| | Gratuït |
|---|---|
| Reunions compartides al dia | 1.000 |
| Visites al dia | 100.000 |
| Espai total | 1 GB (una reunió d'una hora, xifrada, ocupa unes desenes de kB) |
| Mida màxima d'una reunió | 20 MB per peça: el text, cada captura i cada tros de 8 MB d'àudio (una hora d'àudio en fa uns quants) |

## Retirar un enllaç

Una reunió compartida porta la icona d'enllaç a la barra lateral i el botó **Compartida** a dalt, que obre el diàleg. Cada enllaç hi té **Copia** i **Retira**, que l'esborra del Worker amb els seus fitxers. També es retiren els enllaços d'una reunió quan l'esborres. Si en aquell moment no hi ha connexió, caducaran igualment quan toqui, però els que no caduquen es quedarien publicats: retira'ls a mà abans.

Desconnectar Murmur del Worker no retira res. Els enllaços continuen funcionant, però no se'n poden crear de nous ni retirar-ne fins que el tornis a connectar.

## Fitxers

| Fitxer | Què fa |
|---|---|
| `share/src/worker.js` | L'API (`/api/ping`, `/api/shares`) i les adreces de les reunions i dels seus fitxers |
| `share/src/viewer.*`, `viewer-script.js` | La pàgina que desxifra i mostra la reunió (van dins el Worker com a mòduls de text) |
| `share/setup.sh` | La instal·lació sense l'assistent |
| `app/src/lib/share.ts` | Què es comparteix, el xifratge i la connexió |
| `app/src-tauri/src/share.rs` | El clauer, les crides al Worker i la publicació a Cloudflare |
| `app/src/components/ShareDialog.tsx` | El diàleg «Comparteix la reunió» |
