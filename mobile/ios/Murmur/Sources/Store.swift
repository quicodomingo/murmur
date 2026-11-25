import ActivityKit
import AVFoundation
import SwiftUI

extension Line: Identifiable {}
extension MeetingRow: Identifiable {}

/// The recording in progress, as the screen shows it.
struct LiveMeeting {
    var id: String
    var title: String
    var seconds: Double = 0
    var lines: [Line] = []
    var partial = ""
    /// The notes, the marked moments and the photos (Notes.swift), with an empty line to write on.
    var notes: [NoteBlock] = [NoteBlock()]
    var paused = false
    /// Names given while recording, by speaker number.
    var speakerNames: [Int: String] = [:]
    /// Speakers merged into another (from → into): also the lines still to come.
    var aliases: [Int: Int] = [:]
    /// Lines given to another speaker by hand, by line id.
    var lineSpeakers: [String: Int] = [:]

    /// The last thing said, for the list.
    var lastLine: String { partial.isEmpty ? (lines.last?.text ?? "") : partial }
    func isMarked(_ line: Line) -> Bool {
        notes.contains { $0.kind == .mark && ($0.t ?? -10) >= line.start - 1 && ($0.t ?? -10) <= line.end + 2 }
    }

    /// Who said a line, after what was changed by hand.
    func speaker(of line: Line) -> Int {
        if let s = lineSpeakers[line.id] { return s }
        var s = Int(line.speaker)
        var seen: Set<Int> = []
        while let next = aliases[s], !seen.contains(next) { seen.insert(s); s = next }
        return s
    }

    /// The speakers there are, by number, with their names.
    var speakers: [Speaker] {
        Set(lines.map(speaker(of:))).sorted().map { Speaker(id: $0, name: speakerNames[$0]) }
    }
}

/// A speaker in a meeting: their number, and the name given, if any.
struct Speaker: Identifiable, Hashable {
    let id: Int
    var name: String?
    var label: String { name ?? L("rec.speaker", "\(id + 1)") }
}

/// A lock-protected switch the microphone's thread reads (paused or not).
final class Gate: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    var isOn: Bool {
        get { lock.lock(); defer { lock.unlock() }; return value }
        set { lock.lock(); value = newValue; lock.unlock() }
    }
}

/// The recording's own clock and sound level, kept on the microphone's side. The waveform, the
/// timer and the level bars follow them every frame, without waiting for the engine, which can be
/// busy for half a second redoing the provisional text.
final class Meter: @unchecked Sendable {
    struct Sample { let t: Double; let level: Float }
    private let lock = NSLock()
    private var samples: [Sample] = []
    /// Seconds recorded before the current run (pauses stop the clock).
    private var recorded = 0.0
    private var runStart: CFTimeInterval?
    private var last: Float = 0

    func reset() {
        lock.lock(); defer { lock.unlock() }
        samples = []; recorded = 0; last = 0
        runStart = CACurrentMediaTime()
    }

    func pause() {
        lock.lock(); defer { lock.unlock() }
        if let start = runStart { recorded += CACurrentMediaTime() - start; runStart = nil }
        last = 0
    }

    func resume() {
        lock.lock(); defer { lock.unlock() }
        if runStart == nil { runStart = CACurrentMediaTime() }
    }

    private var now: Double { recorded + (runStart.map { CACurrentMediaTime() - $0 } ?? 0) }

    /// Seconds recorded, by the wall clock, without the pauses.
    var seconds: Double { lock.lock(); defer { lock.unlock() }; return now }
    var level: Float { lock.lock(); defer { lock.unlock() }; return last }

    /// A piece of audio from the microphone (its rms).
    func add(_ audio: [Float]) {
        guard !audio.isEmpty else { return }
        let rms = (audio.reduce(0) { $0 + $1 * $1 } / Float(audio.count)).squareRoot()
        lock.lock(); defer { lock.unlock() }
        samples.append(Sample(t: now, level: rms))
        last = rms
        if samples.count > 1500 { samples.removeFirst(300) }
    }

    func snapshot() -> (seconds: Double, samples: [Sample]) {
        lock.lock(); defer { lock.unlock() }
        return (now, samples)
    }
}

