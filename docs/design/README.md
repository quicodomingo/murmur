# Paquet de disseny de Murmur

Copia aquesta carpeta a l'arrel del projecte com a `docs/design/` i afegeix això al `CLAUDE.md`:

```markdown
## Disseny
- Per a qualsevol canvi d'interfície, segueix `docs/design/DESIGN.md`. És la font de veritat.
- Colors: només a través de `MurmurPalette` (`docs/design/tokens/Theme.swift`, copiat a l'app). Mai hexadecimals escrits a mà.
- Referències visuals: `docs/design/screens/<tema>/`. Mides i textos exactes: `docs/design/mockups/<tema>/`.
- L'àcid (#D4FF3A) mai és text ni línia sobre fons clar.
- Textos en català, sense guions llargs.
```

Primers passos suggerits per a Claude Code:
1. Copiar `tokens/Theme.swift` a l'app i substituir tots els colors actuals per `palette.*`.
2. Afegir la pestanya Aparença a Configuració i desar tema i mode.
3. Aplicar els canvis de la barra lateral (logo, Nova reunió, REC), la píndola de gravació i les etiquetes de parlant.
4. Afegir la icona de la barra de menús i els avisos.
5. Posar les icones de `icons/app/` a l'AppIcon.
