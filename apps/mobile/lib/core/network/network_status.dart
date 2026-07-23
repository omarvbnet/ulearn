import 'package:connectivity_plus/connectivity_plus.dart';

/// Lightweight connectivity helper for offline whiteboard playback.
class NetworkStatus {
  NetworkStatus._();

  static Future<bool> isOnline() async {
    try {
      final results = await Connectivity().checkConnectivity();
      if (results.isEmpty) return false;
      return results.any((r) => r != ConnectivityResult.none);
    } catch (_) {
      // If the plugin fails, assume online and let HTTP errors surface.
      return true;
    }
  }

  static Stream<bool> onOnlineChanged() {
    return Connectivity().onConnectivityChanged.map((results) {
      if (results.isEmpty) return false;
      return results.any((r) => r != ConnectivityResult.none);
    });
  }
}
