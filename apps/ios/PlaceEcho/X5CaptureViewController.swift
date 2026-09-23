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
    private let closeChrome = UIVisualEffectView(
        effect: X5CaptureViewController.chromeEffect(interactive: true)
    )
    private let statusChrome = UIVisualEffectView(
        effect: X5CaptureViewController.chromeEffect(interactive: false)
    )
    private let statusLabel = UILabel()
    private let countdownLabel = UILabel()
    private let shutterButton = UIButton(type: .custom)
    private let closeButton = UIButton(type: .system)
    private let activityIndicator = UIActivityIndicatorView(style: .medium)

    private var previewPlayer: INSCameraSessionPlayer?
    private weak var previewRenderView: UIView?
    private var previewFrameTimeout: DispatchWorkItem?
    private var windowCropInfo: INSWindowCropInfo?
    private var countdownTimer: Timer?
    private var countdownValue = 3
    private var connectionAttemptsRemaining = 30
    private var isPreviewReady = false
    private var didFinish = false
    private var didAnimateEntrance = false

    private static func chromeEffect(interactive: Bool) -> UIVisualEffect {
        if #available(iOS 26.0, *) {
            let effect = UIGlassEffect(style: .clear)
            effect.isInteractive = interactive
            effect.tintColor = UIColor.black.withAlphaComponent(0.18)
            return effect
        }
        return UIBlurEffect(style: .systemUltraThinMaterialDark)
    }

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
        animateEntranceIfNeeded()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        countdownTimer?.invalidate()
        countdownTimer = nil
        previewFrameTimeout?.cancel()
        previewFrameTimeout = nil
        previewPlayer?.stopRunning(completion: nil)
        previewPlayer = nil
    }

    private func buildInterface() {
        view.backgroundColor = .black

        previewHost.translatesAutoresizingMaskIntoConstraints = false
        previewHost.backgroundColor = .black
        previewHost.clipsToBounds = true
        view.addSubview(previewHost)

        closeChrome.translatesAutoresizingMaskIntoConstraints = false
        closeChrome.clipsToBounds = true
        closeChrome.layer.cornerRadius = 23
        closeChrome.layer.cornerCurve = .continuous
        view.addSubview(closeChrome)

        var closeConfiguration = UIButton.Configuration.plain()
        closeConfiguration.image = UIImage(
            systemName: "chevron.left",
            withConfiguration: UIImage.SymbolConfiguration(
                pointSize: 22,
                weight: .semibold
            )
        )
        closeConfiguration.baseForegroundColor = .white
        closeConfiguration.contentInsets = .zero
        closeButton.configuration = closeConfiguration
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.accessibilityLabel = "关闭拍摄"
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        closeChrome.contentView.addSubview(closeButton)
        closeChrome.alpha = 0
        closeChrome.transform = CGAffineTransform(translationX: -14, y: 0)

        statusChrome.translatesAutoresizingMaskIntoConstraints = false
        statusChrome.clipsToBounds = true
        statusChrome.layer.cornerRadius = 18
        statusChrome.layer.cornerCurve = .continuous
        statusChrome.alpha = 0
        statusChrome.transform = CGAffineTransform(translationX: 0, y: -10)
        view.addSubview(statusChrome)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "正在连接 X5…"
        statusLabel.textColor = .white
        statusLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusLabel.textAlignment = .center

        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        activityIndicator.color = .white
        activityIndicator.startAnimating()

        let statusStack = UIStackView(arrangedSubviews: [activityIndicator, statusLabel])
        statusStack.translatesAutoresizingMaskIntoConstraints = false
        statusStack.axis = .horizontal
        statusStack.alignment = .center
        statusStack.spacing = 8
        statusChrome.contentView.addSubview(statusStack)

        countdownLabel.translatesAutoresizingMaskIntoConstraints = false
        countdownLabel.textColor = .white
        countdownLabel.font = .monospacedDigitSystemFont(ofSize: 104, weight: .semibold)
        countdownLabel.textAlignment = .center
        countdownLabel.isHidden = true
        countdownLabel.layer.shadowColor = UIColor.black.cgColor
        countdownLabel.layer.shadowOpacity = 0.35
        countdownLabel.layer.shadowRadius = 12
        view.addSubview(countdownLabel)

        shutterButton.translatesAutoresizingMaskIntoConstraints = false
        shutterButton.backgroundColor = UIColor.white.withAlphaComponent(0.34)
        shutterButton.layer.cornerRadius = 43
        shutterButton.layer.cornerCurve = .continuous
        shutterButton.layer.borderColor = UIColor.white.cgColor
        shutterButton.layer.borderWidth = 5
        shutterButton.layer.shadowColor = UIColor.black.cgColor
        shutterButton.layer.shadowOpacity = 0.28
        shutterButton.layer.shadowRadius = 10
        shutterButton.layer.shadowOffset = CGSize(width: 0, height: 4)
        shutterButton.accessibilityLabel = "拍摄全景图"
        shutterButton.isEnabled = false
        shutterButton.alpha = 0
        shutterButton.transform = CGAffineTransform(
            translationX: 0,
            y: 24
        ).scaledBy(x: 0.94, y: 0.94)
        shutterButton.addTarget(self, action: #selector(shutterTouchDown), for: .touchDown)
        shutterButton.addTarget(
            self,
            action: #selector(shutterTouchEnded),
            for: [.touchUpInside, .touchUpOutside, .touchCancel]
        )
        shutterButton.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
        view.addSubview(shutterButton)

        NSLayoutConstraint.activate([
            previewHost.topAnchor.constraint(equalTo: view.topAnchor),
            previewHost.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            previewHost.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            previewHost.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            closeChrome.widthAnchor.constraint(equalToConstant: 46),
            closeChrome.heightAnchor.constraint(equalTo: closeChrome.widthAnchor),
            closeChrome.topAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.topAnchor,
                constant: 12
            ),
            closeChrome.leadingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.leadingAnchor,
                constant: 16
            ),
            closeButton.topAnchor.constraint(equalTo: closeChrome.contentView.topAnchor),
            closeButton.leadingAnchor.constraint(equalTo: closeChrome.contentView.leadingAnchor),
            closeButton.trailingAnchor.constraint(equalTo: closeChrome.contentView.trailingAnchor),
            closeButton.bottomAnchor.constraint(equalTo: closeChrome.contentView.bottomAnchor),

            statusChrome.centerYAnchor.constraint(equalTo: closeChrome.centerYAnchor),
            statusChrome.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            statusChrome.leadingAnchor.constraint(
                greaterThanOrEqualTo: closeChrome.trailingAnchor,
                constant: 12
            ),
            statusChrome.trailingAnchor.constraint(
                lessThanOrEqualTo: view.safeAreaLayoutGuide.trailingAnchor,
                constant: -16
            ),
            statusStack.topAnchor.constraint(equalTo: statusChrome.contentView.topAnchor, constant: 8),
            statusStack.leadingAnchor.constraint(equalTo: statusChrome.contentView.leadingAnchor, constant: 14),
            statusStack.trailingAnchor.constraint(equalTo: statusChrome.contentView.trailingAnchor, constant: -14),
            statusStack.bottomAnchor.constraint(equalTo: statusChrome.contentView.bottomAnchor, constant: -8),

            countdownLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            countdownLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            shutterButton.widthAnchor.constraint(equalToConstant: 86),
            shutterButton.heightAnchor.constraint(equalTo: shutterButton.widthAnchor),
            shutterButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            shutterButton.bottomAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.bottomAnchor,
                constant: -28
            ),
        ])
    }

    private func beginPreviewConnection() {
        previewFrameTimeout?.cancel()
        previewFrameTimeout = nil
        connectionAttemptsRemaining = 30
        showStatus("正在连接 X5…", spinning: true)
        setShutterEnabled(false)
        isPreviewReady = false
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
            showStatus("未连接 X5 · 点按快门重试", spinning: false)
            setShutterEnabled(true)
            return
        }
        connectionAttemptsRemaining -= 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.waitForCameraConnection()
        }
    }

    private func configurePreview() {
        showStatus("正在启动预览…", spinning: true)
        let player = INSCameraSessionPlayer()
        player.delegate = self
        player.dataSource = self
        player.needCameraPreviewStreamAutoRotate = true
        player.render.renderModelType.displayType = .sphereStitch
        previewPlayer = player

        let renderView = player.renderView
        renderView.translatesAutoresizingMaskIntoConstraints = false
        renderView.alpha = 0
        previewHost.addSubview(renderView)
        previewRenderView = renderView
        NSLayoutConstraint.activate([
            renderView.topAnchor.constraint(equalTo: previewHost.topAnchor),
            renderView.leadingAnchor.constraint(equalTo: previewHost.leadingAnchor),
            renderView.trailingAnchor.constraint(equalTo: previewHost.trailingAnchor),
            renderView.bottomAnchor.constraint(equalTo: previewHost.bottomAnchor),
        ])

        let optionTypes = [
            NSNumber(value: INSCameraOptionsType.videoEncode.rawValue),
            NSNumber(value: INSCameraOptionsType.videoResolution.rawValue),
            NSNumber(value: INSCameraOptionsType.windowCropInfo.rawValue),
        ]
        INSCameraManager.shared().commandManager.getOptionsWithTypes(optionTypes) {
            [weak self, weak player] error, options, _ in
            DispatchQueue.main.async {
                guard let self, let player, !self.didFinish else { return }
                guard let options else {
                    self.showPreviewError(
                        error?.localizedDescription ?? "无法读取 X5 预览参数"
                    )
                    return
                }

                self.windowCropInfo = options.windowCropInfo
                player.videoStreamEncode = options.videoEncode
                player.expectedVideoResolution = options.videoResolution
                player.previewStreamType = .main

                let cameraName = self.cameraManager.currentCamera?.name ?? "unknown"
                let cameraType = self.cameraManager.currentCamera?.cameraType ?? "unknown"
                print("PlaceEcho X5 preview: camera=\(cameraName), type=\(cameraType)")

                player.startRunning { [weak self] error in
                    DispatchQueue.main.async {
                        guard let self, !self.didFinish else { return }
                        if let error {
                            self.showPreviewError(error.localizedDescription)
                            return
                        }
                        INSCameraManager.shared().commandManager.requestIFrame { error in
                            if let error {
                                print("PlaceEcho X5 preview: I-frame request failed: \(error)")
                            }
                        }
                        self.showStatus("正在等待实时画面…", spinning: true)
                        self.schedulePreviewFrameTimeout()
                    }
                }
            }
        }
    }

    private func schedulePreviewFrameTimeout() {
        previewFrameTimeout?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self, !self.didFinish, !self.isPreviewReady else { return }
            self.showPreviewError("已连接相机，但没有收到实时画面")
        }
        previewFrameTimeout = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: workItem)
    }

    private func markPreviewReady() {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.didFinish, !self.isPreviewReady else { return }
            self.previewFrameTimeout?.cancel()
            self.previewFrameTimeout = nil
            self.isPreviewReady = true
            self.setShutterEnabled(true)
            self.hideStatus()
            if let renderView = self.previewRenderView {
                UIView.animate(withDuration: 0.32) {
                    renderView.alpha = 1
                }
            }
            print("PlaceEcho X5 preview: first frame rendered")
        }
    }

    private func showPreviewError(_ message: String) {
        previewFrameTimeout?.cancel()
        previewFrameTimeout = nil
        isPreviewReady = false
        print("PlaceEcho X5 preview failed: \(message)")
        showStatus("预览不可用 · 点按快门重试", spinning: false)
        setShutterEnabled(true)
    }

    @objc private func shutterTapped() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
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
        animateCountdownValue()
        hideStatus(animated: false)
        setShutterEnabled(false)
        closeButton.isEnabled = false

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
            self.animateCountdownValue()
            UISelectionFeedbackGenerator().selectionChanged()
        }
    }

    private func animateCountdownValue() {
        countdownLabel.layer.removeAllAnimations()
        countdownLabel.alpha = 0
        countdownLabel.transform = CGAffineTransform(scaleX: 0.62, y: 0.62)
        UIView.animate(
            withDuration: 0.44,
            delay: 0,
            usingSpringWithDamping: 0.58,
            initialSpringVelocity: 0.8
        ) {
            self.countdownLabel.alpha = 1
            self.countdownLabel.transform = .identity
        }
    }

    private func animateEntranceIfNeeded() {
        guard !didAnimateEntrance else { return }
        didAnimateEntrance = true
        UIView.animate(
            withDuration: 0.5,
            delay: 0.08,
            usingSpringWithDamping: 0.82,
            initialSpringVelocity: 0.2
        ) {
            self.closeChrome.alpha = 1
            self.closeChrome.transform = .identity
            self.statusChrome.alpha = 1
            self.statusChrome.transform = .identity
            self.shutterButton.alpha = 0.45
            self.shutterButton.transform = .identity
        }
    }

    private func takePanorama() {
        showStatus("正在处理全景图…", spinning: true)
        stopPreview { [weak self] in
            guard let self else { return }
            self.captureProvider.capture(sceneID: self.sceneID) { [weak self] result in
                DispatchQueue.main.async {
                    self?.finish(result)
                }
            }
        }
    }

    private func setShutterEnabled(_ enabled: Bool) {
        shutterButton.isEnabled = enabled
        UIView.animate(withDuration: 0.2) {
            self.shutterButton.alpha = enabled ? 1 : 0.45
        }
    }

    private func showStatus(_ text: String, spinning: Bool) {
        statusChrome.layer.removeAllAnimations()
        statusLabel.text = text
        statusChrome.isHidden = false
        statusChrome.alpha = 1
        if spinning {
            activityIndicator.startAnimating()
        } else {
            activityIndicator.stopAnimating()
        }
    }

    private func hideStatus(animated: Bool = true) {
        activityIndicator.stopAnimating()
        guard animated else {
            statusChrome.alpha = 0
            statusChrome.isHidden = true
            return
        }
        UIView.animate(withDuration: 0.22, animations: {
            self.statusChrome.alpha = 0
        }) { _ in
            self.statusChrome.isHidden = true
        }
    }

    @objc private func shutterTouchDown() {
        guard shutterButton.isEnabled else { return }
        UIView.animate(withDuration: 0.1) {
            self.shutterButton.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
        }
    }

    @objc private func shutterTouchEnded() {
        UIView.animate(
            withDuration: 0.25,
            delay: 0,
            usingSpringWithDamping: 0.7,
            initialSpringVelocity: 0.4
        ) {
            self.shutterButton.transform = .identity
        }
    }

    private func stopPreview(completion: @escaping () -> Void) {
        previewFrameTimeout?.cancel()
        previewFrameTimeout = nil
        guard let player = previewPlayer else {
            completion()
            return
        }
        player.stopRunning { [weak self, weak player] _ in
            DispatchQueue.main.async {
                player?.renderView.removeFromSuperview()
                self?.previewPlayer = nil
                self?.previewRenderView = nil
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
        previewFrameTimeout?.cancel()
        previewFrameTimeout = nil
        stopPreview { [weak self] in
            guard let self else { return }
            self.dismiss(animated: true) {
                self.completion(result)
            }
        }
    }
}

extension X5CaptureViewController: INSCameraSessionPlayerDelegate, INSCameraSessionPlayerDataSource {
    func updateOffset(to player: INSCameraSessionPlayer) -> String? {
        let settings = cameraManager.currentCamera?.settings
        if let mediaOffsetV6 = settings?.mediaOffsetV6, !mediaOffsetV6.isEmpty {
            return mediaOffsetV6
        }
        if let mediaOffset = settings?.mediaOffset, !mediaOffset.isEmpty {
            return mediaOffset
        }
        return nil
    }

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
        renderModelType.isHalfFisheyeBulletTime = false
        renderModelType.contentMode = .fitScreen
        renderModelType.preferDynamicVertex = false
        renderModelType.aiFlowBottomPercision = .unknown
        renderModelType.dynamicAlphaFlag = false
        renderModelType.usingFisheyeMask = false
        if
            let windowCropInfo,
            windowCropInfo.srcWidth > 0,
            windowCropInfo.srcHeight > 0,
            windowCropInfo.dstWidth > 0,
            windowCropInfo.dstHeight > 0
        {
            renderModelType.cropInfo = INSCropInfo()
            renderModelType.cropInfo.srcWidth = Int32(windowCropInfo.srcWidth)
            renderModelType.cropInfo.srcHeight = Int32(windowCropInfo.srcHeight)
            renderModelType.cropInfo.dstWidth = Int32(windowCropInfo.dstWidth)
            renderModelType.cropInfo.dstHeight = Int32(windowCropInfo.dstHeight)
        }
        renderModelType.aiFlowVersion = 1
        renderModelType.expandFlowWorkRegion = true
        renderModelType.aiFlowFrameInterval = 2
        renderModelType.colorFusion = true
        renderModelType.dynamicStitchType = .dynamicVideo
        renderModelType.cameraType = cameraManager.currentCamera?.cameraType ?? ""
        return renderModelType
    }

    func updateStabilizerParam(
        to player: INSCameraSessionPlayer
    ) -> INSRealtimeStabilizerParam {
        let parameter = INSRealtimeStabilizerParam()
        if let offset = updateOffset(to: player) {
            parameter.offset = offset
        }
        parameter.preferredStabMode = .still
        parameter.isSelfie = false
        parameter.isLiteGyro = false
        parameter.maxFilterAngleDegree = 25
        parameter.windSize = 3
        parameter.fps = 30
        return parameter
    }

    func updateStabilizerDynamicParam(
        to player: INSCameraSessionPlayer,
        dynamicParam: INSStabilizerDynamicParam
    ) -> INSStabilizerDynamicParam {
        dynamicParam.onlineFilterType = .pathPlanSlidingWin
        return dynamicParam
    }

    func playerDidSetup(_ player: INSCameraSessionPlayer) {
        markPreviewReady()
    }

    func playerPrepared(
        _ player: INSCameraSessionPlayer,
        sampleGroup: INSSampleGroup
    ) {
        markPreviewReady()
    }

    func playerPreviewer(
        _ player: INSCameraSessionPlayer,
        sampleGroup: INSSampleGroup,
        projectionInfo: INSProjectionInfo
    ) {
        markPreviewReady()
    }

    func player(_ player: INSCameraSessionPlayer, didOccurWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.showPreviewError(error.localizedDescription)
        }
    }
}
