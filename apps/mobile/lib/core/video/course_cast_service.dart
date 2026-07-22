import 'dart:async';
import 'dart:io';
import 'package:flutter/services.dart';

/// Native Chromecast bridge (Android) and cast-state events.
class CourseCastService {
  CourseCastService._();

  static const _channel = MethodChannel('ulearn/cast');
  static const _events = EventChannel('ulearn/cast_events');

  static Stream<bool>? _castingStream;
  static Stream<bool> get castingStream {
    _castingStream ??= _events
        .receiveBroadcastStream()
        .map((event) => event == true)
        .handleError((_) => false);
    return _castingStream!;
  }

  static Future<bool> get isAvailable async {
    if (Platform.isIOS) return true;
    if (!Platform.isAndroid) return false;
    try {
      final ok = await _channel.invokeMethod<bool>('isAvailable');
      return ok == true;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> get isCasting async {
    try {
      final ok = await _channel.invokeMethod<bool>('isCasting');
      return ok == true;
    } catch (_) {
      return false;
    }
  }

  /// Start casting a course video URL with viewer watermark metadata.
  static Future<bool> castVideo({
    required String url,
    required String title,
    required String watermark,
    String? watermarkVttUrl,
    int positionMs = 0,
  }) async {
    if (Platform.isIOS) return false;
    try {
      final ok = await _channel.invokeMethod<bool>('castVideo', {
        'url': url,
        'title': title,
        'watermark': watermark,
        if (watermarkVttUrl != null) 'watermarkVttUrl': watermarkVttUrl,
        'positionMs': positionMs,
      });
      return ok == true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> showDevicePicker() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod<void>('showDevicePicker');
    } catch (_) {}
  }

  static Future<void> stopCast() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod<void>('stopCast');
    } catch (_) {}
  }
}
