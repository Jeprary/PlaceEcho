import Foundation

struct CapturedPanorama {
    let sceneID: String
    let url: URL
    let width: Int
    let height: Int
}

protocol PanoramaCaptureProviding {
    func capture(
        sceneID: String,
        completion: @escaping (Result<CapturedPanorama, Error>) -> Void
    )
}