/// The app's state: the meetings on this phone and the recording, over murmur-mobile (Rust).
@MainActor
final class Store: ObservableObject {
    @Published var meetings: [MeetingRow] = []
    @Published var live: LiveMeeting?
    @Published var error: String?
    /// The ＋ was just pressed: the acid light fills up while the microphone opens.
    @Published var surging = false
    /// The microphone in use, as iOS names it, shown on the recording card.
    @Published var inputName: String?
    /// The computer this phone is paired with (docs/EMPARELLAR.md).
    @Published var computer: PairedComputer? = PairedComputer.load()
    @Published var syncing = false
    /// Why the last sync didn't go through (shown under the computer in Configuració).
    @Published var syncProblem: String?
    @Published var lastSync: Date? = UserDefaults.standard.object(forKey: "lastSync") as? Date
    @Published var unsent = 0
    /// What just changed, with Desfés ("Parlant 3 ara és Laia").
    @Published var toast: Toast?
    /// Recordings cut off (the app closed or killed in the middle) being made meetings again.
    @Published var recovering = 0
    /// Sync runs on its own queue: it can take a while (the audio), and the recording can't wait.
    let syncQueue = DispatchQueue(label: "murmur.sync", qos: .utility)
    /// The lock screen's Atura was tapped once: a second tap within 4 s stops.
    private var stopArmed = false
    private var routeObserver: NSObjectProtocol?

    let engine: Murmur?
    private let queue = DispatchQueue(label: "murmur.engine", qos: .userInitiated)
    private let microphone = Microphone()
    private let paused = Gate()
    let meter = Meter()
    /// Where meetings, recordings and photos go (the engine's data folder).
    let dataDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Murmur")

    init() {
        let models = (Bundle.main.resourcePath ?? "") + "/models"
        let data = dataDir.path
        do {
            engine = try Murmur(modelsDir: models, dataDir: data)
        } catch {
            engine = nil
            self.error = error.localizedDescription
        }
        reload()
        // The models load in the background, so the first recording starts at once.
        let engine = engine
        queue.async { try? engine?.prepare() }
        // A Live Activity left from a recording this process never had (the app was killed in the
        // middle): its buttons would reach nothing.
        Self.endStaleActivities()
        recoverUnfinished()
        // The Live Activity's buttons (lock screen, Dynamic Island) land here.
        RecordingControls.handler = { [weak self] command in
            guard let self else { return }
            guard self.live != nil else {
                Self.endStaleActivities()
                return
            }
            switch command {
            case .mark: self.mark()
            case .togglePause: self.togglePause()
            case .stop: self.armOrStop()
            }
        }
    }

    /// The lock screen's Atura asks twice, as the desktop's indicator: the first tap turns it into
    /// "Toca per aturar" for 4 s.
    private func armOrStop() {
        if stopArmed {
            stopArmed = false
            Task { _ = await stop() }
            return
        }
        stopArmed = true
        updateActivity()
        Task {
            try? await Task.sleep(for: .seconds(4))
            guard stopArmed else { return }
            stopArmed = false
            updateActivity()
        }
    }

    /// Recordings whose meeting was never saved: the same live transcription runs over their
    /// audio, on the engine's queue (a new recording waits for it), and they're back in the list.
    private func recoverUnfinished() {
        guard let engine else { return }
        let language = language
        let room = UserDefaults.standard.object(forKey: "moreInRoom") as? Bool ?? true
        queue.async { [weak self] in
            let found = (try? engine.unfinishedRecordings()) ?? []
            guard !found.isEmpty else { return }
            Task { @MainActor in self?.recovering = found.count }
            for recording in found {
                let time = Date(timeIntervalSince1970: recording.createdAt / 1000).formatted(date: .omitted, time: .shortened)
                let ok = (try? engine.recoverRecording(id: recording.id, title: L("rec.defaultTitle", time), language: language, moreInRoom: room)) ?? false
                Task { @MainActor in
                    self?.recovering -= 1
                    if ok {
                        self?.reload()
                        Analytics.track("recording_recovered")
                    }
                }
            }
        }
    }

