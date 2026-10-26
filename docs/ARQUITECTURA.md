# Arquitectura de Murmur

Com funciona Murmur per dins, per què està fet així i què s'ha mesurat per decidir-ho. Les regles per treballar-hi són a [`CLAUDE.md`](../CLAUDE.md), i el que falta per fer, al [full de ruta](ROADMAP.md).

## Visió general: dues passades

Murmur transcriu en directe amb models petits i ràpids. Quan s'atura la gravació, una segona passada repassa la reunió sencera amb models més grans.

| Capa | En directe (latència d'1 a 3 s) | Passada final (en aturar) |
|---|---|---|
| Detecció de veu | Silero VAD | |
| Transcripció | Conformer-Transducer català i castellà (Projecte AINA) amb sherpa-onnx; en anglès, Parakeet TDT-CTC 110M | Whisper large-v3-turbo (whisper.cpp), només en reunions d'una sola llengua |
| Parlants | Embeddings NeMo TitaNet-small i agrupació en línia | Segmentació pyannote 3.0 + embeddings 3D-Speaker |
| Puntuació | | Model de Softcatalà (català, sense Whisper) |
| Portada i resum | | Gemma 4 E4B local, opcional; o Claude / OpenAI amb la clau de l'usuari |

Fases del projecte:

1. **Banc de proves** (`bench/`): comparar motors amb gravacions reals, en precisió (WER) i velocitat (factor de temps real, RTF).
2. **Prototip** (`mvp/`): Python amb una interfície web local, per validar la idea.
3. **Producte** (`app/`): Tauri 2 amb un motor en Rust. És la fase actual.
4. **Mòbil**: el mateix nucli en Rust (Tauri mobile o una interfície nativa).

L'app final no porta Python ni PyTorch.

## Maquinari

- **Desenvolupament:** Mac M4 amb 16 GB.
- **Objectiu mínim:** M1 amb 8 GB. Per això els models es carreguen per torns (directe, alliberar, passada final, alliberar, model de llenguatge), el model de llenguatge és de 3 a 4 mil milions de paràmetres en 4 bits, i cap model en directe passa de ~500 MB.

## Banc de proves (`bench/`)

```bash
uv run python -m bench.models                       # descarrega models a models/
uv run python -m bench.run data/reunio.m4a \
    --ref data/reunio.ref.txt --ref-minutes 10 --speakers 3
```

- `--ref` i `--ref-minutes`: la referència transcrita a mà cobreix els primers N minuts, i només s'avalua aquest tros.
- Sortida a `results/<nom>/`: un `.txt` per motor, `diarization.txt` i `report.json` (WER, CER, RTF).
- Motors: `conformer-ca-ctc` (sherpa-onnx), `conformer-ca-es-rnnt` (onnx-asr), `whisper-turbo-mlx` (MLX) i `whisper-aina-ct2` (faster-whisper, CPU).
- Diarització: sherpa-onnx (segmentació pyannote 3.0 + embeddings 3D-Speaker), sense token de Hugging Face.

### Resultats de la primera reunió real (20 min, 5 parlants)

- `conformer-ca-ctc` (NVIDIA, només català): poc usable en parla espontània.
- `conformer-ca-es-rnnt` (AINA): **el millor**. Entén el canvi de llengua dins la frase. RTF 0,02. No posa puntuació ni majúscules, i escriu malament les marques (WordPress, WooCommerce, Shopify).
- La diarització offline infravalora els parlants: amb 5 demanats, ho reparteix gairebé tot en 3. RTF 0,15.
- En directe: ~3% de CPU sense text provisional, ~32% amb text provisional (M4).
- NVIDIA Nemotron ASR **no suporta el català**. Sortformer sí que serviria per a parlants, perquè no depèn de l'idioma.

## Prototip (`mvp/`)

```bash
uv run python -m mvp.server        # http://localhost:8765 (PORT=… per canviar-lo)
```

- El navegador captura el micròfon (AudioWorklet, remostreig a 16 kHz) i envia PCM Float32 per WebSocket (`/ws`).
- `mvp/live.py`: Silero VAD, Conformer ca-es (text provisional cada 0,6 s d'àudio i definitiu en acabar la frase) i agrupació de veus en línia amb 3D-Speaker.
- Protocol: el client envia `{maxSpeakers, threshold}`, rep `ready`, envia àudio binari i `{"type":"stop"}`. El servidor envia `partial`, `final` (`id, start, end, speaker, text`) i `done`.
- Interfície (`mvp/static/`): HTML, CSS i JS sense dependències. Es manté com a referència.

## L'app (`app/`)

```bash
cd app && npm install
npm run tauri dev                                    # app amb micròfon
TRANSCRIPTOR_SIMULATE=../data/reunio-3min.wav npm run tauri dev   # àudio d'un WAV de 16 kHz al ritme real
cd src-tauri && cargo run --release --example simulate -- ../../data/reunio-3min.wav   # motor sense interfície
```

L'app es diu Murmur. El codi i el crate es diuen `transcriptor`, el nom antic. Identificador: `com.quicodomingo.murmur`.

### Motor en directe (`engine.rs`)

- Port de `mvp/live.py` sobre el crate oficial `sherpa-onnx` (1.13.8). L'API de Rust del VAD no té `current_segment`, així que el text provisional es fa amb un buffer propi (pre-roll de 0,4 s) que només descodifica els últims 8 s.
- **Model:** `models/conformer-ca-es-sherpa/`, exportat amb `tools/export_conformer_sherpa.py` (cal NeMo en un entorn a part). És un Conformer clàssic, amb `subsampling_factor` 4. Hi ha una versió int8 (142 MB en lloc de 500 MB), però a l'M4 va més lenta (RTF 0,039 en lloc de 0,021).
- Respecte a l'export d'onnx-asr del prototip, un 9,7% de paraules canvien per la diferent extracció de característiques. A ull, la qualitat és comparable.
- `models_dir()` llegeix `TRANSCRIPTOR_MODELS`, o `../../models` si existeix (desenvolupament), o la carpeta de dades de l'app.

### Àudio (`audio.rs`, `systap.rs`, `pipeline.rs`, `aec.rs`)

- **Micròfon:** cpal, passat a mono i remostrejat linealment a 16 kHz.
- **Àudio del sistema:** un *process tap* de Core Audio (macOS 14.2 o posterior). És un tap mono de tot el que sona menys Murmur, llegit amb un dispositiu agregat privat i passat a 16 kHz.
  - La freqüència és la del dispositiu agregat, no la del format del tap, i es vigila. Quan una app de trucades activa el processament de veu de macOS, la sortida pot baixar de 48 a 24 kHz. Abans això accelerava l'altra banda ×2 i no es reconeixia res. Ara Murmur escolta els canvis i, cada 4 s de blocs continus, compara les mostres rebudes amb el rellotge; si no quadra, passa a la freqüència estàndard més propera. `MURMUR_DEBUG_TAP=1` ho mostra.
  - Només demana «Gravació d'àudio del sistema», no la pantalla, i no fa treballar WindowServer. L'estat del permís i la petició es fan amb les funcions privades de TCC (`TCCAccessPreflight` i `TCCAccessRequest`, servei `kTCCServiceAudioCapture`), carregades amb `dlopen` a `permissions.rs`. Si no hi fossin, l'estat queda desconegut (sense permís, el tap dona silenci).
  - Abans es feia amb ScreenCaptureKit, que obliga a capturar vídeo: amb una videotrucada, WindowServer reduïa la pantalla 60 cops per segon.
- **Les fonts no es barregen:** cada una té la seva `LiveSession`. El micròfon passa abans per la **cancel·lació d'eco WebRTC AEC3** (crate `sonora`, Rust pur), amb l'àudio del sistema com a referència, i només es processa quan ja s'ha vist la referència d'aquell instant. Prova sintètica (eco amb 120 ms de retard i filtre): −65 dB d'eco, amb un residu curt els primers ~4 s mentre l'AEC s'adapta.
- Les frases del micròfon que repeteixen almenys el 60% de paraules d'una del sistema (±2 s) es descarten.
- Les fonts aturades s'omplen de silenci segons el rellotge real, però només quan la cua d'àudio capturat és buida. Amb el Mac saturat (Google Meet amb vídeo), l'àudio pendent es prenia per silenci i es desava com a zeros: a la prova del 18/10, entre el 50% i el 99% de zeros mentre Meet era obert. Si la cua passa de 60 fragments, es deixa de fer el text provisional fins que s'atrapa.
- Ids de parlant: micròfon 0…, sistema 100… (`SYSTEM_SPEAKER_BASE`). En una trucada, el parlant 0 del micròfon es diu «Tu».
- Esdeveniments de Tauri: `transcript` (partial/final), `level`, `transcript-done`, `transcript-error`.
- Windows (pendent): loopback WASAPI.

### Idioma de la reunió

`settings.language`: `ca`, `es`, `ca-es` (per defecte) o `en`, a Configuració › Transcripció.

- Tria el model en directe (`engine.rs`, `LiveModel`): el Conformer ca-es per a tot menys l'anglès, que fa servir **Parakeet TDT-CTC 110M** (`models/parakeet-en/`, model opcional `english`, 458 MB, ja posa puntuació).
- En una sola llengua i amb el model `whisper` descarregat, la passada final hi afegeix Whisper.
- La puntuació de Softcatalà només s'aplica a `ca` i `ca-es` sense Whisper.
- Cada reunió desa l'idioma en què es va gravar (`meeting.language`, columna `language`).

### Desar i escoltar l'àudio

- **Desar** (`recorder.rs`): Ogg/Opus a 16 kHz. Amb una font, mono a 16 kbps (~7 MB/h). Amb dues, **estèreo a 24 kbps (~11 MB/h)**: micròfon a l'esquerra (ja sense eco) i sistema a la dreta. La transcripció de l'àudio descomprimit és pràcticament idèntica a l'original. Fitxer a `<app_data_dir>/recordings/<meeting_id>.ogg`. Opus es compila amb cmake.
- **Escoltar** (`playback.rs`, `lib/player.ts`, `PlayerBar.tsx`): l'Ogg es descodifica, es barreja en mono i es passa a AAC a 48 kbps (~22 MB/h) amb `afconvert`. El `.m4a` va a `<app_cache_dir>/playback/` i es refà si l'Ogg és més nou. Clicar el minut d'una frase o de la portada la fa sonar d'allà, i la transcripció segueix la frase que sona. Sempre es desa en Ogg, que és més petit i manté els canals separats per tornar-los a analitzar.

### Persistència i cerca (`db.rs`)

- SQLite (`rusqlite` amb SQLite inclòs) a `<app_data_dir>/transcriptor.sqlite3`. Taules `meetings` i `utterances` (una fila per frase), i un índex **FTS5** (`search`, `unicode61 remove_diacritics 2`, que ignora els accents) sobre títols, frases (mantingut amb triggers) i blocs de notes.
- La barra lateral carrega resums (`list_meetings`), i el contingut es carrega en obrir la reunió (`get_meeting`). Les edicions es desen com a canvis petits (`apply_changes`) amb un retard d'1,5 s; els canvis d'estat, a l'instant.
- Etiquetes: taules `tags` (nom únic sense distingir majúscules) i `meeting_tags`. Una etiqueta existeix mentre alguna reunió la té. El resum de cada reunió porta les seves etiquetes, i la barra lateral compta i filtra a partir d'aquí, també els resultats de la cerca. Es canvien amb `apply_changes` (`meta.tags`, la llista sencera); `rename_tag` reanomena a totes les reunions, i si el nom nou ja és d'una altra etiqueta, les ajunta; `delete_tag` la treu de totes. `put_meeting` conserva les etiquetes si la reunió nova no en porta.
- Cerca (`search_meetings`): cada paraula com a prefix, totes obligatòries. Els fragments marquen les coincidències amb `\u0002…\u0003`, mai amb HTML.
- Migració automàtica dels fitxers JSON antics i del `localStorage` del webview. En un navegador sense Tauri, les reunions viuen a `localStorage` (útil per treballar la interfície).

### Interfície (`src/`)

- React amb shadcn/ui (Radix, preset Nova), tokens propis a `src/index.css` i `src/murmur-theme.css`, i la font del sistema. Finestra amb `titleBarStyle: Overlay` i `data-tauri-drag-region` a la barra d'eines.
- **Textos:** i18next, amb els textos a `src/locales/<idioma>/<espai>.json` (vegeu [TRADUCCIONS.md](TRADUCCIONS.md)). Rust té els seus a `i18n.rs` (menús, safata, avisos i errors), i els permisos de macOS van en `.lproj`.
- Edició inline amb `<textarea>` que creix, **no** `contentEditable`: amb React duplicava text.
- La transcripció en directe segueix el text nou fins que l'usuari puja; llavors surt «Torna al directe».
- El panell de notes es pot amagar, redimensionar (doble clic restableix; fletxes del teclat) i posar en mode complet. Es recorda a `localStorage`.
- En producció es bloqueja el menú contextual del web fora del text editable, i l'inspector només existeix en builds de desenvolupament.
- En desenvolupament, `?window=indicator`, `?window=toast` o `?window=whatsnew` mostren aquelles finestres soles al navegador.

### Configuració (`SettingsDialog.tsx`)

⌘, o «Configuració…» al menú de l'app (emet `open-settings`). Es desa a `localStorage` (`transcriptor.settings.v1`) i es passa a `start_recording`. Sis pestanyes: General, Aparença, Calendari, Àudio, Transcripció i Intel·ligència (vegeu [DESIGN.md](design/DESIGN.md)).

### Notes (`NotesPanel.tsx`, `lib/notes.ts`)

Editor Tiptap 3 (títols, negreta, cursiva, subratllat, ratllat, llistes i tasques, amb dreceres de Markdown). Es desa com a JSON de Tiptap (`meeting.notesDoc`) perquè **cada bloc porta `attrs.t`**, el minut de la reunió en què s'hi va escriure. L'exportació a Markdown és pròpia (`docToMarkdown`).

### Indicador de gravació, mode compacte i captures

- **Indicador** (`shell.rs`, finestra `indicator`, `IndicatorWindow.tsx`): una píndola a la vora dreta mentre es grava, amb el nivell, «obre Murmur» i «atura».
- **Mode compacte:** clicant la píndola, la finestra principal es fa estreta (380 × 600), sempre al davant i al costat de l'indicador, només amb les notes (`set_compact`).
- **Captures** (`capture.rs`, manuals, des de l'indicador i el mode compacte): busca la finestra de la trucada (Zoom, Teams, FaceTime, Webex, o un navegador amb «Meet», «Teams» o «Zoom» al títol de la pestanya activa; la més gran) i la captura amb `screencapture -l`. Si no n'hi ha, captura la pantalla principal. JPEG a `<app data>/screens/<reunió>/<ms>.jpg`, columna `screens`. Es veuen sota la frase d'aquell moment i dins la part corresponent de la portada. Fa servir el permís de Gravació de pantalla. `examples/capture_probe` llista les finestres.

### Calendari (`calendar.rs`, EventKit)

- Llegeix el Calendari de macOS, que inclou els comptes de Google, iCloud i Exchange afegits al sistema. La integració directa amb Google demanaria OAuth i la verificació de Google; només caldria per a Windows.
- Permís propi (`NSCalendarsFullAccessUsageDescription` i l'entitlement `personal-information.calendars`).
- Cada 20 s, `shell.rs` busca una reunió que comenci d'aquí a 2 minuts o menys (o fa menys d'1 minut) i mostra l'avís, un cop per esdeveniment. Per defecte, només esdeveniments amb convidats o enllaç de videotrucada.
- En començar a gravar, la reunió agafa el títol i els convidats de l'esdeveniment en curs (`lib/calendar.ts`, columna `guests`). El menú de cada parlant els ofereix com a noms.

### Portada (`lib/cover.ts`, `Cover.tsx`)

- El model llegeix la transcripció i, al final, les notes amb el minut en què es van escriure (també compten com a font de tasques i decisions). Cada part es demana amb un prompt propi i una resposta JSON limitada per un esquema, així que els prompts es poden editar a la configuració sense trencar res.
- **Qui l'escriu** (`settings.coverEngine`): Gemma al Mac (per defecte), o Claude o OpenAI amb la clau d'API de l'usuari (`cloud.rs`, `lib/cloud.ts`). La clau es comprova llistant els models del compte, es desa al clauer de macOS (servei `com.quicodomingo.murmur.cloud`) i no torna mai a la interfície, que només en sap les quatre últimes lletres. `run_llm` rep l'`engine` i fa una crida per part amb els mateixos prompts; els esquemes es tornen estrictes (objectes tancats, tots els camps obligatoris, sense mides de llista). El document va primer i igual a cada crida, perquè la memòria cau del proveïdor el llegeixi un sol cop. Al núvol no s'espera que acabi la gravació (`gate.rs`), perquè no carrega el Mac. La portada desa el nom del model (`writtenBy`) i ho diu sota l'entradeta. Només surt text: transcripció i notes, mai àudio.
- **Idioma** (`settings.coverLanguage`): el de la interfície (per defecte) o el de la reunió. «Català + castellà» s'escriu en català, i les reunions sense idioma desat fan servir el de la interfície (`coverLanguageFor`).
- **To:** es desa com un identificador fix (`constructive`, `tense`…) i es tradueix en mostrar-lo. Les portades antigues en català es continuen llegint.
- **Tasques:** només accions que algú demana o es compromet a fer. Es poden marcar, editar, assignar, eliminar i afegir; en tornar a generar, es conserven les afegides a mà i les marcades.
- **Noms:** reanomenar un parlant canvia el nom dins la portada (`renameInCover`), també mentre es genera. Els noms per defecte («Parlant 1», «Tu») es reconeixen en els tres idiomes.
- **Desactualitzada:** la portada desa una empremta del que ha llegit (`basis`). Si després canvien noms, parlants, text o notes, avisa i ofereix tornar-la a generar.
- «PDF o envia…» obre el tauler d'impressió de macOS sobre una còpia de la portada (`.mm-print`), en mode clar.

### Compartir (`lib/share.ts`, `share.rs`, `share/`)

- «Comparteix un enllaç…» (menú Exporta) publica la portada, les notes, la transcripció, les captures o l'àudio, el que se'n triï, en una pàgina web al Worker de Cloudflare **de l'usuari**. Murmur no té cap servidor propi. La posada en marxa és a [COMPARTIR.md](COMPARTIR.md).
- La interfície munta la reunió ja traduïda i amb els colors dels parlants, la comprimeix i la xifra amb AES-GCM. La clau va a l'enllaç després del `#`, o surt d'una contrasenya amb PBKDF2. El Worker només rep el resultat xifrat: ni ell ni Cloudflare no el poden llegir.
- `share.rs` desa l'adreça i la clau d'API del Worker al clauer (servei `com.quicodomingo.murmur.share`) i fa les crides. La clau no torna mai a la interfície.
- **Assistent** (Configuració › Compartir): amb un token de l'usuari, `share.rs` crea el KV, puja el Worker per l'API de Cloudflare (multipart amb `worker.js` i la pàgina com a mòduls de text, que s'inclouen a l'app amb `include_str!`), activa l'adreça workers.dev i comprova que respon. El token es queda al clauer: si el Worker publicat és d'una versió anterior (`/api/ping` › `version`), es torna a publicar abans de compartir.
- **Fitxers:** les captures i l'àudio (el .m4a de reproducció, en trossos de 8 MB) es xifren amb la mateixa clau (12 bytes d'IV i després les dades) i es pugen a part, en binari (`share_upload_file` rep el cos tal qual). La pàgina només baixa l'àudio quan l'escolten. Retirar un enllaç esborra també els seus fitxers.
- La pàgina té «Baixa en Markdown», que munta el fitxer al navegador amb el que s'ha compartit.
- Les reunions amb enllaços vigents porten una icona a la barra lateral i el botó «Compartida» a la capçalera.
- El Worker (`share/src/worker.js`) desa cada reunió a Workers KV amb `expirationTtl`, i KV l'esborra quan caduca. La pàgina (`share/public/viewer.js`) la desxifra al navegador i la dibuixa sempre amb `textContent`, amb una CSP que només permet els seus fitxers.
- Els enllaços de cada reunió es desen a la columna `shares`, que també arriba als resums de la barra lateral, (amb la clau, per poder-los copiar) i es poden retirar. En esborrar una reunió, es retiren els que encara no han caducat.

### Actualitzacions, novetats i publicació

- **Actualitzacions** (`UpdatesDialog.tsx`): en obrir Murmur (si està activat) i amb «Comprova ara». Instal·la tot el que hi hagi pendent: primer els models, després l'app (plugin updater de Tauri), que es reinicia.
  - App: `latest.json` a `github.com/quicodomingo/murmur-releases/releases/latest/download/`. El paquet va signat amb la clau de les actualitzacions; la clau pública és a `tauri.conf.json`.
  - Models: catàleg `models.json` al mateix repositori (`models.rs`, `CATALOG_URL`), amb `version`, `minApp`, `notes` i fitxers (`name`, `url`, `bytes`, `sha256`). Només s'actualitzen els models instal·lats, i una actualització substitueix fitxers amb els mateixos noms. Es descarrega a `models/.updates/<id>/`, es verifica i després substitueix l'antic. La versió instal·lada és a `models/versions.json`.
  - Totes les descàrregues comproven l'espai lliure (+500 MB) i el SHA-256 abans de fer servir el fitxer.
- **Novetats** (`WhatsNewDialog.tsx`, `lib/whatsnew.ts`): en obrir-se una versió nova, Murmur mostra què porta, una sola vegada (l'última vista es desa a `localStorage`, `murmur.whatsnew.seen.v1`). Les versions saltades surten plegades a sota. Una instal·lació nova no les mostra. Es poden desactivar i tornar a obrir des de Configuració › General. El text és dins l'app, traduït (`locales/<idioma>/whatsnew.json`), i les dates a `RELEASES`.
- **Publicar** (`app/scripts/release.sh` i `publish.sh`): compila i signa amb el Developer ID (hardened runtime i `Entitlements.plist` amb `audio-input`, sense el qual el micròfon queda bloquejat), notaritza, grapa i fa el `.dmg`. El procés complet és a [PUBLICAR.md](PUBLICAR.md).

### Dependències

Totes les versions 2.x de `zip` estan retirades de crates.io. `Cargo.toml` fa `[patch.crates-io]` a l'etiqueta git v2.6.1, que és la que demana `sherpa-onnx-sys`.

## Passada final: Whisper (`retranscribe.rs`, `app/whisper/`)

- Només per a reunions d'una sola llengua. Forçat a «català», Whisper passa el castellà al català; per això «Català + castellà» no en fa.
- **Whisper large-v3-turbo q5_0** de whisper.cpp (`models/whisper-ggml/`, model opcional `whisper`, 574 MB, MIT) amb Metal.
- Corre en un procés a part, **`murmur-whisper`** (`app/whisper/`, crate propi): whisper.cpp i llama.cpp porten cadascun el seu ggml i no es poden enllaçar al mateix binari. Així, a més, la memòria es retorna sencera en acabar. Es compila amb `npm run whisper` (ho fan `beforeDevCommand` i `beforeBuildCommand`) i va dins l'app com a `externalBin`.
- Durant la gravació es desa cada canal en PCM a `<app_cache_dir>/final-pass/`. En aturar (després de la verificació de parlants), les frases de cada canal s'empalmen en trossos de fins a 28 s, amb 0,5 s de silenci entre elles. Els temps per paraula (DTW, preset large-v3-turbo) diuen a quina frase va cada paraula. La interfície (`retranscribed` a `store.ts`) substitueix el text de les frases que no s'han editat a mà.
- Es descarta un tros si té més de 6 paraules per segon de veu, o una frase de 2 a 6 paraules repetida 4 cops seguits (d'una sola paraula, 8 cops: «clic, clic, clic, clic» és real). També es descarten les frases amb textos inventats típics («Subtítols realitzats per…»). Llavors es queda el text en directe.
- Prova: `cargo run --release --example whisper_probe -- ../../data/reunio-3min.wav ca` mostra el directe i Whisper frase per frase. A la reunió de 3 minuts: puntuació, majúscules i marques ben escrites (WordPress, WooCommerce, storytelling), amb RTF 0,1 a l'M4.
- La flash attention va un 20% més ràpid, però sense DTW les paraules cauen a la frase següent.
- Descartat: Whisper amb sherpa-onnx (CPU, RTF 0,55, i el model publicat no dona temps per paraula; CoreML no hi és disponible).

### Tornar a transcriure en un altre idioma

Si una reunió s'ha gravat amb l'idioma equivocat, «Torna a transcriure en…» (menú del títol) la torna a passar per Whisper en català, castellà o anglès. `retranscribe_meeting` descodifica l'.ogg canal per canal (`playback::decode_channels`: el micròfon a l'esquerra i, en una trucada, el sistema a la dreta), en fa els mateixos fitxers PCM temporals que la gravació i crida `final_pass` només amb el text. Les frases són les de la reunió (inici i final), així que qui parla i quan es manté; les corregides a mà no es toquen. La interfície desa l'idioma nou i, si la portada està activada, la torna a fer. «Català + castellà» no hi és perquè Whisper només treballa en una llengua.

## Passada final: verificació de parlants (`diarize.rs`, `final_pass` a `lib.rs`)

- Durant la gravació, el canal dels altres (el sistema en una trucada, o el micròfon si no n'hi ha) es desa en PCM de 16 bits a `<app_cache_dir>/final-pass/`.
- En aturar, en un fil a part: diarització amb sherpa-onnx (segmentació pyannote 3.0 + 3D-Speaker). Cada frase en directe rep el parlant que més s'hi solapa, i la interfície (`relabel` a `store.ts`) reassigna: els noms i les frases fixades a mà (`speakerLocked`) segueixen la persona.
- RTF 0,116 a l'M4 (~7 minuts per hora de reunió). Activada per defecte.

### Si comença una altra reunió (`gate.rs`)

- La feina d'acabar una reunió (parlants, Whisper, puntuació i portada) espera mentre Murmur grava, o mentre una altra app fa servir el micròfon (una trucada a Meet, Teams, Zoom…, la mateixa detecció que «Reunió detectada», `micwatch.rs`). Així la gravació o la trucada no van a batzegades. També se'n processa només una reunió alhora: si en tanques dues seguides, la segona espera la primera.
- Whisper corre en un procés a part i es congela al moment (`SIGSTOP`, i `SIGCONT` quan s'acaba la gravació o la trucada). El model de llenguatge s'atura entre token i token, i la puntuació abans de començar. La verificació de parlants és una sola crida a sherpa-onnx: si ja ha començat, acaba (com a molt uns minuts).
- Mentre espera, el model que estava fent servir es queda a la memòria. La interfície ho diu a la barra de progrés («en pausa», i per què) i el temps d'espera no compta per a l'estimació. Si una app es queda el micròfon sense que hi hagi cap trucada, la feina no avança fins que el deixa.

### Avaluació amb etiquetes manuals

`data/qui-parla.json`: 34 frases dels primers 6 minuts, 24 d'una sola persona. Mètrica de `bench/speakers_eval.py`: F1 per parelles i encerts amb la millor correspondència.

| | Model de veus | Configuració | Encerts | F1 |
|---|---|---|---|---|
| Directe (abans) | 3D-Speaker | llindar 0,65 | 75% | 0,62 |
| **Directe (ara)** | **NeMo TitaNet-small** | llindar 0,7 | 88% | 0,77 |
| **Verificació (ara)** | **3D-Speaker** | finestra 0,2, llindar 0,9 | 96% | 0,91 |

- TitaNet a la verificació: F1 ≤ 0,72. wespeaker i CAM++ (VoxCeleb): pitjors. Amb finestra 0,5, F1 ≤ 0,71 amb qualsevol llindar. Forçar el nombre de parlants no funciona (ho posa tot en 2 grups).
- **Comptar parlants enganya:** finestra 0,5 i llindar 1,1 donava «5 parlants», però ho ajuntava gairebé tot.
- 10 de les 34 frases són de diverses persones: el VAD talla per silencis, no per canvis de parlant.
- Una frase només pot crear un parlant nou si dura almenys 2 s (`TRANSCRIPTOR_NEW_SPEAKER_S`). A la reunió etiquetada, entre 1 i 2,5 s donen el mateix 88%; amb 3 s baixa al 75%.
- Només és una reunió: cal tornar a validar amb més reunions etiquetades (`examples/label_dump` i `data/qui-parla.html`).

### Trucades

- El micròfon és una sola persona («Tu»), tret que s'activi «Hi ha més gent amb mi a la sala». Abans, la veu de l'usuari passada per l'AEC es partia en diversos «Sala N».
- **Parlants petits** (`absorb_small_speakers`): a la verificació, un parlant amb menys de 10 s de veu en tota la reunió s'uneix al parlant gran amb la veu més semblant. En una trucada de Meet amb una sola persona a l'altra banda (~35 s de veu), desplaçant l'àudio entre 0,05 i 1,7 s sortien d'1 a 4 grups; amb la regla, sempre 1. A la reunió etiquetada, el grup real més petit té 16 s i el resultat no canvia.
- En directe, l'altra banda d'una trucada de Meet es pot partir igualment: amb TitaNet, la mateixa persona s'assembla a si mateixa entre 0,4 i 0,7, i cap llindar ni model va bé alhora a la sala i a la trucada. No és el còdec (comprimir la sala a Opus no l'empitjora), és el so de Meet. Ho arregla la verificació en aturar.

### Prototip de parlants en directe per finestres

`examples/window_diarize.rs`, `diarize::Diarizer`: cada `hop` segons, pyannote sobre els últims `window` segons. Cada parlant local s'enllaça amb un de global si la veu mitjana s'hi assembla prou, o en crea un de nou si té prou veu a la finestra. La frase rep el parlant quan una finestra la cobreix (retard mitjà de 0,5 s amb hop d'1 s).

| Configuració (finestra, hop, llindar, veu mínima) | Sala: encerts / F1 | Meet (1 persona): grups | RTF |
|---|---|---|---|
| Directe actual (TitaNet 0,7) | 88% / 0,77 | 5 | baix |
| 3D-Speaker 5 s, 1 s, 0,6, 2 s | 79% / 0,75 | 1 | 0,12 |
| 3D-Speaker 20 s, 5 s, 0,6 | 50% / 0,47 | 1 | 0,29 |
| **TitaNet 5 s, 1 s, 0,65, 3 s** | **96% / 0,91** | 2 | 0,08 |
| TitaNet 5 s, 1 s, 0,63–0,67, 2,5–3,5 s | 92–96% / 0,86–0,91 | 2 | 0,08 |

Les finestres de 20 s ajunten persones diferents, i amb 6 s ja empitjora (79%). Només s'ha provat amb una reunió de sala i una trucada: cal validar-ho amb més dades abans d'integrar-ho.

Variables per experimentar: `TRANSCRIPTOR_EMBEDDING` (directe), `TRANSCRIPTOR_DIARIZE_EMBEDDING` (verificació) i `TRANSCRIPTOR_NO_PARTIALS`.
