# Design system — Transcriptor (meeting transcription in Catalan)

## Product context
- Desktop app (Tauri: macOS first, then Windows; later iOS/Android) that transcribes meetings **in Catalan** live, identifies who speaks, and produces a summary with decisions and tasks.
- **Everything runs locally** (privacy is a core value). Optional cloud LLM only with the user's own API key.
- Users: professionals and teams in Catalonia. They need to trust the text, fix it fast, and share a clean record.
- All UI copy in **Catalan**.

### Jobs to be done
1. Start recording in one click and read the transcript appearing live, split by speaker.
2. **During the meeting**: fix a misheard word or reassign/rename the speaker of a line inline, without stopping.
3. **After the meeting**: correct the transcript inline, rename speakers ("Parlant 2" → "Marta"), read summary / decisions / tasks, export.
4. Find past meetings in the sidebar.
5. **Take manual notes** during the meeting; each note is stored with the meeting time it was written at.
6. **Connect calendars** (Google Calendar, Apple Calendar) to auto-title meetings, suggest speaker names from invitees, and prompt to record when a meeting starts.

### Notes panel
- Right-side panel "Notes" (300px), **collapsible** from a toolbar toggle (and its own collapse chevron); when collapsed the transcript re-centers. It is the same slot as the inspector.
- Each note line starts with its grey timestamp (tabular, 12px) and plain 14px text; the last line is a text input with placeholder "Escriu una nota…".
- In the transcript, a note appears as a small accent-colored marker (note icon, 14px) in the margin next to the utterance spoken at that time; hovering a marker highlights the note and vice-versa.

### Settings window
- Native macOS Preferences window: toolbar with icon + label tabs (General, Àudio, Transcripció, Intel·ligència, Calendaris, Privacitat), grouped form rows (label left, control right), native switches, popup buttons, and "Connecta"/"Desconnecta" buttons. Calendar providers shown as rows with their name and status.

## Direction: native macOS document app
The app must feel like a well-made **native Mac app** (references: Apple Notes, Voice Memos, Craft, Granola, the user's document-editor reference). The meeting is a **document**: the transcript reads like a clean page, not a dashboard.

### Anti-"AI slop" rules (hard constraints)
- NO uppercase monospace labels, NO letter-spaced tags, NO numbered tabs ("01 RESUM"), NO decorative badges everywhere.
- NO stat bars, percentages, fake metrics or charts unless explicitly asked.
- NO gradients, NO glow, NO heavy borders, NO big colored blocks, NO bento grids, NO decorative patterns.
- NO left color bars on every paragraph. Color is used sparingly and only where it carries meaning (speaker identity, recording state, highlights).
- Few visible controls; secondary actions live in menus, toolbar or on hover.
- Copy is short, plain Catalan, sentence case.

### Window & chrome (macOS)
- Window with rounded corners (10px) and the native soft window shadow, on a light grey desktop backdrop (#E5E5E7) for the mockup.
- **Unified title bar/toolbar** (52px): traffic lights (red/yellow/green 12px circles) at top-left over the sidebar; centered or left-aligned toolbar items: small segmented control, meeting title with a chevron menu; right side: toolbar icon buttons (borderless, 28px, rounded 6px hover background).
- **Sidebar** (240px): translucent "vibrancy" look = #F2F2F4 at 80% with a very subtle backdrop blur; separated from content by a single 1px #E5E5E5 line. Section headers in small grey sentence case (11px, 600, #8E8E93), e.g. "Avui", "Ahir". Rows 28–32px, 13px text, selected row = rounded 6px fill with accent at 15% (or #DCDCE0 when unfocused). Small grey secondary text for duration.
- **Content**: white (#FFFFFF), document column centered, max 680px, generous top padding.

### Typography (system)
- Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif` (SF Pro on Mac, Segoe UI Variable on Windows). Numbers use `font-variant-numeric: tabular-nums` — no monospace font.
- UI text 13px (macOS standard), secondary 12px #8E8E93.
- Document title 28px / 700, tight (-0.01em). Section headings 17–20px / 600.
- Transcript body 15px / 1.6, color #1D1D1F.

### Color
- Text #1D1D1F, secondary #6E6E73, tertiary #8E8E93, separators #E5E5E5, hover fill #F2F2F4.
- **Accent**: macOS system blue #007AFF (selection, links, focus ring, primary buttons). One accent only.
- Recording red: #FF3B30 (record dot and stop button only).
- **Speaker colors** (soft, used as small name flags / highlight tints, always with the name):
  1 blue #3B82F6 · 2 purple #8B5CF6 · 3 orange #F59E0B · 4 green #10B981 · 5 pink #EC4899 · 6 teal #14B8A6
  - Speaker label = small rounded "name flag" (like collaborator cursor tags): 11px/600 white text on the speaker color, radius 4px, padding 1px 6px.
  - Optional selection/highlight tint of a speaker = color at 12% behind text.
- Dark mode: native dark (#1E1E1E content, #2A2A2C sidebar, text #F5F5F7, separators #3A3A3C); same accents.

### Components
- **Buttons**: macOS style — 24–28px tall, radius 6px, 13px/500. Primary = accent fill white text. Secondary = white with 1px #D1D1D6 border. Toolbar = borderless icon buttons.
- **Segmented control**: grey track #EEEEF0, radius 7px, selected segment white with hairline shadow.
- **Popover/menu**: native look — white (or light vibrancy), radius 10px, 1px rgba(0,0,0,.08) border, soft shadow (0 8px 24px rgba(0,0,0,.12)), rows 24–28px with 13px text, hover = accent fill with white text, separators, checkmark for selected, keyboard shortcuts right-aligned in grey.
- **Utterance**: speaker name flag + grey timestamp (12px, tabular) on one line, text below; 16–20px between utterances; consecutive lines of the same speaker merge without repeating the flag. Hover reveals a faint fill (#F7F7F8, radius 8px) and small icons (play, more) at the right.
- **Inline editing**: clicking text puts it in place-edit with just the caret and a 2px accent focus ring (radius 6px) — no boxes, no hint rows. Edited text can show a tiny grey "editat" after the timestamp.
- **Low confidence word**: dotted underline #C7C7CC.
- **Live partial text**: same style as body but #8E8E93, followed by a blinking caret.
- **Recording control**: compact pill in the toolbar: red dot + timer (tabular) + pause/stop icon buttons. No giant bottom bars.
- **Inspector** (right, 280px, toggleable from toolbar, like Xcode/Pages inspector): plain sections with 13px headings, not tabs-with-numbers. Use a segmented control "Resum | Acords | Tasques" if tabs are needed.
- **Tasks**: native round checkbox, text, assignee as a speaker name flag, optional due date in grey.
- Icons: SF Symbols style (use Lucide with 1.5px stroke, 16px, grey #6E6E73).

### Motion
- Native-feeling and minimal: 150–200ms ease-out; new utterances fade in; caret blink; recording dot pulse. Respect prefers-reduced-motion.

### Accessibility
- Text contrast ≥4.5:1 (secondary grey only for non-essential text). Focus ring 2px accent. Targets ≥28px desktop, ≥44px mobile. Speaker identity always has a text label, not only color.
