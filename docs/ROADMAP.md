# Full de ruta de Murmur

Estat a 16 d'octubre de 2026. L'app es diu **Murmur** (abans Transcriptor). Ja funciona: transcripció en directe en català (Conformer ca-es amb sherpa-onnx, motor en Rust), parlants en directe, àudio del sistema amb canals separats i cancel·lació d'eco, notes riques amb marca de temps, configuració i àudio desat en Opus.

Ordre de treball: **1 → 2 → 3**; els blocs 4–6 s'intercalen quan calgui.

---

## 1. Fer-la servir cada dia *(només falta la prova real)*

- [ ] Provar en reunions reals amb altaveus (cal el permís «Gravació de pantalla i àudio del sistema»). Validar l'eco residual.
- [x] Desar les reunions des de Rust: **SQLite** amb cerca de text completa (FTS5) a totes les reunions.
- [x] Exportar a fitxer: Markdown i .docx.
- [x] Desar cada reunió en Markdown (resum, notes i transcripció) a una carpeta triada, amb un interruptor a la barra de dalt mentre es grava.
- [x] ⌘+ / ⌘− / ⌘0 per ampliar o reduir el text de les notes (també al menú Visualització).
- [x] Exportar a Word o Markdown tot, només el resum i les notes o només la transcripció (el Word porta també el resum), i triar-ho per al Markdown que es desa sol (amb «Tot», el resum i la transcripció en dos fitxers).
- [x] Tab i Maj+Tab per sagnar paràgrafs a les notes (i niuar elements de llista), també als exports i a l'enllaç compartit.
- [x] Selector de micròfon a la configuració.
- [x] Primer commit al repositori.

## 2. Passada final (el salt de qualitat)

En aturar la gravació, reprocessar l'àudio desat:

