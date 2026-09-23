import Foundation

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

enum PanoramaCaptureProviderFactory {
    static func make() -> PanoramaCaptureProviding {
        if ProcessInfo.processInfo.environment["PLACE_ECHO_MOCK_PANORAMA_URL"] != nil {
            return DevelopmentPanoramaCaptureProvider()
        }
        return Insta360PanoramaCaptureProvider()
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
