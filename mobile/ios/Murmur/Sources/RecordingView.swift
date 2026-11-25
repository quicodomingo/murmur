import AVFoundation
import SwiftUI

enum MeetingTab: Hashable { case summary, transcript, notes }

/// Recording: the card with the waveform, the ruler and the timer; the transcript or the notes;
/// and, within reach of the thumb, Marca, Pausa and Atura.
struct RecordingView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.murmur) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    var done: (String?) -> Void
    @State private var tab: MeetingTab = .transcript
    @FocusState private var editing: UUID?
    @State private var camera = false
    @State private var stopping = false
    /// Atura was tapped once: it turns red, "Toca per aturar", for 4 s (as the desktop's indicator).
    @State private var confirmStop = false
    /// The speaker being renamed (the label's menu).
    @State private var naming: Speaker?
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var confirmDiscard = false
    @AppStorage("micInput") private var micInput = ""

    /// The …: rename the meeting, another microphone without stopping, or throw it away. What's
    /// chosen at the start (the language, who's in the room) can't change in the middle.
    private var moreMenu: some View {
        Menu {
            Button(L("meeting.rename"), systemImage: "pencil") {
                newTitle = store.live?.title ?? ""
                renaming = true
            }
            if Microphone.simulated == nil {
                Menu {
                    Picker(L("settings.microphone"), selection: Binding(get: { micInput }, set: { uid in
                        let bluetooth: Set<AVAudioSession.Port> = [.bluetoothHFP, .bluetoothLE, .bluetoothA2DP]
                        let port = Microphone.inputsNow().first { $0.uid == uid }
                        store.useInput(uid, bluetooth: port.map { bluetooth.contains($0.portType) } ?? false)
                    })) {
                        Text(L("settings.micAuto")).tag("")
                        ForEach(Microphone.inputsNow(), id: \.uid) { Text($0.portName).tag($0.uid) }
                    }
                } label: {
                    Label(L("settings.microphone"), systemImage: "mic")
                }
            }
            Divider()
            Button(L("recMenu.discard"), systemImage: "trash", role: .destructive) { confirmDiscard = true }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 17, weight: .medium)).frame(width: 44, height: 44)
                .background(palette.fillSubtle, in: Circle())
        }
        .accessibilityLabel(L("recMenu.more"))
    }

    private func actions(_ live: LiveMeeting?) -> SpeakerActions {
        SpeakerActions(
            speakers: live?.speakers ?? [],
            rename: { naming = $0 },
            reassign: { store.reassignLiveLine($0, to: $1) },
            merge: { store.mergeLiveSpeakers($0, into: $1) })
    }

    var body: some View {
        let live = store.live
        VStack(spacing: 0) {
            HStack {
                CircleButton(systemImage: "chevron.left", label: L("rec.back")) { dismiss() }
                Spacer()
                Text(live?.title ?? "").font(.system(size: 17, weight: .semibold)).lineLimit(1)
                Spacer()
                moreMenu
            }
            .padding(.horizontal, 16).frame(height: 56)

            RecordingCard(live: live)
                .padding(.horizontal, 16).padding(.top, 4)

            Segmented(options: [(MeetingTab.transcript, L("rec.transcript")), (.notes, notesLabel(live))], selection: $tab)
                .padding(.horizontal, 16).padding(.top, 14)

            Group {
                if tab == .transcript { transcript(live) } else { notes(live) }
            }
            // The text fades out at the bottom through a mask, not a band of the background colour:
            // the voice's light behind it shows through.
            .mask {
                VStack(spacing: 0) {
                    Color.black
                    LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: 44)
                }
            }
            // "Parlant 3 ara és Laia · Desfés", above the controls.
            if let toast = store.toast {
                ToastView(toast: toast) { withAnimation { store.toast = nil } }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .padding(.bottom, 6)
            }
            // Writing a note: the format bar takes the controls' place, above the keyboard.
            if editing != nil {
                NotesFormatBar(blocks: notesBinding, focus: $editing, photo: { camera = true }, seconds: { store.meter.seconds })
            } else {
                controls(live)
            }
        }
        .fullScreenCover(isPresented: $camera) {
            CameraPicker { store.addPhoto($0) }.ignoresSafeArea()
        }
        .background {
            ZStack(alignment: .bottom) {
                palette.background
                VoiceGlow(meter: store.meter, paused: live?.paused ?? true)
            }
            .ignoresSafeArea()
        }
        .foregroundStyle(palette.textPrimary)
        .toolbar(.hidden, for: .navigationBar)
        .speakerNameAlert($naming) { store.nameLiveSpeaker($0.id, $1) }
        .renameAlert(isPresented: $renaming, title: $newTitle) { store.renameLive($0) }
        .confirmationDialog(L("recMenu.discardTitle"), isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button(L("recMenu.discardConfirm"), role: .destructive) {
                stopping = true
                Task {
                    await store.discard()
                    dismiss()
                }
            }
        } message: {
            Text(L("recMenu.discardMessage"))
        }
        .animation(.spring(duration: 0.3), value: store.toast?.id)
        // `-autostop <seconds>` (development): stops by itself, to try the end without touching the screen.
        .task {
            let args = ProcessInfo.processInfo.arguments
            guard let i = args.firstIndex(of: "-autostop"), i + 1 < args.count, let after = Double(args[i + 1]) else { return }
            try? await Task.sleep(for: .seconds(after))
            store.mark()
            stopping = true
            done(await store.stop())
        }
        .onChange(of: store.live == nil) { _, ended in
            if ended && !stopping { dismiss() }
        }
    }

    private func notesLabel(_ live: LiveMeeting?) -> String {
        let n = live?.notes.noteCount ?? 0
        return n > 0 ? "\(L("rec.notes")) · \(n)" : L("rec.notes")
    }

    /// The recording's notes, to edit in place.
    private var notesBinding: Binding<[NoteBlock]> {
        Binding(get: { store.live?.notes ?? [] }, set: { store.live?.notes = $0 })
    }

    private func transcript(_ live: LiveMeeting?) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if (live?.lines.isEmpty ?? true) && (live?.partial.isEmpty ?? true) {
                        Text(L("rec.listening")).font(.system(size: 17)).foregroundStyle(palette.textTertiary).padding(.top, 8)
                    }
                    ForEach(live?.lines ?? []) { line in
                        let speaker = live?.speaker(of: line) ?? Int(line.speaker)
                        LineView(id: line.id, speaker: speaker, name: live?.speakerNames[speaker], start: line.start, text: line.text,
                                 marked: live?.isMarked(line) ?? false, actions: actions(live))
                    }
                    if let partial = live?.partial, !partial.isEmpty {
                        (Text(partial).foregroundColor(palette.textTertiary) + Text(" |").foregroundColor(palette.caret))
                            .font(.system(size: 17)).lineSpacing(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Color.clear.frame(height: 20).id("end")
                }
                // The column is always the full width: rows coming and going never resize it.
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.top, 8)
            }
            .onChange(of: live?.lines.count) { _, _ in withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("end", anchor: .bottom) } }
            .onChange(of: live?.partial) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
        }
    }

    private func notes(_ live: LiveMeeting?) -> some View {
        ScrollView {
            NotesEditor(blocks: notesBinding, focus: $editing, now: { store.meter.seconds }, dataDir: store.dataDir)
                .padding(.leading, 4).padding(.trailing, 20).padding(.top, 10).padding(.bottom, 20)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func controls(_ live: LiveMeeting?) -> some View {
        HStack(spacing: 10) {
            round("camera", L("notes.photo")) { camera = true }
            round("flag", L("rec.mark")) { store.mark() }
            Button { store.togglePause() } label: {
                Label(live?.paused == true ? L("rec.recording") : L("rec.pause"), systemImage: live?.paused == true ? "record.circle" : "pause.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .background(palette.background, in: Capsule())
                    .overlay(Capsule().strokeBorder(palette.separator))
            }
            Button {
                if confirmStop {
                    stopping = true
                    Task { done(await store.stop()) }
                } else {
                    withAnimation(.easeOut(duration: 0.2)) { confirmStop = true }
                    UINotificationFeedbackGenerator().notificationOccurred(.warning)
                    Task {
                        try? await Task.sleep(for: .seconds(4))
                        withAnimation(.easeOut(duration: 0.2)) { confirmStop = false }
                    }
                }
            } label: {
                // Confirming, the words alone: «Tap to stop», «Toca para detener» don't fit beside the icon.
                Label(confirmStop ? L("rec.stopConfirm") : L("rec.stop"), systemImage: "stop.fill")
                    .labelStyle(StopLabelStyle(iconShown: !confirmStop))
                    .font(.system(size: 17, weight: .semibold))
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    // The dark red with white of the swipe to delete (5.6:1), in both modes.
                    .background(confirmStop ? MurmurPalette.acidLight.recordingLabel : palette.newMeeting, in: Capsule())
                    .foregroundStyle(confirmStop ? MurmurPalette.acidLight.background : palette.onNewMeeting)
            }
            .disabled(stopping)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16).padding(.bottom, 8).padding(.top, 6)
    }

    /// A round button beside Pausa and Atura (a photo, a marked moment).
    private func round(_ systemImage: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage).font(.system(size: 19, weight: .medium)).frame(width: 52, height: 52)
                .background(palette.background, in: Circle())
                .overlay(Circle().strokeBorder(palette.separator))
        }
        .accessibilityLabel(label)
    }
}

