# Meeting Transcript — transcriptor de reunions en català

Aplicació d'escriptori (Mac primer, després Windows; més endavant iOS/Android) que transcriu reunions en **català** en directe, identifica qui parla i genera un resum amb acords. **Tot funciona en local per defecte**: l'àudio no surt de l'ordinador si l'usuari no ho decideix.

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
| Puntuació / resum | mínim | LLM local per defecte; opcionalment la clau API de l'usuari (OpenAI o Claude) |

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
- Àudio de sistema: ScreenCaptureKit (macOS), WASAPI loopback (Windows)
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
- **Àudio** (`audio.rs`): micròfon amb cpal (→ mono → remostreig lineal a 16 kHz) + **àudio del sistema amb ScreenCaptureKit** (directament a 16 kHz mono, exclou l'àudio de la pròpia app). **Les fonts no es barregen** (`pipeline.rs`): cada una té la seva `LiveSession`; el micròfon passa abans per **cancel·lació d'eco WebRTC AEC3** (`aec.rs`, crate `sonora`, Rust pur) amb l'àudio del sistema com a referència, i només es processa quan ja s'ha vist la referència d'aquell instant. Les fonts aturades s'omplen de silenci pel rellotge real (ScreenCaptureKit no envia res si no sona res). Les frases del micròfon que repeteixen ≥60% de paraules d'una del sistema (±2 s) es descarten.
  - Ids de parlant: micròfon 0…, sistema 100… (`SYSTEM_SPEAKER_BASE`). En una trucada el parlant 0 del micròfon es diu «Tu» per defecte.
  - Prova sintètica (eco amb 120 ms de retard i filtre): −65 dB d'eco; només queda un residu curt els primers ~4 s, mentre l'AEC s'adapta. Esdeveniments Tauri: `transcript` (partial/final), `level`, `transcript-done`, `transcript-error`.
  - `screencapturekit` **0.3.6** (Objective-C). Les versions ≥1 compilen un pont Swift que falla amb només les Command Line Tools (sense Xcode).
  - Permís «Gravació de pantalla i àudio del sistema»: en dev el demana el terminal des d'on s'executa; empaquetada, la pròpia app.
  - Windows (pendent): loopback WASAPI.
- **Desar l'àudio** (`recorder.rs`): Ogg/Opus 16 kHz; mono 16 kbps (~7 MB/h) amb una font, **estèreo 24 kbps (~11 MB/h) amb micròfon (esquerra, ja sense eco) + sistema (dreta)**. La transcripció de l'àudio descomprimit és pràcticament idèntica a l'original. Fitxer a `<app_data_dir>/recordings/<meeting_id>.ogg`. Opus es compila amb cmake (`brew install cmake`).
- **Configuració** (`SettingsDialog.tsx`, ⌘,): Àudio (micròfon, àudio del sistema, desar l'àudio) i Transcripció (màxim de parlants, separació de veus). Es desa a `localStorage` (`transcriptor.settings.v1`) i es passa a `start_recording`.
- **Notes** (`NotesPanel.tsx`, `lib/notes.ts`): editor Tiptap 3 (títols 1–3, negreta, cursiva, subratllat, ratllat, llistes, tasques; dreceres Markdown en escriure). Es desa com a JSON de Tiptap (`meeting.notesDoc`) perquè **cada bloc porta `attrs.t`** (minut de la reunió en què s'hi va escriure; `keepOnSplit: false`). Exportació a Markdown pròpia (`docToMarkdown`). Les marques a la transcripció surten de `notesFromDoc`.
- **Dependència**: totes les versions 2.x de `zip` estan retirades de crates.io; `Cargo.toml` fa `[patch.crates-io]` a l'etiqueta git v2.6.1 (la demana `sherpa-onnx-sys`).
- **Models en dev**: `models_dir()` llegeix `TRANSCRIPTOR_MODELS` o `../../models`. Pendent: directori de dades de l'app + pantalla de primera obertura amb descàrrega.
- **Interfície** (`src/`): shadcn/ui (Radix, preset Nova) amb tokens natius de macOS a `src/index.css`; font del sistema; mode fosc segons el sistema. Finestra amb `titleBarStyle: Overlay` (semàfors sobre la barra lateral) i `data-tauri-drag-region` a la barra d'eines.
  - Panell de notes: amaga/mostra des de la barra d'eines (únic botó), **redimensionable** arrossegant la vora esquerra (doble clic restableix; fletxes del teclat), i **mode complet** que amaga la transcripció. Es recorda a `localStorage` (`transcriptor.notesLayout.v1`).
  - En producció es bloqueja el menú contextual del web fora del text editable; l'inspector només existeix en builds `dev`.
  - Edició inline amb `<textarea>` que creix, **no** `contentEditable` (amb React duplicava text).
  - **Persistència**: una reunió = un JSON a `<app_data_dir>/meetings/<id>.json` (`storage.rs`, escriptura atòmica). La UI desa amb retard d'1,5 s (immediat en canvis d'estat). Les reunions antigues de `localStorage` es migren soles; en un navegador sense Tauri es fa servir `localStorage`.
  - **Exportació** (`lib/export.ts`): Markdown i Word (`docx`, carregat a demanda), notes primer i després la transcripció. Diàleg natiu de desar (plugin dialog) + ordre `write_export`.
  - **Eliminar** una reunió (menú del títol, confirmació nativa) esborra també el seu àudio.
- Disseny de referència a Superdesign (`.superdesign/design-system.md`, `.superdesign/resume.json`).

## Resultats de la primera reunió real (20 min, 5 parlants)

- `conformer-ca-ctc` (NVIDIA, només català): poc usable en parla espontània.
- `conformer-ca-es-rnnt` (AINA): **el millor dels dos**, entén el canvi de codi català-castellà; RTF 0,02. Sense puntuació ni majúscules; marques mal escrites (WordPress, WooCommerce, Shopify).
- Diarització offline (sherpa-onnx) infravalora els parlants: 5 demanats, gairebé tot repartit en 3. RTF 0,15.
- Directe: ~3% CPU sense parcials, ~32% amb parcials (M4). Amb llindar 0,6 agrupa massa; 0,7 s'acosta a la diarització offline.

## Pendent

El full de ruta viu a **`docs/ROADMAP.md`** (blocs 1–6, amb caselles). Mantén-lo al dia quan es completi una tasca.
