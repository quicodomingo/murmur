<p align="center">
  <img src="docs/murmur-icon-acid-1024.png" width="112" alt="" />
</p>

<h1 align="center">Murmur</h1>

<p align="center">
  Transcripción de reuniones que nunca sale de tu Mac.<br />
  En catalán, castellano e inglés, en directo y sabiendo quién habla.
</p>

<p align="center">
  <a href="https://github.com/quicodomingo/murmur-releases/releases/latest">Descargar para macOS</a> ·
  <a href="README.md">English</a> ·
  <a href="README.ca.md">Català</a>
</p>

![Murmur transcribiendo una reunión en directo, en modo claro y oscuro](docs/design/screens/negre-i-acid/1-reunio-en-directe.png)

Murmur es una app para Mac que transcribe tus reuniones mientras ocurren. Todo funciona en tu ordenador, y ningún audio va a ningún servidor. También distingue quién habla y te deja tomar notas y capturas de pantalla ligadas al momento en que las haces. Al terminar, puede escribir una portada con el resumen, el tono, las decisiones y las tareas.

Nació para reuniones en **catalán**, donde la mayoría de servicios de transcripción fallan. Sobre todo cuando la gente pasa del catalán al castellano dentro de la misma frase.

## Qué hace

- **Transcripción en directo** en catalán, en castellano, en catalán y castellano mezclados o en inglés.
- **El micrófono y la llamada, por separado.** Murmur graba el micrófono y el audio del sistema (Zoom, Meet, Teams…) en dos canales y elimina el eco. Por eso funciona también con altavoces, no solo con auriculares. Nunca graba la pantalla: solo hace una captura cuando tú la pides.
- **Hablantes.** Las voces se agrupan en directo. Al terminar, una segunda pasada por toda la grabación comprueba quién ha dicho cada cosa. Puedes cambiar «Hablante 1» por el nombre real o elegirlo entre los invitados del evento del calendario.
- **Pasada final con Whisper.** Cuando la reunión es en una sola lengua, Whisper large-v3-turbo la vuelve a escuchar cuando detienes la grabación. Reescribe el texto con puntuación, mayúsculas y nombres propios. No toca las frases que hayas corregido a mano.
- **Barra flotante mientras grabas.** Una píldora pequeña en el borde de la pantalla se queda delante de la llamada. Muestra el nivel del audio, vuelve a abrir Murmur, detiene la grabación y hace capturas de la pantalla compartida. Cada captura queda ligada al momento de la conversación: aparece junto a lo que se estaba diciendo y dentro de la parte correspondiente de la portada. Si haces clic en la píldora, Murmur se convierte en una ventana estrecha de notas al lado de la llamada.
- **Notas** con títulos, listas y casillas. Cada bloque recuerda el minuto en que se escribió y aparece junto a la transcripción.
- **Portada de la reunión**, opcional. Tiene título, resumen, tono, decisiones y tareas, y la escribe un modelo de lenguaje local (Gemma 4 E4B). Las tareas se pueden marcar, editar y asignar.
- **Calendario.** Murmur te avisa dos minutos antes de que empiece una reunión, y la grabación toma el título y los invitados del evento. Funciona con cualquier calendario añadido a macOS: iCloud, Google o Exchange.
- **Búsqueda** en todas las reuniones, y exportación a Markdown, Word, PDF y audio (.m4a).
- **Interfaz** en catalán, castellano e inglés, con tres temas de color y modo claro y oscuro.

## Privacidad

- Todo se hace en el Mac: el reconocimiento de voz, los hablantes, Whisper y el modelo del resumen.
- Murmur solo se conecta a internet para descargar modelos (la primera vez, y cuando activas una función opcional) y para buscar actualizaciones. Esta comprobación se puede desactivar.
- Las reuniones se guardan en una base de datos SQLite local. El audio solo se guarda si lo activas.
- Para grabar una reunión hace falta el consentimiento de todas las personas que participan. Murmur te lo recuerda al empezar.

## Requisitos

- Un Mac con Apple Silicon (M1 o posterior) y **macOS 14.2** o posterior.
- 8 GB de memoria. Para la portada se recomiendan 16.
- Unos 600 MB de disco para los modelos básicos. Los opcionales ocupan más: inglés, 458 MB; Whisper, 574 MB; Gemma, 5,2 GB.

