# Publicar una versió nova de Murmur

Les apps instal·lades busquen actualitzacions en obrir-se (si l'usuari no ho ha desactivat) i amb «Comprova ara» a Configuració › General. Hi ha dues coses que es poden publicar, cadascuna pel seu camí:

- **L'app**: una *release* a [quicodomingo/murmur-releases](https://github.com/quicodomingo/murmur-releases/releases) amb els instal·ladors i els paquets d'actualització de cada sistema, i el `latest.json` que diu a cada app instal·lada què ha de baixar:
  - macOS: el `.dmg` i `Murmur.app.tar.gz` (amb la seva signatura), fets al Mac amb `release.sh`, o a GitHub Actions si hi ha els secrets d'Apple.
  - Windows: `Murmur_<versió>_x64-setup.exe` (instal·lador i paquet d'actualització alhora) i la seva signatura.
  - Linux: `.deb`, `.rpm` i `.AppImage` (aquesta s'actualitza sola), amb les signatures.
- **El repositori del codi** [quicodomingo/murmur](https://github.com/quicodomingo/murmur), públic i amb llicència MIT: `publish.sh` hi puja el codi i l'etiqueta `v<versió>`, i la *release* hi té els mateixos instal·ladors.
- **Windows i Linux es compilen sols**: l'etiqueta engega [`.github/workflows/release.yml`](../.github/workflows/release.yml), que els compila, els signa amb la clau de les actualitzacions i els afegeix a totes dues *releases* i al `latest.json`, sense treure-hi el Mac.
- **Els models**: el catàleg [`models.json`](https://github.com/quicodomingo/murmur-releases/blob/main/models.json) del mateix repositori. Els fitxers dels models són a Hugging Face (`quicodomingo/murmur-models`) o al seu origen.

Publicar és públic i no es pot desfer per a qui ja s'hagi actualitzat: prova sempre la versió al teu Mac abans, i mira que la CI estigui en verd per a Windows i Linux.

## Què cal tenir (un sol cop)

| Què | On | Per a què |
|---|---|---|
| Developer ID «We Are Mortensen S.L.» | Clauer de macOS | Signar l'app |
| Credencials de notarització, perfil `murmur` | Clauer (`xcrun notarytool store-credentials murmur …`) | Notaritzar l'app i el `.dmg` |
| Clau de les actualitzacions | `~/.tauri/murmur-updater.key` (còpia a 1Password) | Signar el paquet d'actualització |
| Contrasenya d'aquesta clau | Clauer, element `murmur-updater` (còpia a 1Password) | `release.sh` la llegeix sola |
| `gh` amb sessió de `quicodomingo` | `gh auth status` | Pujar la *release* |
| Secrets i variables de GitHub Actions | Repositori del codi › Settings › Secrets and variables › Actions | Compilar i publicar Windows i Linux (i macOS, si es vol) |

Els secrets de GitHub Actions (un sol cop):

| Secret | Què és |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | El contingut de `~/.tauri/murmur-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | La contrasenya d'aquesta clau |
| `RELEASES_TOKEN` | Un *fine-grained token* de `quicodomingo` amb permís *Contents: read and write* només a `murmur-releases` |

Per compilar també el Mac a GitHub Actions (opcional; si no, es fa al Mac amb `release.sh` com sempre), la variable `MACOS_CI` = `true` i aquests secrets:

| Secret | Què és |
|---|---|
| `APPLE_CERTIFICATE` | El Developer ID exportat del clauer com a `.p12`, en base64 (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | La contrasenya del `.p12` |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | La clau d'App Store Connect per notaritzar (el contingut de l'`AuthKey_….p8`, el seu id i l'emissor) |

La clau pública és a `app/src-tauri/tauri.conf.json` › `plugins.updater.pubkey`. **Si es perd la clau privada, les apps instal·lades no podran rebre més actualitzacions**: caldria reinstal·lar-les a mà amb una versió que porti una clau nova.

## Publicar una versió de l'app

1. **Puja el número de versió** (el mateix als tres llocs; [semver](https://semver.org): 0.2.0 → 0.2.1 per a correccions, 0.3.0 per a funcions noves):
   - `app/src-tauri/tauri.conf.json` › `version`
   - `app/package.json` › `version` (`cd app && npm pkg set version=0.2.1`)
   - `app/src-tauri/Cargo.toml` › `version`

   Sense una versió més alta, les apps instal·lades no hi veuen res de nou.

2. **Escriu les novetats** de la versió (la pantalla «Novetats de Murmur» que surt després d'actualitzar):
   - Afegeix la versió i la data a `RELEASES` (`app/src/lib/whatsnew.ts`).
   - Afegeix el text a `app/src/locales/{ca,es,en}/whatsnew.json` › `releases` › `"<versió>"`: de 2 a 5 novetats, cadascuna amb `title` i `text` (una o dues frases), i, si cal, un enllaç a una pestanya de la configuració (`link`: `general`, `appearance`, `calendar`, `audio`, `transcription` o `intelligence`, i el seu `linkLabel`).
   - `npm run check-locales` ha de passar. Una versió sense novetats no mostra res (per a correccions petites, no cal).
   - Les `RELEASE_NOTES` del pas 3 són una frase de resum d'aquestes novetats.

3. **Fes el commit** dels canvis i de la versió.

4. **Compila, signa i notaritza** (uns 5 minuts):
   ```bash
   cd app
   RELEASE_NOTES="Una frase amb el més important de la versió." ./scripts/release.sh
   ```
   Després de compilar, hi afegeix l'extensió del menú Compartir (`scripts/share-extension.sh`), que necessita `swiftc` (les Command Line Tools n'hi ha prou).

   Deixa a `app/src-tauri/target/release/bundle/release/`:
   - `Murmur-<versió>.dmg`: signat, notaritzat i grapat.
   - `Murmur.app.tar.gz` i `.sig`: el paquet d'actualització, fet de l'app ja notaritzada i signat amb la clau de les actualitzacions.
   - `latest.json`: versió, notes, data, signatura i URL del paquet.

   Si la notarització falla, l'script mostra el registre d'Apple. Si diu `No Keychain password item found for profile: murmur`, el clauer està bloquejat o cal tornar a desar les credencials.

5. **Prova-la al teu Mac**: tanca Murmur (també des de la barra de menús) i
   ```bash
   rm -rf /Applications/Murmur.app && ditto src-tauri/target/release/bundle/macos/Murmur.app /Applications/Murmur.app
   ```
   Obre-la amb les reunions que ja tens (una versió que només funcioni amb dades noves és el pitjor error possible).

6. **Publica-la**:
   ```bash
   RELEASE_NOTES="Una frase amb el més important de la versió." ./scripts/publish.sh
   ```
   Crea la *release* `v<versió>` al repositori públic amb els quatre fitxers del Mac, puja el codi i l'etiqueta `v<versió>` al repositori del codi (`git push`) i hi crea la mateixa *release* amb el `.dmg`. Les notes van a GitHub, a `latest.json` i al missatge de l'etiqueta: són el que l'app mostra a la finestra «Actualitzant Murmur».

   L'etiqueta engega la compilació de Windows i Linux ([Actions › Publica](https://github.com/quicodomingo/murmur/actions/workflows/release.yml), uns 30 minuts). Quan acaba, totes dues *releases* tenen els instal·ladors i `latest.json` les tres plataformes. Si el Mac també es compila a GitHub Actions (`MACOS_CI`), es pot saltar el pas 4 i fer només `./scripts/publish.sh --no-mac`.

   Si alguna compilació falla, es pot tornar a llançar a Actions › Publica › *Run workflow*, amb l'etiqueta: no toca el que ja s'hi ha publicat del Mac.

7. **Comprova-ho**:
   ```bash
   curl -sL https://github.com/quicodomingo/murmur-releases/releases/latest/download/latest.json
   ```
   Ha de mostrar la versió nova i les plataformes `darwin-aarch64`, `windows-x86_64` i `linux-x86_64`. En una app amb la versió anterior, «Comprova ara» l'ha d'oferir, instal·lar-la i reiniciar-se, i en tornar a obrir-se ha de mostrar les novetats.

### Abans de publicar: les proves

Cada canvi passa per [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): tipus i traduccions, `cargo test` a macOS, Windows i Linux, i les proves e2e (`app/e2e/`): el motor transcriu un àudio de veritat als tres sistemes, i a Windows i Linux es prova la interfície de l'app compilada amb `tauri-driver`. No es publica una versió amb la CI en vermell.

### Si alguna cosa va malament

- **La release té un error**: no esborris la *release* (qui ja s'ha actualitzat no tornarà enrere). Publica'n una de nova amb la correcció i un número més alt.
- **Cal retirar-la abans que s'estengui**: marca-la com a *pre-release* a GitHub (`gh release edit v<versió> --repo quicodomingo/murmur-releases --prerelease`). `releases/latest` passa a apuntar a l'anterior, i les apps que encara no s'hagin actualitzat ja no la veuran.

## Publicar una versió d'un model

Una actualització de model substitueix els fitxers d'un model **amb els mateixos noms** (per exemple, un `encoder.onnx` millor). Si el model nou necessita codi nou (fitxers diferents, un altre model de parlants, uns altres llindars), va amb una versió nova de l'app, i al catàleg se li posa `minApp` a aquella versió.

1. **Mesura'l abans** amb el banc de proves (`bench/`) i, si toca parlants, amb `bench/speakers_eval.py`. Un model nou pot ser millor en una cosa i pitjor en una altra.
2. **Puja els fitxers** a Hugging Face (`quicodomingo/murmur-models`) o fes servir la URL de l'origen. Han de ser públics.
3. **Calcula la mida i el SHA-256** de cada fitxer:
   ```bash
   shasum -a 256 encoder.onnx; stat -f%z encoder.onnx
   ```
4. **Edita `models.json`** al repositori `murmur-releases`:
   ```json
   "transcription": {
     "version": 2,
     "minApp": "0.2.0",
     "notes": "Menys errors en noms propis",
     "files": [
       { "name": "conformer-ca-es-sherpa/encoder.onnx", "url": "https://…", "bytes": 481422175, "sha256": "…" }
     ]
   }
   ```
   - `version`: un número més alt que l'actual (la de fàbrica és 1).
   - `minApp`: la versió més antiga de Murmur que el pot fer servir.
   - `notes`: una línia; surt a la finestra d'actualització.
   - `files`: només els fitxers que canvien, amb el mateix `name` que tenen a `app/src-tauri/src/models.rs`.

   Les apps només actualitzen els models que ja tenen instal·lats. Ho descarreguen a `models/.updates/<id>/`, comproven la mida i el SHA-256, i només llavors substitueixen els fitxers antics. La versió instal·lada queda a `models/versions.json`.

5. **Actualitza també `models.rs`** (URL, mida i SHA-256 dels fitxers) en la propera versió de l'app, perquè les instal·lacions noves ja descarreguin el model nou.

## Privadesa

Comprovar actualitzacions és l'única connexió que Murmur fa per iniciativa pròpia: GitHub veu l'adreça IP i quina versió es demana. No s'hi envia res més, i es pot desactivar a Configuració › General › Actualitzacions.
