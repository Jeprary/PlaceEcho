import INSCameraSDK
import INSCoreMedia
import UIKit

enum X5CaptureUIError: LocalizedError {
    case cancelled
    case previewFailed(String)

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "X5 capture was cancelled."
        case .previewFailed(let message):
            return "Could not start the X5 preview: \(message)"
        }
    }
}

/// Transient native acquisition UI. The Web product still owns the surrounding
/// creation flow; this controller owns only X5 preview, countdown, and capture.
final class X5CaptureViewController: UIViewController {
    typealias Completion = (Result<CapturedPanorama, Error>) -> Void

    private let sceneID: String
    private let captureProvider: PanoramaCaptureProviding
    private let completion: Completion
    private let cameraManager = INSCameraManager.socket()

    private let previewHost = UIView()
    private let statusLabel = UILabel()
    private let detailLabel = UILabel()
    private let countdownLabel = UILabel()
    private let shutterButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let activityIndicator = UIActivityIndicatorView(style: .large)

    private var previewPlayer: INSCameraSessionPlayer?
    private var countdownTimer: Timer?
    private var countdownValue = 3
    private var connectionAttemptsRemaining = 30
    private var isPreviewReady = false
    private var didFinish = false

    init(
        sceneID: String,
        captureProvider: PanoramaCaptureProviding,
        completion: @escaping Completion
    ) {
        self.sceneID = sceneID
        self.captureProvider = captureProvider
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildInterface()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        beginPreviewConnection()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        countdownTimer?.invalidate()
        countdownTimer = nil
        previewPlayer?.stopRunning(completion: nil)
        previewPlayer = nil
    }

    private func buildInterface() {
        view.backgroundColor = .black

        previewHost.translatesAutoresizingMaskIntoConstraints = false
        previewHost.backgroundColor = UIColor(white: 0.06, alpha: 1)
        previewHost.clipsToBounds = true
        view.addSubview(previewHost)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "Connecting to Insta360 X5…"
        statusLabel.textColor = .white
        statusLabel.font = .preferredFont(forTextStyle: .headline)
        statusLabel.textAlignment = .center
        view.addSubview(statusLabel)

        detailLabel.translatesAutoresizingMaskIntoConstraints = false
        detailLabel.text = "Keep this iPhone connected to the camera Wi-Fi."
        detailLabel.textColor = UIColor.white.withAlphaComponent(0.72)
        detailLabel.font = .preferredFont(forTextStyle: .subheadline)
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 0
        view.addSubview(detailLabel)

        countdownLabel.translatesAutoresizingMaskIntoConstraints = false
        countdownLabel.textColor = .white
        countdownLabel.font = .systemFont(ofSize: 92, weight: .bold)
        countdownLabel.textAlignment = .center
        countdownLabel.isHidden = true
        view.addSubview(countdownLabel)

        var shutterConfiguration = UIButton.Configuration.filled()
        shutterConfiguration.title = "Take panorama"
        shutterConfiguration.baseBackgroundColor = .systemRed
        shutterConfiguration.baseForegroundColor = .white
        shutterConfiguration.cornerStyle = .capsule
        shutterConfiguration.contentInsets = NSDirectionalEdgeInsets(
            top: 16,
            leading: 28,
            bottom: 16,
            trailing: 28
        )
        shutterButton.configuration = shutterConfiguration
        shutterButton.translatesAutoresizingMaskIntoConstraints = false
        shutterButton.isEnabled = false
        shutterButton.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
        view.addSubview(shutterButton)

        var closeConfiguration = UIButton.Configuration.gray()
        closeConfiguration.title = "Close"
        closeConfiguration.baseForegroundColor = .white
        closeConfiguration.cornerStyle = .capsule
        closeButton.configuration = closeConfiguration
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(closeButton)

        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        activityIndicator.color = .white
        activityIndicator.startAnimating()
        view.addSubview(activityIndicator)

        NSLayoutConstraint.activate([
            previewHost.topAnchor.constraint(equalTo: view.topAnchor),
            previewHost.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            previewHost.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            previewHost.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            closeButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),

            statusLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 18),
            statusLabel.leadingAnchor.constraint(equalTo: closeButton.trailingAnchor, constant: 12),
            statusLabel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),

            countdownLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            countdownLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            detailLabel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            detailLabel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            detailLabel.bottomAnchor.constraint(equalTo: shutterButton.topAnchor, constant: -16),

            shutterButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            shutterButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -22),
        ])
    }

    private func beginPreviewConnection() {
        connectionAttemptsRemaining = 30
        statusLabel.text = "Connecting to Insta360 X5…"
        detailLabel.text = "Keep this iPhone connected to the camera Wi-Fi."
        shutterButton.isEnabled = false
        isPreviewReady = false
        activityIndicator.startAnimating()
        cameraManager.setup()
        waitForCameraConnection()
    }

    private func waitForCameraConnection() {
        guard !didFinish else { return }
        if cameraManager.cameraState == .connected {
            configurePreview()
            return
        }
        guard connectionAttemptsRemaining > 0 else {
            activityIndicator.stopAnimating()
            statusLabel.text = "X5 is not connected"
            detailLabel.text = "Connect this iPhone to the X5 Wi-Fi in Settings, return here, then retry."
            shutterButton.configuration?.title = "Retry connection"
            shutterButton.isEnabled = true
            return
        }
        connectionAttemptsRemaining -= 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.waitForCameraConnection()
        }
    }

    private func configurePreview() {
        let player = INSCameraSessionPlayer()
        player.delegate = self
        player.dataSource = self
        player.needCameraPreviewStreamAutoRotate = true
        player.render.renderModelType.displayType = .sphereStitch
        previewPlayer = player

        let renderView = player.renderView
        renderView.translatesAutoresizingMaskIntoConstraints = false
        previewHost.addSubview(renderView)
        NSLayoutConstraint.activate([
            renderView.topAnchor.constraint(equalTo: previewHost.topAnchor),
            renderView.leadingAnchor.constraint(equalTo: previewHost.leadingAnchor),
            renderView.trailingAnchor.constraint(equalTo: previewHost.trailingAnchor),
            renderView.bottomAnchor.constraint(equalTo: previewHost.bottomAnchor),
        ])

        let optionTypes = [NSNumber(value: INSCameraOptionsType.videoEncode.rawValue)]
        INSCameraManager.shared().commandManager.getOptionsWithTypes(optionTypes) { [weak self, weak player] _, options, _ in
            guard let self, let player, !self.didFinish else { return }
            if let options {
                player.videoStreamEncode = options.videoEncode
            }
            player.startRunning { [weak self] error in
                DispatchQueue.main.async {
                    guard let self, !self.didFinish else { return }
                    if let error {
                        self.showPreviewError(error.localizedDescription)
                        return
                    }
                    INSCameraManager.shared().commandManager.requestIFrame { _ in }
                    self.activityIndicator.stopAnimating()
                    self.statusLabel.text = "Live preview"
                    self.detailLabel.text = "Place the X5 steadily, step away from the camera, then take the panorama."
                    self.shutterButton.configuration?.title = "Take panorama"
                    self.isPreviewReady = true
                    self.shutterButton.isEnabled = true
                }
            }
        }
    }

    private func showPreviewError(_ message: String) {
        isPreviewReady = false
        activityIndicator.stopAnimating()
        statusLabel.text = "Preview unavailable"
        detailLabel.text = message
        shutterButton.configuration?.title = "Retry preview"
        shutterButton.isEnabled = true
    }

    @objc private func shutterTapped() {
        if !isPreviewReady || cameraManager.cameraState != .connected {
            previewPlayer?.stopRunning(completion: nil)
            previewPlayer?.renderView.removeFromSuperview()
            previewPlayer = nil
            beginPreviewConnection()
            return
        }
        startCountdown()
    }

    private func startCountdown() {
        countdownTimer?.invalidate()
        countdownValue = 3
        countdownLabel.text = String(countdownValue)
        countdownLabel.isHidden = false
        shutterButton.isEnabled = false
        closeButton.isEnabled = false
        statusLabel.text = "Get out of the X5's view"
        detailLabel.text = "The panorama will be captured automatically."

        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] timer in
            guard let self else {
                timer.invalidate()
                return
            }
            self.countdownValue -= 1
            guard self.countdownValue > 0 else {
                timer.invalidate()
                self.countdownTimer = nil
                self.countdownLabel.isHidden = true
                self.takePanorama()
                return
            }
            self.countdownLabel.text = String(self.countdownValue)
        }
    }

    private func takePanorama() {
        statusLabel.text = "Capturing panorama…"
        detailLabel.text = "Keep the X5 still while PlaceEcho captures, downloads, and stitches the image."
        activityIndicator.startAnimating()
        stopPreview { [weak self] in
            guard let self else { return }
            self.captureProvider.capture(sceneID: self.sceneID) { [weak self] result in
                DispatchQueue.main.async {
                    self?.finish(result)
                }
            }
        }
    }

    private func stopPreview(completion: @escaping () -> Void) {
        guard let player = previewPlayer else {
            completion()
            return
        }
        player.stopRunning { [weak self, weak player] _ in
            DispatchQueue.main.async {
                player?.renderView.removeFromSuperview()
                self?.previewPlayer = nil
                self?.isPreviewReady = false
                completion()
            }
        }
    }

    @objc private func closeTapped() {
        finish(.failure(X5CaptureUIError.cancelled))
    }

    private func finish(_ result: Result<CapturedPanorama, Error>) {
        guard !didFinish else { return }
        didFinish = true
        countdownTimer?.invalidate()
        countdownTimer = nil
        stopPreview { [weak self] in
            guard let self else { return }
            self.dismiss(animated: true) {
                self.completion(result)
            }
        }
    }
}

extension X5CaptureViewController: INSCameraSessionPlayerDelegate, INSCameraSessionPlayerDataSource {
    func updateRenderModelType(
        to player: INSCameraSessionPlayer,
        renderModelType: INSRenderModelType
    ) -> INSRenderModelType {
        renderModelType.displayType = .sphereStitch
        renderModelType.imageLayout = .horizontalMerged
        renderModelType.isHalfFisheye = false
        renderModelType.isSelfieVideo = false
        renderModelType.touchMode = false
        renderModelType.opticalFlowType = .disflow
        renderModelType.contentMode = .fitScreen
        return renderModelType
    }

    func player(_ player: INSCameraSessionPlayer, didOccurWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.showPreviewError(error.localizedDescription)
        }
    }
}
