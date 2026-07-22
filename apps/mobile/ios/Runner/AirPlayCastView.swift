import Flutter
import UIKit
import AVKit
import AVFoundation

private class AirPlayCastView: NSObject, FlutterPlatformView {
  private let container: UIView
  private let playerController: AVPlayerViewController
  private var watermarkTimer: Timer?

  init(frame: CGRect, viewId: Int64, args: Any?) {
    container = UIView(frame: frame)
    playerController = AVPlayerViewController()
    super.init()

    let params = args as? [String: Any]
    let urlString = params?["url"] as? String ?? ""
    let watermark = params?["watermark"] as? String ?? ""

    playerController.view.frame = container.bounds
    playerController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    playerController.allowsPictureInPicturePlayback = false
    playerController.showsPlaybackControls = true

    if let url = URL(string: urlString) {
      let player = AVPlayer(url: url)
      playerController.player = player
      player.play()
    }

    container.addSubview(playerController.view)
    attachPlayerControllerIfNeeded()
    applyWatermark(watermark)
  }

  private func attachPlayerControllerIfNeeded() {
    guard playerController.parent == nil else { return }
    guard let root = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap({ $0.windows })
      .first(where: { $0.isKeyWindow })?
      .rootViewController else { return }

    var host = root
    while let presented = host.presentedViewController {
      host = presented
    }
    host.addChild(playerController)
    playerController.didMove(toParent: host)
  }

  private func applyWatermark(_ text: String) {
    watermarkTimer?.invalidate()
    guard !text.isEmpty, let overlay = playerController.contentOverlayView else { return }

    overlay.subviews.forEach { $0.removeFromSuperview() }

    func placeBanner() {
      overlay.subviews.forEach { $0.removeFromSuperview() }
      let label = UILabel()
      label.text = text
      label.textColor = UIColor(red: 1, green: 0.76, blue: 0.03, alpha: 1)
      label.font = UIFont.boldSystemFont(ofSize: 22)
      label.textAlignment = .center
      label.numberOfLines = 2
      label.backgroundColor = UIColor(white: 0, alpha: 0.72)
      label.layer.borderColor = UIColor(red: 1, green: 0.76, blue: 0.03, alpha: 0.75).cgColor
      label.layer.borderWidth = 1.5
      label.layer.cornerRadius = 8
      label.clipsToBounds = true

      let width = max(overlay.bounds.width - 48, 200)
      let height: CGFloat = 56
      let x = (overlay.bounds.width - width) / 2
      let positions: [CGFloat] = [
        overlay.bounds.height * 0.08,
        overlay.bounds.height * 0.5 - height / 2,
        overlay.bounds.height * 0.82 - height,
      ]
      let y = positions.randomElement() ?? overlay.bounds.height * 0.82 - height
      label.frame = CGRect(x: x, y: y, width: width, height: height)
      overlay.addSubview(label)
    }

    placeBanner()
    watermarkTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { _ in
      placeBanner()
    }
  }

  func view() -> UIView {
    container
  }

  deinit {
    watermarkTimer?.invalidate()
    playerController.player?.pause()
    playerController.willMove(toParent: nil)
    playerController.view.removeFromSuperview()
    playerController.removeFromParent()
  }
}

private class AirPlayCastViewFactory: NSObject, FlutterPlatformViewFactory {
  func create(
    withFrame frame: CGRect,
    viewIdentifier viewId: Int64,
    arguments args: Any?
  ) -> FlutterPlatformView {
    AirPlayCastView(frame: frame, viewId: viewId, args: args)
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    FlutterStandardMessageCodec.sharedInstance()
  }
}

extension AppDelegate {
  func registerAirPlayCastView(with registry: FlutterPluginRegistry) {
    guard let registrar = registry.registrar(forPlugin: "AirPlayCastView") else { return }
    registrar.register(
      AirPlayCastViewFactory(),
      withId: "ulearn/airplay_cast"
    )
  }
}
