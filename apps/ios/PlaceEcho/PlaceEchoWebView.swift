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
        webView.load(URLRequest(url: Self.webURL))
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

    private static var webURL: URL {
        if
            let rawValue = ProcessInfo.processInfo.environment["PLACE_ECHO_WEB_URL"],
            let environmentURL = URL(string: rawValue)
        {
            return environmentURL
        }
        if
            let rawValue = Bundle.main.object(forInfoDictionaryKey: "PlaceEchoWebURL") as? String,
            let configuredURL = URL(string: rawValue)
        {
            return configuredURL
        }
        return URL(string: "http://127.0.0.1:5173")!
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        static let messageHandlerName = "placeecho"

        weak var webView: WKWebView?
        private let captureProvider: PanoramaCaptureProviding
        private var stagedCaptures: [String: CapturedPanorama] = [:]

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

            captureProvider.capture(sceneID: sceneID) { [weak self] result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let panorama):
                        self?.stagedCaptures[panorama.sceneID] = panorama
                        self?.send([
                            "type": "panorama_staged",
                            "scene_id": panorama.sceneID,
                            "width": panorama.width,
                            "height": panorama.height,
                        ])
                    case .failure(let error):
                        self?.send([
                            "type": "capture_failed",
                            "scene_id": sceneID,
                            "message": error.localizedDescription,
                        ])
                    }
                }
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
