<p align="center">
  <img src="docs/murmur-icon-acid-1024.png" width="112" alt="" />
</p>

<h1 align="center">Murmur</h1>

<p align="center">
  Transcripció de reunions que no surt mai del teu Mac.<br />
  En català, castellà i anglès, en directe i amb qui diu què.
</p>

<p align="center">
  <a href="https://github.com/quicodomingo/murmur-releases/releases/latest">Descarrega-la per a macOS</a> ·
  <a href="README.md">English</a>
</p>

![Murmur transcrivint una reunió en directe, en mode clar i fosc](docs/design/screens/negre-i-acid/1-reunio-en-directe.png)

Murmur és una app per a Mac que transcriu les reunions mentre passen. Tot funciona a l'ordinador i cap àudio va a cap servidor. També distingeix qui parla i et deixa prendre notes lligades al moment en què les escrius. En acabar, pot escriure un resum amb les decisions i les tasques.

Va néixer per a reunions en **català**, on la majoria de serveis de transcripció fallen. Sobretot quan la gent passa del català al castellà dins de la mateixa frase.

## Què fa

- **Transcripció en directe** en català, en castellà, en català i castellà barrejats o en anglès.
- **El micròfon i la trucada, per separat.** Murmur grava el micròfon i l'àudio del sistema (Zoom, Meet, Teams…) en dos canals i n'elimina l'eco. Per això funciona també amb altaveus, no només amb auriculars. Només captura l'àudio, mai la pantalla.
- **Parlants.** Les veus s'agrupen en directe. En acabar, una segona passada per tota la gravació comprova qui ha dit cada cosa. Pots canviar «Parlant 1» pel nom real o triar-lo entre els convidats de l'esdeveniment del calendari.
- **Passada final amb Whisper.** Quan la reunió és en una sola llengua, Whisper large-v3-turbo la torna a escoltar quan atures la gravació. Reescriu el text amb puntuació, majúscules i noms propis. No toca les frases que hagis corregit a mà.
- **Notes** amb títols, llistes i caselles. Cada bloc recorda el minut en què es va escriure i surt al costat de la transcripció.
- **Portada de la reunió**, opcional. Té títol, resum, to, decisions i tasques, i l'escriu un model de llenguatge local (Gemma 4 E4B). Les tasques es poden marcar, editar i assignar.
- **Calendari.** Murmur t'avisa dos minuts abans que comenci una reunió, i la gravació agafa el títol i els convidats de l'esdeveniment. Funciona amb qualsevol calendari afegit a macOS: iCloud, Google o Exchange.
- **Cerca** a totes les reunions. Exportació a Markdown, Word, PDF i àudio (.m4a).
- **Interfície** en català, castellà i anglès, amb tres temes de color i mode clar i fosc.

## Privadesa

- Tot es fa al Mac: el reconeixement de veu, els parlants, Whisper i el model del resum.
- Murmur només es connecta a internet en dos casos:
  - Per descarregar models, la primera vegada i quan actives una funció opcional.
  - Per buscar actualitzacions. Aquesta comprovació es pot desactivar.
- Les reunions es desen en una base de dades SQLite local. L'àudio només es desa si ho actives.
- Per gravar una reunió cal el consentiment de tothom que hi participa. Murmur t'ho recorda en començar.

## Requisits

- Un Mac amb Apple Silicon (M1 o posterior) i **macOS 14.2** o posterior.
- 8 GB de memòria. Per a la portada se'n recomanen 16.
- Uns 600 MB de disc per als models bàsics. Els opcionals n'ocupen més: anglès, 458 MB; Whisper, 574 MB; Gemma, 5,2 GB.

## Instal·lació

Descarrega l'últim `.dmg` de [Releases](https://github.com/quicodomingo/murmur-releases/releases/latest) i arrossega Murmur a Aplicacions. L'app està signada i notaritzada per Apple, i s'actualitza sola.

El primer cop que l'obres, Murmur descarrega els models de veu i et demana aquests permisos:

- **Micròfon.**
- **Gravació d'àudio del sistema**, per sentir l'altra banda de la trucada.
- **Calendari**, opcional.
- **Gravació de pantalla**, només si vols fer captures d'una pantalla compartida.

## Models

| Què | Model | De | Llicència |
|---|---|---|---|
| Català i castellà, en directe | Conformer-Transducer ca-es | Projecte AINA (BSC), a partir d'NVIDIA | CC BY 4.0 |
| Anglès, en directe | Parakeet TDT-CTC 110M | NVIDIA | CC BY 4.0 |
| Passada final | Whisper large-v3-turbo (whisper.cpp) | OpenAI | MIT |
| Detecció de veu | Silero VAD | Silero | MIT |
| Parlants, en directe | TitaNet small | NVIDIA NeMo | Apache 2.0 |
| Parlants, passada final | pyannote segmentation 3.0 + ERes2Net | pyannote, 3D-Speaker | MIT, Apache 2.0 |
| Portada i resum | Gemma 4 E4B | Google | Apache 2.0 |

La veu i els parlants funcionen amb [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). Whisper funciona amb [whisper.cpp](https://github.com/ggml-org/whisper.cpp), i Gemma amb [llama.cpp](https://github.com/ggml-org/llama.cpp). Tots dos fan servir Metal.

## Compilar-la

Necessites:

- [Rust](https://rustup.rs).
- Node.js 20 o posterior.
- Les Command Line Tools de Xcode.
- CMake (`brew install cmake`).

```bash
git clone https://github.com/quicodomingo/murmur.git
cd murmur/app
npm install
npm run tauri dev
```

`tauri dev` també compila `murmur-whisper`, el procés a part que fa córrer Whisper. Els models es descarreguen en obrir l'app per primer cop, a `models/`, a l'arrel del repositori.

Altres ordres útils:

```bash
# L'app amb un WAV (16 kHz) en lloc del micròfon, al ritme real
TRANSCRIPTOR_SIMULATE=../data/reunio.wav npm run tauri dev

# El motor en directe sense interfície
cd src-tauri && cargo run --release --example simulate -- ../../data/reunio.wav

# Tests i comprovacions
cd src-tauri && cargo test
cd app && npx tsc --noEmit && npm run check-locales
```

`app/scripts/release.sh` compila una versió signada i notaritzada. Cal un Developer ID d'Apple. Ho explica [docs/PUBLICAR.md](docs/PUBLICAR.md).

## Estructura del repositori

| Carpeta | Què hi ha |
|---|---|
| `app/` | L'app: interfície en React (`src/`), motor en Rust (`src-tauri/`) i procés de Whisper (`whisper/`) |
| `bench/` | Banc de proves en Python per triar els models (WER, factor de temps real, encerts de parlants) |
| `mvp/` | El primer prototip, en Python amb interfície web. Es manté com a referència |
| `tools/` | Scripts per exportar els models de NeMo a ONNX |
| `docs/` | Full de ruta, sistema de disseny, traduccions i guia per publicar |

`CLAUDE.md` explica l'arquitectura en detall.

## Traduccions

La interfície està en català, castellà i anglès. Els textos són a `app/src/locales/<idioma>/`. Per corregir una traducció o afegir un idioma, mira [docs/TRADUCCIONS.md](docs/TRADUCCIONS.md).

## Full de ruta

Els propers passos són aquests:

- Suport per a Windows.
- Triar l'idioma per a cada reunió.
- Un vocabulari propi per a noms i marques.
- Millorar la detecció de parlants.

La llista completa és a [docs/ROADMAP.md](docs/ROADMAP.md).

## Col·laborar

Els *issues* i les *pull requests* són benvinguts. Ens són especialment útils les gravacions de reunions reals amb una transcripció feta a mà, perquè serveixen per mesurar la precisió. Comparteix-les només si tothom qui hi surt hi està d'acord.

## Llicència

Pendent de decidir.
