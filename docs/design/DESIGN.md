# Murmur · especificació de disseny

Murmur és una app de macOS per transcriure reunions en directe, **en local i amb el català al centre**. Aquest document és la font de veritat per a qualsevol canvi d'interfície. Si una captura i aquest text no coincideixen, mana aquest text; si els tokens i aquest text no coincideixen, manen els tokens.

## Fitxers d'aquest paquet

| Carpeta | Què hi ha | Per a què |
|---|---|---|
| `tokens/Theme.swift` | Paleta de colors per tema i mode, amb `@Environment(\.murmur)` | Implementació SwiftUI. No escriguis colors a mà enlloc més |
| `tokens/murmur-tokens.json` | Els mateixos tokens en JSON (`#RRGGBB` o `#RRGGBBAA`) | Font neutra per regenerar codi |
| `tokens/murmur-theme.css` | Variables CSS `--mm-*` per `data-theme` i `data-mode` | Webs, maquetes o una UI web |
| `screens/<tema>/*.png` | Captura de cada pantalla, mode clar a l'esquerra i fosc a la dreta | Referència visual |
| `mockups/<tema>/*.html` | Les mateixes pantalles en HTML estàtic | Mides, espaiats i textos exactes |
| `icons/app/` | Icona de l'app a 1024×1024, un per tema (plantilla d'Apple: cos de 824 px, ombra inclosa) | `Assets.xcassets/AppIcon` |
| `icons/menubar/` | Icona de la barra de menús, 18 pt @1x i @2x, tres estats | `NSStatusItem` |
| `icons/logo/` | Marca monocroma i icona petita en SVG | Barra lateral, About |

Pantalles: `1-reunio-en-directe`, `2-portada`, `3-configuracio` (les cinc pestanyes), `4-quant-a`, `5-barra-de-menus-i-avisos`, `6-onboarding`. Temes: `negre-i-acid` (per defecte), `monocrom`, `formigo-i-vermell`.

## Marca

- **Nom:** Murmur, sempre en minúscules dins el logotip ("murmur") i amb majúscula inicial al text corrent.
- **Concepte:** "mur-mur", dues parets. El que es diu a la reunió no surt del Mac. La marca són **dues barres verticals arrodonides**.
- **Missatge principal:** *Privat, perquè és local.* Qualsevol text sobre privadesa ha de lligar "local" amb "privat": l'àudio i el text no surten mai de l'ordinador.
- **Llengua:** la interfície és en català. Res de castellanismes. No facis servir guions llargs (—) en cap text; fes servir comes, dos punts o punts.
- **Tipografia:** la del sistema (SF Pro) a tota l'app. El logotip "murmur" de l'About fa servir Space Grotesk Bold amb lletres juntes (−0,04 em) i una barra vertical entre les dues síl·labes.

## Temes i modes

L'usuari tria **tema** (Negre i àcid, Monocrom, Formigó i vermell) i **mode** (Sistema, Clar, Fosc) a Configuració › Aparença. Cada tema té versió clara i fosca. Fes servir sempre `MurmurPalette.palette(for:scheme:)`; no hi ha cap color fix fora de `Theme.swift` excepte el punt vermell de gravació (`recordingDot`, #FF3B30, igual a tots els temes).

Regla de proporció: **90% neutres, 9% text i negre, 1% accent.** Si l'accent apareix a més de dos llocs a la mateixa pantalla, sobra.

### Negre i àcid (per defecte)
- Accent `#D4FF3A`. **Mai com a text ni com a línia sobre fons clar**: no té contrast. Sobre clar només com a fons amb text negre a sobre (botó Exporta, "Tu").
- Mode clar: selecció i interruptors en negre; marques de temps i enllaços en oliva fosc (`timestamp`).
- Mode fosc: l'àcid pot ser text i línia (marques de temps, selecció, interruptors).

### Monocrom
- Sense color de marca. L'accent és negre en clar i blanc en fosc. La icona s'inverteix en fosc.
- Els únics colors són funcionals: punt de gravació i colors dels parlants.

### Formigó i vermell
- Fons de gris ciment suau, accent vermell de senyal (`#E10600` clar, `#FF3B28` fosc).
- El parlant 2 passa de corall a ambre en aquest tema perquè no es confongui amb el vermell de marca. Ja ve resolt als tokens.

## Estructura de la finestra

- Finestra principal: barra lateral de 240 pt, barra d'eines de 52 pt d'alçada, panell de notes de 320 pt a la dreta (es pot amagar).
- Radis: finestres 12, targetes 10, botons 7–8, etiquetes 5, píndola de gravació 15 (alçada 30).
- Text de transcripció: 16 pt, interlineat 1,65, amplada màxima 680 pt. Títol de reunió: 30 pt bold, −0,015 em.

