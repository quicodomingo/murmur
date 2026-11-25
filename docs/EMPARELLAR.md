# Emparellar el mòbil amb l'ordinador

Com es connecten Murmur per a mòbil ([MOBIL.md](MOBIL.md)) i l'ordinador perquè les reunions gravades al mòbil hi passin soles per a la passada final, i en tornin els resultats. La part compartida (codi QR, canal xifrat, missatges i fitxers) és a `core/src/sync.rs`.

## Principis

- **Desactivat per defecte.** L'ordinador no escolta res a la xarxa fins que l'usuari obre Configuració › Mòbil i hi connecta un mòbil. Sense mòbils emparellats, no hi ha cap port obert.
- **Només la xarxa local.** Els dos aparells es parlen directament. No hi ha cap servidor de Murmur ni cap passarel·la a internet. Si no són a la mateixa xarxa, les reunions esperen al mòbil.
- **Xifrat d'extrem a extrem, també a casa.** Encara que sigui la xarxa local, tot va xifrat i els dos aparells es reconeixen per una clau que només ells tenen. Una altra màquina de la xarxa no pot llegir res ni fer-se passar per l'ordinador.
- **Només el que és de la reunió.** Hi viatgen el text, l'àudio de la reunió, les notes i les fotos. **L'empremta de «La teva veu» no surt mai de l'aparell on es va gravar.**

## Com s'emparella

1. A l'ordinador, Configuració › Mòbil › «Connecta un mòbil». Surt un codi QR que caduca al cap de 5 minuts.
2. El QR porta:
   - la versió del protocol;
   - el nom de l'ordinador («MacBook de Quico»);
   - la seva clau pública (X25519, 32 bytes);
   - un secret d'un sol ús de 32 bytes, que només serveix per a aquest emparellament;
   - les adreces locals i el port, com a pista (es tornen a buscar amb Bonjour).
3. El mòbil llegeix el QR, es connecta i fa la presentació xifrada (`Noise_IKpsk2`) amb la clau de l'ordinador que porta el QR i el secret d'un sol ús. Si l'ordinador no és el del QR, la presentació no es pot completar. Tot seguit, cadascun envia un primer missatge xifrat amb el seu nom: l'ordinador només recorda el mòbil quan rep el d'ell, perquè és el que demostra que tenia el secret.
4. L'ordinador ho confirma a la pantalla: «L'iPhone de Quico s'ha connectat». A partir d'aquí cadascun desa la clau de l'altre.

El QR demostra que el mòbil era davant de la pantalla: ningú altre de la xarxa el pot haver vist.

## Com es troben i es parlen després

