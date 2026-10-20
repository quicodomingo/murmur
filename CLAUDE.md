# Murmur: transcriptor de reunions en català

L'app es diu **Murmur** (abans «Transcriptor»; el codi i el crate mantenen el nom antic). Identificador: `com.quicodomingo.murmur`. Aplicació d'escriptori (Mac primer, després Windows; més endavant iOS/Android) que transcriu reunions en **català** en directe, identifica qui parla i genera un resum amb acords. **Tot funciona en local per defecte**: l'àudio no surt de l'ordinador si l'usuari no ho decideix.

## Fases del projecte

1. **Banc de proves** (`bench/`) — comparar motors amb gravacions reals: precisió (WER) i velocitat. Decideix quin model va a cada capa.
2. **MVP** (`mvp/`) — Python + interfície web local. Gravar → transcripció en directe amb parlants → passada final + resum.
3. **Producte** (`app/`) — Tauri 2 + nucli en Rust, reaprofitant la interfície web de l'MVP.
4. **Mòbil** — el mateix nucli en Rust (Tauri mobile o interfície nativa).

Fase actual: **3 — App Tauri amb motor Rust** (l'MVP Python queda com a referència i banc de proves).

## Arquitectura: dues passades

| Capa | En directe (latència 1–3 s) | Passada final (en acabar) |
|---|---|---|
| Detecció de veu | Silero VAD | — |
| Transcripció | Conformer-Transducer català d'NVIDIA via **sherpa-onnx** | **Whisper large-v3 català (Projecte AINA)** |
| Diarització | diart o NVIDIA Streaming Sortformer (decidir al banc de proves) | pyannote |
| Puntuació / resum | mínim | **Opcional**: Gemma 4 E4B local (es descarrega en activar-ho) o la clau API de l'usuari (OpenAI o Claude) |

La passada final substitueix la transcripció en directe i en corregeix els parlants i els noms propis.

## Stack per fase

**Banc de proves i MVP (Python 3.12, gestionat amb `uv`)**
- Àudio: `sounddevice` (micròfon) + BlackHole (àudio de sistema de Zoom/Meet/Teams)
- ASR en directe: `sherpa-onnx` (el Conformer de NeMo s'exporta a ONNX amb els scripts de sherpa-onnx)
- ASR final: `mlx-whisper`
- Diarització: `pyannote.audio`, `diart`
- LLM: `mlx-lm`
- Servidor: FastAPI + WebSocket; la interfície és una pàgina web local
- Exportació: Markdown i .docx

**Producte (Tauri 2)**
- Nucli en Rust: `sherpa-onnx` (ASR en directe + diarització), `whisper.cpp` (via `whisper-rs`), `llama.cpp`
- Àudio de sistema: process tap de Core Audio (macOS 14.2+), WASAPI loopback (Windows)
- **No empaquetar Python ni PyTorch a l'app final.**

## Models candidats

- `nvidia/stt_ca_conformer_transducer_large`: ~120M paràmetres, entrenat amb Common Voice 9.0 (WER 3,85% a CV, que és parla llegida; en reunions serà pitjor)
- `PraxySante/stt_ca-es_conformer_transducer_large_fine_tuned`: bilingüe català-castellà
- Whisper `large-v3-turbo` i les variants catalanes del Projecte AINA (BSC) a Hugging Face
- NVIDIA Nemotron ASR **no suporta el català**: no fer-lo servir per a transcripció (Sortformer per a diarització sí, perquè no depèn de l'idioma)

## Interfície

- Per a qualsevol feina de disseny o d'implementació d'interfície, **fes servir la skill `ui-ux-pro-max`**.
- Els textos de la interfície són en **català**.
- Validat amb l'MVP (16/10/2026). Per a l'app cal: **editar parlants inline** (al mateix text, no en un panell), **corregir la transcripció inline**, i la **configuració en un espai que no es vegi sempre** (p. ex. un panell desplegable o una finestra de preferències).
- Elements bàsics: botó de gravar, text en directe amb parlants (editables: "Parlant 1" → nom real), estat de la passada final, resum i acords, llista de reunions, exportació.
- La mateixa interfície web ha de servir per a l'MVP i per a Tauri: res que depengui de FastAPI dins dels components.

## Disseny

- Per a qualsevol canvi d'interfície, segueix `docs/design/DESIGN.md`. És la font de veritat (pensat per a SwiftUI; a l'app web, els tokens equivalents són les variables CSS).
- Colors: només a través dels tokens `--mm-*` (`app/src/murmur-theme.css`, còpia de `docs/design/tokens/murmur-theme.css`) i de les utilitats Tailwind `*-mm-*` o dels tokens de shadcn que hi apunten (`index.css`). Mai hexadecimals escrits a mà.
- Tema i mode: `data-theme` (`acid`, `mono`, `formigo`) i `data-mode` a `<html>` + classe `dark` (`lib/appearance.ts`), triats a Configuració › Aparença.
- Referències visuals: `docs/design/screens/<tema>/`. Mides i textos exactes: `docs/design/mockups/<tema>/`.
- L'àcid (#D4FF3A) mai és text ni línia sobre fons clar.
- Textos en català, sense guions llargs.

## Convencions

- Codi, noms de variables i comentaris en **anglès**; documentació i interfície en **català**.
- Python: `uv` per a dependències, `ruff` per a format i lint, type hints.
- Les gravacions i els models **no es pugen al repositori** (`data/`, `models/` al `.gitignore`).
- Mesurar abans d'optimitzar: qualsevol canvi de model s'ha de justificar amb el banc de proves (WER + factor de temps real).

## Privacitat

- Processament local per defecte. Qualsevol crida al núvol ha de ser opcional i explícita.
- **Model de núvol = clau pròpia de l'usuari** (*bring your own key*): qui vulgui més qualitat hi posa la seva clau d'OpenAI o d'Anthropic. Nosaltres no fem de servidor intermediari. La clau es desa al clauer del sistema (Keychain / Credential Manager), mai en text pla. Només s'envia el text de la transcripció, mai l'àudio.
- Gravar una reunió requereix el consentiment dels participants; l'app ho ha de recordar en començar a gravar.

## Maquinari

- Desenvolupament: **Mac M4, 16 GB**.
- Objectiu mínim: **M1 amb 8 GB**. Implicacions: carregar els models per torns (directe → alliberar → passada final → alliberar → LLM), LLM de 3–4B en 4 bits, i cap model en directe per sobre de ~500 MB.

## Banc de proves (`bench/`)

```bash
uv run python -m bench.models                       # descarrega models a models/
uv run python -m bench.run data/reunio.m4a \
    --ref data/reunio.ref.txt --ref-minutes 10 --speakers 3
```

- `--ref` + `--ref-minutes`: la referència transcrita a mà cobreix els primers N minuts; només s'avalua aquest tros.
- Sortida a `results/<nom>/`: un `.txt` per motor, `diarization.txt` i `report.json` (WER, CER, RTF).
- Motors: `conformer-ca-ctc` (sherpa-onnx), `conformer-ca-es-rnnt` (onnx-asr), `whisper-turbo-mlx` (MLX), `whisper-aina-ct2` (faster-whisper, CPU).
- Diarització: sherpa-onnx (segmentació pyannote 3.0 + embeddings 3D-Speaker), sense token de Hugging Face.
- Prova de fum amb veu sintètica (`say -v Montse`) superada per tots els motors.

## MVP en directe (`mvp/`)

```bash
uv run python -m mvp.server        # http://localhost:8765  (PORT=… per canviar-lo; el 8000 l'usa un altre projecte)
```

- El navegador captura el micròfon (AudioWorklet, remostreig a 16 kHz) i envia PCM Float32 per WebSocket (`/ws`).
- `mvp/live.py`: Silero VAD → Conformer ca-es (text provisional cada 0,6 s d'àudio + definitiu en acabar la frase) → embeddings 3D-Speaker i agrupació en línia (llindar de similitud 0,65 per defecte, regulable a la interfície).
- Protocol: el client envia primer `{maxSpeakers, threshold}`, rep `ready`, envia àudio binari i `{"type":"stop"}`; el servidor envia `partial`, `final` (`id, start, end, speaker, text`) i `done`.
- Interfície (`mvp/static/`): HTML/CSS/JS sense dependències, tokens de color per a mode clar/fosc, parlants reanomenables, exportació a Markdown.

## App (`app/`) — Tauri 2 + React + motor Rust

```bash
cd app && npm install
npm run tauri dev                                    # app amb micròfon
TRANSCRIPTOR_SIMULATE=../data/reunio-3min.wav npm run tauri dev   # àudio d'un WAV 16 kHz al ritme real
cd src-tauri && cargo run --release --example simulate -- ../../data/reunio-3min.wav   # motor sense UI
```

- **Motor** (`src-tauri/src/engine.rs`): port de `mvp/live.py` sobre el crate oficial `sherpa-onnx` (1.13.8). L'API Rust del VAD no té `current_segment`: el text provisional es fa amb un buffer propi (pre-roll 0,4 s) i només descodifica els últims 8 s.
- **Model**: `models/conformer-ca-es-sherpa/` exportat amb `tools/export_conformer_sherpa.py` (cal NeMo en un venv a part). Conformer clàssic → `subsampling_factor` 4. Hi ha versió int8 (142 MB vs 500 MB), però a l'M4 va més lenta (RTF 0,039 vs 0,021).
  - Diferència amb l'export d'onnx-asr de l'MVP: 9,7% de paraules diferents per la diferent extracció de característiques; qualitat comparable a ull. Decidir amb la referència manual.
- **Àudio** (`audio.rs`): micròfon amb cpal (→ mono → remostreig lineal a 16 kHz) + **àudio del sistema amb un *process tap* de Core Audio** (`systap.rs`, macOS 14.2+: tap mono de tot el que sona menys Murmur, llegit amb un dispositiu agregat privat i passat a 16 kHz). La freqüència és la del dispositiu agregat, no la del format del tap, i es vigila: escolta els canvis (quan una app de trucades activa el processament de veu de macOS la sortida pot baixar de 48 a 24 kHz; abans això accelerava l'altra banda ×2 i no es reconeixia res) i, cada 4 s de blocs continus, compara les mostres rebudes amb el rellotge i passa a la freqüència estàndard més propera si no quadra. `MURMUR_DEBUG_TAP=1` ho mostra. Demana només «Gravació d'àudio del sistema» (no la pantalla) i no fa treballar WindowServer; L'estat del permís i la petició es fan amb les funcions privades de TCC (`TCCAccessPreflight`/`TCCAccessRequest`, servei `kTCCServiceAudioCapture`), carregades amb `dlopen` a `permissions.rs`; si no hi fossin, l'estat queda desconegut (sense permís, el tap dona silenci). **Les fonts no es barregen** (`pipeline.rs`): cada una té la seva `LiveSession`; el micròfon passa abans per **cancel·lació d'eco WebRTC AEC3** (`aec.rs`, crate `sonora`, Rust pur) amb l'àudio del sistema com a referència, i només es processa quan ja s'ha vist la referència d'aquell instant. Les fonts aturades s'omplen de silenci pel rellotge real, però només quan la cua d'àudio capturat és buida: amb el Mac saturat (Google Meet amb vídeo) l'àudio pendent es prenia per silenci i es desava com a zeros (prova del 18/10: 50–99% de zeros mentre Meet era obert). Si la cua passa de 60 fragments, es deixa de fer el text provisional fins que s'atrapa. Abans es feia amb ScreenCaptureKit, que obliga a capturar vídeo: amb una videotrucada, WindowServer reduïa la pantalla 60 cops per segon. Les frases del micròfon que repeteixen ≥60% de paraules d'una del sistema (±2 s) es descarten.
  - Ids de parlant: micròfon 0…, sistema 100… (`SYSTEM_SPEAKER_BASE`). En una trucada el parlant 0 del micròfon es diu «Tu» per defecte.
  - Prova sintètica (eco amb 120 ms de retard i filtre): −65 dB d'eco; només queda un residu curt els primers ~4 s, mentre l'AEC s'adapta. Esdeveniments Tauri: `transcript` (partial/final), `level`, `transcript-done`, `transcript-error`.
  - Permís «Gravació d'àudio del sistema»: es demana en començar a gravar (diàleg de macOS) i surt a Configuració › Àudio › Permisos; en dev el demana el terminal des d'on s'executa. La «Gravació de pantalla» només cal per a les captures. Mínim de l'app: macOS 14.2.
  - Windows (pendent): loopback WASAPI.
- **Idioma** (Configuració › Transcripció, `settings.language`): `ca`, `es`, `ca-es` (per defecte) o `en`. Tria el model en directe (`engine.rs` `LiveModel`): el Conformer ca-es per a tot menys l'anglès, que fa servir **Parakeet TDT-CTC 110M** (`models/parakeet-en/`, model opcional `english`, 458 MB, ja posa puntuació). En una sola llengua (`ca`, `es`, `en`) i amb el model `whisper` descarregat, la passada final hi afegeix Whisper (vegeu **Passada final: Whisper**). La puntuació de Softcatalà només s'aplica a `ca`/`ca-es` sense Whisper.
- **Desar l'àudio** (`recorder.rs`): Ogg/Opus 16 kHz; mono 16 kbps (~7 MB/h) amb una font, **estèreo 24 kbps (~11 MB/h) amb micròfon (esquerra, ja sense eco) + sistema (dreta)**. La transcripció de l'àudio descomprimit és pràcticament idèntica a l'original. Fitxer a `<app_data_dir>/recordings/<meeting_id>.ogg`. Opus es compila amb cmake (`brew install cmake`).
- **Escoltar l'àudio** (`playback.rs`, `lib/player.ts`, `PlayerBar.tsx`): si la reunió té àudio desat, una barra a baix (play/pausa, temps, posició, velocitat 1–2×). L'Ogg es descodifica, es barreja en mono i es passa a AAC 48 kbps (~22 MB/h) amb `afconvert`; el `.m4a` va a `<app_cache_dir>/playback/` i es refà si l'Ogg és més nou. Clicar el minut d'una frase o un minut de la portada la fa sonar d'allà; la frase que sona queda marcada i la transcripció la segueix. «Exporta l'àudio (.m4a)…» al menú del títol. Desem sempre en Ogg (més petit i amb els canals separats per reanalitzar).
- **Configuració** (`SettingsDialog.tsx`; ⌘, i «Configuració…» al menú de l'app, que emet `open-settings`). Es desa a `localStorage` (`transcriptor.settings.v1`) i es passa a `start_recording`.
  - General: obrir en iniciar la sessió (plugin autostart, LaunchAgent), panell principal (notes per defecte, o transcripció: l'altre va al `SidePanel` redimensionable), calendaris (vegeu **Calendari**).
- **Indicador de gravació** (`shell.rs` finestra `indicator`, `IndicatorWindow.tsx`): píndola a la vora dreta mentre es grava, amb el nivell, «obre Murmur» i «atura». Clicant-la, si «Mode compacte» està activat, la finestra principal es fa estreta (380 × 600), sempre al davant i al costat de l'indicador, només amb les notes (`set_compact`; en aturar o amb ⤢ torna a la mida d'abans). En desenvolupament, `?window=indicator` (o `toast`) la mostra sola al navegador.
- **Captures de pantalla** (`capture.rs`, manuals): botó de càmera a l'indicador i al mode compacte. Busca la finestra de la trucada (Zoom, Teams, FaceTime, Webex, o un navegador amb «Meet», «Teams», «Zoom» al títol de la pestanya activa; la més gran) i la captura amb `screencapture -l`; si no n'hi ha, la pantalla principal. JPEG a `<app data>/screens/<reunió>/<ms>.jpg`, columna `screens`. Es veuen sota la frase d'aquell moment a la transcripció (clic per ampliar, × per esborrar) i a la portada («Pantalles compartides»). Fa servir el permís de Gravació de pantalla que ja tenim. `examples/capture_probe` llista les finestres.
- **Calendari** (`calendar.rs`, EventKit): llegeix el Calendari de macOS, que inclou els comptes de Google, iCloud i Exchange afegits al sistema (la integració directa amb Google demanaria OAuth i la verificació de Google: només si cal per a Windows). Permís propi (`NSCalendarsFullAccessUsageDescription` + entitlement `personal-information.calendars`). Cada 20 s, `shell.rs` busca als calendaris triats una reunió que comenci d'aquí a ≤ 2 min (o fa ≤ 1 min) i mostra l'avís «Comença d'aquí a 2 minuts · Títol · 17:00 · Google Meet» (un cop per esdeveniment). Per defecte només esdeveniments amb convidats o enllaç de videotrucada. En començar a gravar, la reunió agafa el títol i els convidats de l'esdeveniment en curs (`lib/calendar.ts`, columna `guests`): el menú de cada parlant els ofereix com a noms (i en reanomenar).
  - Àudio: micròfon + dispositiu + **nivell d'entrada en directe** (`start_mic_monitor`/`stop_mic_monitor`, esdeveniment `mic-level`), àudio del sistema, desar l'àudio i **carpeta** (diàleg natiu; per defecte `<app_data_dir>/recordings`).
  - Transcripció: màxim de parlants, separació de veus, **verificació de parlants en acabar** (desactivada per defecte).
- **Notes** (`NotesPanel.tsx`, `lib/notes.ts`): editor Tiptap 3 (títols 1–3, negreta, cursiva, subratllat, ratllat, llistes, tasques; dreceres Markdown en escriure). Es desa com a JSON de Tiptap (`meeting.notesDoc`) perquè **cada bloc porta `attrs.t`** (minut de la reunió en què s'hi va escriure; `keepOnSplit: false`). Exportació a Markdown pròpia (`docToMarkdown`). Les marques a la transcripció surten de `notesFromDoc`.
- **Dependència**: totes les versions 2.x de `zip` estan retirades de crates.io; `Cargo.toml` fa `[patch.crates-io]` a l'etiqueta git v2.6.1 (la demana `sherpa-onnx-sys`).
- **Actualitzacions** (`UpdatesDialog.tsx`): en obrir Murmur (si «Comprova-ho en obrir Murmur» està activat) i amb «Comprova ara» a Configuració › General. Si hi ha res pendent, la finestra «Actualitzant Murmur» ho instal·la tot seguit: primer els models, després l'app (plugin updater de Tauri), que es reinicia.
  - App: `latest.json` a `github.com/quicodomingo/murmur-releases/releases/latest/download/`. Paquet signat amb `~/.tauri/murmur-updater.key` (contrasenya al clauer, `murmur-updater`; clau pública a `tauri.conf.json`). `release.sh` fa `Murmur.app.tar.gz` (de l'app ja notaritzada), la signatura i `latest.json`; `publish.sh` ho puja com a release (`RELEASE_NOTES="…"`).
  - Models: catàleg `models.json` al mateix repositori (`models.rs` `CATALOG_URL`): per model, `version`, `minApp`, `notes` i fitxers (`name`, `url`, `bytes`, `sha256`). Només s'actualitzen els models instal·lats; una actualització substitueix fitxers amb els mateixos noms (si cal codi nou, va amb una versió de l'app). Es descarrega a `models/.updates/<id>/`, es verifica i després substitueix l'antic; la versió instal·lada és a `models/versions.json` (1 = la de fàbrica).
  - Totes les descàrregues comproven l'espai lliure (+500 MB) i el SHA-256 abans de fer servir el fitxer.
  - Procés complet pas a pas (app i models): **`docs/PUBLICAR.md`**.
- **Publicar** (`app/scripts/release.sh`): compila i signa amb el Developer ID de `tauri.conf.json` (hardened runtime + `Entitlements.plist` amb `audio-input`, sense el qual el micròfon queda bloquejat), notaritza amb el perfil del clauer `murmur` (`xcrun notarytool store-credentials`), grapa i fa `Murmur-<versió>.dmg`, també notaritzat.
- **Models en dev**: `models_dir()` llegeix `TRANSCRIPTOR_MODELS` o `../../models`. Pendent: directori de dades de l'app + pantalla de primera obertura amb descàrrega.
- **Interfície** (`src/`): shadcn/ui (Radix, preset Nova) amb tokens natius de macOS a `src/index.css`; font del sistema; mode fosc segons el sistema. Finestra amb `titleBarStyle: Overlay` (semàfors sobre la barra lateral) i `data-tauri-drag-region` a la barra d'eines.
  - Transcripció en directe: segueix el text nou fins que l'usuari puja; llavors surt la píndola «Torna al directe».
  - Panell de notes: amaga/mostra des de la barra d'eines (únic botó), **redimensionable** arrossegant la vora esquerra (doble clic restableix; fletxes del teclat), i **mode complet** que amaga la transcripció. Es recorda a `localStorage` (`transcriptor.notesLayout.v1`).
  - En producció es bloqueja el menú contextual del web fora del text editable; l'inspector només existeix en builds `dev`.
  - Edició inline amb `<textarea>` que creix, **no** `contentEditable` (amb React duplicava text).
  - **Persistència: SQLite** (`db.rs`, `rusqlite` amb SQLite inclòs) a `<app_data_dir>/transcriptor.sqlite3`. Taules `meetings` i `utterances` (una fila per frase) + índex **FTS5** (`search`, `unicode61 remove_diacritics 2`: ignora accents) sobre títols, frases (mantingut amb triggers) i blocs de notes (els envia la UI amb `notesFromDoc`).
    - La barra lateral carrega resums (`list_meetings`); el contingut es carrega en obrir la reunió (`get_meeting`). Les edicions es desen com a canvis petits (`apply_changes`: metadades, frases canviades, notes) amb retard d'1,5 s; els canvis d'estat, a l'instant.
    - Cerca: `search_meetings` → cada paraula com a prefix, totes obligatòries, consulta neutralitzada; fragments amb `\u0002…\u0003` (mai HTML). Clicar un resultat obre la reunió i salta a la frase.
    - Migració automàtica: fitxers JSON antics (`meetings/` → `meetings-json-backup/`) i `localStorage` del webview. En un navegador sense Tauri es fa servir `localStorage` (desenvolupament d'interfície).
  - **Exportació** (`lib/export.ts`): Markdown i Word (`docx`, carregat a demanda), notes primer i després la transcripció. Diàleg natiu de desar (plugin dialog) + ordre `write_export`.
  - **Eliminar** una reunió (menú del títol, confirmació nativa) esborra també el seu àudio.
- Disseny: `docs/design/` (vegeu la secció Disseny).

## Portada (`lib/cover.ts`, `Cover.tsx`)

- El model llegeix la transcripció i, al final, les notes amb el minut en què es van escriure (també compten com a font de tasques i decisions).
- Tasques: només accions que algú demana o es compromet a fer; si no n'hi ha, «En aquesta reunió no s'han demanat tasques». Es poden marcar, editar, assignar (qui ha parlat + convidats), eliminar i afegir; en tornar a generar es conserven les afegides a mà i les marcades.
- Reanomenar un parlant canvia el nom dins la portada (`renameInCover`, paraules senceres), també si es fa mentre es genera, i en mostrar-la els noms genèrics («Parlant 1», «Tu») es substitueixen pels que s'han posat. No cal regenerar per un nom.
- Les captures surten dins de la part de la reunió on es van fer i totes juntes al final («Totes les pantalles»).
- La portada desa una empremta del que ha llegit (`basis`): si després canvien noms, parlants, text o notes (també durant la generació), avisa que ha quedat desactualitzada i ofereix tornar-la a generar.
- «PDF o envia…»: el tauler d'impressió de macOS (Desa com a PDF, Mail, Missatges) sobre una còpia de la portada (`.mm-print`); la pàgina passa a mode clar mentre s'imprimeix.

## Passada final: Whisper (`retranscribe.rs`, `app/whisper/`)

- Només per a reunions d'una sola llengua: forçat a «català», Whisper passa el castellà al català (per això «Català + castellà» no en fa).
- **Whisper large-v3-turbo q5_0** de whisper.cpp (`models/whisper-ggml/`, model opcional `whisper`, 574 MB, MIT) amb Metal. Corre en un procés a part, **`murmur-whisper`** (`app/whisper/`, crate propi): whisper.cpp i llama.cpp porten cadascun el seu ggml i no es poden enllaçar al mateix binari; així, a més, la memòria es torna sencera en acabar. Es compila amb `npm run whisper` (ho fan `beforeDevCommand` i `beforeBuildCommand`) i va dins l'app com a `externalBin` (`src-tauri/binaries/`, no es puja).
- Durant la gravació es desa cada canal en PCM a `<app_cache_dir>/final-pass/`. En aturar (després de la verificació de parlants), les frases de cada canal s'empalmen en trossos de fins a 28 s amb 0,5 s de silenci entre elles; els temps per paraula (DTW, preset large-v3-turbo) diuen a quina frase va cada paraula. Esdeveniment `final-pass-text` (`{base, texts: [{start, text}]}`); la UI (`retranscribed` a `store.ts`) substitueix el text de les frases que no s'han editat a mà.
- Es descarta un tros si té més de 6 paraules per segon de veu, o una frase de 2–6 paraules repetida 4 cops seguits (una sola paraula, 8: «clic, clic, clic, clic» és real), i les frases amb textos inventats típics («Subtítols realitzats per…»). Llavors es queda el text en directe.
- Prova: `cargo run --release --example whisper_probe -- ../../data/reunio-3min.wav ca` posa el directe i Whisper frase per frase. A la reunió de 3 min: puntuació, majúscules i marques ben escrites (WordPress, WooCommerce, storytelling); RTF 0,1 a l'M4 base. La flash attention va un 20% més ràpid però sense DTW les paraules cauen a la frase següent.
- Descartat: Whisper amb sherpa-onnx (CPU, RTF 0,55, i el model publicat no dona temps per paraula; CoreML no hi és disponible).

## Passada final: verificació de parlants (`diarize.rs`, `final_pass` a `lib.rs`)

- Durant la gravació, el canal dels altres (sistema en una trucada, micròfon si no n'hi ha) es desa en PCM 16 bits a `<app_cache_dir>/final-pass/` (només si la verificació està activada).
- En aturar, en un fil a part: diarització sherpa-onnx (segmentació pyannote 3.0 + 3D-Speaker), cada frase en directe rep el parlant que més s'hi solapa, i la UI (`relabel` a `store.ts`) reassigna: els noms i les frases fixades a mà (`speakerLocked`) segueixen la persona. Esdeveniments `final-pass`, `final-pass-speakers`, `final-pass-done`; estat de reunió `processing` amb l'avís «Verificant parlants…» (progrés estimat: la llibreria no en dona).
- **Avaluació amb etiquetes manuals** (`data/qui-parla.json`: 34 frases dels primers 6 min, 24 d'una sola persona; `bench/speakers_eval.py`, mètrica F1 per parelles + encerts amb la millor correspondència):
  | | Model de veus | Configuració | Encerts | F1 |
  |---|---|---|---|---|
  | Directe (abans) | 3D-Speaker | llindar 0,65 | 75% | 0,62 |
  | **Directe (ara)** | **NeMo TitaNet-small** | llindar 0,7 | 88% | 0,77 |
  | **Verificació (ara)** | **3D-Speaker** | finestra 0,2, llindar 0,9 | 96% | 0,91 |
  - TitaNet a la verificació: F1 ≤ 0,72. wespeaker i CAM++ (VoxCeleb): pitjors. Finestra 0,5: F1 ≤ 0,71 amb qualsevol llindar. Forçar el nombre de parlants no funciona (tot en 2 grups).
  - **Comptar parlants enganya**: finestra 0,5 / llindar 1,1 donava «5 parlants» però ajuntava gairebé tot.
  - 10 de 34 frases són «Diverses persones»: el VAD talla per silencis, no per canvis de parlant. Pendent: partir frases als canvis de torn de la verificació.
  - Una sola reunió: tornar a validar amb més reunions etiquetades (`examples/label_dump` + `data/qui-parla.html`).
- **Trucades** (micròfon + sistema): el micròfon és una sola persona («Tu») tret que l'usuari activi «Hi ha més gent amb mi a la sala». Abans, la teva veu passada per l'AEC es partia en diversos «Sala N».
- **Parlants petits** (`absorb_small_speakers`): a la verificació, un parlant amb menys de 10 s de veu en tota la reunió s'uneix al parlant gran amb la veu més semblant (3D-Speaker). En una trucada de Meet amb una sola persona a l'altra banda (~35 s de veu), la verificació era fràgil: desplaçant l'àudio 0,05–1,7 s sortien d'1 a 4 grups; amb la regla, sempre 1. A la reunió etiquetada, el grup real més petit té 16 s i el resultat no canvia (96%, també desplaçada 0,7 s).
- En directe, l'altra banda d'una trucada de Meet es pot partir igualment: amb TitaNet la mateixa persona s'assembla entre 0,4 i 0,7 (llindar 0,7), i cap llindar ni model (3D-Speaker) va bé alhora a la sala i a la trucada. Comprimir la sala a Opus no l'empitjora: és el so de Meet, no el códec. Tampoc ajuda fusionar parlants en directe. Ho arregla la verificació en aturar.
- **Prototip de diarització en directe per finestres** (`examples/window_diarize.rs`, `diarize::Diarizer`): cada `hop` segons, pyannote sobre els últims `window` segons; cada parlant local s'enllaça amb un de global si la veu mitjana s'hi assembla (≥ llindar), o en crea un de nou si té prou veu a la finestra. La frase rep el parlant quan una finestra la cobreix (retard mitjà 0,5 s amb hop 1 s).
  | Configuració (finestra, hop, llindar, veu mínima) | Sala: encerts / F1 | Meet (1 persona): grups | RTF |
  |---|---|---|---|
  | Directe actual (TitaNet 0,7) | 88% / 0,77 | 5 | baix |
  | 3D-Speaker 5 s, 1 s, 0,6, 2 s | 79% / 0,75 | 1 | 0,12 |
  | 3D-Speaker 20 s, 5 s, 0,6 | 50% / 0,47 | 1 | 0,29 |
  | **TitaNet 5 s, 1 s, 0,65, 3 s** | **96% / 0,91** | 2 | 0,08 |
  | TitaNet 5 s, 1 s, 0,63–0,67, 2,5–3,5 s | 92–96% / 0,86–0,91 | 2 | 0,08 |
  - Finestres de 20 s ajunten persones diferents; finestra de 6 s ja empitjora (79%). Només una reunió de sala i una trucada: validar amb més dades abans d'integrar-ho.
- Una frase només pot crear un parlant nou si dura ≥ 2 s (`TRANSCRIPTOR_NEW_SPEAKER_S`): a la reunió etiquetada, 1–2,5 s donen el mateix 88%; 3 s baixa al 75%.
- Temps: RTF 0,116 a l'M4 base (~7 min per hora de reunió). Verificació **activada per defecte** (migració de la configuració v2).
- Experiments: `TRANSCRIPTOR_EMBEDDING` (directe), `TRANSCRIPTOR_DIARIZE_EMBEDDING` (verificació), `TRANSCRIPTOR_NO_PARTIALS`.

## Resultats de la primera reunió real (20 min, 5 parlants)

- `conformer-ca-ctc` (NVIDIA, només català): poc usable en parla espontània.
- `conformer-ca-es-rnnt` (AINA): **el millor dels dos**, entén el canvi de codi català-castellà; RTF 0,02. Sense puntuació ni majúscules; marques mal escrites (WordPress, WooCommerce, Shopify).
- Diarització offline (sherpa-onnx) infravalora els parlants: 5 demanats, gairebé tot repartit en 3. RTF 0,15.
- Directe: ~3% CPU sense parcials, ~32% amb parcials (M4). Amb llindar 0,6 agrupa massa; 0,7 s'acosta a la diarització offline.

## Pendent

El full de ruta viu a **`docs/ROADMAP.md`** (blocs 1–6, amb caselles). Mantén-lo al dia quan es completi una tasca.
