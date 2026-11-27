import AppKit
import Foundation
import Sparkle

@MainActor
final class RoomkitLauncher: NSObject, NSApplicationDelegate, NSMenuDelegate, NSMenuItemValidation, SPUStandardUserDriverDelegate {
    private let isHeadless = CommandLine.arguments.contains("--no-browser")
    private let menuBarPreference = "ShowInMenuBar"
    private let serviceStatus = NSMenuItem()
    private lazy var localization = RoomkitLocalization(resources: Bundle.main.resourceURL)
    private lazy var updater = SPUStandardUpdaterController(
        startingUpdater: false,
        updaterDelegate: nil,
        userDriverDelegate: self
    )
    private var statusItem: NSStatusItem?
    private var availableUpdateVersion: String? {
        didSet { updateMenuBarIcon() }
    }
    private var terminationSignal: DispatchSourceSignal?
    private var preferenceWatch: DispatchSourceFileSystemObject?
    private var server: Process?
    private var address: URL?
    private var editorWindow: RoomkitWindow?
    private var logFile: URL?
    private var readiness = Data()
    private var quitting = false
    private let readinessPipe = Pipe()

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !isHeadless { configureMenus() }

        signal(SIGTERM, SIG_IGN)
        let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        termination.setEventHandler { [weak self] in
            guard let self else { return }
            if !self.isHeadless {
                NSApp.terminate(nil)
            } else {
                self.stop()
                exit(EXIT_SUCCESS)
            }
        }
        termination.resume()
        terminationSignal = termination

