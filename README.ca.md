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
  <a href="README.md">English</a> ·
  <a href="README.es.md">Español</a>
</p>

![Murmur transcrivint una reunió en directe, en mode clar i fosc](docs/design/screens/negre-i-acid/1-reunio-en-directe.png)

Murmur és una app per a Mac que transcriu les reunions mentre passen. Tot funciona a l'ordinador, i cap àudio va a cap servidor. També distingeix qui parla i et deixa prendre notes i captures de pantalla lligades al moment en què les fas. En acabar, pot escriure un resum amb el to, les decisions i les tasques. El pots compartir amb un enllaç o desar-lo en Markdown a la teva carpeta.

Va néixer per a reunions en **català**, on la majoria de serveis de transcripció fallen. Sobretot quan la gent passa del català al castellà dins de la mateixa frase.

## Què fa

- **Transcripció en directe** en català, en castellà, en català i castellà barrejats o en anglès. En començar tries l'idioma i si hi ha més gent a la sala, i més endavant pots tornar a transcriure una reunió en un altre idioma.
- **El micròfon i la trucada, per separat.** Murmur grava el micròfon i l'àudio del sistema (Zoom, Meet, Teams…) en dos canals i n'elimina l'eco. Per això funciona també amb altaveus, no només amb auriculars. Mai no grava la pantalla: només en fa una captura quan tu la demanes.
- **Parlants.** Les veus s'agrupen en directe. En acabar, una segona passada per tota la gravació comprova qui ha dit cada cosa. Pots canviar «Parlant 1» pel nom real o triar-lo entre els convidats de l'esdeveniment del calendari.
- **Passada final amb Whisper.** Quan la reunió és en una sola llengua, Whisper large-v3-turbo la torna a escoltar quan atures la gravació. Reescriu el text amb puntuació, majúscules i noms propis. No toca les frases que hagis corregit a mà.
- **Glossari.** Afegeix-hi els noms, les marques i les sigles que la transcripció escriu malament (WordPress, Softcatalà, el nom d'un client) i Murmur els escriurà bé, en directe i en acabar. Quan corregeixes un nom a mà, et proposa afegir-lo.
- **Barra flotant mentre graves.** Una píndola petita a la vora de la pantalla queda al davant de la trucada. Mostra el nivell de l'àudio, torna a obrir Murmur, atura la gravació i fa captures de la pantalla compartida. Cada captura queda lligada al moment de la conversa: surt al costat del que s'estava dient i dins la part corresponent del resum. Si cliques la píndola, Murmur es converteix en una finestra estreta de notes al costat de la trucada.
- **Transcriure des d'un fitxer.** Fitxer › Transcriu des d'un fitxer… (⌘O) converteix un mp3, m4a, wav, ogg o qualsevol altre àudio en una reunió, amb els parlants i la passada final. Murmur endevina sol en quin idioma és. També hi pots enviar un àudio des del menú Compartir d'altres apps, amb Finder › Obre amb o deixant-lo anar a la finestra o a la icona del Dock.
- **Connector per a Claude**, opcional. Claude Desktop i Claude Code poden llegir i cercar les teves reunions i transcriure àudios amb Murmur, al teu Mac. S'activa a Configuració › Claude.
- **Notes** amb títols, llistes i caselles. Cada bloc recorda el minut en què es va escriure i surt al costat de la transcripció. Amb ⌘+ i ⌘− fas més gran o més petit el text de les notes.
- **Resum de la reunió**, opcional. Té títol, resum, to, decisions i tasques, i l'escriu un model de llenguatge local (Gemma 4 E4B). Les tasques es poden marcar, editar i assignar. Si ho prefereixes, el pot escriure Claude o OpenAI amb la teva clau: només s'hi envia el text, mai l'àudio.
- **Etiquetes** per ordenar les reunions. Les pots filtrar a la barra lateral i cercar-les, i amb el clic dret les reanomenes, les ajuntes o les esborres.
- **Calendari.** Murmur t'avisa dos minuts abans que comenci una reunió, i la gravació agafa el títol i els convidats de l'esdeveniment. Funciona amb qualsevol calendari afegit a macOS: iCloud, Google o Exchange.
- **Compartir amb un enllaç.** Tries què hi surt (resum, notes, transcripció, captures, àudio), quan caduca l'enllaç i si porta contrasenya. Murmur ho xifra al Mac i ho publica al teu compte de Cloudflare, que és gratuït i es configura des de l'app.
- **Markdown a la teva carpeta.** Tria una carpeta i Murmur hi desa el resum, les notes i la transcripció de cada reunió quan acaba. Mentre graves, ho pots activar o desactivar per a aquella reunió.
- **Cerca** a totes les reunions, i exportació a Markdown, Word, PDF, àudio (.m4a) i captures.
- **Interfície** en català, castellà i anglès, amb tres temes de color i mode clar i fosc.

## Privadesa

- Tot es fa al Mac: el reconeixement de veu, els parlants, Whisper i el model del resum. Escriure el resum amb Claude o OpenAI és opcional, fa servir la teva clau (desada al clauer de macOS) i només hi envia text.
- Murmur només es connecta a internet per descarregar models (el primer cop, i quan actives una funció opcional) i per buscar actualitzacions. Aquesta comprovació es pot desactivar. Les reunions compartides es xifren al Mac abans de sortir-ne, i només les pot llegir qui té l'enllaç. Amb el connector per a Claude activat, Claude rep el text que demana, mai l'àudio.
- Les reunions es desen en una base de dades SQLite local. L'àudio només es desa si ho actives.
- Per gravar una reunió cal el consentiment de tothom que hi participa. Murmur t'ho recorda en començar.

## Requisits

- Un Mac amb Apple Silicon (M1 o posterior) i **macOS 14.2** o posterior.
- 8 GB de memòria. Per al resum local se'n recomanen 16.
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
| Resum | Gemma 4 E4B | Google | Apache 2.0 |

La veu i els parlants funcionen amb [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). Whisper funciona amb [whisper.cpp](https://github.com/ggml-org/whisper.cpp), i Gemma amb [llama.cpp](https://github.com/ggml-org/llama.cpp). Tots dos fan servir Metal.

## Compilar-la

Necessites [Rust](https://rustup.rs), Node.js 20 o posterior, les Command Line Tools de Xcode i CMake (`brew install cmake`).

```bash
git clone https://github.com/quicodomingo/murmur.git
cd murmur/app
npm install
npm run tauri dev
```

`tauri dev` també compila `murmur-whisper`, el procés a part que fa córrer Whisper. Els models es descarreguen el primer cop que obres l'app, a `models/`, a l'arrel del repositori.

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

[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) explica com funciona per dins i què s'ha mesurat per decidir-ho, i [CLAUDE.md](CLAUDE.md) té les regles per treballar en el codi (per a persones i agents de codi).

## Traduccions

La interfície està en català, castellà i anglès. Els textos són a `app/src/locales/<idioma>/`. Per corregir una traducció o afegir un idioma, mira [docs/TRADUCCIONS.md](docs/TRADUCCIONS.md).

## Full de ruta

Els propers passos són el suport per a Windows, un vocabulari propi per a noms i marques, i millorar la detecció de parlants. La llista completa és a [docs/ROADMAP.md](docs/ROADMAP.md).

## Col·laborar

Els *issues* i les *pull requests* són benvinguts. Ens són especialment útils les gravacions de reunions reals amb una transcripció feta a mà, perquè serveixen per mesurar la precisió. Comparteix-les només si tothom qui hi surt hi està d'acord.

## Llicència

Pendent de decidir.
