# Publicar una versió nova de Murmur

Les apps instal·lades busquen actualitzacions en obrir-se (si l'usuari no ho ha desactivat) i amb «Comprova ara» a Configuració › General. Hi ha dues coses que es poden publicar, cadascuna pel seu camí:

- **L'app**: una *release* a [quicodomingo/murmur-releases](https://github.com/quicodomingo/murmur-releases/releases) amb el `.dmg` (instal·lacions noves) i el paquet d'actualització (`Murmur.app.tar.gz`, la seva signatura i `latest.json`).
- **El repositori privat** [quicodomingo/murmur](https://github.com/quicodomingo/murmur) (codi): `publish.sh` hi puja el codi i hi crea la mateixa *release* amb el `.dmg`, per als col·laboradors.
- **Els models**: el catàleg [`models.json`](https://github.com/quicodomingo/murmur-releases/blob/main/models.json) del mateix repositori. Els fitxers dels models són a Hugging Face (`quicodomingo/murmur-models`) o al seu origen.

Publicar és públic i no es pot desfer per a qui ja s'hagi actualitzat: prova sempre la versió al teu Mac abans.

## Què cal tenir (un sol cop)

| Què | On | Per a què |
|---|---|---|
| Developer ID «We Are Mortensen S.L.» | Clauer de macOS | Signar l'app |
| Credencials de notarització, perfil `murmur` | Clauer (`xcrun notarytool store-credentials murmur …`) | Notaritzar l'app i el `.dmg` |
| Clau de les actualitzacions | `~/.tauri/murmur-updater.key` (còpia a 1Password) | Signar el paquet d'actualització |
| Contrasenya d'aquesta clau | Clauer, element `murmur-updater` (còpia a 1Password) | `release.sh` la llegeix sola |
| `gh` amb sessió de `quicodomingo` | `gh auth status` | Pujar la *release* |

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
   Crea la *release* `v<versió>` al repositori públic amb els quatre fitxers, puja el codi al privat (`git push`) i hi crea la mateixa *release* amb el `.dmg`. Les notes van a GitHub i a `latest.json`: són el que l'app mostra a la finestra «Actualitzant Murmur».

7. **Comprova-ho**:
   ```bash
   curl -sL https://github.com/quicodomingo/murmur-releases/releases/latest/download/latest.json
   ```
   Ha de mostrar la versió nova. En una app amb la versió anterior, «Comprova ara» l'ha d'oferir, instal·lar-la i reiniciar-se, i en tornar a obrir-se ha de mostrar les novetats.

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