- [x] Verificació de parlants en acabar (infraestructura, interfície i reassignació respectant noms i canvis manuals).
- [x] Ajustar la verificació amb l'etiquetatge manual: directe amb TitaNet (75% → 88% d'encerts), verificació 96%. Activada per defecte.
- [x] Trucades: el micròfon és «Tu», i la verificació uneix els parlants amb menys de 10 s de veu (a Meet, una sola persona sortia en 2–4 grups segons l'alineació de l'àudio).
- [ ] Validar els parlants amb una segona reunió etiquetada, i amb una trucada de 2+ persones a l'altra banda.
- [ ] Partir les frases que barregen parlants als canvis de torn de la verificació (10 de 34 frases ho fan).
- [x] **Idioma de la reunió** (Configuració › Transcripció): Català, Castellà, Català + castellà (per defecte) o Anglès. En anglès, el directe el fa Parakeet TDT-CTC 110M d'NVIDIA (ja amb puntuació).
- [x] **Passada final amb Whisper** large-v3-turbo (whisper.cpp + Metal, procés a part `murmur-whisper`) quan la reunió és d'una sola llengua: torna a escriure cada frase amb puntuació i majúscules, sense tocar parlants ni frases corregides a mà. RTF ~0,1 a l'M4 (uns 6 min per hora). Amb «Català + castellà» no hi passa: forçat a una llengua, Whisper tradueix l'altra.
- [ ] Provar la passada de Whisper en una reunió real sencera i en una trucada (micròfon + sistema), i mesurar-ne el temps en un M1.
- [ ] Comparar Whisper turbo amb el Whisper català d'AINA (cal convertir-lo a whisper.cpp) amb una referència manual (WER).
- [x] **Whisper català del BSC** per a la passada final de les reunions en català (`whisper-3cat-balearic`, large-v3 afinat, convertit a whisper.cpp q5_0, 1,1 GB), i després la puntuació de Softcatalà. Mesurat amb `bench/dialects.py`: és el millor per al català central, el valencià i el balear, i també a les Corts Valencianes; el turbo continua per al castellà i l'anglès. Hi havia un selector de variant (central, valencià, balear), però amb aquestes xifres no calia.
- [x] Publicar el model convertit a huggingface.co/quicodomingo/murmur-models (Apache 2.0, amb el crèdit al BSC, `LICENSE` i `NOTICE`).
- [x] **L'aurora** en acabar (`lib/reveal.ts`): el text de Whisper i el resum apareixen amb una llum que baixa, i el lloc del resum brilla mentre s'escriu.
- [x] **Tradueix la transcripció** al català, al castellà o a l'anglès amb el model dels resums (Gemma, Claude o ChatGPT), sense tocar l'original: un segmentat Original / traducció a la transcripció (`lib/translate.ts`, columna `translation`).
- [x] Exportar a Obsidian: les caixes fortes trobades a la llista d'Obsidian, propietats, tasques, captures a «attachments», persones com a enllaços, desar-hi sola en acabar i «Obre a Obsidian». Configuració › Exportar (amb el Markdown, que era a Transcripció).
- [x] Exportar a Notion amb «Connecta amb Notion» (OAuth amb PKCE contra el servidor MCP de Notion, sense servidor propi), triar la pàgina on es desa, desar-hi sola en acabar i «Obre a Notion». Les transcripcions llargues van a subpàgines.
- [x] **Subtítols:** Exporta › Subtítols en SRT o WebVTT, amb trossos de dues línies, el nom de qui parla i la traducció si n'hi ha; al costat del vídeo d'on ve, amb el seu nom (`lib/subtitles.ts`).
- [x] **Transcriure un vídeo:** mp4, mov i m4v amb `afconvert`, i mkv i webm amb Symphonia (l'Opus amb libopus), també des de Compartir, «Obre amb» i deixant-lo anar a la finestra.
- [ ] Subtítols amb el temps de cada paraula (Whisper els pot donar) en lloc de repartir-lo per llargada.
- [ ] Notion: desar les reunions com a files d'una base de dades, o com a notes de reunió de Notion, quan se n'hagi mirat el format amb `tools/list`.
- [ ] La traducció a les exportacions (Word, Markdown, PDF) i als enllaços compartits.
- [x] **Idioma del resum** a la portada: un menú al costat de «Torna a generar» el torna a escriure en català, castellà o anglès.
- [x] **Torna a escoltar amb Whisper** es pot apagar (Configuració › Transcripció › En acabar la gravació), i els dos Whisper hi són sempre a la vista, cadascun amb per a què serveix.
- [x] **Glossari:** quantes vegades s'ha corregit cada paraula, al costat de cadascuna.
- [x] **«Murmur, sóc la Marta»:** qui es presenta així posa el nom al seu parlant, ajustat als convidats del calendari, als noms ja posats i al glossari (`lib/intro.ts`); avís amb Desfés, i el nom torna a aplicar-se després de la verificació de parlants. «Murmur» és al glossari de manera interna.
- [ ] Mesurar-ho amb dues o tres gravacions de debò: quantes presentacions cauen al parlant correcte, de seguida i després de la verificació.
- [x] **La teva veu desada** (opcional): un pas a l'onboarding, després dels models, per llegir una frase, i a Configuració › Àudio; Murmur et reconeix com a «Tu» des de la primera paraula (`voice.rs`, `known_speakers`).
- [ ] Mesurar «La teva veu» amb gent a la sala: quantes de les teves frases cauen a «Tu».
- [x] **Estadístiques d'ús anònimes** amb Aptabase (`lib/analytics.ts`), que es poden desactivar.
- [x] Posar la clau d'Aptabase a `APTABASE_KEY` (lib.rs): sense, l'app no envia res.
- [ ] Glossari: «com se sent» (les formes en què la transcripció escriu malament una paraula, per corregir-les encara que siguin lluny) i suggeriments a partir dels noms corregits a mà i dels convidats.
- [x] **Barra superior endreçada:** la marca a 30 pt amb «murmur», el títol en gris i sense menú, les accions de la reunió al botó «···» i les exportacions totes a Exporta.
- [ ] Triar l'idioma per reunió (ara és un sol valor a Configuració), o endevinar-lo del calendari.
- [x] **Prova de LLM local** (reunió real de 20 min = 6.426 tokens ≈ 19K tokens/hora; M4 base, llama.cpp + Metal). Resultats a `results/llm/`:
  - Gemma 4 E2B: ràpid (lectura 345 t/s, escriptura 36 t/s) però català fluix i es deixa contingut.
  - **Gemma 4 E4B: el millor equilibri** (lectura 180 t/s, escriptura 21 t/s, ~2–2,5 min per hora de reunió): cobreix tota la reunió, no s'inventa dates. Català millorable.
  - Salamandra 7B (BSC): el català més natural, però lent (6–8 min/h), 6,6 GB de memòria i s'inventa dates.
  - DeepSeek: sense model petit propi (els R1-Distill són Qwen/Llama reentrenats, de raonament).
  - Gemma 4 té el raonament activat per defecte: cal `enable_thinking: false`.
- [x] **Decisió:** les funcions de LLM (resum, acta, capítols, preguntes…) són **opcionals**. En activar-les, l'app descarrega **Gemma 4 E4B** (QAT q4_0 oficial, 5,15 GB, Apache 2.0).
- [ ] Millorar el català de l'E4B: instruccions amb exemples, i revisió amb el corrector de Softcatalà (LanguageTool, local).
- [ ] Provar l'E4B en un M1 de 8 GB (si no hi va, E2B com a alternativa per a equips petits).

### Usos del LLM (propostes a analitzar i prioritzar)

Sobre la transcripció:
- [x] Puntuació i majúscules en acabar: model de Softcatalà (ONNX int8, 126 MB, ~5 s per 20 min). Opcional i esborrable. Paràgrafs: pendent.
- [ ] Corregir noms i marques pel context (worpress → WordPress), amb el vocabulari personalitzat i els convidats del calendari.
- [ ] Versió «neta» per llegir (sense «eh», «o sigui», repeticions), conservant l'original.
- [ ] Suggerir el nom dels parlants pel context («com deia el Guillem»), sempre com a proposta, mai automàtic.
- [x] **Glossari** de paraules que la transcripció escriu malament (noms propis, marques, sigles), a Configuració › Transcripció i des del text («Vols afegir… al glossari?» en corregir una frase). Corregeix cada frase acabada, en directe i després de Whisper (`glossary.rs`).
  - [x] A la portada: el model de llenguatge rep com s'escriuen els noms (els convidats i els termes del glossari que surten a la reunió).
  - [x] Afegir-hi els convidats de l'esdeveniment del calendari, només per a aquella reunió (nom complet i nom de pila).
  - [ ] Aplicar-lo a una reunió ja feta (ara només val per a les noves i les que es tornen a transcriure).
  - [ ] *Hotwords* de sherpa-onnx en directe, si encara cal: el text en directe se substitueix en acabar, Parakeet (anglès) és CTC i caldria *modified beam search*. Mesurar-ho abans.
- [ ] **Speaker tags**: el nom de qui parla des de l'app de la trucada (Meet a Chrome, Zoom, Teams) amb el permís d'Accessibilitat, combinat amb la separació de veus (la veu agrupa; l'app posa el nom). Activable a Configuració › Transcripció. Prova prèvia: `examples/ax_probe.rs`.

Sobre el contingut:
- [x] Resum (portada).
- [x] Decisions i tasques amb responsable, data i minut (portada; les tasques es poden marcar com a fetes).
- [x] Títol automàtic (només si l'usuari no l'ha canviat) i entradeta.
- [x] Parts de la reunió amb minut d'inici (clicable) i 1–3 punts per part. També el to general i «Qui ha parlat» (sense LLM).
- [ ] Preguntes obertes i decisions pendents.
- [ ] Esborrany de correu de seguiment per als assistents.
- Cada acord o tasca porta el minut d'on surt, per comprovar-ho amb un clic (els models petits poden inventar).

Durant la reunió:
- [ ] «Què s'ha dit fins ara?»: resum dels últims minuts (si arribes tard o et despistes).
- [ ] Tenir en compte les notes de l'usuari per prioritzar el resum.

Entre reunions (bloc 5):
- [ ] Preguntes a totes les reunions («Què vam decidir dels preus?»): cerca a SQLite + LLM.

- [x] Gemma 4 E4B dins el nucli Rust (`llm.rs`, llama-cpp-2 + Metal): llegeix la transcripció un cop i respon cada part en JSON amb gramàtica. S'allibera en acabar. ~2,5 min per 20 min de reunió a l'M4.
- [x] Portada (Portada | Transcripció) amb els passos del processament i «Genera la portada» per a reunions antigues.
- [x] Configuració › Intel·ligència: activar, descarregar (reprenible), esborrar models, i editar i provar els prompts de cada part.
- [x] Publicar el model de puntuació convertit perquè l'app el pugui descarregar. És MIT: és a `quicodomingo/murmur-models/punct-ca`, amb la llicència i el crèdit a Softcatalà.
- [ ] Correcció ortogràfica del text que escriu el LLM (castellanismes de l'E4B).

## 3. Instal·lable per a altres persones

- [x] Pantalles de primera obertura (`Onboarding.tsx`, disseny a `docs/design`): benvinguda, quatre passos amb il·lustracions reals, i descàrrega dels models amb progrés, represa i «Continua en segon pla». Surten el primer cop i sempre que falti el model de transcripció.
- [x] **Permisos**: Murmur els demana com les altres apps (diàleg del micròfon, avís de macOS per a l'àudio del sistema) i Configuració › Àudio › Permisos en mostra l'estat.
- [x] Models a la carpeta de dades de l'app (`<app data>/models`) quan no hi ha la carpeta `models/` del projecte.
- [x] Conformer per a sherpa-onnx publicat a [huggingface.co/quicodomingo/murmur-models](https://huggingface.co/quicodomingo/murmur-models) (CC BY 4.0, atribució a AINA; fp32 i int8). Prova: descàrrega completa en una carpeta buida (585 MB, 21 s) i transcripció idèntica a la dels models del projecte.
- [x] Puntuació de Softcatalà: publicada a Hugging Face (`quicodomingo/murmur-models/punct-ca`, MIT) i amb les URL a `models.rs`.
- [ ] Decidir si es baixa el Conformer en int8 (228 MB en total en lloc de 585 MB): mesurar-ne la qualitat amb la referència manual.
- [x] Comprovació d'espai lliure abans de descarregar, i verificació (hash) dels fitxers.
- [ ] Calendaris a la primera obertura (opcional).
- [x] Empaquetar, signar (Developer ID de We Are Mortensen S.L.) i notaritzar: `app/scripts/release.sh` fa l'app i un `.dmg` acceptats per Gatekeeper. Identificador `com.quicodomingo.murmur`.
- [ ] Signar amb un Developer ID propi si Murmur ha de sortir a nom de Quico Domingo.
- [ ] Actualitzacions automàtiques (plugin updater de Tauri).
- [x] **Interfície en català, castellà i anglès** (i18next, `app/src/locales/`; menús natius, avisos i errors a `i18n.rs`; permisos de macOS en `.lproj`). Per defecte, l'idioma del sistema; Configuració › General › Idioma. La portada s'escriu en l'idioma de la interfície. Guia: `docs/TRADUCCIONS.md`.
- [x] Idioma de la portada: el de la interfície o el de la reunió (Configuració › Intel·ligència). Cada reunió desa el seu idioma.
- [x] Pantalla «Novetats de Murmur» després d'actualitzar, amb «No ho tornis a mostrar» (es reactiva a Configuració › General). Text dins l'app, en tres idiomes.
- [ ] Revisar les traduccions amb algú nadiu (sobretot els noms dels menús de macOS en castellà) i provar els textos dels permisos en un Mac en castellà i en anglès.
- [x] README per a GitHub (anglès, `README.md`; català, `README.ca.md`).
- [x] Codi obert: llicència MIT (`LICENSE`) i repositori públic.

## 4. Configuració pendent (ja dissenyada)

- [x] Calendari de macOS (inclou Google, iCloud i Exchange afegits al sistema): triar calendaris, avís «Comença d'aquí a 2 minuts» i títol de la reunió.
- [x] Connectar el calendari continua en segon pla si es tanca la configuració (indicador al peu de la barra lateral i avís en acabar).
- [x] Ajuntar dos parlants que són la mateixa persona: des del menú del parlant, des de l'avís en canviar una frase o posant-li el nom de l'altre.
- [x] Noms dels parlants a partir dels convidats de l'esdeveniment (menú del parlant).
- [x] Indicador de gravació, mode compacte de notes i captures de pantalla manuals.
- [x] Actualitzacions de l'app i dels models en obrir Murmur (repositori `quicodomingo/murmur-releases`), descàrregues amb comprovació d'espai i SHA-256. Versió 0.2.0.
- [ ] Primera publicació (0.2.0) i provar una actualització real amb la 0.2.1.
- [x] Portada: tasques editables, notes com a font, avís de portada desactualitzada i «PDF o envia…».
- [x] Intel·ligència: la portada amb el model local o amb Claude / OpenAI / Gemini / OpenRouter i la clau pròpia, desada al clauer del sistema, triant el model. Només s'envia text (transcripció i notes), mai àudio.
- [ ] Provar la portada amb Claude, OpenAI, Gemini i OpenRouter amb claus reals i comparar-la amb Gemma (qualitat, temps i cost per reunió).
- [x] En acabar una reunió, «Què en faig ara?»: els passos (parlants, Whisper, puntuació, resum) es trien cada cop, recordats per a gravacions i per a fitxers, i el que no es fa queda pendent per a «Acaba de processar…».
- [x] Calendaris amb un enllaç iCal a tots els sistemes (Google, Outlook, iCloud), amb els esdeveniments que es repeteixen i les zones d'Outlook.
- [x] Google Calendar amb el seu inici de sessió (OAuth) a tots els sistemes: projecte de Google Cloud, client «Desktop», permisos `calendar.calendarlist.readonly` i `calendar.events.readonly`.
- [ ] La verificació de Google (pàgina de privadesa amb el paràgraf de *Limited Use*, vídeo, justificació dels permisos) per sortir del mode de proves: fins llavors només hi poden entrar els usuaris de prova i la sessió caduca cada 7 dies. Mentrestant, a l'app publicada no surt (`GOOGLE_CALENDAR`, a `app/src/lib/features.ts`): quan Google ho aprovi, es posa a `true` i es torna a explicar als README.
- [x] Whisper frase a frase per a les reunions en català i castellà: mesurat amb `examples/mixed_probe.rs` en un programa de ràdio barrejat (WER 6 % davant del 21 % tot en català, RTF 0,25 davant de 0,14; vegeu ARQUITECTURA), a la passada final de «Català + castellà», i els dos Whisper a l'onboarding i a la configuració.
- [ ] Confirmar el Whisper frase a frase amb una reunió real barrejada (no només amb el programa de ràdio), i mirar quant tarda en un PC sense GPU.
- [ ] Mesurar els models «Recomanats» d'OpenRouter (`RECOMMENDED`, `lib/cloud.ts`) amb el banc de proves abans de deixar-los com a recomanació: ara són un model conegut per empresa.
- [ ] Vocabulari personalitzat (marques i noms propis: WordPress, WooCommerce, noms de l'equip…).
- [x] Triar l'idioma i si sou més gent a la sala just abans de gravar (pantalla inicial, barra lateral i avisos), i canviar «Som més a la sala» durant la gravació.
- [x] Tornar a transcriure una reunió desada en un altre idioma (català, castellà o anglès) amb Whisper, des del menú del títol.
- [ ] Tornar a transcriure en «Català + castellà» (caldria passar l'àudio desat pel model en directe).
- [ ] Canviar l'idioma durant la gravació (canvi de model en directe, l'àudio d'aquells segons espera a la cua).
- [ ] Endevinar l'idioma amb els primers 20–30 s (Whisper) i suggerir-ne el canvi; suggerir «Som més a la sala» si el micròfon sent veus diferents.
- [x] Exportar totes les captures d'una reunió a una carpeta.
- [x] Continuar una reunió aturada (`docs/mockups/continuar.html`): «Continua» a la barra d'eines durant 10 minuts (i a l'avís flotant si s'ha aturat des de l'indicador) i «Continua la reunió» al menú del títol. Una sola reunió: la pausa surt a la transcripció, la durada és la suma de les parts, l'àudio va al mateix `.ogg`, les veus de la primera part tornen amb el seu nom, i en acabar es verifiquen els parlants de tota la reunió i Whisper només passa per la part nova.
- [ ] Ajuntar dues reunions ja fetes en una.
- [ ] Continuar una reunió des de l'avís del calendari (la mateixa reunió que torna a començar).
- [x] Etiquetes per organitzar les reunions (per client, projecte…): sota el títol, filtre a la barra lateral (també per a la cerca) i reanomenar, ajuntar o esborrar amb el clic dret.
- [ ] Etiquetes automàtiques pel domini dels convidats del calendari: proposar-la la primera vegada i recordar «@acme.com és Acme» (esbós a `docs/mockups/etiquetes.html`, pantalla 4).
- [x] Compartir una reunió amb un enllaç (portada, notes i transcripció, amb contrasenya i caducitat opcionals), xifrada al Mac i publicada al Worker de Cloudflare de cada usuari (`share/`, docs/COMPARTIR.md).
- [x] Compartir també les captures i l'àudio, marcar les reunions compartides i configurar Cloudflare amb un assistent dins l'app.
- [x] «Baixa en Markdown» a la pàgina compartida.
- [ ] Provar l'assistent amb un compte real de Cloudflare i obrir un enllaç amb àudio des d'un mòbil (Safari i Chrome).
- [ ] Exportar totes les reunions d'una etiqueta, i una portada del client amb les últimes reunions.
- [x] Obrir un àudio com a reunió (Fitxer › Transcriu des d'un fitxer…, ⌘O): mp3, m4a, wav, ogg… passa pel motor com una gravació, amb l'idioma detectat per Whisper.
- [ ] Provar la detecció d'idioma amb àudios reals en castellà, en anglès i barrejats (ara només s'ha provat amb reunions en català i veus sintètiques).
- [x] Enviar un àudio a Murmur des del menú Compartir d'altres apps (extensió a `app/share-extension/`), amb Finder › Obre amb o deixant-lo anar a la icona del Dock.
- [x] Arrossegar un àudio a la finestra per obrir-lo, amb un vel que ho indica (`DropOverlay`).
- [x] Connector per a Claude (servidor MCP local, `transcriptor --mcp`): transcriure un fitxer i llegir i cercar les reunions des de Claude Desktop i Claude Code. Configuració › Claude, desactivat per defecte.
- [ ] Provar el connector amb Claude Desktop i Claude Code de debò, amb l'app instal·lada (i que el camí de l'app no canviï en actualitzar-la).
- [ ] Connector: desar a Murmur una transcripció feta des de Claude, si l'usuari ho demana.
- [x] Configuració: botó de tancar i «Desat» quan canvia un ajust.
- [x] Marca nova (Eco): logotip, icona de l'app, barra de menús, pàgina compartida.

## 5. Qualitat i rendiment

- [ ] Cerca difusa (índex FTS5 de trigrames): trobar «worpress» buscant «wordpress». Resultats exactes primer i «semblants» a part, amb llindar ~60% de trigrames compartits.
- [ ] Cerca semàntica entre reunions (`sqlite-vec` + embeddings) per a «pregunta a les teves reunions».

- [ ] Transcripció de referència a mà (5–10 min de `data/reunio.m4a`) per calcular el WER i decidir models amb números.
- [ ] Reduir CPU en directe (ara ~37–47% d'un fil a l'M4, sobretot pels textos provisionals). Provar en un M1 de 8 GB.
- [x] Identitat de Murmur (`docs/design/`): tres temes (Negre i àcid, Monocrom, Formigó i vermell) amb mode clar i fosc, Configuració › Aparença, barra lateral, píndola de gravació, etiquetes de parlant, Quant a, icona de l'app.
- [x] Icona a la barra de menús (repòs, reunió a prop, gravant) i avís flotant «Reunió detectada» quan una altra app comença a fer servir el micròfon (CoreAudio, macOS 14.2+).
- [ ] Icona del Dock segons el tema (opcional al disseny).
- [ ] Diarització en directe per finestres (pyannote 5 s cada 1 s + TitaNet): prototip a `examples/window_diarize.rs`, 96% a la sala i 2 grups a Meet (ara 88% i 5). Validar amb més reunions etiquetades i integrar-la al motor.
- [ ] Afinar la separació de parlants en directe (TitaNet, llindar 0,7). A les trucades de Meet l'altra banda es parteix: cap llindar ni model provat va bé alhora a la sala i a la trucada.

## 6. Més endavant

- [x] Windows i Linux: l'app compila i funciona als tres sistemes, amb instal·ladors (NSIS; `.deb`, `.rpm` i AppImage) i actualitzacions.
- [x] Windows: àudio del sistema amb loopback WASAPI.
- [x] CI a macOS, Windows i Linux, i publicació automàtica de les versions en pujar l'etiqueta.
- [x] Proves e2e: el motor transcriu un àudio de veritat a les tres plataformes, i la interfície amb `tauri-driver` a Windows i Linux.
- [x] Linux: àudio del sistema (el monitor de la sortida per defecte, amb PulseAudio o PipeWire).
- [ ] Windows i Linux: captures de pantalla (`xcap` o similar).
- [ ] Windows i Linux: «Reunió detectada» (qui fa servir el micròfon).
- [ ] Windows i Linux: calendari (Google o Outlook directes, amb OAuth).
- [ ] Windows: signar l'instal·lador perquè SmartScreen no avisi.
- [x] Windows i Linux: acceleració per GPU (Vulkan) per a Whisper i Gemma, amb el processador si no hi ha gràfica o no hi cap.
- [x] Si `murmur-whisper` peta a la gràfica (Vulkan a Linux amb el Whisper del BSC, #9), es repeteix amb el processador, i fins a la versió següent ja hi va directament.
- [ ] Mesurar Vulkan en PC de veritat (NVIDIA, AMD, Intel integrada) amb el banc de proves: factor de temps real de Whisper i velocitat del resum, comparats amb el processador.
- [x] Windows ARM (Snapdragon): compilació nativa, instal·lador `_arm64-setup.exe` i actualitzacions.
- [ ] Windows ARM: provar-la en un Snapdragon de veritat i mesurar; si cal, Gemma a la GPU Adreno amb OpenCL.
- [ ] Murmur per a mòbil (iOS i Android): funciona sol amb la transcripció ràpida, i emparellat amb l'ordinador hi fa la passada final. Pla i mockups a [`docs/MOBIL.md`](MOBIL.md).
  - [x] El motor separat de l'app de l'ordinador (`core/`, `murmur-core`), per compartir-lo amb el mòbil.
  - [x] L'emparellament, la part de l'ordinador: Configuració › Mòbil, codi QR, Bonjour i protocol xifrat ([`docs/EMPARELLAR.md`](EMPARELLAR.md)).
  - [x] El motor compilat per a iOS i una app de proves (`mobile/ios/MurmurProbe`), provada al simulador.
  - [x] La prova d'una tarda a l'iPhone: velocitat amb i sense text provisional, i qualitat comparada amb l'ordinador.
  - [ ] La bateria i la temperatura en mitja hora de gravació (MurmurProbe, «Grava en directe»).
  - [x] L'esquelet de l'app (`mobile/ios/Murmur`): el motor amb UniFFI (`mobile/ffi`), la llista, gravar amb el text en directe, marcar un moment, notes amb el minut, la reunió acabada al mòbil i la configuració. Provat al simulador.
  - [x] A l'iPhone de debò.
  - [ ] La Live Activity i la Dynamic Island (Marca, Pausa i Atura des de la pantalla bloquejada): feta i compilada, falta veure-la a l'iPhone.
  - [x] Posar nom als parlants (el menú de l'etiqueta: canvia el nom, aquesta frase és d'un altre, totes les frases són d'un altre), mentre graves i a la reunió acabada.
  - [x] Fotos amb el minut; l'editor de notes amb format (títol, llista, casella), mentre graves i a la reunió acabada.
  - [x] La portada que torna de l'ordinador (pestanya Resum): l'entradeta, el to, qui ha parlat, el resum, les decisions, les tasques i les parts.
  - [x] Marcar tasques fetes des del mòbil (es conserven quan la reunió torna revisada).
  - [x] El cercador, les etiquetes, compartir una reunió en text, i Configuració › Aparença (tema i mode) i «Desa l'àudio al telèfon».
  - [x] «La teva veu» al mòbil (l'empremta, només al telèfon), «Murmur, sóc…» en directe, el «…» mentre graves (nom, micròfon, descartar) i les veus de la reunió.
  - [x] El splash (l'eco es desdobla i la marca vola a la capçalera) i l'onboarding (benvinguda, què fa, com graves, el micròfon, la teva veu i l'ordinador).
  - [x] L'ordinador torna a llegir el «Murmur, sóc…» de les reunions del mòbil després de verificar els parlants.
  - [x] Estadístiques d'ús anònimes al mòbil (Aptabase, com l'ordinador), desactivables a l'onboarding i a Configuració.
  - [x] Emparellar i sincronitzar amb l'ordinador, la part del mòbil: el QR amb la càmera, Bonjour, l'enviament amb l'àudio i la versió revisada de tornada. Provat al simulador amb `fake_computer`.
  - [x] Provar l'emparellament amb l'app de l'ordinador i un iPhone de debò.
  - [x] Configuració › Mòbil i la icona de la barra lateral, visibles per a tothom (abans, només en desenvolupament).
  - [x] Preparar l'App Store: 1.0 només per a iPhone, la fitxa en tres idiomes, la privadesa, les notes per a la revisió i les captures en català ([`docs/APPSTORE.md`](APPSTORE.md)).
  - [x] La pàgina de privadesa a la web, les captures en castellà i anglès, i enviar-la a revisió.
  - [x] Publicar la versió de l'ordinador que ensenya Configuració › Mòbil (0.16.0) abans que l'app surti a la botiga.
  - [x] Publicada a l'App Store el 17 de novembre de 2026 (https://apps.apple.com/app/id6835415829).
  - [x] L'app de l'iPhone ja és a l'App Store de la UE: a la 0.18.0, `PHONE_APP` a `true` (`app/src/lib/features.ts`), el paràgraf dels README i la novetat de l'iPhone amb la imatge (la de la 0.16.0, que no va sortir).
  - [ ] La secció de l'iPhone a la landing: textos i captures a [`docs/LANDING.md`](LANDING.md).
  - [x] Les reunions de l'ordinador al mòbil, només el text: Configuració › Mòbil, de l'última setmana a totes. Cal l'app del mòbil 1.1.
  - [x] Publicar la 1.1 de l'app de l'iPhone (les reunions de l'ordinador): acceptada per Apple.
  - [x] Una trucada a mitja gravació la posa en pausa i, quan acaba, continua sola (o amb el botó de continuar, que ara torna a engegar el micròfon). «Tap to stop» ja no queda tallat.
  - [x] Enviar la 1.1.1 a Apple.
  - [ ] Provar la trucada a l'iPhone de debò.
  - [ ] Les edicions després de revisar en tots dos sentits (avui el mòbil només conserva el títol i els noms que hi canvies).
  - [ ] iPad i iPhone Duo.
  - [ ] Android (`mobile/android/`, en curs; què hi ha i què falta a [`docs/MOBIL.md`](MOBIL.md#android-on-som)):
    - [x] Gravar amb el text en directe i la notificació fixa, la llista, la reunió acabada, les notes i els parlants editables.
    - [ ] «Murmur, sóc…».
    - [ ] La cerca, les etiquetes i compartir com a text.
    - [ ] La configuració, «La teva veu», l'onboarding i les estadístiques.
    - [ ] L'emparellament amb l'ordinador.
    - [ ] Google Play.
  - [x] Provar l'emparellament de punta a punta amb `fake_phone` i l'app: emparellar, enviar una reunió de 3 minuts, passada final (Whisper i dos parlants trobats) i recollir-ne el resultat.
  - [ ] La prova d'una tarda a l'iPhone (cal Xcode): velocitat, qualitat i bateria del Conformer.
  - [ ] Primera app en SwiftUI: gravar i text en directe, per TestFlight.
- [ ] macOS amb Intel (x86_64), si algú ho demana.
- [ ] iOS / Android reaprofitant el nucli Rust.
