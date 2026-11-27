import Foundation

enum RoomkitMessage: String {
    case starting = "Roomkit is starting…"
    case running = "Roomkit is running"
    case stopped = "Roomkit stopped"
    case updateAvailable = "Roomkit update available"
    case open = "Open Roomkit"
    case openInBrowser = "Open in Browser"
    case edit = "Edit"
    case cut = "Cut"
    case copy = "Copy"
    case paste = "Paste"
    case window = "Window"
    case closeWindow = "Close Window"
    case minimize = "Minimize"
    case checkForUpdates = "Check for Updates…"
    case updateToVersion = "Update to Roomkit {version}…"
    case automaticUpdates = "Automatically Check for Updates"
    case showInMenuBar = "Show in Menu Bar"
    case showStartupLog = "Show Startup Log"
    case quitRoomkit = "Quit Roomkit"
    case serviceStopped = "The local Roomkit service stopped."
    case couldNotOpen = "Roomkit could not open"
    case couldNotSaveDownload = "Roomkit could not save the download"
    case quit = "Quit"
}

struct RoomkitLocalization {
    private let preferenceURL: URL
    private let translations: [String: [String: String]]
    private var locale = "en"

    var preferenceDirectory: URL { preferenceURL.deletingLastPathComponent() }

    init(resources: URL?, environment: [String: String] = ProcessInfo.processInfo.environment) {
        let home = environment["HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? NSHomeDirectory()
        let directory = environment["PLANNER_HOME"].flatMap { $0.isEmpty ? nil : $0 }
            ?? "\(home)/Library/Application Support/Roomkit"
        let path = if directory == "~" {
            home
        } else if directory.hasPrefix("~/") {
            "\(home)/\(directory.dropFirst(2))"
        } else {
            directory
        }
        preferenceURL = URL(fileURLWithPath: path, isDirectory: true, relativeTo: resources)
            .standardizedFileURL.appendingPathComponent("language.json")
        translations = resources.flatMap { resource in
            guard let data = try? Data(contentsOf: resource.appendingPathComponent("native-messages.json")) else {
                return nil
            }
            return try? JSONDecoder().decode([String: [String: String]].self, from: data)
        } ?? [:]
        refresh()
    }

    @discardableResult
    mutating func refresh() -> Bool {
        guard let data = try? Data(contentsOf: preferenceURL),
              let preference = try? JSONDecoder().decode([String: String].self, from: data) else { return false }
        let previous = locale
        if preference == ["kind": "pending"] {
            locale = "en"
        } else if preference.count == 2,
                  preference["kind"] == "selected",
                  let selected = preference["locale"],
                  translations[selected] != nil {
            locale = selected
        }
        return previous != locale
    }

    func text(_ message: RoomkitMessage) -> String {
        translations[locale]?[message.rawValue] ?? message.rawValue
    }
}
