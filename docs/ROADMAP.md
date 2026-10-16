# Full de ruta — Transcriptor

Estat a 16 d'octubre de 2026. Ja funciona: transcripció en directe en català (Conformer ca-es amb sherpa-onnx, motor en Rust), parlants en directe, àudio del sistema amb canals separats i cancel·lació d'eco, notes riques amb marca de temps, configuració i àudio desat en Opus.

Ordre de treball: **1 → 2 → 3**; els blocs 4–6 s'intercalen quan calgui.

---

## 1. Fer-la servir cada dia *(només falta la prova real)*

- [ ] Provar en reunions reals amb altaveus (cal el permís «Gravació de pantalla i àudio del sistema»). Validar l'eco residual.
- [x] Desar les reunions des de Rust: **SQLite** amb cerca de text completa (FTS5) a totes les reunions.
- [x] Exportar a fitxer: Markdown i .docx.
- [x] Selector de micròfon a la configuració.
- [x] Primer commit al repositori.

## 2. Passada final (el salt de qualitat)

En aturar la gravació, reprocessar l'àudio desat:

- [ ] Diarització completa (sherpa-onnx: segmentació pyannote + embeddings) sobre el canal del sistema; el micròfon ja és «Tu».
- [ ] Transcripció final: decidir entre el Conformer actual o Whisper AINA (cal convertir-lo a MLX / whisper.cpp; amb faster-whisper a CPU va massa lent).
- [ ] Puntuació i majúscules amb un LLM.
- [ ] Resum, acords i tasques (amb responsable) amb un LLM.
- [ ] **Prova de LLM local** sobre la transcripció de la reunió real: qualitat del català, temps i memòria (objectiu M1 8 GB):
  - **Gemma 4 E2B** — candidat prioritari a explorar per als resums.
  - Gemma 3 4B, Qwen 3 4B, Salamandra 7B (BSC) com a comparació.
  - Un model de núvol de referència (clau pròpia) per saber on és el sostre.
- [ ] Integrar el model triat amb llama.cpp al nucli Rust, carregant els models per torns (directe → alliberar → passada final → alliberar → LLM).
- [ ] Mostrar l'estat de la passada final a la interfície i el panell Resum · Acords · Tasques (disseny ja fet a Superdesign).

## 3. Instal·lable per a altres persones

- [ ] Pantalles de primera obertura:
  - [ ] Benvinguda (tot es processa en local).
  - [ ] **Permisos**: micròfon i «Gravació de pantalla i àudio del sistema», amb l'estat de cada un i un botó que obre la secció de Configuració del Sistema.
  - [ ] Descàrrega de models amb progrés, mida, comprovació d'espai, represa i verificació (model de transcripció obligatori ~500 MB o 142 MB en int8; LLM opcional: «ara», «més tard» o «faré servir la meva clau»).
  - [ ] Calendaris (opcional).
- [ ] Models a la carpeta de dades de l'app (ara es llegeixen del repositori en dev).
- [ ] Empaquetar, signar i notaritzar (compte d'Apple Developer, 99 $/any). Els permisos passen a ser de l'app.
- [ ] Actualitzacions automàtiques (plugin updater de Tauri).

## 4. Configuració pendent (ja dissenyada)

- [ ] Calendaris: Google Calendar i Apple Calendar → títol de la reunió, noms dels parlants a partir dels convidats, avís per gravar quan comença una reunió.
- [ ] Intel·ligència: model local o clau pròpia d'OpenAI / Anthropic, desada al clauer del sistema. Només s'envia text, mai àudio.
- [ ] Vocabulari personalitzat (marques i noms propis: WordPress, WooCommerce, noms de l'equip…).

## 5. Qualitat i rendiment

- [ ] Cerca semàntica entre reunions (`sqlite-vec` + embeddings) per a «pregunta a les teves reunions».

- [ ] Transcripció de referència a mà (5–10 min de `data/reunio.m4a`) per calcular el WER i decidir models amb números.
- [ ] Reduir CPU en directe (ara ~37–47% d'un fil a l'M4, sobretot pels textos provisionals). Provar en un M1 de 8 GB.
- [ ] Revisar el mode fosc amb cura.
- [ ] Afinar la separació de parlants en directe (llindar per defecte 0,65).

## 6. Més endavant

- [ ] Windows: àudio del sistema amb loopback WASAPI, proves i instal·lador.
- [ ] iOS / Android reaprofitant el nucli Rust.
