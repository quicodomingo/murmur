import SwiftUI

enum Route: Hashable {
    case recording
    case meeting(String)
    /// A meeting opened on a tab (from a search result).
    case meetingAt(String, MeetingTab)
    case search
}

enum Tab { case meetings, settings }

@main
struct MurmurApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var scenePhase
    /// Configuració › Aparença: the theme (the desktop's three) and the mode.
    @AppStorage("theme") private var theme = MurmurTheme.acid.rawValue
    @AppStorage("appearance") private var appearance = "system"

    init() {
        // As early as possible, as Aptabase asks (only if the statistics are on).
        Analytics.start()
        Analytics.track("app_opened")
    }

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store).murmurTheme(MurmurTheme(rawValue: theme) ?? .acid)
                .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
                .task {
                    // `-pair <code>` (development): pairs without the camera, as in the simulator.
                    let args = ProcessInfo.processInfo.arguments
                    if let i = args.firstIndex(of: "-pair"), i + 1 < args.count {
                        do { _ = try await store.pair(code: args[i + 1]) } catch { store.error = error.localizedDescription }
                    }
                }
        }
        // Back in the app: what's pending goes to the computer, what it revised comes back.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.autoSync() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.murmur) private var palette
    @State private var path: [Route] = []
    @State private var tab: Tab = .meetings
    /// The splash, at launch (Splash.swift).
    @State private var splashing = true
    /// The first time: the onboarding (Onboarding.swift), after the splash.
    @AppStorage("onboarded") private var onboarded = false
    @State private var onboarding = false
    @State private var enrolling = false

    var body: some View {
        NavigationStack(path: $path) {
            ZStack(alignment: .bottom) {
                palette.background.ignoresSafeArea()
                switch tab {
                case .meetings: HomeView(open: { path.append($0) }, openSettings: { tab = .settings })
                case .settings: SettingsView()
                }
                Dock(tab: $tab, record: record, openRecording: { path.append(.recording) })
                    .padding(.bottom, 8)
            }
            // The splash lands on the list's logo (or fades into the onboarding, the first time).
            // Inside the stack: preferences don't come out of a NavigationStack.
            .overlayPreferenceValue(LogoAnchorKey.self) { anchor in
                GeometryReader { proxy in
                    if splashing {
                        SplashOverlay(target: onboarded && tab == .meetings ? anchor.map { proxy[$0] } : nil, size: proxy.size) {
                            splashing = false
                            if !onboarded { onboarding = true }
                        }
                    }
                }
                .ignoresSafeArea()
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .recording: RecordingView(done: { id in path = id.map { [.meeting($0)] } ?? [] })
                case .meeting(let id): MeetingView(id: id)
                case .meetingAt(let id, let tab): MeetingView(id: id, initialTab: tab)
                case .search: SearchView(open: { path.append($0) })
                }
            }
        }
        .tint(palette.textPrimary)
        // `-enrollVoice` (development, with -simulate): records "La teva veu" at once.
        .fullScreenCover(isPresented: $enrolling) { VoiceEnrollView(autoStart: true) }
        .fullScreenCover(isPresented: $onboarding) {
            OnboardingView {
                Analytics.track("onboarding_finished", ["voice": store.voiceSavedAt != nil, "computer": store.computer != nil])
                onboarded = true
                onboarding = false
            }
        }
        // `-autostart` (development, with -simulate): records at launch, to try it without touching the screen.
        .task {
            let args = ProcessInfo.processInfo.arguments
            // `-onboarding` (development): shows it again.
            if args.contains("-onboarding") { onboarded = false }
            #if DEBUG
            // `-demo`: the App Store screenshots' sample meetings; `-open <id> [-tab summary|transcript|notes]` opens one.
            if args.contains("-demo") { DemoData.load(into: store) }
            if let i = args.firstIndex(of: "-open"), i + 1 < args.count {
                let tabs: [String: MeetingTab] = ["summary": .summary, "transcript": .transcript, "notes": .notes]
                let tab = args.firstIndex(of: "-tab").flatMap { $0 + 1 < args.count ? tabs[args[$0 + 1]] : nil }
                try? await Task.sleep(for: .seconds(2))
                path = [tab.map { .meetingAt(args[i + 1], $0) } ?? .meeting(args[i + 1])]
            }
            #endif
            if args.contains("-enrollVoice") {
                try? await Task.sleep(for: .seconds(2))
                enrolling = true
            }
            if args.contains("-autostart") { record() }
            if args.contains("-search") { path = [.search] }
            // `-openLatest` (development): opens the newest meeting, to see it without touching the screen.
            if args.contains("-openLatest") {
                try? await Task.sleep(for: .seconds(3))
                if let latest = store.meetings.first { path = [.meeting(latest.id)] }
            }
        }
        .alert(store.error ?? "", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    private func record() {
        Task {
            // The light rises and fills up as the microphone opens, then the recording screen comes in.
            withAnimation(.easeOut(duration: 0.35)) { store.surging = true }
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            async let started = store.start()
            try? await Task.sleep(for: .milliseconds(320))
            if await started { path.append(.recording) }
            try? await Task.sleep(for: .milliseconds(400))
            store.surging = false
        }
    }
}

