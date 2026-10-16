// Murmur, tokens de color. Generat a partir del disseny; no l'editis a mà, regenera'l.
import SwiftUI

enum MurmurTheme: String, CaseIterable, Identifiable {
    case acid, mono, formigo
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .acid: return "Negre i àcid"
        case .mono: return "Monocrom"
        case .formigo: return "Formigó i vermell"
        }
    }
}

struct MurmurPalette {
    /// Fons principal de la finestra
    let background: Color
    /// Fons de la barra lateral
    let sidebar: Color
    /// Fons de la finestra de configuració
    let settingsBackground: Color
    /// Text principal
    let textPrimary: Color
    /// Text secundari, metadades
    let textSecondary: Color
    /// Text terciari, durades, etiquetes de grup
    let textTertiary: Color
    /// Línies i vores
    let separator: Color
    /// Fons suau (botó actiu de barra d'eines)
    let fillSubtle: Color
    /// Camp de cerca de la barra lateral
    let searchField: Color
    /// Fons de camps i selectors
    let field: Color
    /// Fons de la fila seleccionada
    let sidebarSelection: Color
    /// Barreta vertical de la fila seleccionada
    let sidebarSelectionBar: Color
    /// Botó principal (Exporta, Comença a gravar)
    let accent: Color
    /// Text i icona sobre accent
    let onAccent: Color
    /// Botó Nova reunió
    let newMeeting: Color
    /// Text del botó Nova reunió
    let onNewMeeting: Color
    /// Píndola de gravació de la barra d'eines
    let recordingPill: Color
    /// Text de la píndola de gravació
    let onRecordingPill: Color
    /// Vora de la píndola de gravació
    let recordingPillBorder: Color
    /// Barres animades de nivell dins la píndola
    let recordingLevel: Color
    /// Text REC a la barra lateral
    let recordingLabel: Color
    /// Marques de temps i enllaços al minut
    let timestamp: Color
    /// Enllaços (Restableix, llicències)
    let link: Color
    /// Cursor de la transcripció en directe
    let caret: Color
    /// Color de "Tu" (parlant local)
    let you: Color
    /// Text sobre "Tu"
    let onYou: Color
    /// Interruptor actiu, slider, mesurador
    let toggleOn: Color
    /// Botó de l'interruptor actiu
    let toggleKnob: Color
    /// Interruptor inactiu
    let toggleOff: Color
    /// Segments buits del mesurador, pista del slider
    let meterOff: Color
    /// Fons del control segmentat
    let segmentedTrack: Color
    /// Segment seleccionat
    let segmentedSelected: Color
    /// Pestanya seleccionada de la configuració
    let tabSelected: Color
    /// Fons de la icona petita de la barra lateral
    let logoBackground: Color
    /// Primera barra del logo
    let logoBar1: Color
    /// Segona barra del logo
    let logoBar2: Color
    /// Fons de l'avís
    let toastBackground: Color
    /// Text de l'avís
    let toastText: Color
    /// Text secundari de l'avís
    let toastSecondary: Color
    /// Vora i pista de progrés de l'avís
    let toastBorder: Color
    /// Barra de compte enrere de l'avís
    let toastProgress: Color
    /// Parlant 1 (gràfic)
    let speaker1: Color
    /// Parlant 2 (gràfic)
    let speaker2: Color
    /// Parlant 3 (gràfic)
    let speaker3: Color
    /// Parlant 4 (gràfic)
    let speaker4: Color
    /// Fons de l'etiqueta del parlant 1
    let speaker1Tint: Color
    /// Text de l'etiqueta del parlant 1
    let speaker1Text: Color
    /// Fons de l'etiqueta del parlant 2
    let speaker2Tint: Color
    /// Text de l'etiqueta del parlant 2
    let speaker2Text: Color
    /// Fons de l'etiqueta del parlant 3
    let speaker3Tint: Color
    /// Text de l'etiqueta del parlant 3
    let speaker3Text: Color
    /// Fons de l'etiqueta del parlant 4
    let speaker4Tint: Color
    /// Text de l'etiqueta del parlant 4
    let speaker4Text: Color
    /// Punt vermell de gravació (igual a tots els temes)
    let recordingDot: Color
}