/// The card: the waveform with a ruler of minutes and the red now line, the state and the timer.
struct RecordingCard: View {
    @Environment(\.murmur) private var palette
    @EnvironmentObject private var store: Store
    var live: LiveMeeting?

    var body: some View {
        VStack(spacing: 0) {
            Waveform(meter: store.meter, paused: live?.paused == true || live == nil)
                .frame(height: 134)
            VStack(alignment: .leading, spacing: 4) {
                // The state and the language in one line, in plain SF Pro (DESIGN.md: the system
                // typeface everywhere; no monospaced capitals).
                HStack(spacing: 8) {
                    RecordingDot()
                    Text("\(live?.paused == true ? L("rec.pause") : L("rec.recording")) · \(languageName(store.language))")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(palette.textSecondary).lineLimit(1)
                }
                // The microphone's clock, not the engine's: it never stalls behind the transcription.
                TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                    Text(longClock(store.meter.seconds)).font(.tabular(40, weight: .medium)).tracking(-0.8).lineLimit(1)
                }
                // The microphone only when it isn't the phone's own: then it's worth knowing.
                if let input = store.inputName {
                    Label(input, systemImage: "headphones").font(.system(size: 13)).foregroundStyle(palette.textSecondary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18).padding(.vertical, 14)
            .background(palette.background, in: UnevenRoundedRectangle(topLeadingRadius: 26, topTrailingRadius: 26, style: .continuous))
        }
        .background(palette.fillSubtle, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

/// What has been heard, a bar per half second up to the red line (now), dotted after it, over a
/// ruler with the time every 5 seconds: the ruler and the bars share one scale. It's drawn every
/// frame from the microphone's clock, so it glides instead of jumping when the data arrives.
struct Waveform: View {
    @Environment(\.murmur) private var palette
    var meter: Meter
    var paused: Bool

    private static let barSeconds = 0.5
    private static let step: CGFloat = 4
    private static let rulerHeight: CGFloat = 30

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: paused)) { _ in
            let (seconds, samples) = meter.snapshot()
            Canvas { ctx, size in
                draw(&ctx, size: size, seconds: seconds, samples: samples)
            }
        }
    }

    private func draw(_ ctx: inout GraphicsContext, size: CGSize, seconds: Double, samples: [Meter.Sample]) {
            let waveHeight = size.height - Self.rulerHeight
            let mid = waveHeight / 2 + 6
            let now = (size.width * 0.62).rounded()
            let pxPerSecond = Self.step / Self.barSeconds
            // The bars: the loudest piece of each half second, placed by its time, so they slide.
            var bars: [Int: Float] = [:]
            for s in samples { bars[Int(s.t / Self.barSeconds), default: 0] = max(bars[Int(s.t / Self.barSeconds)] ?? 0, s.level) }
            for (index, level) in bars {
                let x = now - CGFloat(seconds - Double(index + 1) * Self.barSeconds) * pxPerSecond
                guard x > 10, x <= now - 2 else { continue }
                let v = CGFloat(min(1, (Double(level) / 0.22).squareRoot()))
                let h = max(2, v * 56)
                ctx.fill(Path(roundedRect: CGRect(x: x, y: mid - h / 2, width: 2, height: h), cornerRadius: 1), with: .color(palette.textTertiary.opacity(0.8)))
            }
            // The dots ahead also slide, so the whole strip moves as one.
            let shift = CGFloat(seconds.truncatingRemainder(dividingBy: Self.barSeconds)) * pxPerSecond
            for x in stride(from: now + Self.step - shift, to: size.width - 10, by: Self.step) where x > now + 2 {
                ctx.fill(Path(CGRect(x: x, y: mid - 1, width: 2, height: 2)), with: .color(palette.separator))
            }
            // The ruler: a line, and the time every 5 s where it falls.
            ctx.fill(Path(CGRect(x: 0, y: waveHeight, width: size.width, height: 1)), with: .color(palette.separator))
            let first = (seconds - Double(now) / pxPerSecond) / 5
            for mark in stride(from: max(0, first.rounded(.up) * 5), through: seconds + Double(size.width - now) / pxPerSecond, by: 5) {
                let x = now + CGFloat(mark - seconds) * pxPerSecond
                guard x > 16, x < size.width - 16 else { continue }
                let current = abs(mark - seconds) < 2.5
                ctx.draw(Text(clock(mark)).font(.tabular(11, weight: current ? .medium : .regular)).foregroundColor(current ? palette.textPrimary : palette.textTertiary),
                         at: CGPoint(x: x, y: waveHeight + Self.rulerHeight / 2))
            }
            ctx.fill(Path(roundedRect: CGRect(x: now, y: 12, width: 2, height: waveHeight - 12), cornerRadius: 1), with: .color(palette.recordingDot))
    }
}

/// What a speaker's label can do (the desktop's menu): rename the speaker, give this line to
/// someone else, or say all their lines are someone else's.
struct SpeakerActions {
    var speakers: [Speaker]
    var rename: (Speaker) -> Void
    var reassign: (_ line: String, _ to: Int) -> Void
    var merge: (_ from: Int, _ into: Int) -> Void
}

/// One line of the transcript: the speaker, the minute, the text; a marked one stands out.
struct LineView: View {
    @Environment(\.murmur) private var palette
    var id: String = ""
    var speaker: Int
    var name: String? = nil
    var start: Double
    var text: String
    var marked: Bool
    var actions: SpeakerActions? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                if let actions {
                    SpeakerMenu(id: id, speaker: Speaker(id: speaker, name: name), actions: actions)
                } else {
                    SpeakerChip(speaker: speaker, name: name)
                }
                Text(clock(start)).font(.tabular(12)).foregroundStyle(palette.timestamp)
                if marked { FlagChip(label: L("rec.important")) }
            }
            Text(text).font(.system(size: 17)).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, marked ? 9 : 0)
        // The marked line's fill reaches past the text without changing the layout: a negative
        // padding would make the whole column measure itself again (and jump while it scrolls).
        .background {
            if marked {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(palette.fillSubtle).padding(.horizontal, -12)
            }
        }
    }
}