- **Descoberta:** l'ordinador s'anuncia a la xarxa local amb Bonjour (`_murmur._tcp`) només mentre hi ha algun mòbil emparellat. L'anunci no diu res de l'usuari, només un identificador aleatori.
- **Connexió:** TCP directe, amb el protocol [Noise](https://noiseprotocol.org/) (`Noise_IK_25519_ChaChaPoly_BLAKE2s`, el crate `snow` en Rust). El mòbil ja coneix la clau de l'ordinador i li presenta la seva, xifrada; l'ordinador només accepta els mòbils que té emparellats (per això IK i no KK: l'ordinador pot tenir-ne diversos i no sap quin es connecta). S'autentiquen mútuament i cada connexió té claus noves: si algun dia es filtrés una clau, no es podrien desxifrar les connexions d'abans.
- **Missatges:** cada missatge es parteix en trames de Noise (com a molt 65.535 bytes). Els de control són JSON (`Msg`); els trossos de fitxer porten una capçalera petita i els bytes tal qual, de 256 KB.
- **Per què Noise i no HTTPS:** no cal cap certificat ni cap autoritat. La identitat és la clau que es va passar pel QR, i prou.
- **On es desen les claus:** la clau privada de l'ordinador, al clauer del sistema (`keychain.rs`). La del mòbil, al clauer de l'iPhone. Mai en fitxers.

## Què s'envia

**Del mòbil a l'ordinador**, quan una reunió s'acaba (o quan tornen a ser a la mateixa xarxa):
- La reunió: identificador (UUID, el mateix a tots dos aparells), títol, data, durada, frases del directe amb el parlant, noms dels parlants («Murmur, sóc…»), marques d'«Important».
- Les notes (el mateix format que a l'ordinador, amb el minut a cada bloc).
- L'àudio, tal com es grava (Opus): unes 11 MB per hora.
- Les fotos, en JPEG, amb el seu minut.

**De l'ordinador al mòbil**, quan acaba la passada final:
- Les frases revisades (Whisper, puntuació, parlants verificats i els noms), el resum i les traduccions si n'hi ha.
- No hi torna l'àudio: el mòbil ja el té (o l'ha esborrat, si l'usuari ho vol així).

**Més endavant (fase 2):** les reunions gravades a l'ordinador, per llegir-les al mòbil. Només el text i les notes; l'àudio, només si l'usuari ho demana per a una reunió.

**Mai:** l'empremta de la veu, les claus d'API dels resums al núvol, la configuració ni els models.

## Com se sincronitza

- **Cada reunió té un amo mentre no és revisada.** El mòbil l'envia i l'ordinador la posa a la seva llista amb una icona de mòbil i «Esperant la passada final». La passada final es fa sola quan l'ordinador no està gravant (la mateixa regla que `gate.rs`).
- **Enviaments que es poden reprendre.** L'àudio va a trossos amb la suma SHA-256 de cada tros i del fitxer sencer. Si es talla, continua on era.
- **L'àudio del mòbil només s'esborra quan l'ordinador confirma** que el té sencer i que la suma quadra, i només si l'usuari ha activat «Esborra l'àudio del mòbil».
- **Les edicions després de revisar:** el títol, els noms dels parlants i les notes es poden canviar a tots dos aparells. Cada camp porta l'hora de l'última edició i guanya la més recent. Les frases es corregeixen a l'ordinador (on hi ha l'àudio i Whisper), i el mòbil rep la versió nova.

## Desemparellar

- Des de qualsevol dels dos: Configuració › Mòbil › el mòbil › «Desemparella», o Configuració › Ordinador › «Desemparella» al mòbil.
- Cadascun esborra la clau de l'altre. Les reunions que ja s'han passat es queden a tots dos llocs.
- Si l'altre aparell no ho sap encara, la propera vegada que s'hi intenti connectar la presentació falla, i diu «Aquest ordinador ja no està connectat. Torna'l a connectar amb el codi QR.»
- Sense cap mòbil emparellat, l'ordinador deixa d'anunciar-se i tanca el port.

## Permisos i avisos del sistema

- **iOS:** «Xarxa local» (`NSLocalNetworkUsageDescription`, `NSBonjourServices` amb `_murmur._tcp`), demanat en el moment d'emparellar, no abans.
- **macOS:** «Xarxa local» (`NSLocalNetworkUsageDescription` i `NSBonjourServices` a `Info.plist`, en tres idiomes), i el tallafoc pot preguntar el primer cop que l'ordinador escolta.
- **Windows:** el tallafoc pot preguntar el primer cop que l'ordinador escolta.

## Estadístiques

Només dos esdeveniments nous, sense contingut ni identificadors (CLAUDE.md): `mobile_paired` i `mobile_synced` (amb `minutesBucket` i `countBucket` de les reunions enviades).

## Decidit

1. **Se sincronitza sol** quan són a la mateixa xarxa, amb un interruptor per aturar-ho.
2. **L'ordinador pot tenir diversos mòbils** (iPhone i iPad); cada mòbil, un sol ordinador.
3. **Fase 2:** les reunions de l'ordinador arriben al mòbil amb el text i les notes; l'àudio, només si l'usuari el demana per a una reunió.

## Ordre de feina (part de l'ordinador)

1. [x] `core/src/sync.rs`: el codi QR, el canal xifrat, els missatges i l'enviament de fitxers que es pot reprendre, amb tests (emparellar, reconnectar, rebutjar desconeguts, un fitxer malmès, missatges grans).
2. [x] `app/src-tauri/src/mobile.rs`: la clau al clauer, els mòbils a `phones.json`, el QR, Bonjour (`mdns-sd`), el servidor i on va cada reunió que arriba (l'àudio a `recordings/`, les captures a `screens/`, marcada amb `device` i en `processing`). L'app l'obre i hi passa la revisió de parlants i Whisper (`retranscribe_meeting` amb `max_speakers`), la puntuació i el resum.
3. [x] Configuració › Mòbil (interfície, textos en tres idiomes, `DESIGN.md`). Visible per a tothom des que hi ha l'app de l'iPhone.
4. [x] `examples/fake_phone.rs`, que fa de mòbil: `pair <codi>`, `send <fitxer.wav> [títol]` i `results`.
5. [x] Provat de punta a punta amb l'app i `fake_phone` (15/11/2026).
6. [x] La part del mòbil (`mobile/ffi/src/pairing.rs` i `Sources/Pairing.swift`), provada al simulador amb `mobile/ffi/examples/fake_computer.rs`, que fa d'ordinador.
7. [ ] Provar-ho amb l'app de l'ordinador i un iPhone de debò.

## La part del mòbil

- **La clau** del mòbil és al clauer de l'iPhone (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: no surt de l'aparell ni va a iCloud). La de l'ordinador (pública) i el seu nom van a la configuració de l'app.
- **Trobar l'ordinador:** Bonjour (`NWBrowser`) dona totes les adreces que anuncien `_murmur._tcp`, en IPv4; s'hi afegeixen l'última que va respondre i les del QR. El nom que anuncia l'ordinador és aleatori, així que es proven totes: la presentació només es completa amb el nostre.
- **A la llista,** a dalt a la dreta, la icona de l'ordinador diu en quin punt és la sincronització: sense ordinador (+), al dia, quantes n'hi ha per enviar, sincronitzant (un anell que gira) o un problema (!). Tocar-la obre un full amb l'ordinador, què queda per enviar, què espera la passada final i «Sincronitza ara»; sense ordinador, la pantalla d'emparellar.
- **Quan se sincronitza:** en acabar una reunió, en tornar a l'app, estirant la llista i amb «Sincronitza ara». Mai a mitja gravació. «Envia les reunions soles» (Configuració › Ordinador) ho pot aturar.
- **Què s'ha enviat:** `sync.json` a la carpeta de dades (les reunions que l'ordinador té senceres, les que han tornat revisades i des de quan cal preguntar), perquè la reunió es quedi amb el format de l'ordinador.
- **De tornada:** la versió de l'ordinador substitueix la del mòbil (frases de Whisper, parlants, resum, traduccions). El mòbil conserva el seu àudio i, si després d'enviar-la hi has canviat el títol o el nom d'un parlant, aquests noms.
- **Les reunions de l'ordinador:** amb Configuració › Mòbil › «Reunions d'aquest ordinador al mòbil» (cap, l'última setmana, l'últim mes, els últims 3 mesos o totes), l'ordinador també hi envia les seves, només el text (frases, parlants, notes, resum), mai l'àudio ni les captures. El mòbil (1.1 o posterior) diu a `GetResults` quines en té o n'ha esborrat (`known`), i l'ordinador li envia les que falten i les que han canviat des de `since`, amb `Results { computer: true }`. El mòbil les crea (`from_computer` a `sync.json`), no les torna mai a enviar com a seves, i si se n'esborra una, no torna (`dismissed`). Els mòbils d'abans no envien `known` i només reben les seves; els ordinadors d'abans no fan cas del camp.
- **L'àudio** es busca a `recordings/<id>.ogg` de la carpeta de dades, no pel camí desat amb la reunió: iOS canvia la carpeta de l'app quan es reinstal·la o s'actualitza.
- **Per provar-ho sense l'ordinador:** `cargo run --release --example fake_computer` a `mobile/ffi` mostra un codi; l'app el pren amb `-pair <codi>` (el simulador no té càmera). Al simulador, l'app s'ha de signar (encara que sigui en local) perquè pugui fer servir el clauer.
