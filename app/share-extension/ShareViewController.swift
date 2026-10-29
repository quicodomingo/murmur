// Murmur's entry in the Share menu: hands the shared audio files to Murmur, which transcribes them
// as if they had been opened from File › Transcribe from File. No window of its own.
import AppKit
import UniformTypeIdentifiers

/// The app group both Murmur and this extension can read and write (Entitlements.plist on each).
let appGroup = "NYQHV4FSKC.com.quicodomingo.murmur"

final class ShareViewController: NSViewController {
    override func loadView() {
        view = NSView(frame: .zero)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        let group = DispatchGroup()
        let lock = NSLock()
        var files: [URL] = []
        for provider in providers {
            group.enter()
            fileURL(from: provider) { url in
                if let url {
                    lock.lock()
                    files.append(url)
                    lock.unlock()
                }
                group.leave()
            }
        }
        group.notify(queue: .main) { [weak self] in
            self?.open(files)
        }
    }

    /// Hands the files to the Murmur that holds this extension (Contents/PlugIns/…appex).
    private func open(_ files: [URL]) {
        let murmur = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        guard !files.isEmpty else {
            extensionContext?.cancelRequest(withError: CocoaError(.fileReadUnknown))
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open(files, withApplicationAt: murmur, configuration: configuration) { [weak self] _, error in
            DispatchQueue.main.async {
                if let error {
                    self?.extensionContext?.cancelRequest(withError: error)
                } else {
                    self?.extensionContext?.completeRequest(returningItems: nil)
                }
            }
        }
    }
}

/// A file Murmur can read: the shared file itself, or, when the app shares only its contents
/// (a voice memo, an attachment), a copy in the app group's folder.
private func fileURL(from provider: NSItemProvider, done: @escaping (URL?) -> Void) {
    if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
        _ = provider.loadObject(ofClass: URL.self) { url, _ in
            done(url.flatMap { isAudio($0) ? $0 : nil })
        }
        return
    }
    guard let type = provider.registeredTypeIdentifiers.compactMap(UTType.init).first(where: { $0.conforms(to: .audio) || $0.conforms(to: .movie) }) else {
        done(nil)
        return
    }
    provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        // The file only lives until this returns.
        done(url.flatMap { copyToShared($0, type: type) })
    }
}

private func isAudio(_ url: URL) -> Bool {
    guard let type = UTType(filenameExtension: url.pathExtension) else { return false }
    return type.conforms(to: .audio) || type.conforms(to: .movie)
}

/// Into the group's Shared folder, where earlier copies older than a day are cleared first.
private func copyToShared(_ url: URL, type: UTType) -> URL? {
    let fm = FileManager.default
    guard let container = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
    let folder = container.appendingPathComponent("Shared", isDirectory: true)
    try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
    let old = Date().addingTimeInterval(-24 * 3600)
    for file in (try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
        if let date = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, date < old {
            try? fm.removeItem(at: file)
        }
    }
    var name = url.lastPathComponent
    if url.pathExtension.isEmpty, let ext = type.preferredFilenameExtension {
        name += "." + ext
    }
    var target = folder.appendingPathComponent(name)
    if fm.fileExists(atPath: target.path) {
        target = folder.appendingPathComponent(UUID().uuidString.prefix(8) + "-" + name)
    }
    do {
        try fm.copyItem(at: url, to: target)
        return target
    } catch {
        return nil
    }
}
