import Foundation
import ImageIO
import INSCameraSDK
import INSCoreMedia

enum Insta360CaptureError: LocalizedError {
    case cameraNotConnected
    case captureReturnedNoFile
    case downloadFailed(String)
    case exportFailed(String)
    case invalidExport
    case captureAlreadyRunning

    var errorDescription: String? {
        switch self {
        case .cameraNotConnected:
            return "Connect the iPhone to the Insta360 X5 Wi-Fi, then try again."
        case .captureReturnedNoFile:
            return "The X5 completed the capture but did not return a photo file."
        case .downloadFailed(let message):
            return "Could not download the X5 photo: \(message)"
        case .exportFailed(let message):
            return "Could not stitch the X5 panorama: \(message)"
        case .invalidExport:
            return "The stitched panorama could not be read."
        case .captureAlreadyRunning:
            return "A panorama capture is already running."
        }
    }
}

/// Minimal X5 flow: Wi-Fi connection -> capture -> local download -> 2:1 JPEG.
/// Upload remains a separate adapter so capture does not depend on API rollout.
final class Insta360PanoramaCaptureProvider: PanoramaCaptureProviding {
    // Even obtaining the socket manager can start the SDK's connection path.
    // Keep it lazy so launching the Web shell never contacts the X5 endpoint.
    private lazy var cameraManager = INSCameraManager.socket()
    private let workQueue = DispatchQueue(
        label: "dev.placeecho.insta360-export",
        qos: .userInitiated
    )
    private let wifiSession = X5WiFiSession()
    private var isCapturing = false

    /// Personal Team builds use manual Wi-Fi selection. The automatic adapter
    /// remains available for a paid team with the Hotspot entitlement enabled.
    private var automaticWiFiEnabled: Bool {
        ProcessInfo.processInfo.environment["PLACE_ECHO_AUTOMATIC_X5_WIFI"] == "1"
    }

    func capture(
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) {
        guard !isCapturing else {
            completion(.failure(Insta360CaptureError.captureAlreadyRunning))
            return
        }
        isCapturing = true
        if cameraManager.cameraState == .connected {
            takePicture(sceneID: sceneID, completion: completion)
            return
        }

        guard automaticWiFiEnabled else {
            cameraManager.setup()
            waitForCameraConnection(
                attemptsRemaining: 30,
                sceneID: sceneID,
                completion: completion
            )
            return
        }

        wifiSession.join { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                self.finish(.failure(error), completion: completion)
            case .success:
                self.cameraManager.setup()
                self.waitForCameraConnection(
                    attemptsRemaining: 30,
                    sceneID: sceneID,
                    completion: completion
                )
            }
        }
    }

    private func waitForCameraConnection(
        attemptsRemaining: Int,
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) {
        if cameraManager.cameraState == .connected {
            takePicture(sceneID: sceneID, completion: completion)
            return
        }
        guard attemptsRemaining > 0 else {
            finish(
                .failure(Insta360CaptureError.cameraNotConnected),
                completion: completion
            )
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.waitForCameraConnection(
                attemptsRemaining: attemptsRemaining - 1,
                sceneID: sceneID,
                completion: completion
            )
        }
    }

    private func takePicture(
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) {
        INSCameraManager.shared().commandManager.takePicture(with: nil) { [weak self] error, photoInfo in
            guard let self else { return }
            if let error {
                self.finish(.failure(error), completion: completion)
                return
            }
            guard let uri = photoInfo?.uri, !uri.isEmpty else {
                self.finish(
                    .failure(Insta360CaptureError.captureReturnedNoFile),
                    completion: completion
                )
                return
            }
            let remoteURL = INSHTTPURLForResourceURI(uri)
            self.downloadAndExport(
                remoteURL: remoteURL,
                sceneID: sceneID,
                completion: completion
            )
        }
    }

    private func downloadAndExport(
        remoteURL: URL,
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) {
        let captureDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PlaceEchoCaptures", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: captureDirectory,
                withIntermediateDirectories: true
            )
        } catch {
            finish(.failure(error), completion: completion)
            return
        }

        let inputURL = captureDirectory.appendingPathComponent(
            remoteURL.lastPathComponent.isEmpty ? "capture.insp" : remoteURL.lastPathComponent
        )
        let outputURL = captureDirectory.appendingPathComponent("panorama.jpg")

        INSCameraManager.shared().commandManager.fetchResource(
            withURI: remoteURL.absoluteString,
            toLocalFile: inputURL,
            progress: { _ in }
        ) { [weak self] error in
            guard let self else { return }
            if let error {
                self.finish(
                    .failure(Insta360CaptureError.downloadFailed(error.localizedDescription)),
                    completion: completion
                )
                return
            }
            self.export(
                inputURL: inputURL,
                outputURL: outputURL,
                sceneID: sceneID,
                completion: completion
            )
        }
    }

    private func export(
        inputURL: URL,
        outputURL: URL,
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) {
        workQueue.async { [weak self] in
            guard let self else { return }
            let exporter: INSExportImageSimplify? = INSExportImageSimplify()
            exporter?.width = 11_904
            exporter?.height = 5_952
            if let error = exporter?.exportImage(withInputUrl: inputURL, outputUrl: outputURL) {
                self.finish(
                    .failure(Insta360CaptureError.exportFailed(error.localizedDescription)),
                    completion: completion
                )
                return
            }
            guard let size = Self.imageSize(at: outputURL) else {
                self.finish(
                    .failure(Insta360CaptureError.invalidExport),
                    completion: completion
                )
                return
            }
            self.finish(
                .success(CapturedPanorama(
                    sceneID: sceneID,
                    url: outputURL,
                    width: size.width,
                    height: size.height
                )),
                completion: completion
            )
        }
    }

    private func finish(
        _ result: Result<CapturedPanorama, Error>,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.cameraManager.shutdown()
            self.wifiSession.disconnectIfManaged {
                self.isCapturing = false
                completion(result)
            }
        }
    }

    private static func imageSize(at url: URL) -> (width: Int, height: Int)? {
        guard
            let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int
        else {
            return nil
        }
        return (width, height)
    }
}
