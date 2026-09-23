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
    case localSaveFailed(String)
    case captureAlreadyRunning

    var errorDescription: String? {
        switch self {
        case .cameraNotConnected:
            return "请先将 iPhone 连接到 Insta360 X5 的 Wi-Fi，然后重试。"
        case .captureReturnedNoFile:
            return "X5 已完成拍摄，但没有返回照片文件。"
        case .downloadFailed(let message):
            return "无法下载 X5 照片：\(message)"
        case .exportFailed(let message):
            return "无法拼接 X5 全景图：\(message)"
        case .invalidExport:
            return "无法读取拼接后的全景图。"
        case .localSaveFailed(let message):
            return "无法将全景图保存到 PlaceEcho：\(message)"
        case .captureAlreadyRunning:
            return "当前已有一项全景拍摄正在进行。"
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
        let commandManager = INSCameraManager.shared().commandManager
        // X5 firmware expects the SDK app identity before accepting photography
        // commands. The vendor's X5 sample performs this handshake immediately
        // before configuring or taking a picture.
        commandManager.setAppidCompletion { [weak self] appIDError in
            guard let self else { return }
            if let appIDError {
                self.finish(.failure(appIDError), completion: completion)
                return
            }

            let options = INSTakePictureOptions()
            // PlaceEcho already presents its own visible three-second countdown.
            // Explicitly disable the camera-side timer so the user does not wait
            // through a second countdown after the native UI reaches zero.
            options.countDown = 0
            commandManager.takePicture(with: options) { [weak self] error, photoInfo in
                guard let self else { return }
                if let error {
                    self.finish(.failure(error), completion: completion)
                    return
                }

                var candidateURIs: [String] = []
                if let uri = photoInfo?.uri, !uri.isEmpty {
                    candidateURIs.append(uri)
                }
                if let hdrURIs = photoInfo?.hdrUris {
                    candidateURIs.append(contentsOf: hdrURIs.filter { !$0.isEmpty })
                }
                if let burstURIs = photoInfo?.burstUris {
                    candidateURIs.append(contentsOf: burstURIs.filter { !$0.isEmpty })
                }

                guard let uri = candidateURIs.first else {
                    self.finish(
                        .failure(Insta360CaptureError.captureReturnedNoFile),
                        completion: completion
                    )
                    return
                }
                print(
                    "PlaceEcho X5 capture: received \(candidateURIs.count) file URI(s), "
                        + "using \(uri)"
                )
                let remoteURL = INSHTTPURLForResourceURI(uri)
                self.downloadAndExport(
                    remoteURL: remoteURL,
                    sceneID: sceneID,
                    completion: completion
                )
            }
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
            let storedURL: URL
            do {
                storedURL = try Self.persistExport(at: outputURL)
                try? FileManager.default.removeItem(
                    at: inputURL.deletingLastPathComponent()
                )
            } catch {
                self.finish(
                    .failure(Insta360CaptureError.localSaveFailed(
                        error.localizedDescription
                    )),
                    completion: completion
                )
                return
            }
            self.finish(
                .success(CapturedPanorama(
                    sceneID: sceneID,
                    url: storedURL,
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

    private static func persistExport(at temporaryURL: URL) throws -> URL {
        let fileManager = FileManager.default
        var captureDirectory = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        .appendingPathComponent("PlaceEcho", isDirectory: true)
        .appendingPathComponent("Captures", isDirectory: true)
        try fileManager.createDirectory(
            at: captureDirectory,
            withIntermediateDirectories: true
        )

        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? captureDirectory.setResourceValues(resourceValues)

        let storedURL = captureDirectory.appendingPathComponent(
            UUID().uuidString + ".jpg",
            isDirectory: false
        )
        try fileManager.moveItem(at: temporaryURL, to: storedURL)
        return storedURL
    }
}
