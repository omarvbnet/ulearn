import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/notifications/notification_router.dart';

/// Background isolate handler — must be a top-level function.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}
  // Payload is delivered again via getInitialMessage / onMessageOpenedApp.
  if (kDebugMode) {
    debugPrint('[FCM background] ${message.messageId} ${message.data}');
  }
}

/// Registers FCM tokens and routes notification taps.
class PushNotificationService {
  PushNotificationService._();
  static final instance = PushNotificationService._();

  ApiClient? _api;
  GlobalKey<NavigatorState>? _navigatorKey;
  bool _ready = false;
  bool _firebaseReady = false;
  StreamSubscription<RemoteMessage>? _fg;
  StreamSubscription<RemoteMessage>? _opened;
  String? _lastUploadedToken;

  /// Call from [main] before [runApp] so background messages are handled.
  Future<void> ensureFirebaseReady() async {
    if (kIsWeb || _firebaseReady) return;
    try {
      await Firebase.initializeApp();
      _firebaseReady = true;
    } catch (e) {
      if (kDebugMode) debugPrint('[FCM] Firebase.initializeApp: $e');
      // May already be initialized by the native layer.
      _firebaseReady = Firebase.apps.isNotEmpty;
    }
  }

  Future<void> init({
    required ApiClient api,
    required GlobalKey<NavigatorState> navigatorKey,
  }) async {
    _api = api;
    _navigatorKey = navigatorKey;
    if (kIsWeb) return;

    await ensureFirebaseReady();
    if (!_firebaseReady && Firebase.apps.isEmpty) {
      if (kDebugMode) {
        debugPrint('[FCM] Firebase not configured — skip push setup');
      }
      return;
    }

    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );

    if (Platform.isIOS) {
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );
      await _waitForApnsToken(messaging);
    }

    await _registerToken();
    messaging.onTokenRefresh.listen((t) => _uploadToken(t));

    _fg?.cancel();
    _fg = FirebaseMessaging.onMessage.listen(_onForeground);

    _opened?.cancel();
    _opened = FirebaseMessaging.onMessageOpenedApp.listen(_onOpened);

    final initial = await messaging.getInitialMessage();
    if (initial != null) {
      // Delay until navigator is ready.
      Future<void>.delayed(const Duration(milliseconds: 800), () {
        _onOpened(initial);
      });
    }

    _ready = true;
  }

  Future<void> onUserLoggedIn() async {
    if (!_ready) {
      // init may still be running; retry shortly once UI/auth settle.
      Future<void>.delayed(const Duration(milliseconds: 500), () async {
        if (_ready) await _registerToken();
      });
      return;
    }
    await _registerToken();
  }

  Future<void> onUserLoggedOut() async {
    final token = _lastUploadedToken;
    final api = _api;
    _lastUploadedToken = null;
    if (token == null || api == null) return;
    try {
      await api.delete('/api/notifications/fcm-token', {'token': token});
    } catch (e) {
      if (kDebugMode) debugPrint('[FCM] delete token: $e');
    }
  }

  /// iOS needs an APNs token before FCM [getToken] succeeds.
  Future<void> _waitForApnsToken(FirebaseMessaging messaging) async {
    for (var i = 0; i < 20; i++) {
      final apns = await messaging.getAPNSToken();
      if (apns != null && apns.isNotEmpty) {
        if (kDebugMode) debugPrint('[FCM] APNs token ready');
        return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    if (kDebugMode) {
      debugPrint('[FCM] APNs token still missing after wait');
    }
  }

  Future<void> _registerToken() async {
    try {
      if (Platform.isIOS) {
        await _waitForApnsToken(FirebaseMessaging.instance);
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _uploadToken(token);
    } catch (e) {
      if (kDebugMode) debugPrint('[FCM] getToken: $e');
    }
  }

  Future<void> _uploadToken(String token) async {
    final api = _api;
    if (api == null) return;
    try {
      await api.post('/api/notifications/fcm-token', {'token': token});
      _lastUploadedToken = token;
    } catch (e) {
      if (kDebugMode) debugPrint('[FCM] upload token: $e');
    }
  }

  void _onForeground(RemoteMessage message) {
    final nav = _navigatorKey?.currentState;
    final ctx = nav?.context;
    if (ctx == null || !ctx.mounted) return;
    final title = message.notification?.title ??
        message.data['title']?.toString() ??
        'U Learn';
    final body = message.notification?.body ??
        message.data['body']?.toString() ??
        '';
    final payload = parseData(message.data);
    ScaffoldMessenger.of(ctx).showSnackBar(
      SnackBar(
        content: Text('$title\n$body'),
        action: SnackBarAction(
          label: 'Open',
          onPressed: () => NotificationRouter.open(ctx, payload),
        ),
        duration: const Duration(seconds: 5),
      ),
    );
  }

  void _onOpened(RemoteMessage message) {
    final ctx = _navigatorKey?.currentState?.context;
    if (ctx == null || !ctx.mounted) return;
    NotificationRouter.open(ctx, parseData(message.data));
  }

  /// Parse `data` JSON from in-app UserNotification row or FCM map.
  static Map<String, dynamic> parseData(dynamic raw) {
    if (raw is Map) {
      return {
        for (final e in raw.entries) e.key.toString(): e.value,
      };
    }
    if (raw is String && raw.trim().isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          return {
            for (final e in decoded.entries) e.key.toString(): e.value,
          };
        }
      } catch (_) {}
    }
    return {};
  }
}
