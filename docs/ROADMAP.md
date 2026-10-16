# Full de ruta de Murmur

Estat a 16 d'octubre de 2026. L'app es diu **Murmur** (abans Transcriptor). Ja funciona: transcripció en directe en català (Conformer ca-es amb sherpa-onnx, motor en Rust), parlants en directe, àudio del sistema amb canals separats i cancel·lació d'eco, notes riques amb marca de temps, configuració i àudio desat en Opus.

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

- [x] Verificació de parlants en acabar (infraestructura, interfície i reassignació respectant noms i canvis manuals).
- [x] Ajustar la verificació amb l'etiquetatge manual: directe amb TitaNet (75% → 88% d'encerts), verificació 96%. Activada per defecte.
- [ ] Validar els parlants amb una segona reunió etiquetada.
- [ ] Partir les frases que barregen parlants als canvis de torn de la verificació (10 de 34 frases ho fan).
- [ ] Transcripció final: decidir entre el Conformer actual o Whisper AINA (cal convertir-lo a MLX / whisper.cpp; amb faster-whisper a CPU va massa lent).
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
- [ ] Publicar el model de puntuació convertit perquè l'app el pugui descarregar (i aclarir-ne la llicència amb Softcatalà).
- [ ] Correcció ortogràfica del text que escriu el LLM (castellanismes de l'E4B).

## 3. Instal·lable per a altres persones

- [x] Pantalles de primera obertura (`Onboarding.tsx`, disseny a `docs/design`): benvinguda, quatre passos amb il·lustracions reals, i descàrrega dels models amb progrés, represa i «Continua en segon pla». Surten el primer cop i sempre que falti el model de transcripció.
- [x] **Permisos**: Murmur els demana com les altres apps (diàleg del micròfon, avís de macOS per a l'àudio del sistema) i Configuració › Àudio › Permisos en mostra l'estat.
- [x] Models a la carpeta de dades de l'app (`<app data>/models`) quan no hi ha la carpeta `models/` del projecte.
- [ ] **Publicar els models convertits** (Conformer per a sherpa-onnx, ~500 MB, CC BY 4.0 d'AINA; puntuació de Softcatalà, llicència per aclarir). Fins llavors, en un Mac nou el model de transcripció no es pot descarregar.
- [ ] Decidir si es baixa el Conformer en int8 (228 MB en total en lloc de 585 MB): mesurar-ne la qualitat amb la referència manual.
- [ ] Comprovació d'espai lliure abans de descarregar, i verificació (hash) dels fitxers.
- [ ] Calendaris a la primera obertura (opcional).
- [ ] Empaquetar, signar i notaritzar (compte d'Apple Developer, 99 $/any). Els permisos passen a ser de l'app.
- [ ] Actualitzacions automàtiques (plugin updater de Tauri).

## 4. Configuració pendent (ja dissenyada)

- [ ] Calendaris: Google Calendar i Apple Calendar → títol de la reunió, noms dels parlants a partir dels convidats, avís «Comença d'aquí a 2 minuts» (la finestra d'avisos ja existeix).
- [ ] Intel·ligència: model local o clau pròpia d'OpenAI / Anthropic, desada al clauer del sistema. Només s'envia text, mai àudio.
- [ ] Vocabulari personalitzat (marques i noms propis: WordPress, WooCommerce, noms de l'equip…).

## 5. Qualitat i rendiment

- [ ] Cerca difusa (índex FTS5 de trigrames): trobar «worpress» buscant «wordpress». Resultats exactes primer i «semblants» a part, amb llindar ~60% de trigrames compartits.
- [ ] Cerca semàntica entre reunions (`sqlite-vec` + embeddings) per a «pregunta a les teves reunions».

- [ ] Transcripció de referència a mà (5–10 min de `data/reunio.m4a`) per calcular el WER i decidir models amb números.
- [ ] Reduir CPU en directe (ara ~37–47% d'un fil a l'M4, sobretot pels textos provisionals). Provar en un M1 de 8 GB.
- [x] Identitat de Murmur (`docs/design/`): tres temes (Negre i àcid, Monocrom, Formigó i vermell) amb mode clar i fosc, Configuració › Aparença, barra lateral, píndola de gravació, etiquetes de parlant, Quant a, icona de l'app.
- [x] Icona a la barra de menús (repòs, reunió a prop, gravant) i avís flotant «Reunió detectada» quan una altra app comença a fer servir el micròfon (CoreAudio, macOS 14.2+).
- [ ] Icona del Dock segons el tema (opcional al disseny).
- [ ] Afinar la separació de parlants en directe (llindar per defecte 0,65).

## 6. Més endavant

- [ ] Windows: àudio del sistema amb loopback WASAPI, proves i instal·lador.
- [ ] iOS / Android reaprofitant el nucli Rust.