    private static func endStaleActivities() {
        for activity in Activity<RecordingAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    // MARK: The Live Activity

    private var activity: Activity<RecordingAttributes>?

    private var activityState: RecordingAttributes.ContentState {
        let seconds = meter.seconds
        let last = live?.lines.last
        return RecordingAttributes.ContentState(
            startedAt: Date().addingTimeInterval(-seconds),
            pausedAt: live?.paused == true ? seconds : nil,
            lastLine: String((last?.text ?? "").suffix(140)),
            speaker: last.flatMap { line in live.map { Speaker(id: $0.speaker(of: line), name: $0.speakerNames[$0.speaker(of: line)]).label } },
            confirmingStop: stopArmed,
            levels: recentLevels())
    }

    /// The voice of the last 2.5 s in five half seconds (0…1), for the bars and the mark's echo.
    private func recentLevels() -> [Double] {
        let (now, samples) = meter.snapshot()
        return (0..<5).reversed().map { k in
            let from = now - Double(k + 1) * 0.5, to = now - Double(k) * 0.5
            let level = samples.filter { $0.t >= from && $0.t < to }.map(\.level).max() ?? 0
            return min(1, (Double(level) / 0.22).squareRoot())
        }
    }

    /// Updates the Live Activity about once a second, for the voice; the time it counts itself.
    private var activityTimer: Timer?

    private func startActivity(title: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = RecordingAttributes(title: title, language: languageName(language))
        activity = try? Activity.request(attributes: attributes, content: .init(state: activityState, staleDate: Self.stale))
        // Also while paused: each update moves `stale` on, so the lock screen knows Murmur is alive.
        activityTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.live != nil else { return }
                self.updateActivity()
            }
        }
    }

    /// When the Live Activity stops believing it: the app updates it every second, so if it goes
    /// this long without, Murmur was closed (by iOS, or a crash) and the lock screen says so
    /// instead of counting time nobody is recording.
    private static var stale: Date { Date().addingTimeInterval(20) }

    private func updateActivity() {
        guard let activity else { return }
        let state = activityState
        Task { await activity.update(.init(state: state, staleDate: Self.stale)) }
    }

    private func endActivity() {
        activityTimer?.invalidate()
        activityTimer = nil
        guard let activity else { return }
        self.activity = nil
        let state = activityState
        Task { await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .immediate) }
    }

    func reload() {
        meetings = (try? engine?.meetings()) ?? []
        unsent = meetings.filter { $0.status == "done" && !$0.sent }.count
    }

    var language: String { UserDefaults.standard.string(forKey: "language") ?? "ca-es" }
    var partialEvery: Double { UserDefaults.standard.object(forKey: "partialEvery") as? Double ?? 1.5 }

    /// Starts recording. False if it couldn't (no microphone).
    func start() async -> Bool {
        guard let engine, live == nil else { return live != nil }
        let allowed = Microphone.simulated != nil ? true : await AVAudioApplication.requestRecordPermission()
        guard allowed else {
            error = L("mic.denied")
            return false
        }
        let time = Date().formatted(date: .omitted, time: .shortened)
        let title = L("rec.defaultTitle", time)
        let language = language, every = Float(partialEvery)
        let room = UserDefaults.standard.object(forKey: "moreInRoom") as? Bool ?? true
        do {
            let id = try await onQueue { try engine.start(title: title, language: language, moreInRoom: room, partialEvery: every) }
            live = LiveMeeting(id: id, title: title)
            // With the user's voice saved, speaker 0 is them (the engine knows them from the first word).
            if engine.voiceSaved() != nil { live?.speakerNames[0] = L("rec.you") }
            paused.isOn = false
            pausedByCall = false
            meter.reset()
            microphone.onInterruption = { [weak self] began, resume in
                Task { @MainActor in self?.interrupted(began: began, resume: resume) }
            }
            let gate = paused, meter = meter
            try microphone.start { [weak self] samples in
                guard !gate.isOn else { return }
                meter.add(samples)
                self?.queue.async {
                    guard let update = try? engine.push(samples: samples) else { return }
                    Task { @MainActor in self?.apply(update) }
                }
            }
            UIApplication.shared.isIdleTimerDisabled = true
            inputName = Microphone.currentName
            routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.inputName = Microphone.currentName }
            }
            startActivity(title: title)
            Analytics.track("recording_started", ["language": language, "room": room, "voice": engine.voiceSaved() != nil])
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func togglePause() {
        guard let live else { return }
        pausedByCall = false
        setPaused(!live.paused)
    }

    /// Paused by a call, not by the user: it carries on by itself when the call ends, if iOS says so.
    private var pausedByCall = false

    /// A call came in (`began`) or ended: the recording pauses, so the clock and the Live
    /// Activity say so, and goes on afterwards. Otherwise Continua starts the microphone again.
    private func interrupted(began: Bool, resume: Bool) {
        guard let live else { return }
        if began {
            guard !live.paused else { return }
            pausedByCall = true
            setPaused(true)
        } else if pausedByCall {
            pausedByCall = false
            if resume { setPaused(false) }
        }
    }

    private func setPaused(_ on: Bool) {
        if !on {
            // After a call iOS has stopped the microphone: start it again first.
            do { try microphone.ensureRunning() } catch {
                self.error = error.localizedDescription
                return
            }
        }
        live?.paused = on
        paused.isOn = on
        if on { meter.pause() } else { meter.resume() }
        updateActivity()
    }

    // MARK: Speakers (the label's menu, as on the desktop)

    /// While recording: they're kept here and go with the meeting when it stops.
    func nameLiveSpeaker(_ speaker: Int, _ name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        live?.speakerNames[speaker] = name.isEmpty ? nil : name
        updateActivity()
    }

    func reassignLiveLine(_ line: String, to speaker: Int) {
        live?.lineSpeakers[line] = speaker
        updateActivity()
    }

    func mergeLiveSpeakers(_ from: Int, into: Int) {
        guard from != into else { return }
        live?.aliases[from] = into
        // Lines given by hand to the one that goes follow it.
        for (line, s) in live?.lineSpeakers ?? [:] where s == from { live?.lineSpeakers[line] = into }
        if live?.speakerNames[into] == nil { live?.speakerNames[into] = live?.speakerNames[from] }
        live?.speakerNames[from] = nil
        updateActivity()
    }

    /// A finished meeting: saved at once.
    func nameSpeaker(_ speaker: Int, _ name: String, in meeting: String) {
        try? engine?.setSpeakerName(id: meeting, speaker: Int64(speaker), name: name)
        reload()
    }

    func reassignLine(_ line: String, to speaker: Int, in meeting: String) {
        try? engine?.setLineSpeaker(id: meeting, line: line, speaker: Int64(speaker))
        reload()
    }

    func mergeSpeakers(_ from: Int, into: Int, in meeting: String) {
        guard from != into else { return }
        try? engine?.mergeSpeakers(id: meeting, from: Int64(from), into: Int64(into))
        reload()
    }

    func mark() {
        guard live != nil else { return }
        live?.notes.insertBeforeTrailing(NoteBlock(kind: .mark, text: L("rec.markNote"), t: meter.seconds.rounded(.down)))
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    /// A photo while recording: saved at its second in the meeting's folder, and into the notes.
    /// It goes to the computer with the meeting, as one of its screenshots.
    func addPhoto(_ image: UIImage) {
        guard let current = live else { return }
        let t = meter.seconds.rounded(.down)
        let path = "screens/\(current.id)/\(Int(t * 1000)).jpg"
        let url = dataDir.appendingPathComponent(path)
        Task.detached(priority: .userInitiated) {
            guard let data = image.jpeg() else { return }
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: url, options: .atomic)
            await MainActor.run {
                guard self.live?.id == current.id else { return }
                self.live?.notes.insertBeforeTrailing(NoteBlock(kind: .photo, t: t, photo: path))
            }
        }
    }

    func setTaskDone(_ task: Int, _ done: Bool, in meeting: String) {
        try? engine?.setTaskDone(id: meeting, task: UInt32(task), done: done)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        reload()
    }

    func setTags(_ tags: [String], in meeting: String) {
        try? engine?.setTags(id: meeting, tags: tags)
        reload()
    }

    /// A finished meeting's notes, as they're edited.
    func saveNotes(_ blocks: [NoteBlock], in meeting: String) {
        let doc = NotesDoc.encode(blocks) ?? ["type": "doc", "content": [["type": "paragraph"]]]
        try? engine?.setNotes(id: meeting, doc: NotesDoc.json(doc))
    }

    /// "Murmur, sóc la Laia": the speaker of that line takes the name, at once, with an undo (the
    /// toast). Another speaker already called so is the same person: the two are joined.
    private func introduce(_ line: Line) {
        guard let current = live, let heard = Intro.name(in: line.text) else { return }
        let speaker = current.speaker(of: line)
        let name = Intro.match(heard, among: Array(current.speakerNames.values))
        let before = Speaker(id: speaker, name: current.speakerNames[speaker]).label
        guard before != name else { return }
        let previous = current
        if let other = current.speakerNames.first(where: { $0.key != speaker && $0.value.lowercased() == name.lowercased() })?.key {
            mergeLiveSpeakers(speaker, into: other)
        } else {
            nameLiveSpeaker(speaker, name)
        }
        Analytics.track("speaker_introduced")
        toast = Toast(text: L("intro.named", before, name)) { [weak self] in
            // Back as it was: the names and the joins of before this line.
            self?.live?.speakerNames = previous.speakerNames
            self?.live?.aliases = previous.aliases
            self?.live?.lineSpeakers = previous.lineSpeakers
        }
    }

    // MARK: La teva veu (voice.rs): a print of the user's voice, only on this phone.

    var voiceSavedAt: Date? { engine?.voiceSaved().map { Date(timeIntervalSince1970: $0) } }

    /// How many words of the sentence have been read in `samples` (the karaoke).
    func voiceProgress(_ sentence: String, _ samples: [Float]) async -> Int {
        guard let engine else { return 0 }
        return Int((try? await onQueue { try engine.voiceProgress(sentence: sentence, samples: samples) }) ?? 0)
    }

    /// Makes and saves the print; throws (with the reason to show) if there was too little speech.
    func enrollVoice(_ samples: [Float]) async throws {
        guard let engine else { return }
        _ = try await onQueue { try engine.enrollVoice(samples: samples) }
        Analytics.track("voice_saved")
        objectWillChange.send()
    }

    func deleteVoice() {
        try? engine?.deleteVoice()
        objectWillChange.send()
    }

    /// The recording's new title (the … while recording); it's saved with the meeting.
    func renameLive(_ title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        live?.title = title
        updateActivity()
    }

    /// Throws the recording away: nothing saved, its audio and photos deleted.
    func discard() async {
        guard let engine, live != nil else { return }
        microphone.stop()
        UIApplication.shared.isIdleTimerDisabled = false
        if let observer = routeObserver { NotificationCenter.default.removeObserver(observer) }
        routeObserver = nil
        stopArmed = false
        endActivity()
        try? await onQueue { try engine.discard() }
        Analytics.track("recording_discarded")
        live = nil
        reload()
    }

    /// Another microphone in the middle of a recording (the … menu): the engine carries on with it.
    func useInput(_ uid: String, bluetooth: Bool) {
        UserDefaults.standard.set(uid, forKey: "micInput")
        UserDefaults.standard.set(bluetooth, forKey: "micInputBluetooth")
        Microphone.switchInput()
        inputName = Microphone.currentName
    }

    /// Stops and saves the meeting; returns its id.
    func stop() async -> String? {
        guard let engine, let current = live else { return nil }
        microphone.stop()
        UIApplication.shared.isIdleTimerDisabled = false
        if let observer = routeObserver { NotificationCenter.default.removeObserver(observer) }
        routeObserver = nil
        stopArmed = false
        endActivity()
        let extra = Self.extra(current)
        do {
            let id = try await onQueue { try engine.stop(extra: extra) }
            // Only sizes, in ranges (CLAUDE.md): how long, how many lines, notes and photos.
            Analytics.track("recording_finished", [
                "minutes": Analytics.minutesBucket(meter.seconds), "language": language,
                "lines": Analytics.countBucket(current.lines.count),
                "notes": Analytics.countBucket(current.notes.filter { $0.isText && !$0.isEmpty }.count),
                "photos": Analytics.countBucket(current.notes.filter { $0.kind == .photo }.count),
                "marks": Analytics.countBucket(current.notes.filter { $0.kind == .mark }.count),
            ])
            live = nil
            reload()
            // Straight to the computer, if it's around.
            autoSync()
            return id
        } catch {
            self.error = error.localizedDescription
            live = nil
            return nil
        }
    }

    func delete(_ id: String) {
        try? engine?.deleteMeeting(id: id)
        reload()
    }

    func rename(_ id: String, to title: String) {
        try? engine?.renameMeeting(id: id, title: title)
        reload()
    }

    func meeting(_ id: String) -> MeetingDetail? {
        guard let json = try? engine?.meetingJson(id: id), let data = json.data(using: .utf8), var detail = MeetingDetail(json: data) else { return nil }
        let row = meetings.first { $0.id == id }
        detail.sent = row?.sent ?? false
        detail.revised = row?.revised ?? false
        detail.fromComputer = row?.fromComputer ?? false
        return detail
    }

    private func apply(_ u: LiveUpdate) {
        guard live != nil else { return }
        live?.lines.append(contentsOf: u.finals)
        // "Murmur, sóc la Laia" (Intro.swift): that line's speaker gets the name.
        for line in u.finals { introduce(line) }
        if !u.finals.isEmpty {
            live?.partial = ""
            // The lock screen gets each finished sentence (not the provisional text: too many updates).
            updateActivity()
        }
        if let p = u.partial { live?.partial = p }
        live?.seconds = u.seconds
    }

    private func onQueue<T>(_ work: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { c in queue.async { c.resume(with: Result { try work() }) } }
    }

    /// The notes as the computer stores them (a TipTap document, each paragraph with its second),
    /// the marked moments, and what was changed about the speakers while recording (the engine
    /// applies the aliases and the lines' speakers, also to the last lines).
    private static func extra(_ live: LiveMeeting) -> String {
        var extra: [String: Any] = [
            "title": live.title,
            "marks": NotesDoc.marks(live.notes),
            "screens": NotesDoc.screens(live.notes),
            "speakerNames": Dictionary(uniqueKeysWithValues: live.speakerNames.map { ("\($0.key)", $0.value) }),
            "speakerAliases": Dictionary(uniqueKeysWithValues: live.aliases.map { ("\($0.key)", $0.value) }),
            "lineSpeakers": live.lineSpeakers,
        ]
        if let doc = NotesDoc.encode(live.notes) { extra["notesDoc"] = doc }
        let data = (try? JSONSerialization.data(withJSONObject: extra)) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}

