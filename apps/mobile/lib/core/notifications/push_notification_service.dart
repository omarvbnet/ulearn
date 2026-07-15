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
  debugPrint('[FCM background] ${message.messageId} ${message.data}');
}

void _fcmLog(String message) {
  // Keep visible in --release so device install issues are diagnosable.
  debugPrint('[FCM] $message');
}

/// Registers FCM tokens and routes notification taps.
class PushNotificationService {
  PushNotificationService._();
  static final instance = PushNotificationService._();

  ApiClient? _api;
  GlobalKey<NavigatorState>? _navigatorKey;
  bool _ready = false;
  bool _firebaseReady = false;
  bool _tokenRegisterInFlight = false;
  bool _pendingLoginRegister = false;
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
      _fcmLog('Firebase.initializeApp: $e');
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
      _fcmLog('Firebase not configured — skip push setup');
      return;
    }

    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );
    _fcmLog('permission=${settings.authorizationStatus}');

    if (Platform.isIOS) {
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );
      await _waitForApnsToken(messaging);
    }

    await _registerToken();
    messaging.onTokenRefresh.listen((t) {
      _fcmLog('token refresh');
      unawaited(_uploadToken(t));
    });

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
    if (_pendingLoginRegister) {
      _pendingLoginRegister = false;
      await _registerToken();
    }
  }

  Future<void> onUserLoggedIn() async {
    if (!_ready) {
      _pendingLoginRegister = true;
      // Retry a few times while init / APNs settle.
      for (var i = 0; i < 10; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        if (_ready) {
          _pendingLoginRegister = false;
          await _registerToken();
          return;
        }
      }
      _fcmLog('onUserLoggedIn: init not ready after retries');
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
      _fcmLog('delete token: $e');
    }
  }

  /// iOS needs an APNs token before FCM [getToken] succeeds.
  Future<void> _waitForApnsToken(FirebaseMessaging messaging) async {
    for (var i = 0; i < 40; i++) {
      final apns = await messaging.getAPNSToken();
      if (apns != null && apns.isNotEmpty) {
        _fcmLog('APNs token ready');
        return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    _fcmLog('APNs token still missing after wait');
  }

  Future<void> _registerToken() async {
    if (_tokenRegisterInFlight) return;
    _tokenRegisterInFlight = true;
    try {
      if (Platform.isIOS) {
        await _waitForApnsToken(FirebaseMessaging.instance);
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) {
        _fcmLog('getToken returned null');
        return;
      }
      _fcmLog('got FCM token (${token.length} chars)');
      await _uploadToken(token);
    } catch (e) {
      _fcmLog('getToken: $e');
    } finally {
      _tokenRegisterInFlight = false;
    }
  }

  Future<void> _uploadToken(String token) async {
    final api = _api;
    if (api == null) return;
    try {
      await api.post('/api/notifications/fcm-token', {'token': token});
      _lastUploadedToken = token;
      _fcmLog('token uploaded');
    } catch (e) {
      _fcmLog('upload token: $e');
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
