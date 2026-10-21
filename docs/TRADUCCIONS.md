# Traduccions de la interfície

Murmur es pot fer servir en **català**, **castellà** i **anglès**. Per defecte agafa l'idioma del sistema. Si el sistema no és en cap d'aquests tres idiomes, fa servir l'anglès. Es canvia a Configuració › General › Idioma.

L'idioma de la interfície i el de les reunions són dues coses separades. La interfície és `settings.uiLanguage`. Les reunions són `settings.language`, a Configuració › Transcripció.

## On són els textos

| Què | On |
|---|---|
| Interfície (React) | `app/src/locales/<idioma>/<espai>.json`, un espai de noms per component o mòdul |
| Menús natius, safata, avisos i errors del motor | `app/src-tauri/src/i18n.rs` |
| Textos dels permisos de macOS | `app/src-tauri/locales/<idioma>.lproj/InfoPlist.strings` |
| Instruccions per escriure la portada | `app/src/locales/<idioma>/cover.json` (`prompts`) |

El **català és la font**. Totes les claus hi han de ser. Si una clau falta en un altre idioma, surt en català.

## Com s'escriu

```tsx
import { useTranslation } from "react-i18next";

const { t } = useTranslation("player");          // espai de noms = src/locales/*/player.json
<button aria-label={t("pause")}>…</button>
t("positionValue", { time, duration })            // "{{time}} de {{duration}}"
t("speakers", { count: 3 })                       // speakers_one / speakers_other
```

- Fora de React (`lib/*.ts`) cal fer servir `t` de `@/lib/i18n`: `t("export:notes")`.
- Les dates i els números van amb `locale()` de `@/lib/i18n`, mai amb `"ca-ES"` escrit a mà.
- Mai s'han d'empalmar trossos de frase (`"Hi ha " + n + " parlants"`). Cal fer una sola clau amb variables, perquè l'ordre de les paraules canvia d'un idioma a l'altre.
- Per als plurals, cal fer servir `count` i els sufixos `_one` / `_other`.
- El que es desa a la base de dades no es tradueix. Per exemple, el to de la portada es desa com un identificador fix i es tradueix en mostrar-lo. Els noms per defecte dels parlants («Parlant 1», «Tu») es calculen en mostrar-los.
- Les claus van en anglès i en camelCase, i diuen què són (`emptyTitle`, `stopRecording`), no què diuen.

## Estil

- **Cap idioma porta guions llargs (—).**
- **Català:** és el text original. Tracta l'usuari de tu, i les ordres van en imperatiu («Obre Murmur», «Comença a gravar»).
- **Castellà (Espanya):** tracta l'usuari de tú. Els botons i els menús van en infinitiu, com a macOS («Abrir Murmur», «Empezar a grabar»). Les cometes són « ».
- **Anglès (EUA):** els menús, els botons i els títols de finestra van en *Title Case*, com a macOS («Start Recording»). Els textos d'ajuda i els missatges van en *sentence case*. Les cometes són “ ”.
- Els noms propis no es tradueixen: Murmur, Whisper, Parakeet, Gemma, Google Meet…

## Comprovar

```bash
cd app && npm run check-locales   # mateixes claus i variables en tots els idiomes
npx tsc --noEmit
```

## Afegir un idioma

1. Copia `app/src/locales/ca/` a `app/src/locales/<codi>/` i tradueix els fitxers.
2. Afegeix el codi a `UI_LANGUAGES` i `UI_LANGUAGE_NAMES` (`app/src/lib/i18n.ts`) i a `i18n.rs`.
3. Afegeix `app/src-tauri/locales/<codi>.lproj/InfoPlist.strings`, el codi a `CFBundleLocalizations` (`Info.plist`) i el fitxer a `bundle.resources` (`tauri.conf.json`).
4. Executa `npm run check-locales`.