## Instalación

Descarga el último `.dmg` de [Releases](https://github.com/quicodomingo/murmur-releases/releases/latest) y arrastra Murmur a Aplicaciones. La app está firmada y notarizada por Apple, y se actualiza sola.

La primera vez que la abres, Murmur descarga los modelos de voz y te pide estos permisos:

- **Micrófono.**
- **Grabación de audio del sistema**, para oír el otro lado de la llamada.
- **Calendario**, opcional.
- **Grabación de pantalla**, solo si quieres hacer capturas de una pantalla compartida.

## Modelos

| Qué | Modelo | De | Licencia |
|---|---|---|---|
| Catalán y castellano, en directo | Conformer-Transducer ca-es | Projecte AINA (BSC), a partir de NVIDIA | CC BY 4.0 |
| Inglés, en directo | Parakeet TDT-CTC 110M | NVIDIA | CC BY 4.0 |
| Pasada final | Whisper large-v3-turbo (whisper.cpp) | OpenAI | MIT |
| Detección de voz | Silero VAD | Silero | MIT |
| Hablantes, en directo | TitaNet small | NVIDIA NeMo | Apache 2.0 |
| Hablantes, pasada final | pyannote segmentation 3.0 + ERes2Net | pyannote, 3D-Speaker | MIT, Apache 2.0 |
| Portada y resumen | Gemma 4 E4B | Google | Apache 2.0 |

La voz y los hablantes funcionan con [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). Whisper funciona con [whisper.cpp](https://github.com/ggml-org/whisper.cpp), y Gemma con [llama.cpp](https://github.com/ggml-org/llama.cpp). Los dos usan Metal.

## Compilarla

Necesitas [Rust](https://rustup.rs), Node.js 20 o posterior, las Command Line Tools de Xcode y CMake (`brew install cmake`).

```bash
git clone https://github.com/quicodomingo/murmur.git
cd murmur/app
npm install
npm run tauri dev
```

`tauri dev` también compila `murmur-whisper`, el proceso aparte que ejecuta Whisper. Los modelos se descargan la primera vez que abres la app, en `models/`, en la raíz del repositorio.

Otros comandos útiles:

```bash
# La app con un WAV (16 kHz) en lugar del micrófono, a ritmo real
TRANSCRIPTOR_SIMULATE=../data/reunion.wav npm run tauri dev

# El motor en directo sin interfaz
cd src-tauri && cargo run --release --example simulate -- ../../data/reunion.wav

# Tests y comprobaciones
cd src-tauri && cargo test
cd app && npx tsc --noEmit && npm run check-locales
```

`app/scripts/release.sh` compila una versión firmada y notarizada. Hace falta un Developer ID de Apple. Lo explica [docs/PUBLICAR.md](docs/PUBLICAR.md) (en catalán).

## Estructura del repositorio

| Carpeta | Qué hay |
|---|---|
| `app/` | La app: interfaz en React (`src/`), motor en Rust (`src-tauri/`) y proceso de Whisper (`whisper/`) |
| `bench/` | Banco de pruebas en Python para elegir los modelos (WER, factor de tiempo real, aciertos de hablantes) |
| `mvp/` | El primer prototipo, en Python con interfaz web. Se mantiene como referencia |
| `tools/` | Scripts para exportar los modelos de NeMo a ONNX |
| `docs/` | Hoja de ruta, sistema de diseño, traducciones y guía para publicar (en catalán) |

`CLAUDE.md` explica la arquitectura en detalle. Está en catalán.

## Traducciones

La interfaz está en catalán, castellano e inglés. Los textos están en `app/src/locales/<idioma>/`. Para corregir una traducción o añadir un idioma, consulta [docs/TRADUCCIONS.md](docs/TRADUCCIONS.md).

## Hoja de ruta

Los próximos pasos son el soporte para Windows, elegir el idioma de cada reunión, un vocabulario propio para nombres y marcas, y mejorar la detección de hablantes. La lista completa está en [docs/ROADMAP.md](docs/ROADMAP.md).

## Colaborar

Los *issues* y las *pull requests* son bienvenidos. Nos son especialmente útiles las grabaciones de reuniones reales con una transcripción hecha a mano, porque sirven para medir la precisión. Compártelas solo si todas las personas que aparecen están de acuerdo.

## Licencia

Pendiente de decidir.
