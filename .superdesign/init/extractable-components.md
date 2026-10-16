# Extractable components

## TopBar
- Source: `mvp/static/index.html` (`header.topbar`)
- Category: layout
- Description: Brand, Local privacy pill, recording status pill, timer
- Extractable props: status (string: "Preparat" | "Escoltant" | "Aturat"), recording (boolean), elapsed (string)
- Hardcoded: brand name "Transcriptor", waveform/lock SVGs

## RecordDock
- Source: `mvp/static/index.html` (`footer.dock`)
- Category: layout
- Description: Bottom bar with mic level meter, record/stop button, export
- Extractable props: recording (boolean), level (0–1), canExport (boolean)
- Hardcoded: labels "Gravar"/"Aturar"/"Exportar", icons

## SpeakerChip
- Source: `mvp/static/app.js` (`makeChip`)
- Category: basic
- Description: Colored pill with speaker number badge and name
- Extractable props: index (number), name (string)
- Hardcoded: hue tokens --spk-N-bg/fg

## Utterance
- Source: `mvp/static/app.js` (`addUtterance`)
- Category: basic
- Description: Speaker chip + timestamp header, paragraph of text
- Extractable props: speaker, start (mm:ss), text
- Hardcoded: typography