extension MurmurPalette {
    static func palette(for theme: MurmurTheme, scheme: ColorScheme) -> MurmurPalette {
        switch (theme, scheme) {
        case (.acid, .light): return .acidLight
        case (.acid, .dark): return .acidDark
        case (.mono, .light): return .monoLight
        case (.mono, .dark): return .monoDark
        case (.formigo, .light): return .formigoLight
        case (.formigo, .dark): return .formigoDark
        default: return .acidLight
        }
    }

    static let acidLight = MurmurPalette(
        background: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        sidebar: Color(.sRGB, red: 0.957, green: 0.957, blue: 0.957, opacity: 1.000),
        settingsBackground: Color(.sRGB, red: 0.965, green: 0.965, blue: 0.965, opacity: 1.000),
        textPrimary: Color(.sRGB, red: 0.067, green: 0.067, blue: 0.067, opacity: 1.000),
        textSecondary: Color(.sRGB, red: 0.420, green: 0.420, blue: 0.420, opacity: 1.000),
        textTertiary: Color(.sRGB, red: 0.561, green: 0.561, blue: 0.561, opacity: 1.000),
        separator: Color(.sRGB, red: 0.910, green: 0.910, blue: 0.910, opacity: 1.000),
        fillSubtle: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        searchField: Color(.sRGB, red: 0.000, green: 0.000, blue: 0.000, opacity: 0.051),
        field: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        sidebarSelection: Color(.sRGB, red: 0.902, green: 0.902, blue: 0.902, opacity: 1.000),
        sidebarSelectionBar: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        accent: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        onAccent: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        newMeeting: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        onNewMeeting: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        recordingPill: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        onRecordingPill: Color(.sRGB, red: 0.961, green: 0.961, blue: 0.961, opacity: 1.000),
        recordingPillBorder: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        recordingLevel: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        recordingLabel: Color(.sRGB, red: 0.843, green: 0.000, blue: 0.082, opacity: 1.000),
        timestamp: Color(.sRGB, red: 0.306, green: 0.388, blue: 0.000, opacity: 1.000),
        link: Color(.sRGB, red: 0.306, green: 0.388, blue: 0.000, opacity: 1.000),
        caret: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        you: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        onYou: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        toggleOn: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        toggleKnob: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        toggleOff: Color(.sRGB, red: 0.851, green: 0.851, blue: 0.863, opacity: 1.000),
        meterOff: Color(.sRGB, red: 0.898, green: 0.898, blue: 0.898, opacity: 1.000),
        segmentedTrack: Color(.sRGB, red: 0.000, green: 0.000, blue: 0.000, opacity: 0.059),
        segmentedSelected: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        tabSelected: Color(.sRGB, red: 0.925, green: 0.925, blue: 0.925, opacity: 1.000),
        logoBackground: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        logoBar1: Color(.sRGB, red: 0.961, green: 0.961, blue: 0.961, opacity: 1.000),
        logoBar2: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        toastBackground: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        toastText: Color(.sRGB, red: 0.067, green: 0.067, blue: 0.067, opacity: 1.000),
        toastSecondary: Color(.sRGB, red: 0.420, green: 0.420, blue: 0.420, opacity: 1.000),
        toastBorder: Color(.sRGB, red: 0.894, green: 0.894, blue: 0.894, opacity: 1.000),
        toastProgress: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        speaker1: Color(.sRGB, red: 0.416, green: 0.333, blue: 0.961, opacity: 1.000),
        speaker2: Color(.sRGB, red: 0.941, green: 0.353, blue: 0.235, opacity: 1.000),
        speaker3: Color(.sRGB, red: 0.055, green: 0.604, blue: 0.655, opacity: 1.000),
        speaker4: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 1.000),
        speaker1Tint: Color(.sRGB, red: 0.416, green: 0.333, blue: 0.961, opacity: 0.141),
        speaker1Text: Color(.sRGB, red: 0.278, green: 0.200, blue: 0.820, opacity: 1.000),
        speaker2Tint: Color(.sRGB, red: 0.941, green: 0.353, blue: 0.235, opacity: 0.141),
        speaker2Text: Color(.sRGB, red: 0.722, green: 0.212, blue: 0.110, opacity: 1.000),
        speaker3Tint: Color(.sRGB, red: 0.055, green: 0.604, blue: 0.655, opacity: 0.141),
        speaker3Text: Color(.sRGB, red: 0.031, green: 0.439, blue: 0.478, opacity: 1.000),
        speaker4Tint: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 0.141),
        speaker4Text: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 1.000),
        recordingDot: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.188, opacity: 1.000)
    )

    static let acidDark = MurmurPalette(
        background: Color(.sRGB, red: 0.055, green: 0.055, blue: 0.055, opacity: 1.000),
        sidebar: Color(.sRGB, red: 0.075, green: 0.075, blue: 0.075, opacity: 1.000),
        settingsBackground: Color(.sRGB, red: 0.055, green: 0.055, blue: 0.055, opacity: 1.000),
        textPrimary: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        textSecondary: Color(.sRGB, red: 0.604, green: 0.604, blue: 0.604, opacity: 1.000),
        textTertiary: Color(.sRGB, red: 0.431, green: 0.431, blue: 0.431, opacity: 1.000),
        separator: Color(.sRGB, red: 0.141, green: 0.141, blue: 0.141, opacity: 1.000),
        fillSubtle: Color(.sRGB, red: 0.110, green: 0.110, blue: 0.110, opacity: 1.000),
        searchField: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 0.071),
        field: Color(.sRGB, red: 0.102, green: 0.102, blue: 0.102, opacity: 1.000),
        sidebarSelection: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 0.102),
        sidebarSelectionBar: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        accent: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        onAccent: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        newMeeting: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        onNewMeeting: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        recordingPill: Color(.sRGB, red: 0.102, green: 0.102, blue: 0.102, opacity: 1.000),
        onRecordingPill: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        recordingPillBorder: Color(.sRGB, red: 0.180, green: 0.180, blue: 0.180, opacity: 1.000),
        recordingLevel: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        recordingLabel: Color(.sRGB, red: 1.000, green: 0.412, blue: 0.380, opacity: 1.000),
        timestamp: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        link: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        caret: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        you: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        onYou: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        toggleOn: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        toggleKnob: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        toggleOff: Color(.sRGB, red: 0.227, green: 0.227, blue: 0.235, opacity: 1.000),
        meterOff: Color(.sRGB, red: 0.165, green: 0.165, blue: 0.165, opacity: 1.000),
        segmentedTrack: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 0.078),
        segmentedSelected: Color(.sRGB, red: 0.173, green: 0.173, blue: 0.173, opacity: 1.000),
        tabSelected: Color(.sRGB, red: 0.133, green: 0.133, blue: 0.133, opacity: 1.000),
        logoBackground: Color(.sRGB, red: 0.043, green: 0.043, blue: 0.043, opacity: 1.000),
        logoBar1: Color(.sRGB, red: 0.961, green: 0.961, blue: 0.961, opacity: 1.000),
        logoBar2: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        toastBackground: Color(.sRGB, red: 0.118, green: 0.118, blue: 0.118, opacity: 1.000),
        toastText: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        toastSecondary: Color(.sRGB, red: 0.604, green: 0.604, blue: 0.604, opacity: 1.000),
        toastBorder: Color(.sRGB, red: 0.200, green: 0.200, blue: 0.200, opacity: 1.000),
        toastProgress: Color(.sRGB, red: 0.831, green: 1.000, blue: 0.227, opacity: 1.000),
        speaker1: Color(.sRGB, red: 0.561, green: 0.502, blue: 1.000, opacity: 1.000),
        speaker2: Color(.sRGB, red: 1.000, green: 0.478, blue: 0.361, opacity: 1.000),
        speaker3: Color(.sRGB, red: 0.180, green: 0.769, blue: 0.816, opacity: 1.000),
        speaker4: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 1.000),
        speaker1Tint: Color(.sRGB, red: 0.561, green: 0.502, blue: 1.000, opacity: 0.180),
        speaker1Text: Color(.sRGB, red: 0.663, green: 0.616, blue: 1.000, opacity: 1.000),
        speaker2Tint: Color(.sRGB, red: 1.000, green: 0.478, blue: 0.361, opacity: 0.180),
        speaker2Text: Color(.sRGB, red: 1.000, green: 0.580, blue: 0.471, opacity: 1.000),
        speaker3Tint: Color(.sRGB, red: 0.180, green: 0.769, blue: 0.816, opacity: 0.180),
        speaker3Text: Color(.sRGB, red: 0.365, green: 0.839, blue: 0.878, opacity: 1.000),
        speaker4Tint: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 0.180),
        speaker4Text: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 1.000),
        recordingDot: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.188, opacity: 1.000)
    )

    static let monoLight = MurmurPalette(
        background: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        sidebar: Color(.sRGB, red: 0.961, green: 0.961, blue: 0.961, opacity: 1.000),
        settingsBackground: Color(.sRGB, red: 0.965, green: 0.965, blue: 0.965, opacity: 1.000),
        textPrimary: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        textSecondary: Color(.sRGB, red: 0.420, green: 0.420, blue: 0.420, opacity: 1.000),
        textTertiary: Color(.sRGB, red: 0.561, green: 0.561, blue: 0.561, opacity: 1.000),
        separator: Color(.sRGB, red: 0.902, green: 0.902, blue: 0.902, opacity: 1.000),
        fillSubtle: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        searchField: Color(.sRGB, red: 0.000, green: 0.000, blue: 0.000, opacity: 0.051),
        field: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        sidebarSelection: Color(.sRGB, red: 0.910, green: 0.910, blue: 0.910, opacity: 1.000),
        sidebarSelectionBar: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        accent: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        onAccent: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        newMeeting: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        onNewMeeting: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        recordingPill: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        onRecordingPill: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        recordingPillBorder: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        recordingLevel: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        recordingLabel: Color(.sRGB, red: 0.843, green: 0.000, blue: 0.082, opacity: 1.000),
        timestamp: Color(.sRGB, red: 0.333, green: 0.333, blue: 0.333, opacity: 1.000),
        link: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        caret: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        you: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        onYou: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        toggleOn: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        toggleKnob: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        toggleOff: Color(.sRGB, red: 0.851, green: 0.851, blue: 0.863, opacity: 1.000),
        meterOff: Color(.sRGB, red: 0.898, green: 0.898, blue: 0.898, opacity: 1.000),
        segmentedTrack: Color(.sRGB, red: 0.000, green: 0.000, blue: 0.000, opacity: 0.059),
        segmentedSelected: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        tabSelected: Color(.sRGB, red: 0.925, green: 0.925, blue: 0.925, opacity: 1.000),
        logoBackground: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        logoBar1: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        logoBar2: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 0.451),
        toastBackground: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        toastText: Color(.sRGB, red: 0.067, green: 0.067, blue: 0.067, opacity: 1.000),
        toastSecondary: Color(.sRGB, red: 0.420, green: 0.420, blue: 0.420, opacity: 1.000),
        toastBorder: Color(.sRGB, red: 0.894, green: 0.894, blue: 0.894, opacity: 1.000),
        toastProgress: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        speaker1: Color(.sRGB, red: 0.416, green: 0.333, blue: 0.961, opacity: 1.000),
        speaker2: Color(.sRGB, red: 0.941, green: 0.353, blue: 0.235, opacity: 1.000),
        speaker3: Color(.sRGB, red: 0.055, green: 0.604, blue: 0.655, opacity: 1.000),
        speaker4: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 1.000),
        speaker1Tint: Color(.sRGB, red: 0.416, green: 0.333, blue: 0.961, opacity: 0.141),
        speaker1Text: Color(.sRGB, red: 0.278, green: 0.200, blue: 0.820, opacity: 1.000),
        speaker2Tint: Color(.sRGB, red: 0.941, green: 0.353, blue: 0.235, opacity: 0.141),
        speaker2Text: Color(.sRGB, red: 0.722, green: 0.212, blue: 0.110, opacity: 1.000),
        speaker3Tint: Color(.sRGB, red: 0.055, green: 0.604, blue: 0.655, opacity: 0.141),
        speaker3Text: Color(.sRGB, red: 0.031, green: 0.439, blue: 0.478, opacity: 1.000),
        speaker4Tint: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 0.141),
        speaker4Text: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 1.000),
        recordingDot: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.188, opacity: 1.000)
    )

    static let monoDark = MurmurPalette(
        background: Color(.sRGB, red: 0.055, green: 0.055, blue: 0.055, opacity: 1.000),
        sidebar: Color(.sRGB, red: 0.075, green: 0.075, blue: 0.075, opacity: 1.000),
        settingsBackground: Color(.sRGB, red: 0.055, green: 0.055, blue: 0.055, opacity: 1.000),
        textPrimary: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        textSecondary: Color(.sRGB, red: 0.604, green: 0.604, blue: 0.604, opacity: 1.000),
        textTertiary: Color(.sRGB, red: 0.431, green: 0.431, blue: 0.431, opacity: 1.000),
        separator: Color(.sRGB, red: 0.149, green: 0.149, blue: 0.149, opacity: 1.000),
        fillSubtle: Color(.sRGB, red: 0.110, green: 0.110, blue: 0.110, opacity: 1.000),
        searchField: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 0.071),
        field: Color(.sRGB, red: 0.102, green: 0.102, blue: 0.102, opacity: 1.000),
        sidebarSelection: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 0.078),
        sidebarSelectionBar: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        accent: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        onAccent: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        newMeeting: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        onNewMeeting: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        recordingPill: Color(.sRGB, red: 0.110, green: 0.110, blue: 0.110, opacity: 1.000),
        onRecordingPill: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        recordingPillBorder: Color(.sRGB, red: 0.180, green: 0.180, blue: 0.180, opacity: 1.000),
        recordingLevel: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        recordingLabel: Color(.sRGB, red: 1.000, green: 0.412, blue: 0.380, opacity: 1.000),
        timestamp: Color(.sRGB, red: 0.741, green: 0.741, blue: 0.741, opacity: 1.000),
        link: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        caret: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        you: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        onYou: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        toggleOn: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        toggleKnob: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        toggleOff: Color(.sRGB, red: 0.227, green: 0.227, blue: 0.235, opacity: 1.000),
        meterOff: Color(.sRGB, red: 0.165, green: 0.165, blue: 0.165, opacity: 1.000),
        segmentedTrack: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 0.078),
        segmentedSelected: Color(.sRGB, red: 0.173, green: 0.173, blue: 0.173, opacity: 1.000),
        tabSelected: Color(.sRGB, red: 0.133, green: 0.133, blue: 0.133, opacity: 1.000),
        logoBackground: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        logoBar1: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 1.000),
        logoBar2: Color(.sRGB, red: 0.039, green: 0.039, blue: 0.039, opacity: 0.400),
        toastBackground: Color(.sRGB, red: 0.118, green: 0.118, blue: 0.118, opacity: 1.000),
        toastText: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        toastSecondary: Color(.sRGB, red: 0.604, green: 0.604, blue: 0.604, opacity: 1.000),
        toastBorder: Color(.sRGB, red: 0.200, green: 0.200, blue: 0.200, opacity: 1.000),
        toastProgress: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        speaker1: Color(.sRGB, red: 0.561, green: 0.502, blue: 1.000, opacity: 1.000),
        speaker2: Color(.sRGB, red: 1.000, green: 0.478, blue: 0.361, opacity: 1.000),
        speaker3: Color(.sRGB, red: 0.180, green: 0.769, blue: 0.816, opacity: 1.000),
        speaker4: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 1.000),
        speaker1Tint: Color(.sRGB, red: 0.561, green: 0.502, blue: 1.000, opacity: 0.180),
        speaker1Text: Color(.sRGB, red: 0.663, green: 0.616, blue: 1.000, opacity: 1.000),
        speaker2Tint: Color(.sRGB, red: 1.000, green: 0.478, blue: 0.361, opacity: 0.180),
        speaker2Text: Color(.sRGB, red: 1.000, green: 0.580, blue: 0.471, opacity: 1.000),
        speaker3Tint: Color(.sRGB, red: 0.180, green: 0.769, blue: 0.816, opacity: 0.180),
        speaker3Text: Color(.sRGB, red: 0.365, green: 0.839, blue: 0.878, opacity: 1.000),
        speaker4Tint: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 0.180),
        speaker4Text: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 1.000),
        recordingDot: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.188, opacity: 1.000)
    )

    static let formigoLight = MurmurPalette(
        background: Color(.sRGB, red: 0.980, green: 0.980, blue: 0.973, opacity: 1.000),
        sidebar: Color(.sRGB, red: 0.925, green: 0.929, blue: 0.914, opacity: 1.000),
        settingsBackground: Color(.sRGB, red: 0.945, green: 0.949, blue: 0.933, opacity: 1.000),
        textPrimary: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.071, opacity: 1.000),
        textSecondary: Color(.sRGB, red: 0.392, green: 0.396, blue: 0.373, opacity: 1.000),
        textTertiary: Color(.sRGB, red: 0.549, green: 0.553, blue: 0.525, opacity: 1.000),
        separator: Color(.sRGB, red: 0.875, green: 0.878, blue: 0.859, opacity: 1.000),
        fillSubtle: Color(.sRGB, red: 0.933, green: 0.937, blue: 0.922, opacity: 1.000),
        searchField: Color(.sRGB, red: 0.000, green: 0.000, blue: 0.000, opacity: 0.051),
        field: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        sidebarSelection: Color(.sRGB, red: 0.871, green: 0.875, blue: 0.851, opacity: 1.000),
        sidebarSelectionBar: Color(.sRGB, red: 0.882, green: 0.024, blue: 0.000, opacity: 1.000),
        accent: Color(.sRGB, red: 0.882, green: 0.024, blue: 0.000, opacity: 1.000),
        onAccent: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        newMeeting: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.071, opacity: 1.000),
        onNewMeeting: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        recordingPill: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.071, opacity: 1.000),
        onRecordingPill: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.933, opacity: 1.000),
        recordingPillBorder: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.071, opacity: 1.000),
        recordingLevel: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        recordingLabel: Color(.sRGB, red: 0.843, green: 0.000, blue: 0.082, opacity: 1.000),
        timestamp: Color(.sRGB, red: 0.722, green: 0.020, blue: 0.000, opacity: 1.000),
        link: Color(.sRGB, red: 0.722, green: 0.020, blue: 0.000, opacity: 1.000),
        caret: Color(.sRGB, red: 0.882, green: 0.024, blue: 0.000, opacity: 1.000),
        you: Color(.sRGB, red: 0.882, green: 0.024, blue: 0.000, opacity: 1.000),
        onYou: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        toggleOn: Color(.sRGB, red: 0.882, green: 0.024, blue: 0.000, opacity: 1.000),
        toggleKnob: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        toggleOff: Color(.sRGB, red: 0.851, green: 0.851, blue: 0.863, opacity: 1.000),
        meterOff: Color(.sRGB, red: 0.898, green: 0.898, blue: 0.898, opacity: 1.000),
        segmentedTrack: Color(.sRGB, red: 0.000, green: 0.000, blue: 0.000, opacity: 0.059),
        segmentedSelected: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        tabSelected: Color(.sRGB, red: 0.886, green: 0.890, blue: 0.871, opacity: 1.000),
        logoBackground: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.071, opacity: 1.000),
        logoBar1: Color(.sRGB, red: 0.827, green: 0.831, blue: 0.820, opacity: 1.000),
        logoBar2: Color(.sRGB, red: 0.882, green: 0.024, blue: 0.000, opacity: 1.000),
        toastBackground: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 1.000),
        toastText: Color(.sRGB, red: 0.067, green: 0.067, blue: 0.067, opacity: 1.000),
        toastSecondary: Color(.sRGB, red: 0.420, green: 0.420, blue: 0.420, opacity: 1.000),
        toastBorder: Color(.sRGB, red: 0.894, green: 0.894, blue: 0.894, opacity: 1.000),
        toastProgress: Color(.sRGB, red: 0.882, green: 0.024, blue: 0.000, opacity: 1.000),
        speaker1: Color(.sRGB, red: 0.416, green: 0.333, blue: 0.961, opacity: 1.000),
        speaker2: Color(.sRGB, red: 0.788, green: 0.541, blue: 0.000, opacity: 1.000),
        speaker3: Color(.sRGB, red: 0.055, green: 0.604, blue: 0.655, opacity: 1.000),
        speaker4: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 1.000),
        speaker1Tint: Color(.sRGB, red: 0.416, green: 0.333, blue: 0.961, opacity: 0.141),
        speaker1Text: Color(.sRGB, red: 0.278, green: 0.200, blue: 0.820, opacity: 1.000),
        speaker2Tint: Color(.sRGB, red: 0.788, green: 0.541, blue: 0.000, opacity: 0.161),
        speaker2Text: Color(.sRGB, red: 0.478, green: 0.329, blue: 0.000, opacity: 1.000),
        speaker3Tint: Color(.sRGB, red: 0.055, green: 0.604, blue: 0.655, opacity: 0.141),
        speaker3Text: Color(.sRGB, red: 0.031, green: 0.439, blue: 0.478, opacity: 1.000),
        speaker4Tint: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 0.141),
        speaker4Text: Color(.sRGB, red: 0.851, green: 0.251, blue: 0.561, opacity: 1.000),
        recordingDot: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.188, opacity: 1.000)
    )

    static let formigoDark = MurmurPalette(
        background: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.067, opacity: 1.000),
        sidebar: Color(.sRGB, red: 0.094, green: 0.094, blue: 0.086, opacity: 1.000),
        settingsBackground: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.067, opacity: 1.000),
        textPrimary: Color(.sRGB, red: 0.910, green: 0.910, blue: 0.894, opacity: 1.000),
        textSecondary: Color(.sRGB, red: 0.604, green: 0.604, blue: 0.580, opacity: 1.000),
        textTertiary: Color(.sRGB, red: 0.424, green: 0.424, blue: 0.400, opacity: 1.000),
        separator: Color(.sRGB, red: 0.165, green: 0.165, blue: 0.153, opacity: 1.000),
        fillSubtle: Color(.sRGB, red: 0.118, green: 0.118, blue: 0.110, opacity: 1.000),
        searchField: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 0.071),
        field: Color(.sRGB, red: 0.102, green: 0.102, blue: 0.102, opacity: 1.000),
        sidebarSelection: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 0.141),
        sidebarSelectionBar: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        accent: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        onAccent: Color(.sRGB, red: 0.055, green: 0.055, blue: 0.051, opacity: 1.000),
        newMeeting: Color(.sRGB, red: 0.910, green: 0.910, blue: 0.894, opacity: 1.000),
        onNewMeeting: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.067, opacity: 1.000),
        recordingPill: Color(.sRGB, red: 0.118, green: 0.118, blue: 0.110, opacity: 1.000),
        onRecordingPill: Color(.sRGB, red: 0.910, green: 0.910, blue: 0.894, opacity: 1.000),
        recordingPillBorder: Color(.sRGB, red: 0.200, green: 0.200, blue: 0.184, opacity: 1.000),
        recordingLevel: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        recordingLabel: Color(.sRGB, red: 1.000, green: 0.412, blue: 0.380, opacity: 1.000),
        timestamp: Color(.sRGB, red: 1.000, green: 0.416, blue: 0.353, opacity: 1.000),
        link: Color(.sRGB, red: 1.000, green: 0.416, blue: 0.353, opacity: 1.000),
        caret: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        you: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        onYou: Color(.sRGB, red: 0.055, green: 0.055, blue: 0.051, opacity: 1.000),
        toggleOn: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        toggleKnob: Color(.sRGB, red: 0.071, green: 0.071, blue: 0.067, opacity: 1.000),
        toggleOff: Color(.sRGB, red: 0.227, green: 0.227, blue: 0.235, opacity: 1.000),
        meterOff: Color(.sRGB, red: 0.165, green: 0.165, blue: 0.165, opacity: 1.000),
        segmentedTrack: Color(.sRGB, red: 1.000, green: 1.000, blue: 1.000, opacity: 0.078),
        segmentedSelected: Color(.sRGB, red: 0.173, green: 0.173, blue: 0.161, opacity: 1.000),
        tabSelected: Color(.sRGB, red: 0.141, green: 0.141, blue: 0.133, opacity: 1.000),
        logoBackground: Color(.sRGB, red: 0.165, green: 0.165, blue: 0.153, opacity: 1.000),
        logoBar1: Color(.sRGB, red: 0.827, green: 0.831, blue: 0.820, opacity: 1.000),
        logoBar2: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        toastBackground: Color(.sRGB, red: 0.118, green: 0.118, blue: 0.118, opacity: 1.000),
        toastText: Color(.sRGB, red: 0.949, green: 0.949, blue: 0.949, opacity: 1.000),
        toastSecondary: Color(.sRGB, red: 0.604, green: 0.604, blue: 0.604, opacity: 1.000),
        toastBorder: Color(.sRGB, red: 0.200, green: 0.200, blue: 0.200, opacity: 1.000),
        toastProgress: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.157, opacity: 1.000),
        speaker1: Color(.sRGB, red: 0.561, green: 0.502, blue: 1.000, opacity: 1.000),
        speaker2: Color(.sRGB, red: 0.910, green: 0.694, blue: 0.227, opacity: 1.000),
        speaker3: Color(.sRGB, red: 0.180, green: 0.769, blue: 0.816, opacity: 1.000),
        speaker4: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 1.000),
        speaker1Tint: Color(.sRGB, red: 0.561, green: 0.502, blue: 1.000, opacity: 0.180),
        speaker1Text: Color(.sRGB, red: 0.663, green: 0.616, blue: 1.000, opacity: 1.000),
        speaker2Tint: Color(.sRGB, red: 0.910, green: 0.694, blue: 0.227, opacity: 0.180),
        speaker2Text: Color(.sRGB, red: 0.941, green: 0.769, blue: 0.388, opacity: 1.000),
        speaker3Tint: Color(.sRGB, red: 0.180, green: 0.769, blue: 0.816, opacity: 0.180),
        speaker3Text: Color(.sRGB, red: 0.365, green: 0.839, blue: 0.878, opacity: 1.000),
        speaker4Tint: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 0.180),
        speaker4Text: Color(.sRGB, red: 0.941, green: 0.384, blue: 0.682, opacity: 1.000),
        recordingDot: Color(.sRGB, red: 1.000, green: 0.231, blue: 0.188, opacity: 1.000)
    )

}

private struct MurmurPaletteKey: EnvironmentKey {
    static let defaultValue = MurmurPalette.acidLight
}

extension EnvironmentValues {
    var murmur: MurmurPalette {
        get { self[MurmurPaletteKey.self] }
        set { self[MurmurPaletteKey.self] = newValue }
    }
}

/// Ús: .murmurTheme(.acid) a l'arrel; després @Environment(\.murmur) var palette
struct MurmurThemeModifier: ViewModifier {
    let theme: MurmurTheme
    @Environment(\.colorScheme) private var scheme
    func body(content: Content) -> some View {
        content.environment(\.murmur, MurmurPalette.palette(for: theme, scheme: scheme))
    }
}

extension View {
    func murmurTheme(_ theme: MurmurTheme) -> some View { modifier(MurmurThemeModifier(theme: theme)) }
}
