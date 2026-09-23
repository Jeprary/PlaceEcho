import Foundation
import NetworkExtension

enum X5WiFiSessionError: LocalizedError {
    case credentialsMissing
    case joinFailed(String)

    var errorDescription: String? {
        switch self {
        case .credentialsMissing:
            return "请连接 X5 Wi-Fi，或在 Xcode Scheme 中配置 X5 的 Wi-Fi 名称和密码。"
        case .joinFailed(let message):
            return "无法临时连接 X5 Wi-Fi：\(message)"
        }
    }
}

/// Owns only Wi-Fi configurations created by PlaceEcho. A manually joined
/// network is never removed. Credentials stay in the local Xcode scheme until
/// Bluetooth-based camera discovery supplies them in a later iteration.
final class X5WiFiSession {
    private var managedSSID: String?

    func join(completion: @escaping (Result<Void, Error>) -> Void) {
        let environment = ProcessInfo.processInfo.environment
        guard
            let ssid = environment["PLACE_ECHO_X5_SSID"],
            !ssid.isEmpty,
            let password = environment["PLACE_ECHO_X5_PASSWORD"],
            !password.isEmpty
        else {
            completion(.failure(X5WiFiSessionError.credentialsMissing))
            return
        }

        let configuration = NEHotspotConfiguration(
            ssid: ssid,
            passphrase: password,
            isWEP: false
        )
        configuration.joinOnce = true
        NEHotspotConfigurationManager.shared.apply(configuration) { [weak self] error in
            DispatchQueue.main.async {
                if let error {
                    let nsError = error as NSError
                    let alreadyAssociated =
                        nsError.domain == NEHotspotConfigurationErrorDomain &&
                        nsError.code == NEHotspotConfigurationError.alreadyAssociated.rawValue
                    guard alreadyAssociated else {
                        completion(.failure(
                            X5WiFiSessionError.joinFailed(error.localizedDescription)
                        ))
                        return
                    }
                }
                self?.managedSSID = ssid
                completion(.success(()))
            }
        }
    }

    func disconnectIfManaged(completion: @escaping () -> Void) {
        guard let managedSSID else {
            completion()
            return
        }
        NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: managedSSID)
        self.managedSSID = nil

        // Network selection is controlled by iOS. Give it a short handoff
        // window before the upload layer checks internet reachability.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            completion()
        }
    }
}