/// The floating glass bar: Reunions · record · Configuració. While recording, the middle button
/// is the desktop's "Gravant" pill and goes back to the meeting.
struct Dock: View {
    @EnvironmentObject private var store: Store
    @Environment(\.murmur) private var palette
    @Binding var tab: Tab
    var record: () -> Void
    var openRecording: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            side("list.bullet", L("dock.meetings"), on: tab == .meetings) { tab = .meetings }
            if let live = store.live {
                Button(action: openRecording) {
                    TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                        HStack(spacing: 10) {
                            LevelBars(level: live.paused ? 0 : store.meter.level)
                            Text(clock(store.meter.seconds)).font(.tabular(17, weight: .semibold))
                        }
                    }
                    .frame(minWidth: 120, minHeight: 56).padding(.horizontal, 18)
                    .background(palette.recordingPill, in: Capsule())
                    .overlay(Capsule().strokeBorder(palette.recordingPillBorder, lineWidth: 1))
                    .foregroundStyle(palette.onRecordingPill)
                }
                .accessibilityLabel(L("dock.recording", clock(live.seconds)))
            } else {
                Button(action: record) {
                    Image(systemName: "plus").font(.system(size: 24, weight: .semibold))
                        .frame(width: 120, height: 56)
                        .background(palette.newMeeting, in: Capsule())
                        .foregroundStyle(palette.onNewMeeting)
                }
                .accessibilityLabel(L("dock.new"))
            }
            side("gearshape", L("dock.settings"), on: tab == .settings) { tab = .settings }
        }
        .padding(6)
        .glassCapsule()
        .shadow(color: .black.opacity(0.12), radius: 15, y: 8)
        .buttonStyle(.plain)
    }

    private func side(_ icon: String, _ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 19, weight: .medium))
                .frame(width: 56, height: 56)
                .background(on ? palette.textPrimary.opacity(0.08) : .clear, in: Circle())
                .foregroundStyle(on ? palette.textPrimary : palette.textSecondary)
        }
        .accessibilityLabel(label)
    }
}

