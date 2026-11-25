# Murmur

Guia per a qui treballa en aquest repositori, persones o agents de codi. Murmur és una app per a macOS, Windows i Linux (Tauri 2, React i un motor en Rust) que transcriu reunions en directe, en català, castellà i anglès, distingeix qui parla i, en acabar, en pot escriure un resum amb un model local. **Tot es processa a l'ordinador.**

## On és cada cosa

| Document | Què hi ha |
|---|---|
| [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) | Com funciona per dins, per què està fet així i què s'ha mesurat |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | El que falta per fer, amb caselles |
| [`docs/design/DESIGN.md`](docs/design/DESIGN.md) | El disseny: marca, temes, components, mides |
| [`docs/TRADUCCIONS.md`](docs/TRADUCCIONS.md) | Com s'escriuen i es tradueixen els textos de la interfície |
| [`docs/PUBLICAR.md`](docs/PUBLICAR.md) | Com es publica una versió de l'app o d'un model |
| [`docs/LANDING.md`](docs/LANDING.md) | Els textos i les captures per a la pàgina de descàrrega |
| [`docs/NOVETATS-0.14.md`](docs/NOVETATS-0.14.md) | El post del blog de la 0.14 i què cal canviar de la web |
| [`docs/MOBIL.md`](docs/MOBIL.md) | L'exploració d'una versió per a mòbil |

| Carpeta | Què hi ha |
|---|---|
| `app/src/` | Interfície (React, shadcn/ui, i18next) |
| `core/` | El motor en Rust (`murmur-core`), compartit amb el mòbil: transcripció, parlants, la teva veu, glossari, puntuació, gravació, base de dades i textos (`i18n.rs`) |
| `app/src-tauri/src/` | L'app de l'ordinador en Rust: captura d'àudio, finestres, calendari, Whisper, model de llenguatge, compartir, connector per a Claude |
| `app/whisper/` | `murmur-whisper`, el procés a part que fa la passada final amb Whisper |
| `share/` | El Worker de Cloudflare dels enllaços compartits ([`docs/COMPARTIR.md`](docs/COMPARTIR.md)) |
| `feedback/` | El Worker de Cloudflare que rep els comentaris de l'app ([`docs/COMENTARIS.md`](docs/COMENTARIS.md)) |
| `mobile/` | Les apps del mòbil: `ffi/` (el motor amb UniFFI, `murmur-mobile`), `ios/Murmur/` (l'app en SwiftUI) i `ios/MurmurProbe/` (la prova d'una tarda). Vegeu [`docs/MOBIL.md`](docs/MOBIL.md) |
| `bench/`, `mvp/`, `tools/` | Banc de proves, primer prototip, scripts d'exportació de models (Python, amb `uv`) i les captures de la landing (`tools/landing-captures/`) |

## Ordres

```bash
cd app && npm install && npm run tauri dev            # l'app
TRANSCRIPTOR_SIMULATE=../data/reunio-3min.wav npm run tauri dev   # amb un WAV en lloc del micròfon
cd app/src-tauri && cargo test                         # tests de l'app i del motor (core/)
cd app && npx tsc --noEmit && npm run check-locales    # tipus i traduccions
cd app/src-tauri && cargo run --release -- --mcp       # el connector per a Claude (MCP per stdio)
cd app/src-tauri && cargo run --release --example lang_probe -- ../../data/reunio.m4a   # l'idioma que detectaria
```

## Regles del projecte

**Llengua**
- Codi, noms i comentaris en anglès. Documentació en català.
- Cap text visible s'escriu al codi: sempre amb `t()` i claus a `app/src/locales/`, o a `core/src/i18n.rs` des de Rust. El català és la font, i el castellà i l'anglès s'actualitzen alhora. `npm run check-locales` ha de passar.
- Cap text, en cap idioma, porta guions llargs (—).
- Els textos parlen de l'**ordinador**, no del Mac: Murmur funciona a macOS, Windows i Linux. Només es diu «Mac» del que és exclusiu del Mac (el Finder, el Dock, Configuració del Sistema…). Els textos antics que diuen «Mac» tenen la versió de PC a `locales/*/pc.json`.

