# Murmur

Guia per a qui treballa en aquest repositori, persones o agents de codi. Murmur és una app de Mac (Tauri 2, React i un motor en Rust) que transcriu reunions en directe, en català, castellà i anglès, distingeix qui parla i, en acabar, en pot escriure una portada amb un model local. **Tot es processa a l'ordinador.**

## On és cada cosa

| Document | Què hi ha |
|---|---|
| [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) | Com funciona per dins, per què està fet així i què s'ha mesurat |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | El que falta per fer, amb caselles |
| [`docs/design/DESIGN.md`](docs/design/DESIGN.md) | El disseny: marca, temes, components, mides |
| [`docs/TRADUCCIONS.md`](docs/TRADUCCIONS.md) | Com s'escriuen i es tradueixen els textos de la interfície |
| [`docs/PUBLICAR.md`](docs/PUBLICAR.md) | Com es publica una versió de l'app o d'un model |

| Carpeta | Què hi ha |
|---|---|
| `app/src/` | Interfície (React, shadcn/ui, i18next) |
| `app/src-tauri/src/` | Motor en Rust: àudio, transcripció, parlants, base de dades, model de llenguatge |
| `app/whisper/` | `murmur-whisper`, el procés a part que fa la passada final amb Whisper |
| `bench/`, `mvp/`, `tools/` | Banc de proves, primer prototip i scripts d'exportació de models (Python, amb `uv`) |

## Ordres

```bash
cd app && npm install && npm run tauri dev            # l'app
TRANSCRIPTOR_SIMULATE=../data/reunio-3min.wav npm run tauri dev   # amb un WAV en lloc del micròfon
cd app/src-tauri && cargo test                         # tests del motor
cd app && npx tsc --noEmit && npm run check-locales    # tipus i traduccions
```

## Regles del projecte

**Llengua**
- Codi, noms i comentaris en anglès. Documentació en català.
- Cap text visible s'escriu al codi: sempre amb `t()` i claus a `app/src/locales/`, o a `i18n.rs` des de Rust. El català és la font, i el castellà i l'anglès s'actualitzen alhora. `npm run check-locales` ha de passar.
- Cap text, en cap idioma, porta guions llargs (—).

**Disseny**
- Qualsevol canvi d'interfície segueix `docs/design/DESIGN.md`.
- Els colors només surten dels tokens `--mm-*` (`app/src/murmur-theme.css`) i de les utilitats `*-mm-*` o dels tokens de shadcn que hi apunten. Mai hexadecimals escrits a mà.
- L'àcid (#D4FF3A) mai és text ni línia sobre fons clar.
- Edició inline amb `<textarea>`, no amb `contentEditable`.

**Privadesa**
- Tot es processa en local per defecte. Qualsevol connexió al núvol ha de ser opcional i explícita.
- Si algun dia hi ha un model al núvol, serà amb la clau pròpia de l'usuari, desada al clauer del sistema, mai en text pla. Només s'hi enviaria text, mai àudio.
- Gravar una reunió requereix el consentiment de qui hi participa, i l'app ho recorda en començar.

**Models i dades**
- Les gravacions, els models i els resultats no es pugen al repositori (`data/`, `models/`, `results/`).
- Cap canvi de model sense mesurar-lo abans amb el banc de proves: WER i factor de temps real, i, si toca parlants, `bench/speakers_eval.py`.
- Objectiu mínim: un M1 amb 8 GB. Els models es carreguen per torns i cap model en directe passa de ~500 MB.

**Full de ruta**
- Quan s'acaba una tasca, es marca a `docs/ROADMAP.md`. Si canvia com funciona alguna peça, s'actualitza `docs/ARQUITECTURA.md`.

## Abans de publicar una versió

Tot el procés és a `docs/PUBLICAR.md`. El pas que és fàcil d'oblidar:

- **Si la versió porta canvis visibles, s'escriuen les novetats** que l'app mostra després d'actualitzar:
  - La versió i la data van a `RELEASES` (`app/src/lib/whatsnew.ts`).
  - De 2 a 5 novetats van a `app/src/locales/{ca,es,en}/whatsnew.json` › `releases` › `"<versió>"`. Cadascuna té `title`, un `text` d'una o dues frases i, si cal, un `link` a una pestanya de la configuració amb el seu `linkLabel`. Sense icones.
  - Les `RELEASE_NOTES` de `publish.sh` són una frase de resum d'aquestes novetats.
  - Una correcció petita pot anar sense novetats, i llavors no surt res.

## Preferències personals

Les preferències de cadascú (eines, skills, dreceres) van a `CLAUDE.local.md`, que no es puja al repositori.