struct HomeView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.murmur) private var palette
    var open: (Route) -> Void
    var openSettings: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                HStack(spacing: 9) {
                    LogoTile(size: 34)
                        // Where the splash lands.
                        .anchorPreference(key: LogoAnchorKey.self, value: .bounds) { $0 }
                    Text("murmur").font(.system(size: 24, weight: .bold)).tracking(-1.1)
                }
                Spacer()
                // Where syncing with the computer is; it opens the computer's sheet.
                SyncButton(openSettings: openSettings)
                if !store.meetings.isEmpty {
                    CircleButton(systemImage: "magnifyingglass", label: L("search.title")) { open(.search) }
                        .padding(.leading, 8)
                }
            }
            .padding(.horizontal, 20).frame(height: 56)

            // A recording cut off (the app was closed in the middle), being made a meeting again.
            if store.recovering > 0 {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(L("home.recovering")).font(.system(size: 14))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(palette.textSecondary)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(palette.fillSubtle, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 16).padding(.bottom, 8)
            }

            if store.meetings.isEmpty && store.live == nil {
                EmptyHome()
            } else {
                // A List, for the system's swipe to delete; it looks like the cards of the design.
                List {
                    if let live = store.live {
                        section(L("home.today"))
                        row(LiveCard(live: live)) { open(.recording) }
                    }
                    ForEach(groups, id: \.0) { title, rows in
                        if !(store.live != nil && title == L("home.today")) { section(title) }
                        ForEach(rows) { meeting in
                            row(MeetingCard(row: meeting)) { open(.meeting(meeting.id)) }
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    Button(L("home.delete"), systemImage: "trash", role: .destructive) { toDelete = meeting }
                                        // The light theme's dark red in both modes: white on it is 5.6:1
                                        // (the system red gives about 3.5:1). Without it, the app's tint (white in dark) wins.
                                        .tint(MurmurPalette.acidLight.recordingLabel)
                                }
                                // Holding a meeting: rename it or delete it.
                                .contextMenu {
                                    Button(L("meeting.rename"), systemImage: "pencil") {
                                        newTitle = meeting.title
                                        toRename = meeting
                                    }
                                    Button(L("home.delete"), systemImage: "trash", role: .destructive) { toDelete = meeting }
                                }
                        }
                    }
                    Color.clear.frame(height: 110).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                // Pull to sync with the computer, if there's one.
                .refreshable { if store.computer != nil { await store.sync() } }
            }
        }
        .foregroundStyle(palette.textPrimary)
        .confirmationDialog(L(toDelete?.fromComputer == true ? "meeting.deleteConfirmComputer" : "meeting.deleteConfirm"), isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), titleVisibility: .visible, presenting: toDelete) { meeting in
            Button(L("meeting.delete"), role: .destructive) { store.delete(meeting.id) }
        }
        .renameAlert(isPresented: Binding(get: { toRename != nil }, set: { if !$0 { toRename = nil } }), title: $newTitle) { title in
            if let meeting = toRename { store.rename(meeting.id, to: title) }
        }
    }

    @State private var toDelete: MeetingRow?
    @State private var toRename: MeetingRow?
    @State private var newTitle = ""

    private func row(_ card: some View, open: @escaping () -> Void) -> some View {
        Button(action: open) { card }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }

    private func section(_ title: String) -> some View {
        Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.textSecondary)
            .padding(.leading, 8).padding(.top, 10)
            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }

    /// Avui, Ahir, Aquesta setmana, Abans: as the desktop's sidebar.
    private var groups: [(String, [MeetingRow])] {
        let cal = Calendar.current
        var out: [(String, [MeetingRow])] = []
        for row in store.meetings {
            let date = Date(timeIntervalSince1970: row.createdAt / 1000)
            let title = cal.isDateInToday(date) ? L("home.today") : cal.isDateInYesterday(date) ? L("home.yesterday")
                : cal.isDate(date, equalTo: .now, toGranularity: .weekOfYear) ? L("home.thisWeek") : L("home.earlier")
            if out.last?.0 == title { out[out.count - 1].1.append(row) } else { out.append((title, [row])) }
        }
        return out
    }
}

struct EmptyHome: View {
    @EnvironmentObject private var store: Store
    @Environment(\.murmur) private var palette
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(spacing: 10) {
            LogoTile(size: 84).padding(.bottom, 16)
            Text(L("home.emptyTitle")).font(.system(size: 28, weight: .bold)).tracking(-0.5)
            Text(L("home.emptyText")).font(.system(size: 17)).foregroundStyle(palette.textSecondary)
            Text(L("home.consent")).font(.system(size: 13)).foregroundStyle(palette.textTertiary)
            Spacer()
            StartOptions().padding(.bottom, 92)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 36).padding(.top, 70)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The acid light from below: here is where you record.
        .background(alignment: .bottom) { AcidGlow().ignoresSafeArea() }
    }
}

/// The acid light that rises from the record button. It breathes slowly (about 6 s a breath:
/// it grows a little and brightens, then settles), like something waiting to listen. With Reduce
/// Motion it stays still.
struct AcidGlow: View {
    @Environment(\.murmur) private var palette
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @EnvironmentObject private var store: Store

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            // 0 → 1 → 0 over a breath, eased at both ends.
            let breath = reduceMotion ? 0.5 : (1 - cos(timeline.date.timeIntervalSinceReferenceDate * 2 * .pi / 6)) / 2
            // On ＋ the light fills up (the microphone opening).
            let surge = store.surging
            Ellipse()
                .fill(RadialGradient(colors: [palette.accent.opacity((scheme == .dark ? 0.16 : 0.34) * (surge ? 1.8 : 0.75 + 0.25 * breath)), palette.accent.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: 230))
                .frame(width: 520, height: 420)
                .scaleEffect(surge ? 1.6 : 0.94 + 0.1 * breath, anchor: .bottom)
                .offset(y: 170)
        }
        .allowsHitTesting(false)
    }
}

