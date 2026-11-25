import Foundation
import Network
import Security
import UIKit

/// This phone's private key for pairing (docs/EMPARELLAR.md), in the iPhone's keychain: only on
/// this device, never in iCloud or a backup that leaves it.
enum SyncKey {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.quicodomingo.murmur.sync",
        kSecAttrAccount as String: "phone",
    ]

    /// The key, made the first time it's needed.
    static func get() throws -> Data {
        var q = query
        q[kSecReturnData as String] = true
        var item: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data, data.count == 32 {
            return data
        }
        let key = try newSyncKey()
        var add = query
        add[kSecValueData as String] = key
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
        return key
    }

    /// Unpairing: a new pairing gets a new key.
    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}

/// The computer this phone is paired with. Its key is public (it's in the QR); only the phone's
/// own private key is secret, and that one is in the keychain.
struct PairedComputer: Codable, Equatable {
    var name: String
    var key: Data
    /// Where it answered, most recent first: tried before what Bonjour finds.
    var addresses: [String]

    private static let defaultsKey = "pairedComputer"

    static func load() -> PairedComputer? {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey) else { return nil }
        return try? JSONDecoder().decode(PairedComputer.self, from: data)
    }

    static func save(_ computer: PairedComputer?) {
        if let computer, let data = try? JSONEncoder().encode(computer) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        } else {
            UserDefaults.standard.removeObject(forKey: defaultsKey)
        }
    }
}

/// Bonjour: the computers announcing `_murmur._tcp` on this network, as "host:port". The name they
/// announce is random, so every one is a candidate; the handshake tells which is ours. The first
/// search is what makes iOS ask for the local network permission.
enum Discovery {
    static func find(timeout: TimeInterval = 2) async -> [String] {
        await withCheckedContinuation { continuation in
            let queue = DispatchQueue(label: "murmur.discovery")
            let browser = NWBrowser(for: .bonjour(type: "_murmur._tcp", domain: nil), using: .tcp)
            var found: [String] = []
            var connections: [NWConnection] = []
            var finished = false

            // IPv4: a plain address the engine's sockets take as it is (an IPv6 link-local one
            // comes with its interface's name).
            let parameters = NWParameters.tcp
            (parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options)?.version = .v4

            func finish() {
                guard !finished else { return }
                finished = true
                browser.cancel()
                connections.forEach { $0.cancel() }
                continuation.resume(returning: found)
            }

            browser.browseResultsChangedHandler = { results, _ in
                for result in results {
                    // Resolving it: open and close at once, and keep the address it reached.
                    let connection = NWConnection(to: result.endpoint, using: parameters)
                    connections.append(connection)
                    connection.stateUpdateHandler = { state in
                        guard case .ready = state else { return }
                        if case let .hostPort(host, port)? = connection.currentPath?.remoteEndpoint, case let .ipv4(address) = host {
                            // From the bytes: the description may carry the interface ("%en0").
                            let entry = address.rawValue.map(String.init).joined(separator: ".") + ":\(port.rawValue)"
                            if !found.contains(entry) { found.append(entry) }
                        }
                        connection.cancel()
                    }
                    connection.start(queue: queue)
                }
            }
            browser.start(queue: queue)
            queue.asyncAfter(deadline: .now() + timeout) { finish() }
        }
    }
}

/// What went wrong, as the person reads it.
struct SyncProblem: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
extension Store {
    /// The name the computer shows for this phone ("iPhone").
    private var phoneName: String { UIDevice.current.name }

    /// Runs engine work off the main thread, on the sync queue.
    private func onSyncQueue<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { c in syncQueue.async { c.resume(with: Result { try work() }) } }
    }

    /// Pairs with the computer in the QR's text. Returns its name; throws a `SyncProblem` to show.
    func pair(code: String) async throws -> String {
        guard let engine else { throw SyncProblem(message: L("pair.unreachable")) }
        guard let info = try? readPairingCode(uri: code) else { throw SyncProblem(message: L("pair.notACode")) }
        let found = await Discovery.find(timeout: 1.5)
        let name = phoneName
        do {
            let key = try SyncKey.get()
            let paired = try await onSyncQueue { try engine.pair(uri: code, extra: found, privateKey: key, phoneName: name) }
            let computer = PairedComputer(name: paired.name, key: paired.key, addresses: ([paired.address] + info.addresses).uniqued())
            PairedComputer.save(computer)
            self.computer = computer
            syncProblem = nil
            reload()
            Analytics.track("mobile_paired")
            autoSync(force: true)
            return paired.name
        } catch let error as MurmurError {
            switch error {
            case .NotACode: throw SyncProblem(message: L("pair.notACode"))
            case .CodeExpired: throw SyncProblem(message: L("pair.expired"))
            case .Unreachable: throw SyncProblem(message: L("pair.unreachable"))
            default: throw SyncProblem(message: L("sync.failed", error.localizedDescription))
            }
        }
    }

    /// Unpaired on the phone: the computer keeps what it has; a new pairing starts with a new key.
    func unpair() {
        try? engine?.forgetComputer()
        SyncKey.delete()
        PairedComputer.save(nil)
        computer = nil
        syncProblem = nil
        lastSync = nil
        UserDefaults.standard.removeObject(forKey: "lastSync")
        reload()
    }

    /// "Envia les reunions soles" (on by default).
    var autoSyncOn: Bool { UserDefaults.standard.object(forKey: "autoSync") as? Bool ?? true }

    /// Syncs if paired and allowed, never in the middle of a recording. `force`: also when the
    /// automatic one is off (Sincronitza ara, just paired).
    func autoSync(force: Bool = false) {
        guard computer != nil, live == nil, force || autoSyncOn else { return }
        Task { await sync() }
    }

    /// Sends what the computer doesn't have and picks up what it has revised.
    func sync() async {
        guard let engine, var computer, !syncing else { return }
        syncing = true
        defer { syncing = false }
        let found = await Discovery.find(timeout: 1.5)
        let candidates = (computer.addresses + found).uniqued()
        let (key, name, computerKey) = ((try? SyncKey.get()) ?? Data(), phoneName, computer.key)
        let keepAudio = UserDefaults.standard.object(forKey: "keepAudio") as? Bool ?? true
        do {
            let report = try await onSyncQueue { try engine.sync(candidates: candidates, privateKey: key, computerKey: computerKey, phoneName: name, keepAudio: keepAudio) }
            // Where it answered goes first next time; its name may have changed.
            computer.name = report.computerName
            computer.addresses = Array(([report.address] + computer.addresses).uniqued().prefix(4))
            PairedComputer.save(computer)
            self.computer = computer
            syncProblem = nil
            lastSync = Date()
            if report.sent + report.revised + report.received > 0 {
                Analytics.track("mobile_synced", [
                    "sent": Analytics.countBucket(Int(report.sent)),
                    "revised": Analytics.countBucket(Int(report.revised)),
                    "received": Analytics.countBucket(Int(report.received)),
                ])
            }
            UserDefaults.standard.set(lastSync, forKey: "lastSync")
        } catch let error as MurmurError {
            switch error {
            case .Busy: break
            case .Unreachable: syncProblem = L("sync.unreachable")
            case .NotPaired: syncProblem = L("sync.notPaired")
            default: syncProblem = L("sync.failed", error.localizedDescription)
            }
        } catch {
            syncProblem = L("sync.failed", error.localizedDescription)
        }
        reload()
    }
}

extension Sequence where Element: Hashable {
    /// In order, without repeats.
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
