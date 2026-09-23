import SwiftUI
import WebKit

struct PlaceEchoWebView: UIViewRepresentable {
    private let captureProvider: PanoramaCaptureProviding

    init(captureProvider: PanoramaCaptureProviding) {
        self.captureProvider = captureProvider
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(captureProvider: captureProvider)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: Coordinator.messageHandlerName)

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController = contentController
        configuration.setURLSchemeHandler(
            context.coordinator.bundledWebAppHandler,
            forURLScheme: BundledWebAppSchemeHandler.scheme
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        context.coordinator.showLoadingIndicator(in: webView)
        Self.loadWebProduct(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: Coordinator.messageHandlerName
        )
        webView.navigationDelegate = nil
        coordinator.webView = nil
    }

    private static func loadWebProduct(in webView: WKWebView) {
        if
            let rawValue = ProcessInfo.processInfo.environment["PLACE_ECHO_WEB_URL"],
            !rawValue.isEmpty,
            let environmentURL = URL(string: rawValue)
        {
            webView.load(URLRequest(url: environmentURL))
            return
        }
        if
            Bundle.main.url(
                forResource: "index",
                withExtension: "html",
                subdirectory: "WebApp"
            ) != nil,
            let bundledURL = URL(string: "\(BundledWebAppSchemeHandler.scheme)://app/index.html")
        {
            webView.load(URLRequest(url: bundledURL))
            return
        }
        if
            let rawValue = Bundle.main.object(forInfoDictionaryKey: "PlaceEchoWebURL") as? String,
            let configuredURL = URL(string: rawValue)
        {
            webView.load(URLRequest(url: configuredURL))
            return
        }
        assertionFailure("PlaceEcho has neither a bundled WebApp nor a configured Web URL.")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        static let messageHandlerName = "placeecho"

        weak var webView: WKWebView?
        fileprivate let bundledWebAppHandler = BundledWebAppSchemeHandler()
        private let captureProvider: PanoramaCaptureProviding
        private weak var captureViewController: UIViewController?
        private weak var loadingView: UIView?
        private weak var loadingLabel: UILabel?
        private weak var recoveryCaptureButton: UIButton?
        private var recoveryWorkItem: DispatchWorkItem?
        private var isNativeRecoveryCapture = false
        private var isPreparingCapture = false
        private var didRetryTerminatedWebContent = false
        private var isWebReady = false
        private var pendingNativeMessages: [[String: Any]] = []

        init(captureProvider: PanoramaCaptureProviding) {
            self.captureProvider = captureProvider
        }

        func showLoadingIndicator(in webView: WKWebView) {
            let container = UIView()
            container.translatesAutoresizingMaskIntoConstraints = false
            container.backgroundColor = .systemBackground

            let indicator = UIActivityIndicatorView(style: .large)
            indicator.translatesAutoresizingMaskIntoConstraints = false
            indicator.startAnimating()

            let label = UILabel()
            label.translatesAutoresizingMaskIntoConstraints = false
            label.text = "正在启动 PlaceEcho…"
            label.textColor = .secondaryLabel
            label.font = .preferredFont(forTextStyle: .body)
            label.textAlignment = .center
            label.numberOfLines = 0

            var recoveryConfiguration = UIButton.Configuration.filled()
            recoveryConfiguration.title = "直接使用 X5 拍摄"
            recoveryConfiguration.cornerStyle = .capsule
            recoveryConfiguration.contentInsets = NSDirectionalEdgeInsets(
                top: 14,
                leading: 24,
                bottom: 14,
                trailing: 24
            )
            let recoveryButton = UIButton(configuration: recoveryConfiguration)
            recoveryButton.translatesAutoresizingMaskIntoConstraints = false
            recoveryButton.isHidden = true
            recoveryButton.addTarget(
                self,
                action: #selector(openNativeCaptureRecovery),
                for: .touchUpInside
            )

            container.addSubview(indicator)
            container.addSubview(label)
            container.addSubview(recoveryButton)
            webView.addSubview(container)
            NSLayoutConstraint.activate([
                container.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
                container.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
                container.topAnchor.constraint(equalTo: webView.topAnchor),
                container.bottomAnchor.constraint(equalTo: webView.bottomAnchor),
                indicator.centerXAnchor.constraint(equalTo: container.centerXAnchor),
                indicator.centerYAnchor.constraint(equalTo: container.centerYAnchor, constant: -18),
                label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 28),
                label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -28),
                label.topAnchor.constraint(equalTo: indicator.bottomAnchor, constant: 16),
                recoveryButton.centerXAnchor.constraint(equalTo: container.centerXAnchor),
                recoveryButton.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 22),
            ])
            loadingView = container
            loadingLabel = label
            recoveryCaptureButton = recoveryButton

            recoveryWorkItem?.cancel()
            let workItem = DispatchWorkItem { [weak self, weak recoveryButton] in
                guard let self, self.loadingView != nil else { return }
                recoveryButton?.isHidden = false
            }
            recoveryWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: workItem)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("PlaceEcho Web: loaded \(webView.url?.absoluteString ?? "unknown URL")")
            isWebReady = true
            recoveryWorkItem?.cancel()
            recoveryWorkItem = nil
            loadingView?.removeFromSuperview()
            flushPendingMessages()
        }

        func webView(
            _ webView: WKWebView,
            didStartProvisionalNavigation navigation: WKNavigation!
        ) {
            isWebReady = false
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            showLoadFailure(error)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            showLoadFailure(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            print("PlaceEcho Web: WebContent process terminated")
            isWebReady = false
            recoveryWorkItem?.cancel()
            recoveryWorkItem = nil
            loadingLabel?.text = "页面进程已停止，你可以直接使用 X5 拍摄。"
            recoveryCaptureButton?.isHidden = false
            if !didRetryTerminatedWebContent {
                didRetryTerminatedWebContent = true
                webView.reload()
            }
        }

        private func showLoadFailure(_ error: Error) {
            print("PlaceEcho Web: navigation failed: \(error.localizedDescription)")
            recoveryWorkItem?.cancel()
            recoveryWorkItem = nil
            loadingLabel?.text = "页面加载失败，你仍可直接使用 X5 拍摄。"
            recoveryCaptureButton?.isHidden = false
        }

        @objc private func openNativeCaptureRecovery() {
            guard captureViewController == nil, !isPreparingCapture else { return }
            isNativeRecoveryCapture = true
            presentX5Capture(sceneID: "scene_manager_window")
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                message.name == Self.messageHandlerName,
                let body = message.body as? [String: Any],
                body["type"] as? String == "capture_panorama",
                let sceneID = body["scene_id"] as? String,
                !sceneID.isEmpty
            else {
                return
            }

            guard captureViewController == nil, !isPreparingCapture else {
                send([
                    "type": "capture_failed",
                    "scene_id": sceneID,
                    "message": "X5 拍摄页面已经打开。",
                ])
                return
            }

            if captureProvider is PanoramaCaptureViewControllerProviding {
                presentX5Capture(sceneID: sceneID)
            } else {
                runCapture(sceneID: sceneID)
            }
        }

        private func presentX5Capture(sceneID: String) {
            guard let capturePresenter = captureProvider as? PanoramaCaptureViewControllerProviding else {
                runCapture(sceneID: sceneID)
                return
            }

            isPreparingCapture = true
            capturePresenter.prepareCaptureViewController(
                sceneID: sceneID,
                captureCompletion: { [weak self] result in
                    self?.captureViewController = nil
                    self?.handle(result, fallbackSceneID: sceneID)
                },
                preparationCompletion: { [weak self] result in
                    guard let self else { return }
                    self.isPreparingCapture = false
                    switch result {
                    case .success(let controller):
                        guard
                            let webView = self.webView,
                            let presenter = webView.nearestViewController
                        else {
                            self.isNativeRecoveryCapture = false
                            self.send([
                                "type": "capture_failed",
                                "scene_id": sceneID,
                                "message": "无法打开 X5 拍摄页面。",
                            ])
                            return
                        }
                        self.captureViewController = controller
                        presenter.present(controller, animated: true)
                    case .failure(let error):
                        self.isNativeRecoveryCapture = false
                        self.send([
                            "type": "capture_failed",
                            "scene_id": sceneID,
                            "message": error.localizedDescription,
                        ])
                    }
                }
            )
        }

        private func runCapture(sceneID: String) {
            captureProvider.capture(sceneID: sceneID) { [weak self] result in
                DispatchQueue.main.async {
                    self?.handle(result, fallbackSceneID: sceneID)
                }
            }
        }

        private func handle(
            _ result: Result<CapturedPanorama, Error>,
            fallbackSceneID: String
        ) {
            let shouldShowNativeResult = isNativeRecoveryCapture
            isNativeRecoveryCapture = false
            switch result {
            case .success(let panorama):
                guard let captureURL = bundledWebAppHandler.webURL(for: panorama.url) else {
                    send([
                        "type": "capture_failed",
                        "scene_id": panorama.sceneID,
                        "message": "全景图已拍摄，但无法提供给当前页面。",
                    ])
                    if shouldShowNativeResult {
                        showNativeCaptureResult(.failure(NSError(
                            domain: "dev.placeecho.capture-store",
                            code: 1,
                            userInfo: [
                                NSLocalizedDescriptionKey: "全景图已拍摄，但无法提供给当前页面。",
                            ]
                        )))
                    }
                    return
                }
                send([
                    "type": "panorama_ready",
                    "scene_id": panorama.sceneID,
                    "url": captureURL.absoluteString,
                    "width": panorama.width,
                    "height": panorama.height,
                    "availability": "device",
                ])
            case .failure(let error):
                send([
                    "type": "capture_failed",
                    "scene_id": fallbackSceneID,
                    "message": error.localizedDescription,
                ])
            }
            if shouldShowNativeResult {
                showNativeCaptureResult(result)
            }
        }

        private func showNativeCaptureResult(
            _ result: Result<CapturedPanorama, Error>
        ) {
            guard
                let webView,
                let presenter = webView.nearestViewController
            else {
                return
            }
            let title: String
            let message: String
            switch result {
            case .success:
                title = "拍摄完成"
                message = "全景图已保存在这台 iPhone，并已进入当前创建流程；恢复正常网络后会继续同步。"
            case .failure(let error):
                title = "拍摄未完成"
                message = error.localizedDescription
            }
            let alert = UIAlertController(
                title: title,
                message: message,
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "好", style: .default))
            presenter.present(alert, animated: true)
        }

        private func send(_ message: [String: Any]) {
            guard isWebReady else {
                pendingNativeMessages.append(message)
                return
            }
            evaluate(message)
        }

        private func flushPendingMessages() {
            let messages = pendingNativeMessages
            pendingNativeMessages.removeAll()
            messages.forEach(evaluate)
        }

        private func evaluate(_ message: [String: Any]) {
            guard
                JSONSerialization.isValidJSONObject(message),
                let data = try? JSONSerialization.data(withJSONObject: message),
                let json = String(data: data, encoding: .utf8)
            else {
                return
            }
            webView?.evaluateJavaScript("window.PlaceEchoNative?.receiveMessage(\(json));")
        }
    }
}

