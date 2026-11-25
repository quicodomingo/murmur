# Murmur per a iPhone a l'App Store

Tot el que demana l'App Store Connect per publicar l'app de l'iPhone (`mobile/ios/Murmur`), i els passos. L'app es publica amb l'equip de Mortensen (`NYQHV4FSKC`, a `project.yml`), amb l'identificador `com.quicodomingo.murmur.ios` (i `…ios.widgets` per a la Live Activity).

## Abans d'enviar-la

- **Només iPhone** en aquesta primera versió (`TARGETED_DEVICE_FAMILY: "1"`): l'iPad encara no té disposició pròpia, i Apple la provaria també a l'iPad.
- **Versió 1.1.1 (3)** als dos `Info.plist` (la 1.0 va ser la 1, la 1.1 la 2). Cada pujada nova necessita un número de compilació (`CFBundleVersion`) més alt.
- **La pàgina de privadesa de la web** (`murmur.quicodomingo.com/privacitat`): l'App Store en demana una. El text és més avall.
- **La prova de bateria** de mitja hora encara està pendent (docs/MOBIL.md).

## Els passos

1. **App Store Connect › Apps › +** (a [appstoreconnect.apple.com](https://appstoreconnect.apple.com), amb el compte de Mortensen): app nova per a iOS, nom **Murmur**, idioma principal, identificador `com.quicodomingo.murmur.ios`, SKU `murmur-ios`.
2. **Pujar la compilació:** a Xcode, l'esquema Murmur amb **Any iOS Device (arm64)**, *Product › Archive*, i a l'Organizer *Distribute App › App Store Connect › Upload*. Xcode crea els certificats i els perfils de distribució (signatura automàtica).
3. **La fitxa:** els textos, les captures (`docs/appstore/`), la privadesa, la classificació per edats i les notes per a la revisió, tot d'aquest document.
4. **Exportació:** a la compilació, la pregunta de l'encriptació (més avall).
5. **Publicació manual:** a *Version Release*, tria **Manually release this version**. Així, quan Apple l'aprovi, no surt sola a la botiga.
6. **Envia a revisió.** Sol trigar d'un a tres dies.
7. **Quan estigui aprovada:** primer es publica la versió de l'ordinador que ensenya Configuració › Mòbil, i després es prem *Release This Version*. Al revés, qui baixés l'app no la podria connectar.

## La fitxa

**Categoria:** Productivitat (secundària: Empreses). **Preu:** gratuïta. **Classificació per edats:** 4+ (cap dels continguts del qüestionari). **Copyright:** 2026 Quico Domingo. **Web de suport i de màrqueting:** https://murmur.quicodomingo.com

L'App Store Connect accepta el català com a idioma de la fitxa; si no hi sortís, el castellà seria el principal.

### Català

- **Nom:** Murmur
- **Subtítol** (30): Transcriu reunions en català
- **Text promocional** (170): Grava la reunió amb el telèfon damunt la taula i llegeix-la mentre parleu. Tot es queda al telèfon, i l'ordinador la pot revisar i resumir.
- **Paraules clau** (100): transcripció,reunions,actes,dictat,veu a text,català,valencià,notes,resum,parlants,privat
- **Descripció:**

> Murmur transcriu les teves reunions en directe, amb el català al centre. Deixa el telèfon damunt la taula i llegeix el que es diu mentre parleu, en català i castellà.
>
> TOT ES QUEDA AL TELÈFON
> La transcripció es fa dins del telèfon, sense connexió. Ni l'àudio ni el text no van a cap servidor.
>
> QUI DIU QUÈ
> Murmur distingeix les veus. Posa nom a cada parlant, o que s'ho posi ell dient «Murmur, sóc la Laia». Desa la teva veu i et reconeixerà com a «Tu».
>
> NOTES AL MINUT
> Escriu notes amb títols, llistes i caselles, fes fotos de la pissarra i marca els moments importants: tot queda lligat al minut exacte de la reunió.
>
> AMB EL TELÈFON BLOQUEJAT
> La gravació continua amb la pantalla apagada. Des de la pantalla bloquejada i la Dynamic Island hi pots marcar un moment, posar-la en pausa o aturar-la.
>
> I A L'ORDINADOR
> Amb Murmur a l'ordinador (macOS, Windows i Linux) i a la mateixa xarxa, cada reunió hi passa sola, xifrada. L'ordinador la torna a escoltar amb Whisper, en fa el resum, les decisions i les tasques, i te les torna al telèfon.
>
> També: cerca en totes les reunions, etiquetes, compartir en text, tres temes de color i mode fosc.
>
> Per gravar una reunió cal el consentiment de tothom qui hi participa.

- **Novetats d'aquesta versió:** Les reunions de l'ordinador, també al mòbil. Si fas servir Murmur a l'ordinador, ara en pots tenir les reunions al telèfon: el text, els parlants, les notes i el resum, sense l'àudio. Tria quines a l'app de l'ordinador (Configuració › Mòbil: l'última setmana, l'últim mes, els últims 3 mesos o totes) i arriben quan el mòbil se sincronitza, amb la icona de l'ordinador. Les trobaràs a la llista i a la cerca, i si n'esborres una del mòbil, no hi torna. Cal Murmur 0.19 o posterior a l'ordinador.

### Castellano

- **Nombre:** Murmur
- **Subtítulo:** Transcribe reuniones en vivo
- **Texto promocional:** Graba la reunión con el teléfono sobre la mesa y léela mientras habláis. Todo se queda en el teléfono, y el ordenador puede revisarla y resumirla.
- **Palabras clave:** transcripción,reuniones,actas,dictado,voz a texto,catalán,notas,resumen,hablantes,privado
- **Descripción:**

> Murmur transcribe tus reuniones en directo, en catalán y castellano. Deja el teléfono sobre la mesa y lee lo que se dice mientras habláis.
>
> TODO SE QUEDA EN EL TELÉFONO
> La transcripción se hace dentro del teléfono, sin conexión. Ni el audio ni el texto van a ningún servidor.
>
> QUIÉN DICE QUÉ
> Murmur distingue las voces. Pon nombre a cada hablante, o que se lo ponga él diciendo «Murmur, soy Laia». Guarda tu voz y te reconocerá como «Tú».
>
> NOTAS EN SU MINUTO
> Escribe notas con títulos, listas y casillas, haz fotos de la pizarra y marca los momentos importantes: todo queda ligado al minuto exacto de la reunión.
>
> CON EL TELÉFONO BLOQUEADO
> La grabación sigue con la pantalla apagada. Desde la pantalla bloqueada y la Dynamic Island puedes marcar un momento, pausarla o detenerla.
>
> Y EN EL ORDENADOR
> Con Murmur en el ordenador (macOS, Windows y Linux) y en la misma red, cada reunión pasa sola, cifrada. El ordenador la vuelve a escuchar con Whisper, hace el resumen, las decisiones y las tareas, y te las devuelve al teléfono.
>
> También: búsqueda en todas las reuniones, etiquetas, compartir en texto, tres temas de color y modo oscuro.
>
> Para grabar una reunión hace falta el consentimiento de todas las personas que participan.

- **Novedades:** Las reuniones del ordenador, también en el móvil. Si usas Murmur en el ordenador, ahora puedes tener sus reuniones en el teléfono: el texto, los hablantes, las notas y el resumen, sin el audio. Elige cuáles en la app del ordenador (Configuración › Móvil: la última semana, el último mes, los últimos 3 meses o todas) y llegan cuando el móvil se sincroniza, con el icono del ordenador. Las encontrarás en la lista y en la búsqueda, y si borras una del móvil, no vuelve. Necesitas Murmur 0.19 o posterior en el ordenador.

### English

- **Name:** Murmur
- **Subtitle:** Live meeting transcription
- **Promotional text:** Record the meeting with your phone on the table and read it as you talk. It all stays on the phone, and your computer can revise and summarise it.
- **Keywords:** minutes,dictation,speech to text,catalan,spanish,notes,summary,speakers,private,offline,recorder
- **Description:**

> Murmur transcribes your meetings live, in Catalan and Spanish. Leave your phone on the table and read what's being said as you talk.
>
> IT ALL STAYS ON THE PHONE
> Transcription happens on the phone, offline. Neither the audio nor the text goes to any server.
>
> WHO SAYS WHAT
> Murmur tells voices apart. Name each speaker, or let them name themselves by saying "Murmur, I'm Laia". Save your voice and it will know you as "You".
>
> NOTES AT THEIR MINUTE
> Write notes with headings, lists and checkboxes, take photos of the whiteboard and mark the important moments: all tied to the exact minute of the meeting.
>
> WITH THE PHONE LOCKED
> Recording goes on with the screen off. From the lock screen and the Dynamic Island you can mark a moment, pause or stop.
>
> AND ON YOUR COMPUTER
> With Murmur on your computer (macOS, Windows and Linux) on the same network, every meeting goes there on its own, encrypted. The computer listens to it again with Whisper, writes the summary, decisions and tasks, and sends them back to the phone.
>
> Also: search across all meetings, tags, sharing as text, three colour themes and dark mode.
>
> Recording a meeting needs the consent of everyone taking part.

- **What's new:** Your computer's meetings, on your phone too. If you use Murmur on your computer, you can now have its meetings on your phone: the text, speakers, notes and summary, without the audio. Choose which ones in the desktop app (Settings › Phone: the last week, the last month, the last 3 months or all of them) and they arrive the next time your phone syncs, with the computer icon. You'll find them in the list and in search, and if you delete one from your phone, it doesn't come back. Requires Murmur 0.19 or later on your computer.

## Privadesa (App Privacy)

- **Dades recollides:** només **Dades d'ús › Interacció amb el producte** (les estadístiques anònimes d'Aptabase, `Sources/Analytics.swift`), **no vinculades** a la persona, **sense seguiment**, per a **Anàlisi**. Es poden desactivar.
- **Cap altra dada:** l'àudio, el text, les notes, les fotos i l'empremta de la veu es queden al telèfon. El que passa a l'ordinador va directament entre els dos aparells de la persona, xifrat, sense passar per cap servidor: no és una recollida de dades.
- **Política de privadesa:** https://murmur.quicodomingo.com/privacitat/ (a murmur-web, en tres idiomes, amb l'avís legal a `/avis-legal/`).

## Encriptació (exportació)

L'app xifra el que passa entre el telèfon i l'ordinador de la persona (Noise: X25519, ChaCha20-Poly1305 i BLAKE2s, `core/src/sync.rs`). Al formulari de l'App Store Connect: **sí, fa servir encriptació**, i és de les exemptes per a ús general (protegir les dades de la persona entre els seus aparells, amb algorismes estàndard, sense cap funció d'encriptació oferta a tercers). Quan ho hagis confirmat, es pot afegir `ITSAppUsesNonExemptEncryption = NO` a l'`Info.plist` perquè no ho pregunti a cada pujada. És una declaració legal: la decideix qui publica.

