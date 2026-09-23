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

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
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
            let indexURL = Bundle.main.url(
                forResource: "index",
                withExtension: "html",
                subdirectory: "WebApp"
            )
        {
            let webRoot = indexURL.deletingLastPathComponent()
            webView.loadFileURL(indexURL, allowingReadAccessTo: webRoot)
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
        private let captureProvider: PanoramaCaptureProviding
        private var stagedCaptures: [String: CapturedPanorama] = [:]
        private weak var captureViewController: X5CaptureViewController?

        init(captureProvider: PanoramaCaptureProviding) {
            self.captureProvider = captureProvider
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

            if captureProvider is Insta360PanoramaCaptureProvider {
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

            let controller = X5CaptureViewController(
                sceneID: sceneID,
                captureProvider: captureProvider
            ) { [weak self] result in
                self?.captureViewController = nil
                self?.handle(result, fallbackSceneID: sceneID)
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