fileprivate final class BundledWebAppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "placeecho"

    func webURL(for localCaptureURL: URL) -> URL? {
        guard
            localCaptureURL.isFileURL,
            let captureRoot = try? Self.captureRoot(),
            Self.isDescendant(localCaptureURL, of: captureRoot),
            Self.isCaptureFile(localCaptureURL.lastPathComponent)
        else {
            return nil
        }
        return URL(
            string: "\(Self.scheme)://capture/\(localCaptureURL.lastPathComponent)"
        )
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(Self.error("无效的 PlaceEcho 资源请求。"))
            return
        }

        let fileURL: URL
        do {
            switch requestURL.host {
            case "app":
                fileURL = try Self.bundledFileURL(for: requestURL)
            case "capture":
                fileURL = try Self.captureFileURL(for: requestURL)
            default:
                throw Self.error("不支持的 PlaceEcho 资源地址。")
            }
        } catch {
            urlSchemeTask.didFailWithError(error)
            return
        }

        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            let response = URLResponse(
                url: requestURL,
                mimeType: Self.mimeType(for: fileURL.pathExtension, data: data),
                expectedContentLength: data.count,
                textEncodingName: Self.textEncoding(for: fileURL.pathExtension)
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            print("PlaceEcho Web: missing resource \(requestURL): \(error)")
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func bundledFileURL(for requestURL: URL) throws -> URL {
        guard let bundleResourceURL = Bundle.main.resourceURL else {
            throw error("找不到内置 Web 资源。")
        }
        let resourceRoot = bundleResourceURL
            .appendingPathComponent("WebApp", isDirectory: true)
            .standardizedFileURL
        let resourcePath = requestURL.path.removingPercentEncoding?
            .trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        let relativePath = resourcePath.isEmpty ? "index.html" : resourcePath
        guard !relativePath.split(separator: "/").contains("..") else {
            throw error("无效的内置 Web 资源路径。")
        }
        let fileURL = resourceRoot
            .appendingPathComponent(relativePath, isDirectory: false)
            .standardizedFileURL
        guard isDescendant(fileURL, of: resourceRoot) else {
            throw error("Web 资源路径超出允许范围。")
        }
        return fileURL
    }

    private static func captureFileURL(for requestURL: URL) throws -> URL {
        let filename = requestURL.path.removingPercentEncoding?
            .trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        guard isCaptureFile(filename) else {
            throw error("无效的本机全景图路径。")
        }
        let root = try captureRoot()
        let fileURL = root
            .appendingPathComponent(filename, isDirectory: false)
            .standardizedFileURL
        guard isDescendant(fileURL, of: root) else {
            throw error("全景图路径超出允许范围。")
        }
        return fileURL
    }

    private static func captureRoot() throws -> URL {
        try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        .appendingPathComponent("PlaceEcho", isDirectory: true)
        .appendingPathComponent("Captures", isDirectory: true)
        .standardizedFileURL
    }

    private static func isCaptureFile(_ filename: String) -> Bool {
        let url = URL(fileURLWithPath: filename)
        return !filename.contains("/")
            && url.pathExtension.lowercased() == "jpg"
            && UUID(uuidString: url.deletingPathExtension().lastPathComponent) != nil
    }

    private static func isDescendant(_ fileURL: URL, of rootURL: URL) -> Bool {
        let rootPath = rootURL.path.hasSuffix("/")
            ? rootURL.path
            : rootURL.path + "/"
        return fileURL.standardizedFileURL.path.hasPrefix(rootPath)
    }

    private static func mimeType(for pathExtension: String, data: Data) -> String {
        // Development thumbnails are transcoded to JPEG for older iOS WebKit
        // decoders while retaining the stable Web route used by the product.
        if data.count >= 3, data[0] == 0xFF, data[1] == 0xD8, data[2] == 0xFF {
            return "image/jpeg"
        }
        return switch pathExtension.lowercased() {
        case "html": "text/html"
        case "css": "text/css"
        case "js", "mjs": "text/javascript"
        case "json": "application/json"
        case "wasm": "application/wasm"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "webp": "image/webp"
        case "mp4": "video/mp4"
        case "svg": "image/svg+xml"
        case "glb": "model/gltf-binary"
        case "spz": "application/octet-stream"
        default: "application/octet-stream"
        }
    }

    private static func textEncoding(for pathExtension: String) -> String? {
        switch pathExtension.lowercased() {
        case "html", "css", "js", "mjs", "json", "svg": "utf-8"
        default: nil
        }
    }

    private static func error(_ description: String) -> NSError {
        NSError(
            domain: "dev.placeecho.web",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: description]
        )
    }
}

private extension UIView {
    var nearestViewController: UIViewController? {
        var responder: UIResponder? = self
        while let next = responder?.next {
            if let viewController = next as? UIViewController {
                return viewController
            }
            responder = next
        }
        return window?.rootViewController
    }
}