## Notes per a la revisió

> Murmur transcribes in-room meetings on the phone, offline. No account or login is needed.
>
> To try it: tap the + button, allow the microphone and speak (Catalan or Spanish; it also picks up some English words). Lines appear as you speak; Atura (Stop) asks for a second tap. Lock the phone while recording to see the Live Activity with Mark, Pause and Stop.
>
> Background audio is used only to keep recording with the screen locked.
>
> The app is fully functional on its own. Pairing with a computer (Settings › Ordinador) is an optional extra for users of the free Murmur desktop app (https://murmur.quicodomingo.com); the desktop update that enables it ships together with this release. It uses the camera only to read the computer's QR code, and the local network only to talk to that computer. Nothing goes through any server.
>
> Usage statistics are anonymous (Aptabase) and can be turned off in Settings.

## Captures

**Les que es pugen** són a `docs/appstore/<idioma>/botiga/` (1.png … 5.png, 1206 × 2622, la casella «iPhone with Dynamic Island, medium display»): un titular amb la tipografia de la landing i el telèfon damunt dels colors de la marca. La marca Eco travessa la primera i la segona. Es fan amb `docs/appstore/promo/render.sh` (Chrome sense finestra, a partir de `promo.html`, on hi ha els titulars en tres idiomes) a partir de les captures de l'app d'aquí sota.

**Les captures de l'app:** 
L'App Store en demana per a l'iPhone de 6,9 polzades (1320 × 2868); les mides més petites les fa Apple. Són a `docs/appstore/<idioma>/` (ca, es, en), al costat dels textos de la fitxa en un fitxer per camp per copiar-los, amb els límits comprovats. L'iPhone només transcriu en català i castellà: a les angleses, la transcripció és en castellà i la resta (títols, notes i el resum que fa l'ordinador) en anglès. Es fan amb `-demo` i l'idioma del simulador, fetes al simulador de l'iPhone 16 Pro Max amb les reunions de mostra (`-demo`, només en compilacions de desenvolupament: la gent i les reunions són inventades, com a la landing).

