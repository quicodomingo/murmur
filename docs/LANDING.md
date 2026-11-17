# Landing de descàrrega

Tot el que cal per fer la pàgina de descàrrega de Murmur: el missatge, els textos de cada secció en català, castellà i anglès, les captures que tenim i les que falten. Les dades surten del README, de la versió 0.14.0 i de l'app de l'iPhone (1.0, la fitxa és a [APPSTORE.md](APPSTORE.md)) (les novetats des de la primera versió, i el post del blog, són a [NOVETATS-0.14.md](NOVETATS-0.14.md)); si canvia alguna funcionalitat, s'actualitza aquí també.

## Dades bàsiques

| | |
|---|---|
| Nom | Murmur (sempre amb majúscula al text; el logotip és «murmur» en minúscula) |
| Plataforma | Mac amb Apple Silicon (M1 o posterior) i macOS 14.2 o posterior; Windows 10 i 11 i Linux de 64 bits, amb un processador amb AVX2 (Intel des del 2013, AMD des del 2015), i Windows 11 en PC amb ARM (Snapdragon). iPhone amb iOS 18 o posterior. Ben aviat, iPad i Android |
| Preu | Gratuïta. Codi obert amb llicència MIT |
| Descàrrega | https://github.com/quicodomingo/murmur-releases/releases/latest (els fitxers porten la versió al nom, així que l'enllaç estable és el de la pàgina, no el del fitxer): el `.dmg` del Mac, `Murmur_<versió>_x64-setup.exe` per a Windows (`_arm64-setup.exe` per als PC amb ARM), i el `.deb` i el `.rpm` per a Linux |
| App Store | https://apps.apple.com/app/id6835415829 (sense país: obre la botiga de qui visita). El nom a la botiga és «Murmur - Meeting transcription» en anglès; en català, «Murmur» |
| Codi | https://github.com/quicodomingo/murmur |
| Targeta gràfica | Whisper (la passada final) i el model del resum la fan servir sols, sense configurar res: Metal al Mac, i Vulkan a Windows x64 i a Linux (NVIDIA, AMD o Intel). Als PC amb ARM, de moment, el processador. La transcripció en directe sempre va pel processador |
| Signatura | Al Mac, signada i notaritzada per Apple. A Windows, l'instal·lador encara no està signat (SmartScreen avisa el primer cop). S'actualitza sola a tot arreu |
| Idiomes de les reunions | Català (central, valencià i balear), castellà, català i castellà barrejats, anglès |
| Idiomes de la interfície | Català, castellà, anglès |
| Icona | `docs/murmur-icon-acid-1024.png` (i les variants de `docs/design/`) |
| Colors i tipografia | [`docs/design/DESIGN.md`](design/DESIGN.md). L'àcid (#D4FF3A) mai és text ni línia sobre fons clar |

## El missatge

Una idea central: **transcriu les reunions al teu ordinador, en català, sense enviar res enlloc.** Tres arguments la sostenen, per aquest ordre:

1. **Privat de debò.** L'àudio no surt mai de l'ordinador. Sense compte i sense subscripció.
2. **Fet per al català.** Entén el català, el castellà i les dues llengües barrejades dins la mateixa frase, que és on fallen els altres.
3. **No només transcriu.** Sap qui parla, hi pots prendre notes i captures, i en acabar et deixa el resum, les decisions i les tasques.

## Textos per seccions

### 1. Capçalera

