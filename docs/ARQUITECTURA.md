# Arquitectura de Murmur

Com funciona Murmur per dins, per què està fet així i què s'ha mesurat per decidir-ho. Les regles per treballar-hi són a [`CLAUDE.md`](../CLAUDE.md), i el que falta per fer, al [full de ruta](ROADMAP.md).

## Visió general: dues passades

Murmur transcriu en directe amb models petits i ràpids. Quan s'atura la gravació, una segona passada repassa la reunió sencera amb models més grans.

| Capa | En directe (latència d'1 a 3 s) | Passada final (en aturar) |
|---|---|---|
| Detecció de veu | Silero VAD | |
| Transcripció | Conformer-Transducer català i castellà (Projecte AINA) amb sherpa-onnx; en anglès, Parakeet TDT-CTC 110M | Whisper (whisper.cpp), només en reunions d'una sola llengua: el català del BSC en català, large-v3-turbo en castellà i anglès |
| Parlants | Embeddings NeMo TitaNet-small i agrupació en línia | Segmentació pyannote 3.0 + embeddings 3D-Speaker |
| Puntuació | | Model de Softcatalà (català, sense Whisper) |
| Portada i resum | | Gemma 4 E4B local, opcional; o Claude / OpenAI / Gemini / OpenRouter amb la clau de l'usuari |

Fases del projecte:

1. **Banc de proves** (`bench/`): comparar motors amb gravacions reals, en precisió (WER) i velocitat (factor de temps real, RTF).
2. **Prototip** (`mvp/`): Python amb una interfície web local, per validar la idea.
3. **Producte** (`app/`): Tauri 2 amb un motor en Rust. És la fase actual.
4. **Mòbil**: el mateix nucli en Rust (Tauri mobile o una interfície nativa).

L'app final no porta Python ni PyTorch.

## Maquinari

- **Desenvolupament:** Mac M4 amb 16 GB.
- **Objectiu mínim:** M1 amb 8 GB. A Windows i Linux, un PC x86-64 amb AVX2 i 8 GB. Per això els models es carreguen per torns (directe, alliberar, passada final, alliberar, model de llenguatge), el model de llenguatge és de 3 a 4 mil milions de paràmetres en 4 bits, i cap model en directe passa de ~500 MB.

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

El motor és a `core/` (`murmur-core`), separat de l'app de l'ordinador perquè el puguin fer servir també les apps de mòbil ([MOBIL.md](MOBIL.md)): transcripció en directe, parlants, la teva veu, glossari, puntuació, gravació i reproducció en Opus, la base de dades i els textos de Rust (`i18n.rs`). No sap res de finestres ni d'interfície. L'app (`app/src-tauri`) en reexporta els mòduls, de manera que el seu codi els continua trobant a `crate::engine`, `crate::db`… Tots dos formen un sol espai de treball de Cargo (un `Cargo.lock` i una carpeta `target`), i `cargo test` passa els tests de tots dos. La captura d'àudio de l'ordinador (`audio.rs`, `systap.rs`), Whisper, el model de llenguatge, el calendari, compartir i el connector per a Claude es queden a l'app.

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
- **Si el micròfon calla:** un micròfon envia fragments tota l'estona, també de silenci (cada ~10 ms). Si en passen 4 s sense cap (`MIC_QUIET`), el fil de treball avisa (`mic-lost`) i demana al fil de l'àudio que el torni a obrir (`Capture::reopen_mic`: el triat si hi és, si no el del sistema) cada 5 s fins que torna a enviar. Passava a Windows: un canvi del micròfon per defecte, uns auriculars que es desconnecten o una altra app que se l'emporta, i la reunió seguia gravant silenci sense dir res (una prova de 75 minuts en va treure 23). L'app ho diu amb un avís que no marxa fins que el micròfon torna i, si Murmur no és al davant, amb l'avís flotant «El micròfon no envia so» (`shell::mic_lost`). No es vigila amb un fitxer obert ni amb el simulador.
- **L'ordinador no s'adorm mentre grava** (`awake.rs`), des que comença fins que s'escriu l'última frase: a Windows, una petició d'energia per al sistema i la pantalla (`PowerSetRequest`; amb Modern Standby, apagar la pantalla aturava les apps d'escriptori i el micròfon); al Mac, una asserció d'IOKit contra el repòs per inactivitat (la pantalla es pot apagar); a Linux, `systemd-inhibit` mentre Murmur viu.
- Ids de parlant: micròfon 0…, sistema 100… (`SYSTEM_SPEAKER_BASE`). En una trucada, el parlant 0 del micròfon es diu «Tu».
- Esdeveniments de Tauri: `transcript` (partial/final), `level`, `transcript-done`, `transcript-error`, `mic-lost`.
- **Windows:** l'àudio del sistema és el loopback de WASAPI, un flux d'entrada de `cpal` sobre la sortida per defecte (`audio.rs`, `start_loopback`). No envia res mentre no sona res.
- **Linux:** l'àudio del sistema és el monitor de la sortida per defecte, gravat amb l'API simple de PulseAudio sobre la font `@DEFAULT_MONITOR@` (`audio.rs`, `start_monitor`), igual que `parecord --device=<sortida>.monitor`. Funciona amb PulseAudio i amb PipeWire (pipewire-pulse), sense permisos. El servidor ja ho dona a 16 kHz mono. Un fil llegeix blocs de 100 ms; a diferència de WASAPI, envia silenci mentre no sona res. Es tria en començar a gravar: si es canvia la sortida a mitja reunió, no la segueix. Enllaça amb `libpulse.so.0` i `libpulse-simple.so.0` (dependències `libpulse0` del .deb i `pulseaudio-libs` del .rpm).

### Idioma de la reunió

`settings.language`: `ca`, `es`, `ca-es` (per defecte) o `en`, a Configuració › Transcripció.

- Tria el model en directe (`engine.rs`, `LiveModel`): el Conformer ca-es per a tot menys l'anglès, que fa servir **Parakeet TDT-CTC 110M** (`models/parakeet-en/`, model opcional `english`, 458 MB, ja posa puntuació).
- En una sola llengua i amb el model `whisper` descarregat, la passada final hi afegeix Whisper.
- La puntuació de Softcatalà s'aplica a `ca-es` i a `ca`, després del Whisper català del BSC (que escriu sense puntuació). Només se la salta el turbo, que ja puntua.
- Cada reunió desa l'idioma en què es va gravar (`meeting.language`, columna `language`).

### Desar i escoltar l'àudio

- **Desar** (`recorder.rs`): Ogg/Opus a 16 kHz. Amb una font, mono a 16 kbps (~7 MB/h). Amb dues, **estèreo a 24 kbps (~11 MB/h)**: micròfon a l'esquerra (ja sense eco) i sistema a la dreta. La transcripció de l'àudio descomprimit és pràcticament idèntica a l'original. Fitxer a `<app_data_dir>/recordings/<meeting_id>.ogg`. Opus es compila amb cmake.
- **Escoltar** (`playback.rs`, `lib/player.ts`, `PlayerBar.tsx`): l'Ogg es descodifica, es barreja en mono i es passa a AAC a 48 kbps (~22 MB/h) amb `afconvert`. A Windows i Linux no hi ha `afconvert` ni un codificador d'AAC segur: és un Ogg/Opus mono amb el mateix codificador de `recorder.rs`, que WebView2 i WebKitGTK reprodueixen (`playback::EXTENSION`). El `.m4a` va a `<app_cache_dir>/playback/` i es refà si l'Ogg és més nou. Clicar el minut d'una frase o de la portada la fa sonar d'allà, i la transcripció segueix la frase que sona. Sempre es desa en Ogg, que és més petit i manté els canals separats per tornar-los a analitzar.