        do {
            try start()
        } catch {
            showFailure(error.localizedDescription)
        }
    }

    private func configureMenus() {
        UserDefaults.standard.register(defaults: [menuBarPreference: true])
        setServiceStatus(.starting)
        let menu = NSMenu()
        let roomkit = NSMenuItem()
        menu.addItem(roomkit)
        let actions = NSMenu()
        actions.delegate = self
        addMenuItem(.open, action: #selector(openRoomkit), keyEquivalent: "o", to: actions).target = self
        addMenuItem(.openInBrowser, action: #selector(openInBrowser), to: actions).target = self
        addMenuItem(.checkForUpdates, action: #selector(checkForUpdates), to: actions).target = self
        addMenuItem(.automaticUpdates, action: #selector(toggleAutomaticUpdates), to: actions).target = self
        addMenuItem(.showInMenuBar, action: #selector(toggleMenuBar), to: actions).target = self
        addMenuItem(.showStartupLog, action: #selector(showLog), to: actions).target = self
        actions.addItem(.separator())
        addMenuItem(.quitRoomkit, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q", to: actions)
        roomkit.submenu = actions

        let edit = addSubmenu(.edit, to: menu)
        addMenuItem(.cut, action: #selector(NSText.cut(_:)), keyEquivalent: "x", to: edit)
        addMenuItem(.copy, action: #selector(NSText.copy(_:)), keyEquivalent: "c", to: edit)
        addMenuItem(.paste, action: #selector(NSText.paste(_:)), keyEquivalent: "v", to: edit)

        let window = addSubmenu(.window, to: menu)
        addMenuItem(.closeWindow, action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w", to: window)
        addMenuItem(.minimize, action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m", to: window)
        NSApp.mainMenu = menu
        NSApp.windowsMenu = window
        if UserDefaults.standard.bool(forKey: menuBarPreference) { showMenuBar() }
        updater.startUpdater()
    }

    private func showMenuBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let menu = NSMenu()
        menu.delegate = self
        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
            menu.addItem(withTitle: "Roomkit \(version)", action: nil, keyEquivalent: "")
        }
        menu.addItem(serviceStatus)
        menu.addItem(.separator())
        addMenuItem(.open, action: #selector(openRoomkit), to: menu).target = self
        addMenuItem(.openInBrowser, action: #selector(openInBrowser), to: menu).target = self
        addMenuItem(.checkForUpdates, action: #selector(checkForUpdates), to: menu).target = self
        addMenuItem(.showStartupLog, action: #selector(showLog), to: menu).target = self
        menu.addItem(.separator())
        addMenuItem(.quitRoomkit, action: #selector(NSApplication.terminate(_:)), to: menu)
        item.menu = menu
        statusItem = item
        updateMenuBarIcon()
    }

    @discardableResult
    private func addMenuItem(_ message: RoomkitMessage, action: Selector, keyEquivalent: String = "", to menu: NSMenu) -> NSMenuItem {
        let item = menu.addItem(withTitle: menuTitle(message), action: action, keyEquivalent: keyEquivalent)
        item.representedObject = message
        return item
    }

    private func addSubmenu(_ message: RoomkitMessage, to menu: NSMenu) -> NSMenu {
        let title = localization.text(message)
        let submenu = NSMenu(title: title)
        submenu.delegate = self
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.representedObject = message
        item.submenu = submenu
        menu.addItem(item)
        return submenu
    }

    private func setServiceStatus(_ message: RoomkitMessage) {
        serviceStatus.representedObject = message
        serviceStatus.title = localization.text(message)
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        refreshMenuLocalization()
    }

    private func watchLanguagePreference() {
        let directory = localization.preferenceDirectory
        let descriptor = open(directory.path, O_EVTONLY)
        if descriptor >= 0 {
            let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor, eventMask: .write, queue: .main)
            source.setEventHandler { [weak self] in self?.refreshMenuLocalization() }
            source.setCancelHandler { _ = close(descriptor) }
            preferenceWatch = source
            source.activate()
        }
        refreshMenuLocalization()
    }

    private func refreshMenuLocalization() {
        guard localization.refresh() else { return }
        let mainItems = NSApp.mainMenu?.items ?? []
        let subItems = mainItems.flatMap { $0.submenu?.items ?? [] }
        let statusItems = statusItem?.menu?.items ?? []
        for item in mainItems + subItems + statusItems {
            if let message = item.representedObject as? RoomkitMessage {
                let title = menuTitle(message)
                item.title = title
                item.submenu?.title = title
            }
        }
        updateMenuBarIcon()
    }

    private func menuTitle(_ message: RoomkitMessage) -> String {
        if message == .checkForUpdates, let version = availableUpdateVersion {
            return localization.text(.updateToVersion).replacingOccurrences(of: "{version}", with: version)
        }
        return localization.text(message)
    }

    private func updateMenuBarIcon() {
        let hasUpdate = availableUpdateVersion != nil
        let label = hasUpdate ? localization.text(.updateAvailable) : "Roomkit"
        statusItem?.button?.image = NSImage(
            systemSymbolName: hasUpdate ? "cube.fill" : "cube",
            accessibilityDescription: label
        )
        statusItem?.button?.toolTip = label
    }

    nonisolated var supportsGentleScheduledUpdateReminders: Bool { true }

    nonisolated func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool {
        MainActor.assumeIsolated { statusItem == nil || immediateFocus }
    }

    nonisolated func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        guard !state.userInitiated else { return }
        let version = update.displayVersionString
        MainActor.assumeIsolated { availableUpdateVersion = version }
    }

    nonisolated func standardUserDriverWillFinishUpdateSession() {
        MainActor.assumeIsolated { availableUpdateVersion = nil }
    }

    @objc private func checkForUpdates(_ sender: Any?) {
        NSApp.activate()
        updater.checkForUpdates(sender)
    }

    @objc private func toggleAutomaticUpdates() {
        updater.updater.automaticallyChecksForUpdates.toggle()
    }

    @objc private func toggleMenuBar() {
        if let item = statusItem {
            item.menu?.removeItem(serviceStatus)
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        } else {
            showMenuBar()
        }
        UserDefaults.standard.set(statusItem != nil, forKey: menuBarPreference)
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        switch menuItem.action {
        case #selector(openRoomkit), #selector(openInBrowser):
            return address != nil
        case #selector(showLog):
            return logFile != nil
        case #selector(checkForUpdates):
            menuItem.title = menuTitle(.checkForUpdates)
            return updater.updater.canCheckForUpdates
        case #selector(toggleAutomaticUpdates):
            menuItem.state = updater.updater.automaticallyChecksForUpdates ? .on : .off
        case #selector(toggleMenuBar):
            menuItem.state = statusItem != nil ? .on : .off
        default:
            break
        }
        return true
    }

    private func start() throws {
        guard let resources = Bundle.main.resourceURL else {
            throw CocoaError(.fileNoSuchFile)
        }
        let directory = isHeadless
            ? FileManager.default.temporaryDirectory
            : FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Roomkit", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = directory.appendingPathComponent("startup-\(UUID().uuidString).log")
        try Data().write(to: file, options: .withoutOverwriting)
        logFile = file

        let child = Process()
        child.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/node")
        child.currentDirectoryURL = resources
        child.arguments = [resources.appendingPathComponent("server.mjs").path]
        child.environment = ProcessInfo.processInfo.environment.filter { !["NODE_OPTIONS", "NODE_PATH"].contains($0.key) }
        child.standardOutput = readinessPipe
        child.standardError = try FileHandle(forWritingTo: file)
        readinessPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            if chunk.isEmpty { handle.readabilityHandler = nil }
            Task { @MainActor in self?.receive(chunk) }
        }
        child.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if !self.quitting {
                    self.showFailure()
                }
            }
        }
        server = child
        try child.run()
    }

    private func receive(_ chunk: Data) {
        if address != nil || quitting { return }
        readiness.append(chunk)
        while let newline = readiness.firstIndex(of: 10) {
            let line = String(decoding: readiness[..<newline], as: UTF8.self)
            readiness.removeSubrange(...newline)
            guard line.hasPrefix("ROOMKIT_READY "),
                  let url = URL(string: String(line.dropFirst("ROOMKIT_READY ".count))),
                  url.scheme == "http", url.host == "127.0.0.1" else { continue }
            address = url
            if isHeadless {
                FileHandle.standardOutput.write(Data("ROOMKIT_READY \(url.absoluteString)\n".utf8))
            } else {
                watchLanguagePreference()
                setServiceStatus(.running)
                openRoomkit()
            }
            return
        }
        if readiness.count > 65536 { readiness.removeAll() }
    }

    @objc private func openRoomkit() {
        guard !isHeadless, let address else { return }
        let editor = editorWindow ?? RoomkitWindow(address: address)
        editorWindow = editor
        editor.showWindow(nil)
        editor.window?.deminiaturize(nil)
        NSApp.activate()
    }

    @objc private func openInBrowser() {
        if let url = editorWindow?.editorURL ?? address { NSWorkspace.shared.open(url) }
    }

    @objc private func showLog() {
        if let logFile { NSWorkspace.shared.open(logFile) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openRoomkit()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        stop()
        return .terminateNow
    }

    private func stop() {
        quitting = true
        preferenceWatch?.cancel()
        preferenceWatch = nil
        guard let server, server.isRunning else { return }
        server.terminate()
        let deadline = Date().addingTimeInterval(9)
        while server.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if server.isRunning { kill(server.processIdentifier, SIGKILL) }
    }

    private func showFailure(_ detail: String? = nil) {
        if isHeadless {
            let message = detail ?? RoomkitMessage.serviceStopped.rawValue
            FileHandle.standardError.write(Data("\(message)\n".utf8))
            if let logFile, let log = try? Data(contentsOf: logFile) {
                FileHandle.standardError.write(log)
            }
            stop()
            exit(EXIT_FAILURE)
        }
        localization.refresh()
        setServiceStatus(.stopped)
        address = nil
        let alert = NSAlert()
        alert.messageText = localization.text(.couldNotOpen)
        alert.informativeText = detail ?? localization.text(.serviceStopped)
        alert.addButton(withTitle: localization.text(.quit))
        if logFile != nil { alert.addButton(withTitle: localization.text(.showStartupLog)) }
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn { showLog() }
        NSApp.terminate(nil)
    }
}

@main
struct RoomkitApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let launcher = RoomkitLauncher()
        app.setActivationPolicy(.regular)
        app.delegate = launcher
        withExtendedLifetime(launcher) { app.run() }
    }
}