| | Català | Castellà | Anglès |
|---|---|---|---|
| Titular | Les teves reunions, transcrites al teu ordinador. | Tus reuniones, transcritas en tu ordenador. | Your meetings, transcribed on your computer. |
| Subtítol | En català, castellà i anglès, en directe i amb qui diu què. Res surt de l'ordinador. | En catalán, castellano e inglés, en directo y con quién dice qué. Nada sale del ordenador. | In Catalan, Spanish and English, live, with who said what. Nothing leaves your computer. |
| Botó (segons el sistema de qui visita) | Descarrega per a Mac / per a Windows / per a Linux | Descargar para Mac / para Windows / para Linux | Download for Mac / for Windows / for Linux |
| Sota el botó | Gratuïta · Mac, Windows i Linux | Gratis · Mac, Windows y Linux | Free · Mac, Windows and Linux |
| Enllaç al costat (a l'App Store) | També per a iPhone | También para iPhone | Also on iPhone |
| Enllaç sota el botó | Altres sistemes | Otros sistemas | Other platforms |

Captura: `01-reunio` (o `02-reunio-fosc` si la pàgina és fosca).

**Si qui visita fa servir un iPhone**, el botó gran no pot ser el de descàrrega de l'ordinador: hi va la insígnia «Baixa-la a l'App Store», i a sota «Murmur també és per a Mac, Windows i Linux» amb l'enllaç a la secció de descàrrega. Es detecta pel navegador (`/iPhone/` a `navigator.userAgent`), igual que ara es tria Mac, Windows o Linux. A Safari de l'iPhone, a més, el bàner de l'App Store surt sol amb aquesta línia al `<head>`:

```html
<meta name="apple-itunes-app" content="app-id=6835415829">
```

#### Quin instal·lador de Windows

A Windows hi ha dos instal·ladors: `_x64-setup.exe` (Intel i AMD, gairebé tots els PC) i `_arm64-setup.exe` (PC amb ARM, com els Snapdragon dels Surface i els Copilot+ PC). La targeta gràfica no cal triar-la: l'app la detecta sola en obrir-se (vegeu «Fa servir la targeta gràfica?» a les preguntes freqüents). El botó «Descarrega per a Windows» ha de donar el que toca sense preguntar res:

- **Edge i Chrome** diuen si el PC és ARM amb `navigator.userAgentData.getHighEntropyValues(["architecture"])`, que torna `"arm"` o `"x86"`. Firefox i la resta no ho diuen: llavors, l'x64.
- **Si no se sap, l'x64.** En un PC amb ARM també funciona, emulat i més a poc a poc. L'ARM, en canvi, no s'instal·la en un PC x64.
- **Els fitxers porten la versió al nom**, així que l'enllaç directe surt de l'API de GitHub (sense clau, fins a 60 consultes per hora i visitant). Si falla, es porta a la pàgina de la release.
- Les actualitzacions mantenen l'arquitectura: cadascú rep sempre l'instal·lador que ja té.

```js
const RELEASES = "https://github.com/quicodomingo/murmur-releases/releases/latest";

async function windowsDownload() {
  let arm = false;
  try {
    const { architecture } = await navigator.userAgentData.getHighEntropyValues(["architecture"]);
    arm = architecture === "arm";
  } catch {} // Firefox, Safari: no ho diuen, x64
  try {
    const res = await fetch("https://api.github.com/repos/quicodomingo/murmur-releases/releases/latest");
    const { assets } = await res.json();
    const file = assets.find((a) => a.name.endsWith(arm ? "_arm64-setup.exe" : "_x64-setup.exe"));
    if (file) return file.browser_download_url;
  } catch {}
  return RELEASES;
}
```

A «Altres sistemes» hi han de sortir tots dos, per a qui vulgui triar:

| | Català | Castellà | Anglès |
|---|---|---|---|
| x64 | Windows (Intel i AMD) | Windows (Intel y AMD) | Windows (Intel and AMD) |
| ARM | Windows amb ARM (Snapdragon) | Windows con ARM (Snapdragon) | Windows on ARM (Snapdragon) |

### 2. Per al català

| Català | Castellà | Anglès |
|---|---|---|
| **Va néixer per a reunions en català.** La majoria de serveis de transcripció s'equivoquen quan la gent passa del català al castellà dins la mateixa frase. Murmur fa servir un model entrenat per a totes dues llengües alhora. I quan la reunió és en una sola llengua, en acabar Whisper la torna a escoltar per posar-hi la puntuació i els noms propis. En català, ho fa un Whisper del Barcelona Supercomputing Center, que entén igual de bé el central, el valencià i el balear. | **Nació para reuniones en catalán.** La mayoría de servicios de transcripción se equivocan cuando la gente pasa del catalán al castellano en la misma frase. Murmur usa un modelo entrenado para las dos lenguas a la vez. Y cuando la reunión es en una sola lengua, al terminar Whisper la vuelve a escuchar para poner la puntuación y los nombres propios. En catalán, lo hace un Whisper del Barcelona Supercomputing Center, que entiende igual de bien el central, el valenciano y el balear. | **Built for meetings in Catalan.** Most transcription services trip up when people switch between Catalan and Spanish mid-sentence. Murmur uses a model trained on both languages at once. It works in English too, and when a meeting is in a single language, Whisper listens again at the end to add punctuation and proper names. In Catalan, that's a Whisper by the Barcelona Supercomputing Center, which handles Central, Valencian and Balearic Catalan equally well. |

### 3. Com funciona (tres passos)

| | Català | Castellà | Anglès |
|---|---|---|---|
| 1 | **Grava.** Murmur escolta el micròfon i la trucada (Zoom, Meet, Teams…) per separat, també amb altaveus. | **Graba.** Murmur escucha el micrófono y la llamada (Zoom, Meet, Teams…) por separado, también con altavoces. | **Record.** Murmur listens to your mic and the call (Zoom, Meet, Teams…) separately, even on speakers. |
| 2 | **Llegeix-la en directe.** La transcripció apareix mentre parleu, separada per parlants. Hi pots prendre notes i captures de la pantalla compartida. | **Léela en directo.** La transcripción aparece mientras habláis, separada por hablantes. Puedes tomar notas y capturas de la pantalla compartida. | **Read it live.** The transcript appears as you talk, split by speaker. Take notes and screenshots of the shared screen as you go. |
| 3 | **Endu-te'n el resum.** En acabar, un model local escriu el resum, les decisions i les tasques, cadascuna enllaçada al moment de la reunió. | **Llévate el resumen.** Al terminar, un modelo local escribe el resumen, las decisiones y las tareas, cada una enlazada al momento de la reunión. | **Take away the summary.** When it ends, a local model writes the summary, decisions and tasks, each linked to its moment in the meeting. |

Captures: `01-reunio` per als passos 1 i 2, `03-resum` o `05-resum-sencer` per al 3.

### 4. Funcionalitats

Vuit blocs. Cadascun amb un títol i una o dues frases; el detall és al README.

| Bloc | Català | Castellà | Anglès | Captura |
|---|---|---|---|---|
| Parlants | **Qui diu què.** Les veus s'agrupen en directe i es comproven en acabar. Posa-hi noms, o tria'ls entre els convidats del calendari. | **Quién dice qué.** Las voces se agrupan en directo y se comprueban al terminar. Ponles nombre, o elígelos entre los invitados del calendario. | **Who said what.** Voices are grouped live and checked again at the end. Name them, or pick from the calendar guests. | `01-reunio` |
| La teva veu i presentacions | **Et reconeix.** Llegeix una frase i Murmur et marcarà com a «Tu» a totes les reunions; l'empremta es queda a l'ordinador. A la sala, n'hi ha prou amb dir «Murmur, sóc la Marta». | **Te reconoce.** Lee una frase y Murmur te marcará como «Tú» en todas las reuniones; la huella se queda en el ordenador. En la sala, basta con decir «Murmur, soy Marta». | **It knows your voice.** Read one sentence and Murmur marks you as "You" in every meeting; the voiceprint stays on your computer. In the room, just say "Murmur, I'm Marta". | `20-la-teva-veu`, `21-presenta-te` |
| Notes | **Notes lligades al moment.** Títols, llistes, caselles i sagnats. Cada nota recorda el minut en què la vas escriure, i les captures de pantalla queden al costat del que es deia. | **Notas ligadas al momento.** Títulos, listas, casillas y sangrías. Cada nota recuerda el minuto en que la escribiste, y las capturas quedan junto a lo que se decía. | **Notes tied to the moment.** Headings, lists, checkboxes and indents. Each note remembers the minute you wrote it, and screenshots sit next to what was being said. | `01-reunio` |
| Resum | **El resum, les decisions i les tasques.** Amb el to de la reunió, qui ha parlat i quant, i les parts amb les captures. El fa un model local; si vols, Claude o OpenAI amb la teva clau. | **El resumen, las decisiones y las tareas.** Con el tono de la reunión, quién ha hablado y cuánto, y las partes con las capturas. Lo hace un modelo local; si quieres, Claude u OpenAI con tu clave. | **Summary, decisions and tasks.** With the meeting's tone, who spoke and for how long, and its parts with the screenshots. A local model writes it; or Claude or OpenAI with your own key. | `03-resum`, `05-resum-sencer` |
| Traducció | **En una altra llengua.** Tradueix la transcripció al català, al castellà o a l'anglès, i tria en quina llengua vols el resum. L'original no es toca. | **En otra lengua.** Traduce la transcripción al catalán, al castellano o al inglés, y elige en qué lengua quieres el resumen. El original no se toca. | **In another language.** Translate the transcript into Catalan, Spanish or English, and choose the summary's language. The original stays as it was. | Falta |
| Calendari | **Sap quan comença la reunió.** T'avisa dos minuts abans i la gravació agafa el títol i els convidats. iCloud, Google o Exchange, a través del Calendari de macOS (de moment, només al Mac). | **Sabe cuándo empieza la reunión.** Te avisa dos minutos antes y la grabación toma el título y los invitados. iCloud, Google o Exchange, a través del Calendario de macOS. | **Knows when your meeting starts.** It alerts you two minutes before, and the recording takes the event's title and guests. iCloud, Google or Exchange, via macOS Calendar. | Falta (vegeu més avall) |
| Compartir i exportar | **Comparteix-la o endu-te-la.** Un enllaç xifrat al teu compte gratuït de Cloudflare, amb caducitat i contrasenya si vols. O Word, PDF, Markdown a la teva carpeta, subtítols, àudio i captures. | **Compártela o llévatela.** Un enlace cifrado en tu cuenta gratuita de Cloudflare, con caducidad y contraseña si quieres. O Word, PDF, Markdown en tu carpeta, subtítulos, audio y capturas. | **Share it or take it with you.** An encrypted link on your free Cloudflare account, with expiry and a password if you like. Or Word, PDF, Markdown to your folder, subtitles, audio and screenshots. | `09-exportar`, `15-exportar-notion-obsidian` |
| Notion i Obsidian | **On ja treballes.** Desa cada reunió a Notion, sense crear cap clau, o com una nota a la teva caixa forta d'Obsidian, amb les tasques i les captures. A mà o sola en acabar. | **Donde ya trabajas.** Guarda cada reunión en Notion, sin crear ninguna clave, o como una nota en tu bóveda de Obsidian, con las tareas y las capturas. A mano o sola al terminar. | **Where you already work.** Save each meeting to Notion, with no key to create, or as a note in your Obsidian vault, with tasks and screenshots. By hand or on its own when it ends. | `16-desat-notion`, `17-desat-obsidian`, `18-configuracio-exportar` |
| Vídeos i subtítols | **Subtitula un vídeo.** Deixa anar un vídeo (mp4, mov, mkv, webm) i Murmur en transcriu el so. Exporta els subtítols en SRT o WebVTT, al costat del vídeo i amb el seu nom. | **Subtitula un vídeo.** Suelta un vídeo (mp4, mov, mkv, webm) y Murmur transcribe su sonido. Exporta los subtítulos en SRT o WebVTT, junto al vídeo y con su nombre. | **Subtitle a video.** Drop a video (mp4, mov, mkv, webm) and Murmur transcribes its sound. Export subtitles as SRT or WebVTT, next to the video and with its name. | Falta |

Funcionalitats més petites, per a una llista o una graella d'icones: cerca a totes les reunions (`10-cerca`), etiquetes, glossari de noms i marques, transcriure un fitxer d'àudio o de vídeo, ajuntar dos parlants, continuar una reunió aturada, connector per a Claude, tres temes amb mode clar i fosc (`06` a `08`).

### 5. A l'iPhone

Una secció pròpia, entre les funcionalitats i la privadesa. La idea: **les reunions de la sala, amb el telèfon damunt la taula**, i l'ordinador que les acaba quan hi tornes. Captura principal: `30-iphone-transcripcio`; si hi cap una tira de dues o tres, `30-iphone-resum` i `30-iphone-notes` al costat.

| | Català | Castellà | Anglès |
|---|---|---|---|
| Etiqueta | Nou · iPhone | Nuevo · iPhone | New · iPhone |
| Titular | Murmur, ara també al telèfon. | Murmur, ahora también en el teléfono. | Murmur, now on your phone too. |
| Text | Deixa l'iPhone damunt la taula i llegeix la reunió mentre parleu, en català i castellà. Es transcriu dins del telèfon, sense connexió, i continua amb la pantalla bloquejada. | Deja el iPhone sobre la mesa y lee la reunión mientras habláis, en catalán y castellano. Se transcribe dentro del teléfono, sin conexión, y sigue con la pantalla bloqueada. | Leave your iPhone on the table and read the meeting as you talk, in Catalan and Spanish. It's transcribed on the phone, offline, and keeps going with the screen locked. |
| Botó | La insígnia oficial «Baixa-la a l'App Store» | La insignia oficial «Descárgalo en el App Store» | The official "Download on the App Store" badge |
| Sota el botó | Gratuïta · iOS 18 o posterior | Gratis · iOS 18 o posterior | Free · iOS 18 or later |

Tres punts al costat de la captura:

| | Català | Castellà | Anglès |
|---|---|---|---|
| 1 | **Qui diu què, també aquí.** Distingeix les veus, et reconeix com a «Tu» i la gent es pot presentar dient «Murmur, sóc la Laia». | **Quién dice qué, también aquí.** Distingue las voces, te reconoce como «Tú» y la gente se puede presentar diciendo «Murmur, soy Laia». | **Who said what, here too.** It tells voices apart, knows you as "You", and people can introduce themselves by saying "Murmur, I'm Laia". |
| 2 | **Notes i fotos al minut.** Escriu notes, fes fotos de la pissarra i marca els moments importants, des de l'app o des de la pantalla bloquejada. | **Notas y fotos en su minuto.** Escribe notas, haz fotos de la pizarra y marca los momentos importantes, desde la app o desde la pantalla bloqueada. | **Notes and photos at their minute.** Write notes, take photos of the whiteboard and mark the key moments, in the app or from the lock screen. |
| 3 | **L'ordinador l'acaba.** Amb Murmur a l'ordinador i a la mateixa xarxa, cada reunió hi passa sola i xifrada, sense cap servidor pel mig. L'ordinador la torna a escoltar amb Whisper, en fa el resum, les decisions i les tasques, i te les torna al telèfon. | **El ordenador la termina.** Con Murmur en el ordenador y en la misma red, cada reunión pasa sola y cifrada, sin ningún servidor por medio. El ordenador la vuelve a escuchar con Whisper, hace el resumen, las decisiones y las tareas, y te las devuelve al teléfono. | **Your computer finishes it.** With Murmur on your computer and on the same network, each meeting goes across on its own, encrypted, with no server in between. The computer listens again with Whisper, writes the summary, decisions and tasks, and sends them back to the phone. |

Coses que cal dir bé, perquè són diferents de l'ordinador:

- **Idiomes:** l'iPhone transcriu en català i castellà (i les dues barrejades). L'anglès, de moment, només a l'ordinador. Per això, a les captures angleses la transcripció és en castellà.
- **El resum el fa l'ordinador**, no el telèfon. L'app funciona sola (transcripció, parlants, notes, cerca), però el resum, les decisions i les tasques arriben quan l'emparelles. Que la landing no prometi resums «al telèfon».
- **Sense compte:** emparellar és llegir un codi QR de Configuració › Mòbil a l'ordinador (des de la 0.16.0).
- **iPad i Android:** «Ben aviat», sense data.

**La insígnia de l'App Store** s'ha de baixar de la pàgina d'Apple (Apple Marketing Tools, *App Store badges*), en català, castellà i anglès, en negre per als fons clars i en blanc per als foscos. Apple no deixa canviar-la (ni colors, ni proporcions, ni el text) i demana un mínim de 40 px d'alçada a la pantalla i un marge al voltant. L'enllaç és el de l'App Store de les dades bàsiques.

### 6. Privadesa

| Català | Castellà | Anglès |
|---|---|---|
| **Tot es queda al teu ordinador.** La veu, els parlants i el resum es processen a l'ordinador. Murmur només es connecta per descarregar els models, buscar actualitzacions i enviar estadístiques d'ús anònimes, que es poden desactivar. Sense compte i sense subscripció. Si comparteixes una reunió, es xifra abans de sortir de l'ordinador. Si connectes Notion, només hi va el text de les reunions que hi desis, directament al teu espai. A l'iPhone, igual: tot es queda al telèfon, i el que passa a l'ordinador hi va directament, per la teva xarxa i xifrat. | **Todo se queda en tu ordenador.** La voz, los hablantes y el resumen se procesan en el ordenador. Murmur solo se conecta para descargar los modelos, buscar actualizaciones y enviar estadísticas de uso anónimas, que se pueden desactivar. Sin cuenta y sin suscripción. Si compartes una reunión, se cifra antes de salir del ordenador. Si conectas Notion, solo le llega el texto de las reuniones que guardes allí, directamente a tu espacio. En el iPhone, igual: todo se queda en el teléfono, y lo que pasa al ordenador va directamente, por tu red y cifrado. | **Everything stays on your computer.** Speech, speakers and the summary are processed on your computer. Murmur only goes online to download models, check for updates and send anonymous usage statistics, which you can turn off. No account, no subscription. If you share a meeting, it's encrypted before it leaves your computer. If you connect Notion, only the text of the meetings you save there goes to it, straight to your own workspace. On the iPhone, the same: it all stays on the phone, and what goes to your computer goes straight there, over your own network, encrypted. |

Nota que ha de sortir a prop: **per gravar una reunió cal el consentiment de tothom que hi participa** (*Grabar una reunión requiere el consentimiento de todos los participantes* / *Recording a meeting requires everyone's consent*).

### 7. Preguntes freqüents

| Pregunta | Resposta |
|---|---|
| És gratuïta? | Sí. És de codi obert, amb llicència MIT. |
| Funciona amb Zoom, Meet o Teams? | Amb qualsevol: Murmur grava l'àudio del sistema, no s'hi connecta. Ningú de la trucada veu cap bot. |
| Cal connexió a internet? | Només el primer cop, per descarregar els models (uns 600 MB), i per buscar actualitzacions. |
| Quanta memòria cal? | En té prou amb 8 GB. Per al resum local se'n recomanen 16; si no, el resum el pot fer Claude o OpenAI amb la teva clau. |
| Funciona a Windows, a Linux o a Macs amb Intel? | A Windows 10 o 11 i a Linux de 64 bits, sí, des de la 0.12, gràcies a @xaviviro (cal un processador amb AVX2: Intel des del 2013, AMD des del 2015). Als PC amb ARM (Snapdragon), amb Windows 11, des de la 0.15. Als Macs amb Intel, no. |
| Fa servir la targeta gràfica? | Sí, sola, per a les dues feines més pesades: la passada final de Whisper i el resum. Al Mac, sempre. A Windows i a Linux, si tens una gràfica NVIDIA, AMD o Intel amb els controladors al dia; si en tens una de dedicada i una d'integrada, fa servir la dedicada. Si no en tens, o el model no hi cap, Murmur fa servir el processador: va més a poc a poc, però funciona igual. La transcripció en directe sempre va pel processador, que no li cal més. |
| Tinc un PC amb Snapdragon. Quin baixo? | La versió per a ARM (`_arm64-setup.exe`); el botó de descàrrega ja te la dona si fas servir Edge o Chrome. La versió per a Intel i AMD també funciona, però emulada i més lenta. De moment, als PC amb ARM tot va pel processador, que és prou ràpid; la gràfica Adreno potser vindrà més endavant. |
| Entén el valencià i el balear? | Sí. En acabar, el Whisper català del BSC torna a escoltar la reunió, i és el millor de les nostres proves amb totes tres variants. |
| Pot transcriure un vídeo? | Sí: mp4, mov, m4v, mkv i webm. Murmur n'agafa només el so, i en pots exportar els subtítols. |
| Què s'envia a Notion? | Només el text de la reunió (resum, notes i transcripció), quan l'exportes o en acabar si ho tens activat. Mai l'àudio ni les captures. |
| Hi ha app per al mòbil? | Sí, per a iPhone, a l'App Store (iOS 18 o posterior). Grava i transcriu sola, sense l'ordinador. iPad i Android vindran ben aviat. |
| Cal l'ordinador per fer servir l'app de l'iPhone? | No. Sola transcriu, distingeix les veus, hi pots prendre notes i fotos i cercar. Si tens Murmur a l'ordinador (0.16 o posterior), l'emparelles amb un codi QR i cada reunió hi passa per refer-la amb Whisper i fer-ne el resum, que torna al telèfon. |
| L'iPhone entén l'anglès? | De moment, l'iPhone transcriu en català i castellà, també barrejats. L'anglès és a l'ordinador. |
| Grava amb la pantalla bloquejada? | Sí. La gravació continua amb la pantalla apagada, i des de la pantalla bloquejada pots marcar un moment, posar-la en pausa o aturar-la. |
| On es desen les reunions? | En una base de dades al teu ordinador. L'àudio només es desa si ho actives. També pots desar cada reunió en Markdown a la carpeta que triïs. |

### 8. Peu

Codi obert (MIT) · GitHub · Windows i Linux gràcies a @xaviviro · amb models del projecte AINA i del BSC, NVIDIA, OpenAI, Softcatalà i Google (la taula de models és al README, amb les llicències).

## Captures

Són de l'app de veritat, amb una reunió d'exemple («Llançament de la web nova», 34 minuts, tres parlants, notes, dues captures de pantalla i resum). A 2880×1800 (finestra de 1440×900 a 2×), en PNG.

Són a `data/captures-landing/`, que no es puja al repositori. Per tornar-les a fer (per exemple, quan canviï la interfície), amb el servidor de Vite engegat al port 8766:

```bash
cd app && npx vite --port 8766          # en un altre terminal
node tools/landing-captures/shoot.mjs data/captures-landing
node tools/landing-captures/shoot.mjs data/captures-landing ca-03   # només les que contenen «ca-03»
```

Les reunions d'exemple són a `tools/landing-captures/seed.mjs`, en els tres idiomes. Obsidian, Notion i la gravació de la veu, que al navegador no hi són, se simulen dins el mateix script (`open(lang, { mock: true })`), i la pestanya Mòbil, que només surt en desenvolupament, s'amaga.

| Fitxer | Idiomes | Què hi surt | On encaixa |
|---|---|---|---|
| `01-reunio` | ca, es, en | Notes al centre i transcripció al costat, amb parlants i una captura de pantalla | Capçalera, Com funciona, Parlants, Notes |
| `02-reunio-fosc` | ca, es, en | El mateix en mode fosc | Capçalera fosca, Temes |
| `03-resum` | ca, es, en | Inici del resum: to, qui ha parlat, resum i decisions | Resum |
| `04-resum-fosc` | ca, es, en | El mateix en mode fosc | Resum |
| `05-resum-sencer` | ca, es, en | El resum sencer, amb tasques, parts i captures (1440×2000) | Resum, en vertical o amb desplaçament |
| `06-tema-mono` | ca | Tema monocrom | Temes |
| `07-tema-formigo` | ca | Tema formigó | Temes |
| `08-tema-formigo-fosc` | ca | Tema formigó fosc | Temes |
| `09-exportar` | ca | El menú Exporta, amb Word › Tot / Resum i notes / Transcripció | Compartir i exportar |
| `10-cerca` | ca | La cerca a totes les reunions, amb els resultats ressaltats | Funcionalitats petites |
| `11-configuracio-*` | ca | Les pestanyes General, Aparença, Calendari, Transcripció, Intel·ligència i Compartir | Si cal ensenyar la configuració (millor no a la capçalera) |
| `12-benvinguda` | ca | La primera pantalla en obrir Murmur | Instal·lació |
| `15-exportar-notion-obsidian` | ca, es, en | El menú Exporta amb Notion i Obsidian | Compartir i exportar |
| `16-desat-notion` | ca, es, en | L'avís «Desada a Notion» amb «Obre a Notion» | Compartir i exportar, tuit |
| `17-desat-obsidian` | ca, es, en | L'avís «Desada a Obsidian» amb «Obre a Obsidian» | Compartir i exportar, tuit |
| `18-configuracio-exportar` | ca, es, en | Configuració › Exportar: Obsidian i Notion connectat | Compartir i exportar |
| `19-notion-tria` | ca, es, en | Triar a quina pàgina de Notion van les reunions | Compartir i exportar |
| `20-la-teva-veu` | ca, es, en | «Fes que Murmur et reconegui»: llegint la frase, amb les paraules ja dites apagades | Parlants |
| `21-presenta-te` | ca, es, en | En directe: «Murmur, sóc la Laia» i l'avís «Parlant 3» és Laia | Parlants |
| `30-iphone-transcripcio` | ca, es, en | iPhone: la reunió «Llançament de la web nova», revisada, amb la transcripció i els parlants | A l'iPhone (la principal) |
| `30-iphone-resum` | ca, es, en | iPhone: el resum que ha fet l'ordinador, amb to, qui ha parlat, decisions i tasques | A l'iPhone, «L'ordinador l'acaba» |
| `30-iphone-notes` | ca, es, en | iPhone: les notes amb el minut i una foto de la pissarra | A l'iPhone, «Notes i fotos» |
| `30-iphone-llista` | ca, es, en | iPhone: la llista de reunions per dies | A l'iPhone |
| `30-iphone-cerca` | ca, es, en | iPhone: la cerca a totes les reunions | A l'iPhone |

Les `30-iphone-*` són les captures de l'App Store (`docs/appstore/<idioma>/`, en mode clar) dins el marc del telèfon i amb el fons transparent, a 908 × 1921, per posar-les sobre qualsevol color. Es fan amb `docs/appstore/promo/render-landing.sh` (Chrome sense finestra). Les de la botiga, amb titular i fons de marca (`docs/appstore/<idioma>/botiga/`), també serveixen per a xarxes.

També hi ha les captures més antigues de `data/captures-blog/` i les maquetes de disseny de `docs/design/screens/` (clar i fosc l'un al costat de l'altre, amb una interfície anterior).

### Les que falten

Aquestes només es poden fer amb l'app de veritat, perquè depenen del motor, de finestres a part o d'un compte:

- [ ] **Gravant en directe:** el botó «Gravant 12:34» a la barra i el text que va apareixent. És la imatge que més ven; potser millor que `01-reunio` per a la capçalera.
- [ ] **La píndola flotant** a sobre d'una trucada de Zoom o Meet, i el mode compacte de notes al costat.
- [ ] **L'avís «Comença d'aquí a 2 minuts»** a la cantonada de la pantalla.
- [ ] **El glossari amb paraules** (Configuració › Transcripció). Al navegador surt buit, perquè el desa el motor.
- [ ] **Compartir:** el diàleg amb un Worker connectat (què hi surt, caducitat, contrasenya) i la pàgina que veu qui rep l'enllaç.
- [ ] **Continuar una reunió:** el botó «Continua» després d'aturar, i la pausa marcada a la transcripció.
- [ ] **Claude** llegint una reunió amb el connector, si es vol parlar d'aquesta funcionalitat.
- [ ] **Subtítols sobre un vídeo:** un vídeo transcrit amb el `.srt` carregat a VLC o IINA. És la imatge del bloc de vídeos.
- [ ] **La traducció:** una reunió amb la transcripció traduïda i el segmentat Original / traducció.
- [ ] **Windows:** la finestra de Murmur a Windows.
- [ ] **Dins Obsidian i Notion:** la nota a Obsidian i la pàgina a Notion, fetes amb l'app de veritat (les de Murmur són simulades).
- [ ] **iPhone en mode fosc:** les mateixes cinc, si la secció de l'iPhone és fosca. Cal el simulador d'iOS (ara no n'hi ha cap d'instal·lat), amb `-demo -appearance dark`.
- [ ] **iPhone gravant:** la pantalla de gravació amb el text que va apareixent, i la Live Activity a la pantalla bloquejada. Són les que més ensenyen el que fa; cal l'iPhone de debò.
- [ ] Un vídeo curt (20 a 30 segons) d'una gravació en directe, si la landing en vol.