### Continuar una reunió (`lib/parts.ts`, `resume_meeting` a `lib.rs`)

«Continua» torna a gravar dins una reunió aturada, amb les mateixes fonts i el mateix idioma. Continua sent una sola reunió en un sol eix de temps:

- **Àudio:** `Recorder::resume` copia els paquets de l'Ogg en un fitxer nou com un sol flux (sense la marca de final), el posa al lloc de l'original i hi segueix l'àudio nou. La part nova comença on acaba l'àudio desat (`Recorder::seconds`), i el reproductor va seguit. Si la reunió no tenia l'àudio desat, la part nova tampoc no es desa (no quadraria amb el temps) i comença a la durada de la reunió.
- **Temps:** el `Pipeline` suma `offset` a les frases. `meeting.parts` desa quan va començar cada part (hora de rellotge i segon de la reunió): la durada és la suma de les parts, la transcripció mostra la pausa amb les hores, i la data diu les franges («12:23 a 13:05 i 14:10 a 14:40»).
- **Veus:** abans de prendre l'àudio nou (que espera a la cua), `resume_meeting` descodifica l'àudio desat i fa la mitjana de TitaNet de les frases més llargues de cada parlant. Les sessions en directe comencen amb aquestes veus i el seu número (`known_speakers`), i les veus noves es numeren a partir de l'últim. Sense àudio desat, només es reserven els números.
- **En acabar:** la verificació de parlants torna a passar per tota la reunió (la pista de la passada final comença amb l'àudio desat i les frases d'abans; `Tapped::origin` diu en quin segon de la reunió comença cada pista). Whisper només reescriu les frases de la part nova (`FinalPlan::text_from`), la puntuació també, i el resum es torna a fer amb la reunió sencera.
- **Quan:** el botó surt 10 minuts després d'aturar. Si s'ha aturat des de l'indicador i Murmur no és al davant, l'avís flotant «Gravació aturada» ofereix el mateix. No es pot continuar mentre s'està acabant la reunió (parlants, Whisper) ni mentre se'n grava una altra.

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

Els exports a Word i Markdown (`lib/export.ts`) reben un `ExportContent`: `all`, `summary` (el resum i les notes) o `transcript`. Una reunió sense resum sempre ho exporta tot, perquè el fitxer no quedi buit. El Markdown que es desa sol a la carpeta fa servir `settings.markdownContent` i, si la reunió té resum, escriu cada part en un fitxer: «<dia> <títol> - Resum.md» (resum i notes) i «… - Transcripció.md», els dos amb «Tot». Sense resum, un sol fitxer amb el nom de sempre.

El sagnat (extensió `Indent`) és un atribut `indent` (0 a 6) dels paràgrafs i títols de primer nivell, no un caràcter de tabulació: així el paràgraf sencer queda sagnat, també quan ocupa més d'una línia. Tab el puja, i Maj+Tab o el retrocés a l'inici de la línia el baixen. Dins d'una llista, Tab niua l'element. Tab mai surt de l'editor; Maj+Tab sí, quan no hi ha res per desfer, perquè amb el teclat se'n pugui sortir. Al Word és un sagnat esquerre; al Markdown, que no té paràgrafs sagnats, quatre espais no separables per pas; a la pàgina compartida, `data-indent` (la CSP no admet estils en línia).

### Indicador de gravació, mode compacte i captures

