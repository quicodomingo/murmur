# Landing de descàrrega

Tot el que cal per fer la pàgina de descàrrega de Murmur: el missatge, els textos de cada secció en català, castellà i anglès, les captures que tenim i les que falten. Les dades surten del README i de la versió 0.11.2; si canvia alguna funcionalitat, s'actualitza aquí també.

## Dades bàsiques

| | |
|---|---|
| Nom | Murmur (sempre amb majúscula al text; el logotip és «murmur» en minúscula) |
| Plataforma | Mac amb Apple Silicon (M1 o posterior), macOS 14.2 o posterior |
| Preu | Gratuïta. Codi obert amb llicència MIT |
| Descàrrega | https://github.com/quicodomingo/murmur-releases/releases/latest (el `.dmg` porta la versió al nom, així que l'enllaç estable és el de la pàgina, no el del fitxer) |
| Codi | https://github.com/quicodomingo/murmur |
| Signatura | Signada i notaritzada per Apple. S'actualitza sola |
| Idiomes de les reunions | Català, castellà, català i castellà barrejats, anglès |
| Idiomes de la interfície | Català, castellà, anglès |
| Icona | `docs/murmur-icon-acid-1024.png` (i les variants de `docs/design/`) |
| Colors i tipografia | [`docs/design/DESIGN.md`](design/DESIGN.md). L'àcid (#D4FF3A) mai és text ni línia sobre fons clar |

## El missatge

Una idea central: **transcriu les reunions al teu Mac, en català, sense enviar res enlloc.** Tres arguments la sostenen, per aquest ordre:

1. **Privat de debò.** L'àudio no surt mai de l'ordinador. Sense compte i sense subscripció.
2. **Fet per al català.** Entén el català, el castellà i les dues llengües barrejades dins la mateixa frase, que és on fallen els altres.
3. **No només transcriu.** Sap qui parla, hi pots prendre notes i captures, i en acabar et deixa el resum, les decisions i les tasques.

## Textos per seccions

### 1. Capçalera

| | Català | Castellà | Anglès |
|---|---|---|---|
| Titular | Les teves reunions, transcrites al teu Mac. | Tus reuniones, transcritas en tu Mac. | Your meetings, transcribed on your Mac. |
| Subtítol | En català, castellà i anglès, en directe i amb qui diu què. Res surt de l'ordinador. | En catalán, castellano e inglés, en directo y con quién dice qué. Nada sale del ordenador. | In Catalan, Spanish and English, live, with who said what. Nothing leaves your computer. |
| Botó | Descarrega per a Mac | Descargar para Mac | Download for Mac |
| Sota el botó | Gratuïta · Apple Silicon · macOS 14.2 o posterior | Gratis · Apple Silicon · macOS 14.2 o posterior | Free · Apple Silicon · macOS 14.2 or later |

Captura: `01-reunio` (o `02-reunio-fosc` si la pàgina és fosca).

### 2. Per al català

| Català | Castellà | Anglès |
|---|---|---|
| **Va néixer per a reunions en català.** La majoria de serveis de transcripció s'equivoquen quan la gent passa del català al castellà dins la mateixa frase. Murmur fa servir un model entrenat per a totes dues llengües alhora. I quan la reunió és en una sola llengua, en acabar Whisper la torna a escoltar per posar-hi la puntuació i els noms propis. | **Nació para reuniones en catalán.** La mayoría de servicios de transcripción se equivocan cuando la gente pasa del catalán al castellano en la misma frase. Murmur usa un modelo entrenado para las dos lenguas a la vez. Y cuando la reunión es en una sola lengua, al terminar Whisper la vuelve a escuchar para poner la puntuación y los nombres propios. | **Built for meetings in Catalan.** Most transcription services trip up when people switch between Catalan and Spanish mid-sentence. Murmur uses a model trained on both languages at once. It works in English too, and when a meeting is in a single language, Whisper listens again at the end to add punctuation and proper names. |