/// The speaker's label as a menu.
struct SpeakerMenu: View {
    var id: String
    var speaker: Speaker
    var actions: SpeakerActions

    var body: some View {
        let others = actions.speakers.filter { $0.id != speaker.id }
        Menu {
            Button(L("speakers.rename"), systemImage: "pencil") { actions.rename(speaker) }
            if !others.isEmpty {
                Menu(L("speakers.thisLine")) {
                    ForEach(others) { other in
                        Button(other.label) { actions.reassign(id, other.id) }
                    }
                }
                Menu(L("speakers.allLines", speaker.label)) {
                    ForEach(others) { other in
                        Button(other.label) { actions.merge(speaker.id, other.id) }
                    }
                }
            }
        } label: {
            HStack(spacing: 3) {
                SpeakerChip(speaker: speaker.id, name: speaker.name)
            }
        }
        .accessibilityLabel(speaker.label)
    }
}

/// "Canvia el nom…" of a speaker: an alert with the name in a field.
struct SpeakerNameAlert: ViewModifier {
    @Binding var speaker: Speaker?
    @State private var name = ""
    var save: (Speaker, String) -> Void

    func body(content: Content) -> some View {
        content
            .alert(L("speakers.nameTitle"), isPresented: Binding(get: { speaker != nil }, set: { if !$0 { speaker = nil } })) {
                TextField(L("speakers.namePlaceholder"), text: $name).textInputAutocapitalization(.words)
                Button(L("meeting.cancel"), role: .cancel) {}
                Button(L("meeting.save")) { if let speaker { save(speaker, name) } }
            }
            .onChange(of: speaker) { _, s in name = s?.name ?? "" }
    }
}

extension View {
    func speakerNameAlert(_ speaker: Binding<Speaker?>, save: @escaping (Speaker, String) -> Void) -> some View {
        modifier(SpeakerNameAlert(speaker: speaker, save: save))
    }
}


/// Atura with its icon, or the confirmation's words alone.
private struct StopLabelStyle: LabelStyle {
    var iconShown: Bool
    func makeBody(configuration: Configuration) -> some View {
        if iconShown {
            Label(configuration)
        } else {
            configuration.title
        }
    }
}