## Política de privadesa (per a la web)

> **Murmur: privadesa**
>
> Murmur transcriu les reunions dins del teu aparell. L'àudio, el text, les notes, les fotos i l'empremta de la teva veu es queden al teu telèfon o al teu ordinador i no van a cap servidor nostre ni de ningú.
>
> **Entre el telèfon i l'ordinador.** Si els connectes, les reunions passen directament d'un a l'altre per la teva xarxa local, xifrades. No hi ha cap servidor pel mig.
>
> **La teva veu.** Si la deses, Murmur en guarda una empremta (una dada biomètrica), no la gravació. Es queda a l'aparell on l'has desada i la pots esborrar quan vulguis.
>
> **Estadístiques d'ús.** Si no les desactives, Murmur envia estadístiques anònimes amb Aptabase: quines funcions es fan servir, quant duren les reunions (en franges), la versió i el sistema. Sense cap identificador i sense res de les reunions. Es desactiven a Configuració.
>
> **Resums al núvol (ordinador).** Només si tu ho tries, l'app de l'ordinador envia el text d'una reunió al model que hagis connectat amb la teva pròpia clau. Mai l'àudio.
>
> **Compartir.** Només comparteixes el que tries, quan ho tries.
>
> Contacte: a través de https://github.com/quicodomingo/murmur
