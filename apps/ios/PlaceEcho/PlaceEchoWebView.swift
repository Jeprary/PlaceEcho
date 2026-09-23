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
        private var stagedCaptures: [String: CapturedPanorama] = [:]
        private weak var captureViewController: UIViewController?
        private weak var loadingView: UIView?
        private weak var loadingLabel: UILabel?
        private var didRetryTerminatedWebContent = false

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
            label.text = "正在打开 PlaceEcho…"
            label.textColor = .secondaryLabel
            label.font = .preferredFont(forTextStyle: .body)
            label.textAlignment = .center
            label.numberOfLines = 0

            container.addSubview(indicator)
            container.addSubview(label)
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
            ])
            loadingView = container
            loadingLabel = label
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("PlaceEcho Web: loaded \(webView.url?.absoluteString ?? "unknown URL")")
            loadingView?.removeFromSuperview()
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
            if !didRetryTerminatedWebContent {
                didRetryTerminatedWebContent = true
                loadingLabel?.text = "网页进程正在重新启动…"
                webView.reload()
            } else {
                loadingLabel?.text = "页面启动失败，请关闭 App 后重新打开。"
            }
        }

        private func showLoadFailure(_ error: Error) {
            print("PlaceEcho Web: navigation failed: \(error.localizedDescription)")
            loadingLabel?.text = "页面加载失败：\(error.localizedDescription)"
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

            guard captureViewController == nil else {
                send([
                    "type": "capture_failed",
                    "scene_id": sceneID,
                    "message": "An X5 capture screen is already open.",
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
            guard
                let webView,
                let presenter = webView.nearestViewController
            else {
                send([
                    "type": "capture_failed",
                    "scene_id": sceneID,
                    "message": "Could not present the X5 capture screen.",
                ])
                return
            }

            guard let capturePresenter = captureProvider as? PanoramaCaptureViewControllerProviding else {
                runCapture(sceneID: sceneID)
                return
            }

            let controller: UIViewController
            do {
                controller = try capturePresenter.makeCaptureViewController(
                    sceneID: sceneID
                ) { [weak self] result in
                    self?.captureViewController = nil
                    self?.handle(result, fallbackSceneID: sceneID)
                }
            } catch {
                send([
                    "type": "capture_failed",
                    "scene_id": sceneID,
                    "message": error.localizedDescription,
                ])
                return
            }
            captureViewController = controller
            presenter.present(controller, animated: true)
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
            switch result {
            case .success(let panorama):
                stagedCaptures[panorama.sceneID] = panorama
                send([
                    "type": "panorama_staged",
                    "scene_id": panorama.sceneID,
                    "width": panorama.width,
                    "height": panorama.height,
                ])
            case .failure(let error):
                send([
                    "type": "capture_failed",
                    "scene_id": fallbackSceneID,
                    "message": error.localizedDescription,
                ])
            }
        }

        private func send(_ message: [String: Any]) {
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

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard
            let requestURL = urlSchemeTask.request.url,
            requestURL.host == "app",
            let bundleResourceURL = Bundle.main.resourceURL
        else {
            urlSchemeTask.didFailWithError(Self.error("Invalid bundled Web request."))
            return
        }
        let resourceRoot = bundleResourceURL
            .appendingPathComponent("WebApp", isDirectory: true)
            .standardizedFileURL

        let resourcePath = requestURL.path.removingPercentEncoding?
            .trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        let relativePath = resourcePath.isEmpty ? "index.html" : resourcePath
        guard !relativePath.split(separator: "/").contains("..") else {
            urlSchemeTask.didFailWithError(Self.error("Invalid bundled Web path."))
            return
        }

        let fileURL = resourceRoot
            .appendingPathComponent(relativePath, isDirectory: false)
            .standardizedFileURL
        let rootPath = resourceRoot.path.hasSuffix("/")
            ? resourceRoot.path
            : resourceRoot.path + "/"
        guard fileURL.path.hasPrefix(rootPath) else {
            urlSchemeTask.didFailWithError(Self.error("Bundled Web path is outside WebApp."))
            return
        }

        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            let response = URLResponse(
                url: requestURL,
                mimeType: Self.mimeType(for: fileURL.pathExtension),
                expectedContentLength: data.count,
                textEncodingName: Self.textEncoding(for: fileURL.pathExtension)
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            print("PlaceEcho Web: missing bundled resource \(relativePath): \(error)")
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html": "text/html"
        case "css": "text/css"
        case "js", "mjs": "text/javascript"
        case "json": "application/json"
        case "wasm": "application/wasm"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
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