### 3. Com funciona (tres passos)

| | Català | Castellà | Anglès |
|---|---|---|---|
| 1 | **Grava.** Murmur escolta el micròfon i la trucada (Zoom, Meet, Teams…) per separat, també amb altaveus. | **Graba.** Murmur escucha el micrófono y la llamada (Zoom, Meet, Teams…) por separado, también con altavoces. | **Record.** Murmur listens to your mic and the call (Zoom, Meet, Teams…) separately, even on speakers. |
| 2 | **Llegeix-la en directe.** La transcripció apareix mentre parleu, separada per parlants. Hi pots prendre notes i captures de la pantalla compartida. | **Léela en directo.** La transcripción aparece mientras habláis, separada por hablantes. Puedes tomar notas y capturas de la pantalla compartida. | **Read it live.** The transcript appears as you talk, split by speaker. Take notes and screenshots of the shared screen as you go. |
| 3 | **Endu-te'n el resum.** En acabar, un model local escriu el resum, les decisions i les tasques, cadascuna enllaçada al moment de la reunió. | **Llévate el resumen.** Al terminar, un modelo local escribe el resumen, las decisiones y las tareas, cada una enlazada al momento de la reunión. | **Take away the summary.** When it ends, a local model writes the summary, decisions and tasks, each linked to its moment in the meeting. |

Captures: `01-reunio` per als passos 1 i 2, `03-resum` o `05-resum-sencer` per al 3.

### 4. Funcionalitats

Cinc blocs. Cadascun amb un títol i una o dues frases; el detall és al README.

| Bloc | Català | Castellà | Anglès | Captura |
|---|---|---|---|---|
| Parlants | **Qui diu què.** Les veus s'agrupen en directe i es comproven en acabar. Posa-hi noms, o tria'ls entre els convidats del calendari. | **Quién dice qué.** Las voces se agrupan en directo y se comprueban al terminar. Ponles nombre, o elígelos entre los invitados del calendario. | **Who said what.** Voices are grouped live and checked again at the end. Name them, or pick from the calendar guests. | `01-reunio` |
| Notes | **Notes lligades al moment.** Títols, llistes, caselles i sagnats. Cada nota recorda el minut en què la vas escriure, i les captures de pantalla queden al costat del que es deia. | **Notas ligadas al momento.** Títulos, listas, casillas y sangrías. Cada nota recuerda el minuto en que la escribiste, y las capturas quedan junto a lo que se decía. | **Notes tied to the moment.** Headings, lists, checkboxes and indents. Each note remembers the minute you wrote it, and screenshots sit next to what was being said. | `01-reunio` |
| Resum | **El resum, les decisions i les tasques.** Amb el to de la reunió, qui ha parlat i quant, i les parts amb les captures. El fa un model local; si vols, Claude o OpenAI amb la teva clau. | **El resumen, las decisiones y las tareas.** Con el tono de la reunión, quién ha hablado y cuánto, y las partes con las capturas. Lo hace un modelo local; si quieres, Claude u OpenAI con tu clave. | **Summary, decisions and tasks.** With the meeting's tone, who spoke and for how long, and its parts with the screenshots. A local model writes it; or Claude or OpenAI with your own key. | `03-resum`, `05-resum-sencer` |
| Calendari | **Sap quan comença la reunió.** T'avisa dos minuts abans i la gravació agafa el títol i els convidats. iCloud, Google o Exchange, a través del Calendari de macOS. | **Sabe cuándo empieza la reunión.** Te avisa dos minutos antes y la grabación toma el título y los invitados. iCloud, Google o Exchange, a través del Calendario de macOS. | **Knows when your meeting starts.** It alerts you two minutes before, and the recording takes the event's title and guests. iCloud, Google or Exchange, via macOS Calendar. | Falta (vegeu més avall) |
| Compartir i exportar | **Comparteix-la o endu-te-la.** Un enllaç xifrat al teu compte gratuït de Cloudflare, amb caducitat i contrasenya si vols. O Word, PDF, Markdown a la teva carpeta, àudio i captures. | **Compártela o llévatela.** Un enlace cifrado en tu cuenta gratuita de Cloudflare, con caducidad y contraseña si quieres. O Word, PDF, Markdown en tu carpeta, audio y capturas. | **Share it or take it with you.** An encrypted link on your free Cloudflare account, with expiry and a password if you like. Or Word, PDF, Markdown to your folder, audio and screenshots. | `09-exportar` |