- **Indicador** (`shell.rs`, finestra `indicator`, `IndicatorWindow.tsx`): una píndola a la vora dreta mentre es grava, amb el nivell, «obre Murmur» i «atura».
- **Mode compacte:** clicant la píndola, la finestra principal es fa estreta (380 × 600), sempre al davant i al costat de l'indicador, només amb les notes (`set_compact`).
- **Captures** (`capture.rs`, manuals, des de l'indicador i el mode compacte): busca la finestra de la trucada (Zoom, Teams, FaceTime, Webex, o un navegador amb «Meet», «Teams» o «Zoom» al títol de la pestanya activa; la més gran) i la captura amb `screencapture -l`. Si no n'hi ha, captura la pantalla principal. JPEG a `<app data>/screens/<reunió>/<ms>.jpg`, columna `screens`. Es veuen sota la frase d'aquell moment i dins la part corresponent de la portada. Fa servir el permís de Gravació de pantalla. `examples/capture_probe` llista les finestres.

### Calendari (`calendar.rs`, EventKit; `google.rs`, Google Calendar; `ics.rs`, enllaços iCal)

- Al Mac, llegeix el Calendari de macOS, que inclou els comptes de Google, iCloud i Exchange afegits al sistema (`calendarEnabled`, i `system` a les crides i a l'avís, perquè es pot desconnectar i continuar amb els enllaços).
- **Enllaços iCal**, a tots els sistemes (`ics.rs`): l'«adreça secreta en format iCal» de Google, el calendari publicat d'Outlook, el públic d'iCloud… La llista (id, nom i URL) es desa al clauer, perquè qui té l'enllaç veu el calendari; la interfície no en veu mai l'URL, només el domini. En afegir-lo es llegeix un cop per comprovar que és un calendari i agafar-ne el nom (`X-WR-CALNAME`). Es torna a llegir com a molt cada 5 minuts, quan algú demana esdeveniments; si falla, es queden els d'abans i la configuració mostra l'error. Les línies plegades s'ajunten, les alarmes s'ignoren, els esdeveniments de tot el dia no compten (no són reunions), i els que es repeteixen s'expandeixen amb `rrule` (`RRULE`, `RDATE`, `EXDATE`, i les ocurrències mogudes o anul·lades amb `RECURRENCE-ID`). Les zones de Windows que escriu Outlook («Romance Standard Time») es passen a IANA amb una taula de les habituals; les que no s'hi troben, a la zona de l'ordinador. A Google, el calendari principal es diu com l'adreça: l'assistent amb aquesta adreça és l'usuari. Prova: `cargo run --example ics_probe -- <url>`.
- **Google Calendar**, a tots els sistemes (`google.rs`): «Inicia la sessió…» obre el navegador amb OAuth, PKCE i una redirecció a `127.0.0.1` (`oauth.rs`, compartit amb Notion), i demana només `calendar.calendarlist.readonly`, `calendar.events.readonly` i l'adreça (`openid email`, que surt de l'`id_token`). Si a la pàgina de Google es desmarca algun dels dos permisos de calendari, no es desa res i es demana tornar-ho a provar. El refresh token i l'adreça es desen al clauer; desconnectar revoca l'accés a Google. Els calendaris (`google:<id>`) es llegeixen com a molt cada 5 minuts, i els esdeveniments de cada calendari també, amb una finestra d'una hora abans i 24 h després del que es demana perquè les preguntes de l'avís (sempre a prop d'ara) surtin de la memòria. No compten els anul·lats, els rebutjats, els de tot el dia ni els d'ubicació de feina, fora de l'oficina o concentració. Si la sessió caduca (revocada, o els 7 dies mentre l'app de Google és en proves), s'esborra i la configuració demana tornar a iniciar-la. El client OAuth (`MURMUR_GOOGLE_CLIENT_ID` i `_SECRET`) el posa `build.rs` en compilar, des de l'entorn (els secrets de la publicació) o de `app/src-tauri/google-oauth.json` (el JSON de Google Cloud, fora del repositori); sense, l'app no ofereix Google (`googleCalendar` a `platform`). El secret d'una app d'escriptori no pot ser secret de debò (Google ho diu per a les apps instal·lades): només es manté fora del codi públic.
- Un esdeveniment que arriba per dos camins (un compte de Google afegit també a macOS, o també com a enllaç) es mostra un cop: `calendar::events` treu els que tenen el mateix inici, final i títol.
- Permís propi (`NSCalendarsFullAccessUsageDescription` i l'entitlement `personal-information.calendars`).
- Just després de connectar-lo, macOS encara carrega els comptes i la llista de calendaris pot sortir buida. `syncCalendars` (`lib/calendar.ts`) la torna a demanar cada segon, fins a un minut, fora de la finestra de configuració: si es tanca, continua, el peu de la barra lateral ho indica, i en acabar un avís diu quants calendaris ha trobat. La finestra, en tornar-se a obrir, en recull l'estat (`useCalendarSync`).
- Cada 20 s, `shell.rs` busca una reunió que comenci d'aquí a 2 minuts o menys (o fa menys d'1 minut) i mostra l'avís, un cop per esdeveniment. Per defecte, només esdeveniments amb convidats o enllaç de videotrucada.
- En començar a gravar, la reunió agafa el títol i els convidats de l'esdeveniment en curs (`lib/calendar.ts`, columna `guests`). El menú de cada parlant els ofereix com a noms.

### Portada (`lib/cover.ts`, `Cover.tsx`)

- El model llegeix la transcripció i, al final, les notes amb el minut en què es van escriure (també compten com a font de tasques i decisions). Cada part es demana amb un prompt propi i una resposta JSON limitada per un esquema, així que els prompts es poden editar a la configuració sense trencar res.
- **Qui l'escriu** (`settings.coverEngine`): Gemma al Mac (per defecte), o Claude, OpenAI, Gemini o OpenRouter amb la clau d'API de l'usuari (`cloud.rs`, `lib/cloud.ts`), triat en un desplegable (cinc opcions no hi cabien en un segmentat). La clau es comprova llistant els models del compte (a OpenRouter, amb `/api/v1/key`, perquè la llista de models és pública), es desa al clauer de macOS (servei `com.quicodomingo.murmur.cloud`) i no torna mai a la interfície, que només en sap les quatre últimes lletres. `run_llm` rep l'`engine` i fa una crida per part amb els mateixos prompts; els esquemes es tornen estrictes (objectes tancats, tots els camps obligatoris, sense mides de llista). El document va primer i igual a cada crida, perquè la memòria cau del proveïdor el llegeixi un sol cop. Al núvol no s'espera que acabi la gravació (`gate.rs`), perquè no carrega el Mac. La portada desa el nom del model (`writtenBy`) i ho diu sota l'entradeta. Només surt text: transcripció i notes, mai àudio. OpenRouter fa servir l'API de xat d'OpenAI (`/chat/completions`): la llista són els models que només escriuen text i segueixen un esquema JSON (`supported_parameters=structured_outputs`, sense les variants `:batch`), agrupats per empresa; les crides porten `provider.require_parameters`, perquè no vagin a un servidor que ignori l'esquema, i amb Claude el document porta `cache_control`. Gemini fa servir la seva API (`generateContent`, capçalera `x-goog-api-key`) amb l'esquema a `responseJsonSchema`, sense `additionalProperties`; una clau dolenta hi torna com a 400 (`API_KEY_INVALID`), no 401. La memòria cau de Gemini és implícita, i el document va primer igualment.
- **Idioma** (`settings.coverLanguage`): el de la interfície (per defecte) o el de la reunió. «Català + castellà» s'escriu en català, i les reunions sense idioma desat fan servir el de la interfície (`coverLanguageFor`).
- **To:** es desa com un identificador fix (`constructive`, `tense`…) i es tradueix en mostrar-lo. Les portades antigues en català es continuen llegint.
- **Tasques:** només accions que algú demana o es compromet a fer. Es poden marcar, editar, assignar, eliminar i afegir; en tornar a generar, es conserven les afegides a mà i les marcades.
- **Noms:** reanomenar un parlant canvia el nom dins la portada (`renameInCover`), també mentre es genera. Els noms per defecte («Parlant 1», «Tu») es reconeixen en els tres idiomes.
- **Ajuntar parlants:** quan la detecció parteix una persona en dues, `mergeSpeakers` (`lib/store.ts`, acció `merge`) passa totes les frases d'un parlant a l'altre, marcades com a canviades a mà (`speakerLocked`) perquè la passada final no les torni a separar, n'esborra el nom i canvia el nom vell pel nou a la portada. Es fa des del menú del parlant, des de l'avís que surt en canviar el parlant d'una sola frase, o reanomenant un parlant amb el nom d'un altre.
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
- **Publicar** (`app/scripts/release.sh` i `publish.sh`): compila i signa amb el Developer ID (hardened runtime i `Entitlements.plist` amb `audio-input`, sense el qual el micròfon queda bloquejat), notaritza, grapa i fa el `.dmg`. L'etiqueta `v<versió>` engega `.github/workflows/release.yml`, que compila Windows i Linux (i macOS, si hi ha els secrets d'Apple) i els afegeix a les releases i al `latest.json` (`scripts/latest-json.mjs`). El procés complet és a [PUBLICAR.md](PUBLICAR.md).

### Dependències

Totes les versions 2.x de `zip` estan retirades de crates.io. `Cargo.toml` fa `[patch.crates-io]` a l'etiqueta git v2.6.1, que és la que demana `sherpa-onnx-sys`.

### Windows i Linux

La mateixa app, amb el que cada sistema permet. La interfície pregunta què hi ha (`platform` a `lib.rs`, `lib/platform.ts`) i només ofereix el que funciona.

