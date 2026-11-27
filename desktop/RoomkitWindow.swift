import AppKit
import WebKit

@MainActor
final class RoomkitWindow: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSWindowDelegate {
    private let address: URL
    private let webView: WKWebView
    private var saveDestinations: [ObjectIdentifier: SaveDestination] = [:]

    private struct SaveDestination {
        let file: URL
        let stagingDirectory: URL
        let existingFileVersion: NSDictionary?

        var stagedFile: URL { stagingDirectory.appendingPathComponent(file.lastPathComponent) }
    }

    init(address: URL) {
        self.address = address
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        super.init(window: window)
        window.title = "Roomkit"
        window.contentView = webView
        window.initialFirstResponder = webView
        window.contentMinSize = NSSize(width: 720, height: 540)
        window.center()
        window.setFrameAutosaveName("Roomkit Editor")
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.load(URLRequest(url: address))
    }

    required init?(coder: NSCoder) { nil }

    var editorURL: URL? {
        guard let url = webView.url, isEditorURL(url) else { return nil }
        return url
    }

    private func isEditorURL(_ url: URL) -> Bool {
        url.scheme == address.scheme && url.host == address.host && url.port == address.port
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let sourceIsEditor = action.sourceFrame.request.url.map(isEditorURL) ?? false
        if action.shouldPerformDownload, sourceIsEditor,
           isEditorURL(url) || url.scheme == "blob" || url.scheme == "data" {
            return decisionHandler(.download)
        }
        if isEditorURL(url) {
            return decisionHandler(.allow)
        }
        if action.targetFrame?.isMainFrame == false, url.scheme == "data" || url.absoluteString == "about:blank" {
            return decisionHandler(.allow)
        }
        if sourceIsEditor, action.navigationType == .linkActivated,
           url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url, isEditorURL(url) {
            webView.load(action.request)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        guard let window, let url = frame.request.url, isEditorURL(url) else { return completionHandler(nil) }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.begin { result in
            guard result == .OK, let file = panel.url else { return completionHandler(nil) }
            let files = FileManager.default
            do {
                let existingFileVersion = try self.fileVersion(at: file)
                let directory = try files.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: file, create: true)
                let destination = SaveDestination(
                    file: file, stagingDirectory: directory, existingFileVersion: existingFileVersion
                )
                self.saveDestinations[ObjectIdentifier(download)] = destination
                completionHandler(destination.stagedFile)
            } catch {
                completionHandler(nil)
                self.showSaveError(error)
            }
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let destination = saveDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let files = FileManager.default
        defer { try? files.removeItem(at: destination.stagingDirectory) }
        do {
            guard try fileVersion(at: destination.file) == destination.existingFileVersion else {
                throw CocoaError(.fileWriteFileExists, userInfo: [NSFilePathErrorKey: destination.file.path])
            }
            if destination.existingFileVersion != nil {
                _ = try files.replaceItemAt(destination.file, withItemAt: destination.stagedFile)
            } else {
                try files.moveItem(at: destination.stagedFile, to: destination.file)
            }
        } catch {
            showSaveError(error)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let destination = saveDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        try? FileManager.default.removeItem(at: destination.stagingDirectory)
        showSaveError(error)
    }

    private func fileVersion(at file: URL) throws -> NSDictionary? {
        let files = FileManager.default
        guard files.fileExists(atPath: file.path) else { return nil }
        let attributes = try files.attributesOfItem(atPath: file.path)
        let versionKeys: Set<FileAttributeKey> = [.systemNumber, .systemFileNumber, .modificationDate, .size]
        return NSDictionary(dictionary: attributes.filter { versionKeys.contains($0.key) })
    }

    private func showSaveError(_ error: Error) {
        let alert = NSAlert(error: error)
        let localization = RoomkitLocalization(resources: Bundle.main.resourceURL)
        alert.messageText = localization.text(.couldNotSaveDownload)
        if let window, window.isVisible {
            alert.beginSheetModal(for: window)
        } else {
            alert.runModal()
        }
    }

    func windowWillClose(_ notification: Notification) {
        webView.evaluateJavaScript("window.dispatchEvent(new Event('roomkit:window-close'))")
        webView.setMicrophoneCaptureState(.none)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