## Components

### Barra lateral
- **Capçalera:** semàfors a l'esquerra; a la dreta, la icona petita (18 pt, `logoBackground` + `logoBar1` + `logoBar2`) i "murmur" en 12 pt bold.
- **Nova reunió:** botó sòlid a tota l'amplada, just sota la capçalera (alçada 32, radi 8, `newMeeting` / `onNewMeeting`), amb icona + i la drecera ⌘N a la dreta al 60% d'opacitat.
- **Fila seleccionada:** fons `sidebarSelection` i una barreta vertical de 3 pt a l'esquerra (`sidebarSelectionBar`). És un eco del logo.
- **Reunió gravant:** a la dreta de la fila, un punt vermell de 8 pt que fa pampallugues (opacitat 1 → 0,35, 1,4 s, ease-in-out, amb un halo que s'expandeix) i el text "REC" en 10 pt bold (`recordingLabel`).
- **Peu:** "Tot es queda en aquest Mac" en 11 pt i la roda de configuració.

### Barra d'eines
- **Píndola de gravació:** fons `recordingPill`, dues barres de 4×14 pt (`recordingLevel`) animades com un nivell d'àudio (escala vertical 0,45 → 1, 0,9 s, desfasades mig cicle), el text "Gravant", el temporitzador en xifres tabulars i un botó rodó d'aturar.
- **Exporta:** botó principal, `accent` amb text `onAccent`, 600 de pes.
- **Portada / Transcripció:** control segmentat (`segmentedTrack`, `segmentedSelected`).

### Transcripció en directe
- Cada intervenció: etiqueta del parlant (fons `speakerNTint`, text `speakerNText`, 12 pt semibold) + marca de temps (`timestamp`).
- El text que encara s'està reconeixent va en `textSecondary`, seguit d'un cursor de 2×18 pt (`caret`) que parpelleja cada segon.
- Notes: cada nota porta la seva marca de temps a l'esquerra en `timestamp`.

### Parlants
- Colors: `speaker1` violeta, `speaker2` corall (ambre a Formigó), `speaker3` turquesa, `speaker4` magenta. **"Tu" sempre és `you`** (l'accent del tema).
- Al gràfic "Qui ha parlat", cada segment és el color sòlid; a les etiquetes i tasques, el tint amb el text fosc corresponent.
- Més de quatre parlants: repeteix la paleta en ordre.

### Portada
Estructura igual que la teva maqueta original: metadades, títol, entradeta, nota "Generat en aquest ordinador", targetes de To i Qui ha parlat, Resum, Decisions, Tasques i Parts. Els minuts enllaçats fan servir `timestamp`. El punt del To fa servir el color de text en clar i l'accent en fosc.

### Configuració
Cinc pestanyes, en aquest ordre: **General, Aparença, Àudio, Transcripció, Intel·ligència**. Pestanya activa amb fons `tabSelected`.
- **General:** Inici (Obre Murmur en iniciar la sessió), Interfície (Panell principal: Transcripció / Notes), Avisos (Reunió detectada), Calendaris (el Calendari de macOS, que inclou els comptes de Google, iCloud o Exchange afegits al sistema: botó Connecta…; un cop connectat, interruptors «Avisa quan comenci una reunió» i «Inclou els esdeveniments sense convidats», i la llista «Calendaris que vigila» amb el color de cada calendari, el compte i un interruptor; «Tots» per tornar-los a vigilar tots).
- **Aparença:** Tema, amb tres targetes que mostren una mini finestra partida (clar a l'esquerra, fosc a la dreta) i un check a la seleccionada (contorn de 2 pt en `textPrimary`); i Mode (Sistema / Clar / Fosc).
- **Àudio:** Micròfon, Dispositiu, Nivell d'entrada (12 segments; els actius en `toggleOn`, els buits en `meterOff`), Àudio del sistema; Gravació (Desa l'àudio, Carpeta).
- **Transcripció:** Nombre màxim de parlants, Separació de veus (slider en `toggleOn` sobre `meterOff`, valor i enllaç Restableix en `link`), Verificació de parlants.
- **Intel·ligència:** Puntuació i majúscules, Portada, nota de privadesa amb icona de cadenat, Prompts de la portada (acordió).
- Interruptors: actiu `toggleOn` amb botó `toggleKnob`; inactiu `toggleOff` amb botó blanc.

### Quant a
Icona de 104 pt, logotip, versió, una frase que explica que tot es processa en aquest Mac, tres etiquetes (Res surt d'aquest Mac · Sense núvol ni comptes · Català, i més llengües), la taula **Models i eines de codi obert** (funció, model, autor, enllaç a la llicència) i el peu "Fet a Barcelona per Quico Domingo" amb el botó cap a quicodomingo.com. Els camps entre claudàtors de la maqueta s'han d'omplir amb els models reals.

### Icona de la barra de menús
`NSStatusItem` de 18 pt. Tres estats (fitxers a `icons/menubar/`):
- **En repòs** (`MenuBarTemplate`): una barra plena i l'altra de contorn. `isTemplate = true`.
- **Reunió a prop** (`MenuBarAlertTemplate`): barres plenes i un punt. `isTemplate = true`.
- **Gravant** (`MenuBarRecording`): barres plenes i punt vermell. `isTemplate = false`, perquè el vermell s'ha de veure.

### Avisos (toasts)
Panell flotant a dalt a la dreta, sota la barra de menús (amplada 470, radi 16, ombra suau, `toastBackground`). Tenen un botó rodó de tancar a la cantonada superior esquerra.
- **Comença d'aquí a 2 minuts:** icona de calendari, títol de la reunió · hora · plataforma. Depèn del calendari connectat.
- **Reunió detectada:** punt vermell amb halo, "*App* fa servir el micròfon".
- Un sol botó, sempre **Comença a gravar**, amb la icona petita, `accent` / `onAccent`. Sense desplegable.
- A sota, una barra de compte enrere de 3 pt (`toastProgress` sobre `toastBorder`); quan s'acaba, l'avís desapareix sol.

### Onboarding
Finestra de 720×540 que surt el primer cop que s'obre l'app. Peu fix de 68 pt amb els punts de progrés a l'esquerra (el pas actual és una píndola de 18 pt en `textPrimary`; la resta, punts de 6 pt en `separator`) i els botons a la dreta: secundari de text en `textSecondary`, principal en `accent` / `onAccent`.

1. **Benvinguda:** icona de 112 pt, logotip, "Transcriu les teves reunions en directe, amb el català al centre." i "Privat, perquè és local." Botó: Comença.
2. **Transcripció en directe:** "Veus el text mentre parleu". Il·lustració: píndola de gravació i una intervenció que s'està escrivint.
3. **Parlants i notes:** "Qui parla i què hi apuntes". Il·lustració: gràfic de qui ha parlat i notes amb el minut.
4. **Portada:** "La reunió, resumida". Il·lustració: títol, decisions i tasques.
5. **Avisos:** "Cap reunió sense gravar". Il·lustració: barra de menús i avís "Reunió detectada".
6. **Models** (tres estats de la mateixa pantalla):
   - *Triar:* "Descarrega els models". Dues files: **Model de transcripció** (Necessari, sempre inclòs, no es pot desmarcar) i **Eines de resum i portada** (Opcional, interruptor activat per defecte). Cada fila mostra la mida de descàrrega. A sota, la nota de privadesa amb cadenat. Botó: Descarrega i comença.
   - *Descarregant:* una barra de progrés per model (6 pt, `toggleOn` sobre `separator`), percentatge a la dreta. Primer el model de transcripció; les eines esperen ("En espera"). Si l'interruptor de les eines és apagat, només hi ha una barra. Botó principal desactivat ("Descarregant…") i secundari "Continua en segon pla": la descàrrega segueix si es tanca la finestra.
   - *A punt:* barres plenes, "Fet". Botó: Tanca.

Les il·lustracions dels passos 2 a 5 són fragments reals de la interfície amb els tokens del tema actiu, dins una caixa de 236 pt d'alçada amb fons `fillSubtle`. Les mides dels models estan pendents (a les maquetes surten com a [mida]).

## Accessibilitat i moviment
- Contrast mínim 4,5:1 per al text (3:1 a partir de 24 pt). Per això l'àcid mai és text sobre clar.
- Respecta "Redueix el moviment": atura el parpelleig del REC, les barres de nivell i el cursor.
- Els colors que s'han de distingir també es diferencien en lluminositat, no només en to.

## Notes d'implementació
- Desa el tema a `@AppStorage("murmurTheme")` i el mode a `@AppStorage("murmurMode")`; aplica el mode amb `.preferredColorScheme` (nil per a Sistema).
- Aplica el tema a l'arrel amb `.murmurTheme(theme)` i llegeix els colors amb `@Environment(\.murmur) var palette`.
- Opcional: canvia la icona del Dock segons el tema amb `NSApp.applicationIconImage`. La icona del Finder i de l'App Store queda la de per defecte (Negre i àcid).