Funcionalitats més petites, per a una llista o una graella d'icones: cerca a totes les reunions (`10-cerca`), etiquetes, glossari de noms i marques, transcriure un fitxer d'àudio, continuar una reunió aturada, connector per a Claude, tres temes amb mode clar i fosc (`06` a `08`).

### 5. Privadesa

| Català | Castellà | Anglès |
|---|---|---|
| **Tot es queda en aquest Mac.** La veu, els parlants i el resum es processen a l'ordinador. Murmur només es connecta per descarregar els models i buscar actualitzacions. Sense compte i sense subscripció. Si comparteixes una reunió, es xifra abans de sortir del Mac. | **Todo se queda en este Mac.** La voz, los hablantes y el resumen se procesan en el ordenador. Murmur solo se conecta para descargar los modelos y buscar actualizaciones. Sin cuenta y sin suscripción. Si compartes una reunión, se cifra antes de salir del Mac. | **Everything stays on this Mac.** Speech, speakers and the summary are processed on your computer. Murmur only goes online to download models and check for updates. No account, no subscription. If you share a meeting, it's encrypted before it leaves your Mac. |

Nota que ha de sortir a prop: **per gravar una reunió cal el consentiment de tothom que hi participa** (*Grabar una reunión requiere el consentimiento de todos los participantes* / *Recording a meeting requires everyone's consent*).

### 6. Preguntes freqüents

| Pregunta | Resposta |
|---|---|
| És gratuïta? | Sí. És de codi obert, amb llicència MIT. |
| Funciona amb Zoom, Meet o Teams? | Amb qualsevol: Murmur grava l'àudio del sistema, no s'hi connecta. Ningú de la trucada veu cap bot. |
| Cal connexió a internet? | Només el primer cop, per descarregar els models (uns 600 MB), i per buscar actualitzacions. |
| Quanta memòria cal? | En té prou amb 8 GB. Per al resum local se'n recomanen 16; si no, el resum el pot fer Claude o OpenAI amb la teva clau. |
| Funciona a Windows o a Macs amb Intel? | Encara no. |
| On es desen les reunions? | En una base de dades al teu Mac. L'àudio només es desa si ho actives. També pots desar cada reunió en Markdown a la carpeta que triïs. |

### 7. Peu

Codi obert (MIT) · GitHub · amb models del projecte AINA (BSC), NVIDIA, OpenAI i Google (la taula de models és al README, amb les llicències).

## Captures

Són de l'app de veritat, amb una reunió d'exemple («Llançament de la web nova», 34 minuts, tres parlants, notes, dues captures de pantalla i resum). A 2880×1800 (finestra de 1440×900 a 2×), en PNG.

Són a `data/captures-landing/`, que no es puja al repositori. Per tornar-les a fer (per exemple, quan canviï la interfície), amb el servidor de Vite engegat al port 8766:

```bash
cd app && npx vite --port 8766          # en un altre terminal
node tools/landing-captures/shoot.mjs data/captures-landing
node tools/landing-captures/shoot.mjs data/captures-landing ca-03   # només les que contenen «ca-03»
```

Les reunions d'exemple són a `tools/landing-captures/seed.mjs`, en els tres idiomes.

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
- [ ] Un vídeo curt (20 a 30 segons) d'una gravació en directe, si la landing en vol.