| | macOS | Windows | Linux |
|---|---|---|---|
| Micròfon | Sí | Sí | Sí |
| Àudio del sistema | Core Audio tap (`systap.rs`) | Loopback WASAPI | No |
| Calendari, captures, «Reunió detectada», menú Compartir | Sí | No | No |
| Obrir un àudio o un vídeo | `afconvert`, i Symphonia per a Matroska i WebM | Symphonia (l'Opus, amb libopus) | Igual que Windows |
| Escoltar i exportar l'àudio | `.m4a` (AAC) | `.ogg` (Opus) | `.ogg` (Opus) |
| Clauer | Keychain (`security-framework`) | Gestor de credencials (`keyring`) | Secret Service (`keyring`) |
| Whisper i Gemma | Metal | Vulkan, o CPU amb AVX2 (x64); CPU (ARM) | Vulkan, o CPU amb AVX2 |
| Instal·lador i actualitzacions | `.dmg`, `.app.tar.gz` | NSIS (`_x64-setup.exe` i `_arm64-setup.exe`, per a l'usuari) | `.deb`, `.rpm`, AppImage (s'actualitza sola) |

- **Clauer** (`keychain.rs`): a macOS, `security-framework` com sempre (les claus desades abans es continuen llegint); a la resta, `keyring`, amb el mateix servei i compte.
- **sherpa-onnx a Windows i Linux** són les biblioteques compartides (`features = ["shared"]`), no les estàtiques. A Windows, les estàtiques fan servir el runtime estàtic de C (`/MT`), que no es pot enllaçar amb el de llama.cpp (`/MD`). A Linux, l'onnxruntime estàtic i llama.cpp porten cadascun les seves instàncies de les plantilles de libstdc++ (`std::regex`), fetes amb compiladors diferents: l'enllaçador se'n queda una i onnxruntime petava en crear l'entorn (`free(): invalid pointer`, vist a la prova e2e del motor). `build.rs` copia les biblioteques a `src-tauri/windows-dlls/` o `src-tauri/linux-libs/`, i l'instal·lador les posa al costat de l'executable (Windows) o a `/usr/lib/Murmur` (Linux, on apunta el `rpath`).
- **GPU (Vulkan)**: les versions de Windows x64 i Linux es compilen amb `--features vulkan` (Gemma, a l'app) i `MURMUR_VULKAN=1` (Whisper, a `murmur-whisper`), amb el Vulkan SDK (`.github/actions/vulkan`). A Windows, ggml es compila amb Ninja: amb MSBuild, els camins del generador de shaders de ggml-vulkan són massa llargs per al seguiment de fitxers (FTK1011), i sense seguiment no es compila. L'app es compila a `C:/mt` (`CARGO_TARGET_DIR`) i `murmur-whisper` a `C:\mw` (`MURMUR_WHISPER_TARGET_DIR`): a les carpetes de sempre, els camins del generador passen dels 260 caràcters i cl.exe falla. Sense la funció, que és com es compila per defecte, tot va pel processador i no cal el SDK.
  - Tots dos enllacen amb el carregador de Vulkan (`vulkan-1.dll`, `libvulkan.so.1`), sense el qual no arrencarien. El porten els controladors de la gràfica, però no tots els PC en tenen, així que `build.rs` el posa a l'instal·lador (`MURMUR_VULKAN_LOADER`, o el del SDK o del sistema) i `murmur-whisper` té el mateix `rpath` que l'app (`app/whisper/build.rs`).
  - Sense cap controlador de Vulkan, ggml no troba cap dispositiu i fa servir el processador. Els que són CPU (llvmpipe) no compten, i llama.cpp només fa servir la gràfica integrada si no n'hi ha cap de dedicada.
  - Si `murmur-whisper` mor a la gràfica (un senyal, o un codi de sortida que no és el seu 1), `retranscribe.rs` el torna a obrir amb `MURMUR_NO_GPU` i deixa `whisper-no-gpu` a la carpeta dels models amb la versió de Murmur: fins a la versió següent, Whisper va directament pel processador. Passava amb Vulkan a Linux i el Whisper del BSC, tant a una Intel UHD 620 com a una MX150 (#9). El reintent no torna a començar: `murmur-whisper` escriu el text de cada tros de 28 s així que el té, i el reintent li passa `skip` amb els trossos fets.
  - Abans de carregar Whisper amb Vulkan, `pick_gpu` (a `app/whisper/src/main.rs`) mira les gràfiques que troba ggml i en tria una de dedicada amb memòria lliure per al model i 1,3 GB més (la memòria de la conversa i els buffers de càlcul: uns 1,2 GB amb large-v3). Les integrades no es fan servir: comparteixen la RAM i van més lentes que el processador (una UHD 620 va fer mitja feina en el temps que el processador la fa tota). Sense cap gràfica que hi càpiga, va pel processador des del principi: a una MX150 de 2 GB, whisper.cpp petava en lloc de fallar. Cada gràfica surt al registre amb la memòria i el veredicte. Al Mac, Metal, com sempre.
  - Si la gràfica no hi cap o el controlador falla en carregar el model, es torna a carregar amb el processador (`llm.rs`, `load` a `app/whisper/src/main.rs`). Si el que no hi cap és la memòria de la conversa d'una reunió llarga, va a la RAM i el model es queda a la gràfica (`with_offload_kqv(false)`). `MURMUR_NO_GPU` ho fa tot amb el processador.
  - Els executors de la CI no tenen gràfica: les proves dels paquets comproven que el carregador hi és i que, sense GPU, tot funciona.
- **Windows ARM** (`aarch64-pc-windows-msvc`, l'executor `windows-11-arm`): sherpa-onnx en té biblioteques. ggml només pot triar una CPU ARM concreta compilant amb clang: amb MSVC demana `GGML_NATIVE`, i agafaria l'SVE de l'executor, que cap Snapdragon té. Es compila amb clang-cl i Ninja a l'entorn ARM64 de Visual Studio (`.github/scripts/msvc-ninja.ps1`), perquè amb el generador de Visual Studio el crate `cmake` hi força les eines x64 (`-Thost=x64`), que l'executor ARM no té. llama-cpp-sys hi activa sempre OpenMP, i amb clang-cl és el `libomp` de LLVM, que `build.rs` enllaça i posa a l'instal·lador (`libomp.dll`). Es compila per a ARMv8.2 amb dotprod i fp16 (`GGML_CPU_ARM_ARCH`, a `.github/actions/preparar` i `scripts/build-whisper.mjs`), que tenen tots els PC amb Windows ARM. Sense GPU de moment: l'Adreno va millor amb OpenCL que amb Vulkan, i abans cal mesurar si el processador ja n'hi ha prou. L'actualitzador baixa l'instal·lador ARM (`windows-aarch64` al `latest.json`). Qui tingui instal·lada la versió x64, que funciona emulada, s'hi queda fins que instal·li la d'ARM.
- **AVX2**: als executors de GitHub, whisper.cpp es compilaria per a la CPU de la màquina (`GGML_NATIVE`) i llama.cpp per a l'x86-64 bàsic (SSE2, diverses vegades més lent). `app/.cargo/config.toml` i `scripts/build-whisper.mjs` fixen AVX2, FMA i F16C: qualsevol PC des del 2013-2015.
- **Dreceres i textos**: ⌘ és Ctrl (`hasMod`, `shortcut`), i els textos que diuen «aquest Mac», Finder o Configuració del Sistema tenen la seva versió per a qualsevol ordinador a `locales/<idioma>/pc.json`, que `lib/i18n.ts` aplica fora de macOS.
- **Dades**: on Tauri les posa a cada sistema (`app_data_dir`: Application Support, `%APPDATA%`, `~/.local/share`). El connector per a Claude les busca al mateix lloc (`dirs::data_dir`), i Claude Desktop a `dirs::config_dir`.
- **Obrir amb…**: a Windows i Linux el fitxer arriba com a argument (`Opened::from_args`).

### Proves e2e (`app/e2e/`)

- **Motor** (`specs/motor.test.mjs`, a les tres plataformes): l'app amb `--mcp` transcriu `fixtures/bon-dia.wav` (una veu sintètica d'espeak que diu «Bon dia a tothom. Avui parlarem del pressupost de l'any que ve i de les vacances d'estiu.») amb el model de transcripció de veritat, i se n'han d'entendre almenys tres paraules. Prova sherpa-onnx, els models, la descodificació i la diarització en aquell sistema.
- **Interfície** (`specs/interficie.e2e.mjs`, Windows x64 i Linux, amb `tauri-driver`; a Windows ARM el msedgedriver no hi arrenca el WebView2): la benvinguda, els textos per a PC, les dreceres amb Ctrl, i una configuració sense calendari ni permisos de macOS.
- **Obrir un àudio** (`specs/importa.e2e.mjs`): l'app oberta amb el fitxer com a argument en fa una reunió i en mostra la transcripció.
- La CI (`.github/workflows/ci.yml`) les fa a cada canvi. El model (~585 MB) es desa a la memòria cau de GitHub mentre no canviï `models.rs`.

## Passada final: Whisper (`retranscribe.rs`, `app/whisper/`)

- Només per a reunions d'una sola llengua. Forçat a «català», Whisper passa el castellà al català; per això «Català + castellà» no en fa.
- **Whisper large-v3-turbo q5_0** de whisper.cpp (`models/whisper-ggml/`, model opcional `whisper`, 574 MB, MIT) amb Metal.
- **En català, el Whisper del BSC** (`whisper-3cat-balearic`, Apache 2.0, large-v3 afinat amb 3CatParla), convertit amb `convert-h5-to-ggml.py` de whisper.cpp i quantitzat a q5_0 (1,1 GB, model opcional `whisper-ca`). `retranscribe::model_for` el tria per a «ca» si és descarregat; si no, el turbo, com abans. `Settings.finalPass` (Configuració › Transcripció › En acabar la gravació › Torna a escoltar amb Whisper) l'apaga per a les gravacions; «Torna a transcriure en…» continua funcionant. A qui té «Català» triat i no el té, Murmur li ofereix un cop, en obrir-se, amb un avís i el botó Descarrega (`murmur.whisperCaOffered.v1`); no el descarrega sense preguntar. El mateix amb el turbo a qui té «Castellà» o «Anglès» (`murmur.whisperOffered.v1`). L'onboarding pregunta en quina llengua són majoritàriament les reunions (es desa com l'idioma de les reunions) i hi descarrega el Whisper que toca (fila «Repàs en acabar», marcada d'entrada): el del BSC per al català, el turbo per al castellà i l'anglès. Amb «Català + castellà» encara no en descarrega cap: Whisper passaria una llengua a l'altra. Per a aquestes reunions es mesura Whisper frase a frase, només per als ordinadors amb GPU (`examples/mixed_probe.rs`): cada frase amb la seva llengua (la detecció de Whisper), el català al model del BSC i el castellà al turbo. El turbo es queda: fa el castellà i l'anglès i endevina l'idioma dels fitxers, i amb «Català» la configuració el mostra (si hi és) per poder-lo esborrar. Escriu sense puntuació ni majúscules: després hi passa el model de Softcatalà, també a `transcribe_file`. És uns dos cops més lent que el turbo (`RTF_ESTIMATE_CA`).
- `murmur-whisper` llegeix a la capçalera del model quantes capes té el descodificador (4 el turbo, 32 un large-v3) i tria els caps d'alineació (DTW) que toquen. Els models del BSC escriuen la primera peça de cada frase sense espai davant: una peça que cau a l'inici d'una altra frase sempre comença una paraula nova («tardi» + «també» feia «tarditambé»).
- **Mesura** (`bench/dialects.py`, com ho fa l'app: frases tallades pel VAD, empalmades en trossos de 28 s i paraules col·locades pel DTW; WER normalitzat, sense puntuació ni majúscules i amb els números en lletres). Common Voice 17 (proves, 150 frases per accent) i les Corts Valencianes (18 min de parla espontània). M4, 15 min d'àudio per conjunt.

  | WER | directe | turbo | BSC valencià | BSC balear |
  |---|---|---|---|---|
  | Català central | (1,4%) | 8,8% | 6,5% | **3,7%** |
  | Balear | (2,9%) | 13,6% | 9,2% | **5,7%** |
  | Valencià | (1,9%) | 13,7% | 5,9% | **3,7%** |
  | Corts Valencianes | 30,6% | 23,2% | 16,3% | **14,7%** |
  | Castellà | 4,6% | **5,1%** | 10,3% | 7,2% |
  | Anglès | | **11,6%** | 12,8% | 12,8% |

  El directe surt tan bé a Common Voice perquè probablement s'hi va entrenar. El model valencià del BSC s'entrena amb les Corts i, tot i així, el balear el supera. En una reunió real en valencià (20 min), escoltada a mà, el balear amb la puntuació de Softcatalà va ser el millor. Temps: 227 s per a aquells 20 min (el turbo, 171 s).
- Corre en un procés a part, **`murmur-whisper`** (`app/whisper/`, crate propi): whisper.cpp i llama.cpp porten cadascun el seu ggml i no es poden enllaçar al mateix binari. Així, a més, la memòria es retorna sencera en acabar. Es compila amb `npm run whisper` (ho fan `beforeDevCommand` i `beforeBuildCommand`) i va dins l'app com a `externalBin`.
- Durant la gravació es desa cada canal en PCM a `<app_cache_dir>/final-pass/`. En aturar (després de la verificació de parlants), les frases de cada canal s'empalmen en trossos de fins a 28 s, amb 0,5 s de silenci entre elles. Els temps per paraula (DTW, preset large-v3-turbo) diuen a quina frase va cada paraula. La interfície (`retranscribed` a `store.ts`) substitueix el text de les frases que no s'han editat a mà.
- Es descarta un tros si té més de 6 paraules per segon de veu, o una frase de 2 a 6 paraules repetida 4 cops seguits (d'una sola paraula, 8 cops: «clic, clic, clic, clic» és real). També es descarten les frases amb textos inventats típics («Subtítols realitzats per…»). Llavors es queda el text en directe.
- Prova: `cargo run --release --example whisper_probe -- ../../data/reunio-3min.wav ca` mostra el directe i Whisper frase per frase. A la reunió de 3 minuts: puntuació, majúscules i marques ben escrites (WordPress, WooCommerce, storytelling), amb RTF 0,1 a l'M4.
- La flash attention va un 20% més ràpid, però sense DTW les paraules cauen a la frase següent.
- Descartat: Whisper amb sherpa-onnx (CPU, RTF 0,55, i el model publicat no dona temps per paraula; CoreML no hi és disponible).

### Glossari (`glossary.rs`)

- Taula `glossary` a la base de dades (un terme per fila, sense distingir majúscules, en l'ordre en què s'han afegit). Es llegeix en començar una gravació, a la passada final i al connector per a Claude (`transcribe_file`). S'edita a Configuració › Transcripció, i en corregir una frase a mà la interfície proposa afegir-hi els noms nous (`lib/glossary.ts`, `newNames`: paraules amb majúscules dins o que no comencen frase).
- `glossary::correct` passa per cada frase acabada del directe (`Pipeline::filter`) i per cada frase de Whisper (`retranscribe::transcribe`). Compara grups d'1 a 3 paraules amb cada terme sense accents, majúscules, apòstrofs ni espais («soft català», «Wordpress», «d'aïna»). Als termes de 7 lletres o més admet una lletra de diferència, i dues a partir de 12, sempre amb la mateixa inicial. Els curts només canvien si coincideixen exactament. Si hi ha empat, guanya el grup de menys paraules («Wordpress o» no es menja la «o»). També recupera l'apòstrof que el directe perd davant de vocal o h («daina» → «d'AINA»).
- **Convidats.** En gravar una reunió del calendari, o en tornar-la a transcriure, `glossary::with_guests` hi afegeix, només per a aquella reunió, el nom complet de cada convidat i el nom de pila (la primera paraula de 4 lletres o més abans de l'última). Els cognoms no, perquè sovint són paraules corrents (Puig, Rius, Serra), ni els noms curts (Pau, Mar). Un convidat sense majúscules és la part d'usuari d'una adreça, i es deixa fora.
- **Portada.** `spellingNote` (`lib/glossary.ts`) afegeix a les instruccions generals del model una frase amb com s'escriuen els convidats i els termes del glossari que surten a la reunió (comparats sense accents ni majúscules). Només aquests: una llista de termes que no hi són podria fer que un model petit els fiqués al resum. No forma part del document, així que canviar el glossari no deixa les portades antigues desfasades.
- Mesura (`MURMUR_GLOSSARY="AINA,Softcatalà,WordPress,WooCommerce" cargo run --release --example whisper_probe -- ../../data/reunio-3min.wav ca`): de cinc errors de Whisper, en corregeix quatre i no toca res més. «sob català» queda tal qual, perquè és massa lluny. Amb noms que semblen paraules corrents (Mar, Pau, Marta), cap fals positiu.
- `glossary::correct` compta cada correcció de debò (no les paraules que ja estaven ben escrites) en un comptador en memòria; `save_glossary_hits` el suma a la columna `glossary.hits` en acabar cada reunió i en obrir el glossari, i `set_glossary` la conserva per a les paraules que es queden. La configuració mostra el número al costat de cada paraula. Una paraula corregida en directe i després per Whisper compta dues vegades: és una pista de quines paraules fan feina, no una mesura exacta.
- Descartat: passar el glossari a Whisper com a `initial_prompt`. Escrivia bé AINA i Softcatalà, però es menjava mitja frase (unes 15 paraules) i canviava paraules que estaven bé («agafar» → «agrair»).

### Tornar a transcriure en un altre idioma

Si una reunió s'ha gravat amb l'idioma equivocat, «Torna a transcriure en…» (menú del títol) la torna a passar per Whisper en català, castellà o anglès. `retranscribe_meeting` descodifica l'.ogg canal per canal (`playback::decode_channels`: el micròfon a l'esquerra i, en una trucada, el sistema a la dreta), en fa els mateixos fitxers PCM temporals que la gravació i crida `final_pass` només amb el text. Les frases són les de la reunió (inici i final), així que qui parla i quan es manté; les corregides a mà no es toquen. La interfície desa l'idioma nou i, si la portada està activada, la torna a fer. «Català + castellà» no hi és perquè Whisper només treballa en una llengua.

### Obrir un àudio o un vídeo (`import.rs`)

Fitxer › Transcriu des d'un fitxer… (⌘O) fa una reunió a partir d'un fitxer, com si s'hagués gravat. D'un vídeo només se'n fa servir el so: la imatge no es descodifica mai.

- **Descodificar.** `afconvert` de macOS ho passa a WAV de 16 kHz (mp3, m4a, wav, aiff, flac, mp4 i també Ogg/Opus a les versions noves de macOS). Si no pot (Matroska i WebM, que fan OBS i els navegadors), ho prova Symphonia, que també és el que llegeix tot a Windows i Linux: agafa la primera pista amb so, i si és Opus (el so habitual d'un WebM), en passa els paquets a libopus a 48 kHz. Si tampoc, un .ogg passa pel decodificador d'Opus de l'app. L'AVI no es llegeix. `MURMUR_VIDEOS=<carpeta> cargo test -- --ignored videos` prova mp4, mov, m4v, mkv (AAC i Opus) i webm fets amb ffmpeg. Els canals es barregen a `import::wav_samples`: amb `-c 1`, `afconvert` es queda només amb l'esquerre, i en una trucada gravada en estèreo cada persona va en un canal.
- **Idioma.** Si no se sap, `detect_language` el demana a Whisper. Silero VAD troba on es parla, `import::windows` en fa fins a 8 finestres d'uns 10 s de veu repartides pel fitxer, i `murmur-whisper <model> detect` en dona les probabilitats de català, castellà i anglès. `import::decide` compta les finestres clares (≥ 0,6). Si el català i el castellà hi surten tots dos (≥ 15% de les finestres; una finestra amb tots dos ≥ 0,3 compta mig per a cadascun), és «Català + castellà». Si no està clar, es fa servir l'idioma de sempre. Una reunió de 20 minuts triga uns 20 s.
- **Transcriure.** `start_recording` amb `file`: el fitxer va pel canal del micròfon (tothom en un canal, com a la sala), sense eco ni farciment de silenci, tan de pressa com el motor el pren (unes 25 vegades el temps real a l'M4). Després hi ha la passada final de sempre. No mostra l'indicador ni fa esperar la feina d'una altra reunió.

**Des de fora.** L'app declara els tipus d'àudio i vídeo a `tauri.conf.json` › `fileAssociations` amb rang `Alternate` (surt a Finder › Obre amb sense prendre's l'obertura per defecte). macOS li passa els fitxers amb `RunEvent::Opened`; queden a la cua `Opened` fins que la finestra els pren (`take_opened_files`, avisada amb l'esdeveniment `opened-files`), perquè en obrir l'app en fred arriben abans que la interfície. La interfície els transcriu un darrere l'altre quan no hi ha cap gravació ni importació en marxa. Els fitxers deixats anar a la finestra (`onDragDropEvent` de Tauri, a `DropOverlay`) van a la mateixa cua; mentre s'arrosseguen, un vel atenua tota la finestra i diu si és un àudio.

L'entrada del menú Compartir és una extensió d'app a part (`app/share-extension/`, Swift, `com.apple.share-services`). No té finestra: recull els fitxers i els obre amb el Murmur que la conté (`NSWorkspace.open`), que torna a ser `RunEvent::Opened`. Les extensions van en sandbox; si l'app d'origen només en comparteix el contingut i no un fitxer (una nota de veu, un adjunt), en fa una còpia a la carpeta del grup d'apps `NYQHV4FSKC.com.quicodomingo.murmur` (`~/Library/Group Containers/…/Shared`), que Murmur també pot llegir i on les còpies de més d'un dia s'esborren. Tauri no sap compilar extensions: `scripts/share-extension.sh` la compila amb `swiftc`, la posa a `Contents/PlugIns/`, la signa amb les seves entitlements i torna a signar l'app. `release.sh` el crida abans de notaritzar.

Mesura amb `examples/lang_probe.rs` (decisió per fitxer) i `examples/import_probe.rs` (velocitat del motor).

### Subtítols (`lib/subtitles.ts`)

Exporta › Subtítols escriu la transcripció en SRT o WebVTT. Una frase de la transcripció pot durar mig minut, i un subtítol no: cada frase es talla en trossos de dues línies de 42 caràcters com a màxim, millor després d'un punt o d'una coma, i el seu temps es reparteix segons la llargada (no tenim el temps de cada paraula). Cap tros dura més de 6 s ni menys d'1 s, ni passa d'un parlant al següent. Opcionalment, el nom de qui parla quan canvia («Marta: …», o `<v Marta>` al WebVTT) i, si la reunió està traduïda, el text de la traducció. Si la reunió ve d'un fitxer obert en aquest ordinador, el diàleg de desar proposa la mateixa carpeta i el mateix nom (`video.srt`, o `video.en.srt` per a la traducció), perquè els reproductors els trobin sols; el camí del fitxer només es recorda al `localStorage`.

### Obsidian (`lib/obsidian.ts`, `obsidian.rs`)

Una caixa forta d'Obsidian és una carpeta de Markdown. `obsidian.rs` llegeix la llista de caixes fortes d'Obsidian (`obsidian.json` a la carpeta de configuració del sistema, i la de Flatpak a Linux), només per oferir-les pel nom; mai hi escriu. `saveToObsidian` hi escriu «<carpeta>/2026-11-15 Títol.md»: propietats YAML a dalt (data, durada, participants, etiquetes, idioma, d'on ve), el Markdown de sempre sense el títol (Obsidian mostra el nom del fitxer) i amb les persones com a `[[enllaços]]` si es vol, i les captures copiades a «attachments/» i inserides amb `![[…]]`. «Obre a Obsidian» fa servir `obsidian://open?path=…` (permès a `capabilities/default.json`). Les reunions fetes en aquesta sessió s'hi desen soles quan acaben, si està activat. `write_export` crea la carpeta si no hi és.

### Notion (`lib/notion.ts`, `notion.rs`)

Murmur parla amb el servidor MCP allotjat de Notion (`https://mcp.notion.com/mcp`), sense cap servidor propi ni clau per crear. «Connecta amb Notion» fa OAuth amb PKCE (S256): Murmur es registra al moment com a client públic (registre dinàmic, `token_endpoint_auth_method: none`), obre el navegador i espera la resposta en un port local (`127.0.0.1:<port>/callback`), comprovant `state` i l'emissor. El testimoni dura unes 8 hores i el de renovació canvia a cada renovació; tots dos es desen al clauer, i es renoven sota un mutex perquè dues crides alhora no en gastin un de vell. Cada crida és JSON-RPC: `initialize`, `notifications/initialized` i `tools/call`, amb respostes en JSON o en SSE. Fa servir `notion-search` i `notion-list-recent-pages` per triar la pàgina, i `notion-create-pages` per desar-hi la reunió (resum, notes i transcripció en Markdown); si la transcripció passa de ~40 KB, va en subpàgines. Sense pàgina triada, cada reunió és una pàgina privada. Només s'hi envia text, mai àudio ni captures.

### Mòbils (`mobile.rs`, `core/src/sync.rs`)

L'ordinador pot rebre les reunions gravades amb Murmur per a mòbil ([EMPARELLAR.md](EMPARELLAR.md)). Està apagat fins que s'hi emparella un mòbil: sense mòbils ni codi a la pantalla, no hi ha cap port obert.

- **Protocol (`core/src/sync.rs`, compartit amb el mòbil):** TCP a la xarxa local amb Noise. Per emparellar, `Noise_IKpsk2` amb la clau de l'ordinador i un secret d'un sol ús, tots dos al QR (`murmur://pair?…`); després, `Noise_IK`, i l'ordinador només accepta els mòbils que té. Cada banda envia primer un `Hello` amb el seu nom: l'ordinador només recorda un mòbil nou quan rep el seu, perquè és el que demostra que tenia el secret. Els missatges van partits en trames de Noise; els fitxers, en trossos de 256 KB amb la suma SHA-256, i es reprenen si es talla.
- **L'ordinador (`mobile.rs`):** la clau privada al clauer (`com.quicodomingo.murmur.mobile`), els mòbils (clau pública, nom, dates) a `phones.json`, el QR en SVG (`qrcode`), l'anunci `_murmur._tcp` amb Bonjour (`mdns-sd`, amb un nom aleatori) i un fil per connexió. Una reunió que arriba va a `incoming/<id>/` mentre es rep; després l'àudio passa a `recordings/`, les captures a `screens/<id>/`, i es desa amb `device` (`{id, name}`) i en `processing`. L'esdeveniment `mobile-meeting` fa que l'app l'afegeixi a la llista i hi passi la revisió de parlants i Whisper (`retranscribe_meeting` amb `max_speakers`), la puntuació i el resum. El mòbil en recull el resultat amb `GetResults` (`db.changed_for_device`, per `updated_at`), sense les rutes de l'ordinador.
- **L'estat, a la interfície:** `mobile_status` diu els mòbils, quin està connectat ara i quina reunió envia (`activity`, mentre dura la connexió: una guarda `Syncing` que es treu sola en tancar-se), i si els mòbils no poden arribar a l'ordinador (`problem`: `offline` sense xarxa local, `listen` si no s'ha pogut obrir el port). Cada canvi s'envia amb l'esdeveniment `mobile-status`. El nom de l'ordinador que veu el mòbil (`computer_name`) és el de Compartir al Mac, el nom del dispositiu a Windows (`GetComputerNameExW`; si és el que posa Windows, «DESKTOP-4F2K1QX», «PC de <usuari>») i el nom «bonic» de `/etc/machine-info` o el `hostname` a Linux. A Windows, el primer cop que s'obre el port el tallafocs pregunta, i en una xarxa «pública» bloqueja el mòbil: la pestanya Mòbil ho explica. Ho fan servir la icona del peu de la barra lateral (`MobileSync.tsx`, que torna a preguntar cada 30 s perquè la xarxa pot canviar sense avisar) i la pestanya Mòbil.
- **Prova sense mòbil:** `cargo run --example fake_phone -- pair '<codi>'`, `send <fitxer.wav> [títol]` i `results`.

### Connector per a Claude (`mcp.rs`)

El mateix binari de l'app, cridat amb `--mcp` (`main.rs`), és un servidor MCP per stdio: `/Applications/Murmur.app/Contents/MacOS/transcriptor --mcp`. Així no cal instal·lar res més ni afegir cap binari al paquet.

- **Eines:** `list_meetings`, `search_meetings` i `get_meeting` llegeixen la base de dades de l'app en mode de només lectura (`Db::open_read_only`; l'app hi pot escriure alhora, és WAL). `get_meeting` torna el resum, les tasques, les notes i la transcripció en Markdown, amb els noms dels parlants. `transcribe_file` torna de seguida un identificador i transcriu en un fil (`import::transcribe_file`: idioma, motor, parlants i Whisper, com «Transcriu des d'un fitxer…» però sense interfície). `get_transcription` en diu l'estat o el text. Una transcripció llarga triga més del que Claude espera una resposta, per això és asíncrona. Una sola alhora.
- **Sortida neta:** el protocol és la sortida estàndard. En començar es duplica i el descriptor 1 passa a apuntar a stderr, perquè cap biblioteca (sherpa-onnx, onnxruntime) hi escrigui res.
- **Configuració › Claude:** l'interruptor afegeix o treu l'entrada `murmur` de `~/Library/Application Support/Claude/claude_desktop_config.json` sense tocar res més (si l'arxiu no és JSON vàlid, no el reescriu). Per a Claude Code mostra l'ordre `claude mcp add`. Desactivat per defecte: només hi ha connector si l'usuari l'afegeix.
- **Privadesa:** Murmur no envia res. Claude rep el text que demana a les eines; l'àudio no surt del Mac.

## Passada final: verificació de parlants (`diarize.rs`, `final_pass` a `lib.rs`)

- Durant la gravació, el canal dels altres (el sistema en una trucada, o el micròfon si no n'hi ha) es desa en PCM de 16 bits a `<app_cache_dir>/final-pass/`.
- En aturar, en un fil a part: diarització amb sherpa-onnx (segmentació pyannote 3.0 + 3D-Speaker). Cada frase en directe rep el parlant que més s'hi solapa, i la interfície (`relabel` a `store.ts`) reassigna: cada parlant de la diarització es queda el número del parlant en directe de qui té més frases, així que els números i els noms no es mouen, i la teva veu, reconeguda en directe com a 0 («Tu»), continua sent «Tu». Les frases fixades a mà (`speakerLocked`) no es toquen. (Abans es renumeraven per ordre d'aparició, i «Tu» passava a ser qui parlava primer a la sala.)
- RTF 0,116 a l'M4 (~7 minuts per hora de reunió). Activada per defecte.

### Què fa en acabar («Què en faig ara?», `AfterCard.tsx`)

Els passos de després (parlants, Whisper, puntuació, resum) es trien quan s'acaba cada reunió, no a l'inici. En gravar o obrir un fitxer, Rust desa l'àudio de tot el que es podrà fer (els parlants sempre; Whisper si la llengua és una i el model hi és) i, en aturar-se, en lloc de començar la passada final la guarda a `AppState::waiting` i avisa amb `final-pass-ready` (què es pot fer i quant trigaria cada cosa). La interfície respon amb `run_final_pass(meeting, speakers, text)`, que la comença amb el que s'ha triat o, sense res, esborra l'àudio i emet `final-pass-done`. La puntuació i el resum els fa la interfície després, com sempre (`postprocess.ts`, `choose`).

- **La targeta** surt a dalt de la reunió, marcada com l'última tria, que es recorda per separat per a gravacions (`verifySpeakers`, `finalPass`, `punctuate`, `summarize`, com abans) i per a fitxers (`fileSteps`). Si no s'hi toca res, comença sola als 10 s; tocar-la atura el compte enrere. El temporitzador és de la finestra (`App.tsx`), no de la targeta: si s'obre una altra reunió, igualment comença. Amb «Pregunta-m'ho en acabar» apagat (`askAfter`), o aturada des de l'indicador amb Murmur al darrere, fa l'última tria sense preguntar. Les reunions del mòbil fan el que diuen els interruptors de les gravacions.
- **El que no es fa** i encara es pot fer queda a la reunió (`pending`, columna de la base de dades). S'hi desa tot el que es pot fer des que la reunió acaba, abans de triar, i el que es tria hi continua fins que s'ha fet: si Murmur es tanca o s'actualitza a mig camí, no es perd res. A més, l'actualitzador (`UpdatesDialog.tsx`) no instal·la ni reinicia res mentre es grava, es fa la passada final, hi ha «Què en faig ara?» obert o s'obre un fitxer. Mentrestant la descarrega i espera. la barra lateral hi posa un punt i el menú «···» ofereix «Acaba de processar…», que obre la mateixa targeta amb el que ja s'ha fet marcat com a fet. Els parlants i Whisper es fan llavors amb l'àudio desat (`retranscribe_meeting`, que ara revisa l'altra banda de la trucada si n'hi ha, com en acabar); sense «Desa l'àudio» ja no es poden fer, i la targeta ho avisa en aturar. Cada pas fet surt de `pending` en arribar el seu resultat (`store.ts`, `done`), i els de la passada, també quan s'acaba (`postDone`), encara que no hagin canviat res.

### Si comença una altra reunió (`gate.rs`)

- La feina d'acabar una reunió (parlants, Whisper, puntuació i portada) espera mentre Murmur grava, o mentre una altra app fa servir el micròfon (una trucada a Meet, Teams, Zoom…, la mateixa detecció que «Reunió detectada», `micwatch.rs`). Així la gravació o la trucada no van a batzegades. També se'n processa només una reunió alhora: si en tanques dues seguides, la segona espera la primera. Quan es torna a fer la passada d'una reunió desada (`retranscribe_meeting`: les que arriben del mòbil, o canviar d'idioma), el torn (`gate::heavy`) es pren abans de descodificar l'àudio i passa a `final_pass`: si arriben diverses reunions del mòbil alhora, no es descodifiquen totes juntes (~230 MB per hora d'àudio cadascuna), ni mentre Murmur grava.
- Whisper corre en un procés a part i es congela al moment (`SIGSTOP`, i `SIGCONT` quan s'acaba la gravació o la trucada; a Windows, `NtSuspendProcess` i `NtResumeProcess`). El model de llenguatge s'atura entre token i token, i la puntuació abans de començar. La verificació de parlants és una sola crida a sherpa-onnx: si ja ha començat, acaba (com a molt uns minuts).
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

## Registre (`logfile.rs`)

Un fitxer de text a la carpeta de registres de l'app (al Mac `~/Library/Logs/com.quicodomingo.murmur`, a Windows `%LOCALAPPDATA%\com.quicodomingo.murmur\logs`, a Linux `~/.local/share/com.quicodomingo.murmur/logs`), perquè qui prova Murmur ens l'enviï quan alguna cosa falla. Configuració › General › Mostra el registre n'obre la carpeta (`show_log`); no s'envia mai sol.

- **Què hi va:** la versió i el sistema en obrir l'app; quan comença i s'atura una gravació o un fitxer, amb quines fonts, l'idioma, si hi ha un micròfon triat (només «chosen» o «default», mai el nom: pot ser «AirPods de la Marta») i quant ha durat; el micròfon que calla i es torna a obrir; la passada final (què fa, quant triga i els errors); Gemma a la GPU o al processador; les descàrregues que fallen. Els nostres crates escriuen des d'`info`; les biblioteques, només avisos i errors.
- **Què no hi va mai:** el que es diu a les reunions, títols, notes, noms, àudio, claus o noms de dispositius. La carpeta de l'usuari s'escriu `~`, perquè els camins no portin el seu nom. Un log nou no hi ha de posar mai contingut de les reunions (la frase que repetia l'eco d'una trucada ara només en diu el nombre de paraules).
- **Mida:** `murmur.log` fins a 1 MB; llavors passa a ser `murmur.1.log` (substituint l'anterior) i se'n comença un altre: com a molt 2 MB.

## Estadístiques d'ús (`lib/analytics.ts`)

- [Aptabase](https://aptabase.com), amb el connector oficial per a Tauri (`tauri-plugin-aptabase`, amb rustls). Només es carrega si `APTABASE_KEY` (lib.rs) té una clau; sense, no s'envia res. En tancar l'app, `flush_events_blocking` envia el que quedi a la cua.
- El connector afegeix a cada esdeveniment la versió de l'app, el sistema operatiu i el seu idioma, i un identificador de sessió que viu en memòria i caduca. No fa servir cap identificador del dispositiu ni desa res al disc. No hi ha informes d'errors automàtics.
- `track()` no fa res si l'usuari ho ha desactivat (`Settings.analytics`, activat per defecte: casella a l'onboarding i interruptor a Configuració › General). Els valors de cert o fals van com a «yes» o «no».
- Esdeveniments: `app_opened` (com està configurat i quantes reunions, en franges), `recording_started`, `recording_continued`, `recording_finished` i `file_transcribed` (idioma, fonts, durada i nombre de frases en franges), `file_opened`, `retranscribed`, `translated`, `summary_generated`, `exported` (format) i `shared` (què s'hi inclou, caducitat, contrasenya). Mai títols, text, noms, notes ni àudio.

## Presentacions: «Murmur, sóc la Marta» (`lib/intro.ts`)

- Cada frase acabada del directe passa per `introducedName`: si comença per «Murmur» (amb qualsevol signe darrere) i segueix amb una manera de dir «sóc» en català, castellà o anglès («sóc», «em dic», «jo sóc», «soy», «me llamo», «I'm», «my name is»…), en treu el nom: fins a tres paraules, sense l'article («la», «en», «l'») i fins a la primera coma o «i/y/and/que». Sense «Murmur» davant no compta: «sóc la Marta» es diu per moltes raons.
- «Murmur» és al glossari de manera interna (`glossary::BUILT_IN`, no surt a la llista), perquè el directe l'escrigui bé encara que el senti com «mur mur».
- `matchName` ajusta el nom als convidats del calendari, als noms ja posats i al glossari: el nom sencer, o el primer nom si només n'hi ha un que s'hi assembli (una lletra de diferència a partir de 4). Si no, el nom tal com s'ha sentit, amb majúscules.
- L'acció `introduce` del store posa el nom al parlant d'aquella frase i la fixa (`speakerLocked`); si un altre parlant ja té el nom, els ajunta. Després de la verificació de parlants es tornen a aplicar totes les presentacions de la reunió, perquè el nom segueixi la persona i no el número. Un avís diu «"Parlant 2" és la Marta», amb Desfés si no s'han ajuntat dos parlants.
- No es desa cap veu: la presentació només serveix dins d'aquella reunió.

## La teva veu (`voice.rs`)

- Opcional: un pas a l'onboarding, després dels models (l'empremta necessita el model de parlants), i a Configuració › Transcripció › Parlants en directe. L'usuari llegeix una frase com en un karaoke: cada mig segon, el model del directe (el mateix de les reunions, ja carregat) transcriu el que porta gravat i `voice::progress` ho compara amb la frase, paraula per paraula i tolerant paraules mal sentides o saltades; «voice-progress» diu quantes se n'han llegit. Mig segon després de l'última, la gravació s'atura sola (com a molt 20 s, o `stop_voice_recording`). Primer es va provar de fer avançar la guia amb el nivell del micròfon, i no seguia el ritme de qui llegeix. `record_voice` grava el micròfon (amb «voice-level» per al nivell), `voice::enroll` en treu la veu amb Silero VAD (n'ha de quedar com a mínim 4 s) i en calcula l'empremta amb TitaNet, el mateix model que agrupa les veus en directe, normalitzada.
- Només es desa l'empremta, mai la gravació: `voice.json` a la carpeta de dades de l'app, amb el model que la va fer (una empremta d'un altre model s'ignora). No surt mai de l'ordinador i es pot esborrar. És una dada biomètrica, i la interfície ho diu.
- En començar a gravar (no en un fitxer ni en una reunió que continua), el canal del micròfon comença amb aquesta veu com a parlant 0, «Tu» (`LiveSession::known_speakers`, el mateix que fa «Continua»).
