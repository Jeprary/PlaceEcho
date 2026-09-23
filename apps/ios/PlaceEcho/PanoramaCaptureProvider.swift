import Foundation
import UIKit

struct CapturedPanorama {
    let sceneID: String
    let url: URL
    let width: Int
    let height: Int
}

enum PanoramaCaptureError: LocalizedError {
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Native panorama capture is not configured. Add the Insta360 adapter or a development mock URL."
        }
    }
}

protocol PanoramaCaptureProviding {
    func capture(
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    )
}

protocol PanoramaCaptureViewControllerProviding: PanoramaCaptureProviding {
    func makeCaptureViewController(
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) throws -> UIViewController
}

enum PanoramaCaptureProviderFactory {
    static func make() -> PanoramaCaptureProviding {
        if ProcessInfo.processInfo.environment["PLACE_ECHO_MOCK_PANORAMA_URL"] != nil {
            return DevelopmentPanoramaCaptureProvider()
        }
        return Insta360CapturePluginProvider()
    }
}

enum Insta360CapturePluginError: LocalizedError {
    case frameworkMissing
    case frameworkLoadFailed(String)
    case invalidPlugin
    case directCaptureUnsupported

    var errorDescription: String? {
        switch self {
        case .frameworkMissing:
            return "The Insta360 capture module is missing from this build."
        case .frameworkLoadFailed(let message):
            return "Could not load the Insta360 capture module: \(message)"
        case .invalidPlugin:
            return "The Insta360 capture module is not compatible with this app."
        case .directCaptureUnsupported:
            return "Open the X5 capture screen before taking a panorama."
        }
    }
}

/// Keeps the very large Insta360 binaries out of the application launch path.
/// The capture framework and its SDK dependencies are loaded only after the
/// user explicitly opens the X5 acquisition screen.
final class Insta360CapturePluginProvider: PanoramaCaptureViewControllerProviding {
    private static let factoryClassName = "PlaceEchoCapturePluginFactory"
    private static let factorySelector = NSSelectorFromString("makeCaptureViewController")
    private static let resultNotification = Notification.Name(
        "dev.placeecho.x5.capture-result"
    )
    private static let sceneIDDefaultsKey = "dev.placeecho.x5.pending-scene-id"
    private static let requestIDDefaultsKey = "dev.placeecho.x5.pending-request-id"

    private var pluginBundle: Bundle?
    private var observations: [String: NSObjectProtocol] = [:]

    func capture(
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) {
        completion(.failure(Insta360CapturePluginError.directCaptureUnsupported))
    }

    func makeCaptureViewController(
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) throws -> UIViewController {
        let bundle = try loadPluginBundle()
        guard
            let factoryType = NSClassFromString(Self.factoryClassName) as? NSObject.Type
        else {
            throw Insta360CapturePluginError.invalidPlugin
        }

        let requestID = UUID().uuidString
        let defaults = UserDefaults.standard
        defaults.set(sceneID, forKey: Self.sceneIDDefaultsKey)
        defaults.set(requestID, forKey: Self.requestIDDefaultsKey)

        let observation = NotificationCenter.default.addObserver(
            forName: Self.resultNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard
                let userInfo = notification.userInfo,
                userInfo["request_id"] as? String == requestID
            else {
                return
            }
            self?.removeObservation(requestID: requestID)
            completion(Self.captureResult(from: userInfo, fallbackSceneID: sceneID))
        }
        observations[requestID] = observation

        let factory = factoryType.init()
        guard
            factory.responds(to: Self.factorySelector),
            let unmanagedController = factory.perform(Self.factorySelector),
            let controller = unmanagedController.takeUnretainedValue() as? UIViewController
        else {
            removeObservation(requestID: requestID)
            defaults.removeObject(forKey: Self.sceneIDDefaultsKey)
            defaults.removeObject(forKey: Self.requestIDDefaultsKey)
            throw Insta360CapturePluginError.invalidPlugin
        }

        // Retain the successfully loaded bundle for the lifetime of the provider.
        pluginBundle = bundle
        return controller
    }

    private func loadPluginBundle() throws -> Bundle {
        if let pluginBundle, pluginBundle.isLoaded {
            return pluginBundle
        }
        guard
            let frameworkURL = Bundle.main.privateFrameworksURL?
                .appendingPathComponent("PlaceEchoCaptureKit.framework", isDirectory: true),
            let bundle = Bundle(url: frameworkURL)
        else {
            throw Insta360CapturePluginError.frameworkMissing
        }
        do {
            try bundle.loadAndReturnError()
        } catch {
            throw Insta360CapturePluginError.frameworkLoadFailed(
                error.localizedDescription
            )
        }
        return bundle
    }

    private func removeObservation(requestID: String) {
        guard let observation = observations.removeValue(forKey: requestID) else {
            return
        }
        NotificationCenter.default.removeObserver(observation)
    }

    private static func captureResult(
        from userInfo: [AnyHashable: Any],
        fallbackSceneID: String
    ) -> Result<CapturedPanorama, Error> {
        guard userInfo["success"] as? Bool == true else {
            let message = userInfo["message"] as? String ?? "X5 capture failed."
            return .failure(NSError(
                domain: "dev.placeecho.capture-plugin",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: message]
            ))
        }
        guard
            let rawURL = userInfo["url"] as? String,
            let url = URL(string: rawURL),
            let width = userInfo["width"] as? Int,
            let height = userInfo["height"] as? Int
        else {
            return .failure(Insta360CapturePluginError.invalidPlugin)
        }
        return .success(CapturedPanorama(
            sceneID: userInfo["scene_id"] as? String ?? fallbackSceneID,
            url: url,
            width: width,
            height: height
        ))
    }
}

/// Keeps the bridge testable before the Insta360 SDK is added. Set
/// PLACE_ECHO_MOCK_PANORAMA_URL in the Xcode scheme to return a known image.
final class DevelopmentPanoramaCaptureProvider: PanoramaCaptureProviding {
    func capture(
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) {
        let environment = ProcessInfo.processInfo.environment
        guard
            let rawURL = environment["PLACE_ECHO_MOCK_PANORAMA_URL"],
            let url = URL(string: rawURL)
        else {
            completion(.failure(PanoramaCaptureError.notConfigured))
            return
        }

        let width = Int(environment["PLACE_ECHO_MOCK_PANORAMA_WIDTH"] ?? "8192") ?? 8192
        let height = Int(environment["PLACE_ECHO_MOCK_PANORAMA_HEIGHT"] ?? "4096") ?? 4096
        completion(.success(CapturedPanorama(
            sceneID: sceneID,
            url: url,
            width: width,
            height: height
        )))
    }
}