/// While recording: a faint acid light behind the controls that rises and falls with the voice,
/// so a glance says the microphone hears. With Reduce Motion it stays still.
struct VoiceGlow: View {
    @Environment(\.murmur) private var palette
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var meter: Meter
    var paused: Bool

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.1)) { _ in
            let voice = paused || reduceMotion ? 0 : CGFloat(min(1, (Double(meter.level) / 0.22).squareRoot()))
            Ellipse()
                .fill(RadialGradient(colors: [palette.accent.opacity((scheme == .dark ? 0.08 : 0.16) + (scheme == .dark ? 0.12 : 0.22) * voice), palette.accent.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: 220))
                .frame(width: 520, height: 360)
                .scaleEffect(0.9 + 0.25 * voice, anchor: .bottom)
                .offset(y: 190)
                .animation(.easeOut(duration: 0.35), value: voice)
        }
        .allowsHitTesting(false)
    }
}

/// Under the record button, as on the desktop: the meeting's language and whether there are more
/// people in the room. What's chosen here is also the default (Configuració).
struct StartOptions: View {
    @Environment(\.murmur) private var palette
    @AppStorage("language") private var language = "ca-es"
    @AppStorage("moreInRoom") private var moreInRoom = true

    var body: some View {
        HStack(spacing: 8) {
            Menu {
                Picker(L("start.languageTitle"), selection: $language) {
                    Text(L("language.caEs")).tag("ca-es")
                    Text(L("language.ca")).tag("ca")
                    Text(L("language.es")).tag("es")
                }
            } label: {
                HStack(spacing: 4) { Text(languageName(language)); Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)) }
            }
            Text("·")
            Menu {
                Picker(L("start.roomTitle"), selection: $moreInRoom) {
                    Text(L("start.onlyMe")).tag(false)
                    Text(L("start.moreInRoom")).tag(true)
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: moreInRoom ? "person.2" : "person").font(.system(size: 12))
                    Text(moreInRoom ? L("start.moreInRoom") : L("start.onlyMe"))
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
                }
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(palette.textSecondary)
        .tint(palette.textSecondary)
    }
}

func languageName(_ code: String) -> String {
    switch code {
    case "ca": return L("language.ca")
    case "es": return L("language.es")
    case "en": return L("language.en")
    default: return L("language.caEs")
    }
}

struct LiveCard: View {
    @Environment(\.murmur) private var palette
    @EnvironmentObject private var store: Store
    var live: LiveMeeting
    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                Circle().fill(palette.recordingPill).frame(width: 40, height: 40)
                    .overlay(LevelBars(level: live.paused ? 0 : store.meter.level, count: 3, height: 15))
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(live.title).font(.system(size: 17, weight: .semibold)).lineLimit(1)
                    Spacer()
                    TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                        HStack(spacing: 6) { RecordingDot(); Text(clock(store.meter.seconds)).font(.tabular(13, weight: .bold)) }
                            .foregroundStyle(palette.recordingLabel)
                    }
                }
                Text(live.lastLine.isEmpty ? L("rec.listening") : "…" + live.lastLine)
                    .font(.system(size: 15)).lineLimit(1)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(palette.background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(palette.textPrimary, lineWidth: 1.5))
        .contentShape(Rectangle())
    }
}

struct MeetingCard: View {
    @Environment(\.murmur) private var palette
    var row: MeetingRow
    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: row.revised || row.fromComputer ? "laptopcomputer" : "iphone").font(.system(size: 16))
                .frame(width: 40, height: 40).background(palette.background, in: Circle())
                .foregroundStyle(palette.textSecondary)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(row.title).font(.system(size: 17, weight: .semibold)).lineLimit(1)
                    Spacer()
                    Text("\(max(1, Int(row.duration / 60))) min").font(.system(size: 15)).monospacedDigit().foregroundStyle(palette.textSecondary)
                }
                HStack(spacing: 6) {
                    Text(Date(timeIntervalSince1970: row.createdAt / 1000).formatted(date: .omitted, time: .shortened))
                    if row.fromComputer { Text("· " + L("home.fromComputer")) } else if row.revised { Text("· " + L("home.revised")) }
                    ForEach(row.tags, id: \.self) { tag in
                        Text(tag).font(.system(size: 12, weight: .medium)).padding(.horizontal, 7).padding(.vertical, 2)
                            .background(palette.background, in: RoundedRectangle(cornerRadius: 5))
                    }
                }
                .font(.system(size: 13)).foregroundStyle(palette.textSecondary)
                if let last = row.lastLine {
                    Text(last).font(.system(size: 15)).foregroundStyle(palette.textSecondary).lineLimit(1).padding(.top, 4)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(palette.fillSubtle, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .contentShape(Rectangle())
    }
}