**Disseny**
- Qualsevol canvi d'interfície segueix `docs/design/DESIGN.md`.
- Els colors només surten dels tokens `--mm-*` (`app/src/murmur-theme.css`) i de les utilitats `*-mm-*` o dels tokens de shadcn que hi apunten. Mai hexadecimals escrits a mà.
- L'àcid (#D4FF3A) mai és text ni línia sobre fons clar.
- Edició inline amb `<textarea>`, no amb `contentEditable`.

**Privadesa**
- Tot es processa en local per defecte. Qualsevol connexió al núvol ha de ser opcional i explícita.
- Si algun dia hi ha un model al núvol, serà amb la clau pròpia de l'usuari, desada al clauer del sistema, mai en text pla. Només s'hi enviaria text, mai àudio.
- Compartir una reunió publica només el que tria l'usuari, xifrat al Mac abans de sortir-ne, al seu propi Worker de Cloudflare.
- El connector per a Claude (`mcp.rs`) està desactivat fins que l'usuari l'afegeix. Llegeix la base de dades només en lectura, i a Claude només li dona text, mai àudio.
- Gravar una reunió requereix el consentiment de qui hi participa, i l'app ho recorda en començar.
- Les estadístiques d'ús (`lib/analytics.ts`, Aptabase) són anònimes i es poden desactivar (casella a l'onboarding, interruptor a Configuració › General). Un esdeveniment nou mai porta contingut de les reunions (títols, text, noms, notes, àudio) ni cap identificador, i les mides i quantitats van en franges (`minutesBucket`, `countBucket`).

**Models i dades**
- Les gravacions, els models i els resultats no es pugen al repositori (`data/`, `models/`, `results/`).
- Cap canvi de model sense mesurar-lo abans amb el banc de proves: WER i factor de temps real, i, si toca parlants, `bench/speakers_eval.py`.
- Objectiu mínim: un M1 amb 8 GB. Els models es carreguen per torns i cap model en directe passa de ~500 MB.

**Full de ruta**
- Quan s'acaba una tasca, es marca a `docs/ROADMAP.md`. Si canvia com funciona alguna peça, s'actualitza `docs/ARQUITECTURA.md`.
- Quan s'afegeix una funcionalitat nova o en canvia una de visible, s'actualitza l'apartat de funcionalitats dels tres README (`README.md`, `README.ca.md` i `README.es.md`), i també la privadesa, els requisits o el full de ruta si toca.

## Abans de publicar una versió

Tot el procés és a `docs/PUBLICAR.md`. Els passos que és fàcil d'oblidar:

- **Pregunta sempre, abans de cada publicació, si aquesta versió també surt per a Windows i Linux.** Ho decideix la variable `PC_RELEASE` del repositori del codi (`gh variable list --repo quicodomingo/murmur`):
  - Si la resposta és sí i la variable no és `true`, posa-la amb `gh variable set PC_RELEASE --body true --repo quicodomingo/murmur` abans de `publish.sh`. Després, recorda a l'usuari que ha d'aprovar dues vegades a Actions › Publica (abans de compilar i abans de publicar).
  - Si és no i la variable és `true`, treu-la amb `gh variable delete PC_RELEASE --repo quicodomingo/murmur`. Només es publica el Mac.

- **Si la versió porta canvis visibles, s'escriuen les novetats** que l'app mostra després d'actualitzar:
  - La versió i la data van a `RELEASES` (`app/src/lib/whatsnew.ts`).
  - De 2 a 5 novetats van a `app/src/locales/{ca,es,en}/whatsnew.json` › `releases` › `"<versió>"`. Cadascuna té `title`, un `text` d'una o dues frases i, si cal, un `link` a una pestanya de la configuració amb el seu `linkLabel`. Sense icones. Només una novetat molt important pot portar una imatge (`image` i, si cal, `imageDark`: un fitxer de `app/public/whatsnew/` d'uns 880×400 px).
  - Les `RELEASE_NOTES` de `publish.sh` són una frase de resum d'aquestes novetats.
  - Una correcció petita pot anar sense novetats, i llavors no surt res.

## Preferències personals

Les preferències de cadascú (eines, skills, dreceres) van a `CLAUDE.local.md`, que no es puja al repositori.