/// A finished meeting, read from the computer's JSON format.
struct MeetingDetail {
    struct Utterance: Identifiable { let id: String; let start: Double; let end: Double; let speaker: Int; let text: String }
    var title = ""
    var createdAt = Date()
    var duration: Double = 0
    var utterances: [Utterance] = []
    var notes: [NoteBlock] = []
    var speakerNames: [Int: String] = [:]
    var tags: [String] = []
    /// The computer has it, and has sent back the revised version.
    var sent = false
    var revised = false
    /// Recorded on the computer and sent here, text only.
    var fromComputer = false
    /// What the computer's language model wrote (its cover), once it comes back.
    var cover: Cover?

    init?(json: Data) {
        guard let m = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else { return nil }
        title = m["title"] as? String ?? ""
        createdAt = Date(timeIntervalSince1970: (m["createdAt"] as? Double ?? 0) / 1000)
        duration = m["duration"] as? Double ?? 0
        tags = m["tags"] as? [String] ?? []
        for (k, v) in m["speakerNames"] as? [String: Any] ?? [:] {
            if let i = Int(k), let name = v as? String, !name.isEmpty { speakerNames[i] = name }
        }
        utterances = (m["utterances"] as? [[String: Any]] ?? []).map {
            Utterance(id: $0["id"] as? String ?? UUID().uuidString, start: $0["start"] as? Double ?? 0, end: $0["end"] as? Double ?? 0, speaker: $0["speaker"] as? Int ?? 0, text: $0["text"] as? String ?? "")
        }
        let marks = Set((m["marks"] as? [[String: Any]] ?? []).compactMap { $0["t"] as? Double })
        notes = NotesDoc.decode(doc: m["notesDoc"] as? [String: Any], marks: marks, screens: m["screens"] as? [[String: Any]] ?? [])
        cover = (m["cover"] as? [String: Any]).flatMap(Cover.init)
    }

    func isMarked(_ u: Utterance) -> Bool {
        notes.contains { $0.kind == .mark && ($0.t ?? -10) >= u.start - 1 && ($0.t ?? -10) <= u.end + 2 }
    }

    /// Who spoke and how much (seconds), largest first.
    var talk: [(speaker: Int, seconds: Double)] {
        var seconds: [Int: Double] = [:]
        for u in utterances { seconds[u.speaker, default: 0] += max(0, u.end - u.start) }
        return seconds.map { ($0.key, $0.value) }.sorted { $0.seconds > $1.seconds }
    }

    var speakers: [Speaker] {
        Set(utterances.map(\.speaker)).sorted().map { Speaker(id: $0, name: speakerNames[$0]) }
    }
}
