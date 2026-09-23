import SwiftUI

@main
struct PlaceEchoApp: App {
    var body: some Scene {
        WindowGroup {
            PlaceEchoWebView(
                captureProvider: PanoramaCaptureProviderFactory.make()
            )
            .ignoresSafeArea()
        }
    }
}
