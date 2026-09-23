import Foundation
import UIKit

@objc(PlaceEchoCapturePluginFactory)
public final class PlaceEchoCapturePluginFactory: NSObject {
    private static let resultNotification = Notification.Name(
        "dev.placeecho.x5.capture-result"
    )
    private static let sceneIDDefaultsKey = "dev.placeecho.x5.pending-scene-id"
    private static let requestIDDefaultsKey = "dev.placeecho.x5.pending-request-id"

    @objc(makeCaptureViewController)
    public func makeCaptureViewController() -> UIViewController? {
        let defaults = UserDefaults.standard
        guard
            let sceneID = defaults.string(forKey: Self.sceneIDDefaultsKey),
            let requestID = defaults.string(forKey: Self.requestIDDefaultsKey)
        else {
            return nil
        }
        defaults.removeObject(forKey: Self.sceneIDDefaultsKey)
        defaults.removeObject(forKey: Self.requestIDDefaultsKey)

        let provider = Insta360PanoramaCaptureProvider()
        return X5CaptureViewController(
            sceneID: sceneID,
            captureProvider: provider
        ) { result in
            let userInfo: [String: Any]
            switch result {
            case .success(let panorama):
                userInfo = [
                    "request_id": requestID,
                    "success": true,
                    "scene_id": panorama.sceneID,
                    "url": panorama.url.absoluteString,
                    "width": panorama.width,
                    "height": panorama.height,
                ]
            case .failure(let error):
                userInfo = [
                    "request_id": requestID,
                    "success": false,
                    "scene_id": sceneID,
                    "message": error.localizedDescription,
                ]
            }
            NotificationCenter.default.post(
                name: Self.resultNotification,
                object: nil,
                userInfo: userInfo
            )
        }
    }
}
