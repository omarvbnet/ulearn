import 'dart:async';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/iap/store_iap.dart';

/// Fulfills Apple/Google purchases on our backend AFTER StoreKit confirms payment.
///
/// Flow:
/// 1. User confirms on Apple sheet → StoreKit emits [PurchaseStatus.purchased]
/// 2. We POST receipt/token to our verify APIs (with retries)
/// 3. Only after server returns ok do we call [StoreIap.completeIfNeeded]
///
/// Never finishes the StoreKit transaction until our DB has unlocked access,
/// so a network blip can still recover on next app launch.
class IapFulfillment {
  IapFulfillment._();

  static ApiClient? _api;
  static StreamSubscription<PurchaseDetails>? _sub;
  static final _pendingCourseByProduct = <String, String>{};
  static final _inFlight = <String>{};
  static final _listeners = <void Function(IapFulfillmentResult)>[];

  static void addListener(void Function(IapFulfillmentResult) cb) =>
      _listeners.add(cb);
  static void removeListener(void Function(IapFulfillmentResult) cb) =>
      _listeners.remove(cb);

  static void _emit(IapFulfillmentResult r) {
    for (final cb in List.of(_listeners)) {
      try {
        cb(r);
      } catch (_) {}
    }
  }

  static void _log(String msg, {Object? error}) {
    developer.log('[IapFulfillment] $msg', name: 'iap', error: error);
    if (kDebugMode) {
      // ignore: avoid_print
      print('[IapFulfillment] $msg${error != null ? ' error=$error' : ''}');
    }
  }

  /// Call when the user is authenticated so orphaned Sandbox purchases can sync.
  static Future<void> bind(ApiClient api) async {
    _api = api;
    await StoreIap.ensureInitialized();
    _sub ??= StoreIap.listenUnowned(_onUnowned);
    _log('bound — listening for purchased/restored deliveries');
  }

  static void unbind() {
    _sub?.cancel();
    _sub = null;
    _api = null;
    _pendingCourseByProduct.clear();
  }

  /// Remember which course a product buy belongs to (used by orphan recovery).
  static void rememberCourseBuy({
    required String productId,
    required String courseId,
  }) {
    _pendingCourseByProduct[productId] = courseId;
  }

  static Future<void> _onUnowned(PurchaseDetails purchase) async {
    if (purchase.status != PurchaseStatus.purchased &&
        purchase.status != PurchaseStatus.restored) {
      return;
    }
    try {
      await fulfill(purchase);
    } catch (e) {
      _log('unowned fulfill failed product=${purchase.productID}', error: e);
    }
  }

  /// Verify on our servers, then finish the StoreKit transaction.
  static Future<IapFulfillmentResult> fulfill(
    PurchaseDetails purchase, {
    String? courseId,
  }) async {
    final api = _api;
    if (api == null) {
      throw StoreIapException(
        'not_bound',
        'Sign in required before activating this purchase.',
      );
    }

    final txKey =
        '${purchase.productID}:${purchase.purchaseID ?? purchase.verificationData.serverVerificationData.hashCode}';
    if (_inFlight.contains(txKey)) {
      _log('skip duplicate in-flight $txKey');
      return IapFulfillmentResult(
        kind: IapKind.unknown,
        productId: purchase.productID,
        alreadyProcessed: true,
      );
    }
    _inFlight.add(txKey);

    try {
      final platform = Platform.isIOS ? 'APPLE' : 'GOOGLE';
      final transactionId = purchase.purchaseID ??
          purchase.verificationData.serverVerificationData.hashCode.toString();
      final token = purchase.verificationData.serverVerificationData;
      final receipt = purchase.verificationData.localVerificationData;
      final resolvedCourseId =
          courseId ?? _pendingCourseByProduct[purchase.productID];

      late final Map<String, dynamic> verified;
      late final IapKind kind;

      if (_looksLikeAi(purchase.productID)) {
        kind = IapKind.ai;
        verified = await _postWithRetry(
          () => api.post('/api/ai/creative/iap/verify', {
            'platform': platform,
            'productId': purchase.productID,
            'transactionId': transactionId,
            'purchaseToken': token,
            'receiptData': receipt,
          }),
        );
      } else {
        kind = IapKind.course;
        verified = await _postWithRetry(
          () => api.post('/api/store/courses/iap/verify', {
            'courseId': ?resolvedCourseId,
            'platform': platform,
            'productId': purchase.productID,
            'transactionId': transactionId,
            'purchaseToken': token,
            'receiptData': receipt,
          }),
        );
        final unlockedCourseId =
            verified['courseId']?.toString() ?? resolvedCourseId;
        if (unlockedCourseId != null) {
          _pendingCourseByProduct.remove(purchase.productID);
        }
      }

      // Only finish StoreKit AFTER our DB unlocked access.
      await StoreIap.completeIfNeeded(purchase);

      final result = IapFulfillmentResult(
        kind: kind,
        productId: purchase.productID,
        courseId: verified['courseId']?.toString() ?? resolvedCourseId,
        expiresAt: verified['expiresAt']?.toString(),
        alreadyProcessed: verified['alreadyProcessed'] == true,
        raw: verified,
      );
      _log(
        'fulfilled kind=$kind product=${purchase.productID} '
        'course=${result.courseId} already=${result.alreadyProcessed}',
      );
      _emit(result);
      return result;
    } catch (e) {
      // Do NOT completePurchase — Apple will redeliver so we can retry.
      _log('fulfill failed — leaving transaction pending', error: e);
      rethrow;
    } finally {
      _inFlight.remove(txKey);
    }
  }

  static bool _looksLikeAi(String productId) {
    final id = productId.toLowerCase();
    return id.contains('ai') &&
        (id.contains('month') || id.contains('year') || id.contains('annual'));
  }

  static Future<Map<String, dynamic>> _postWithRetry(
    Future<dynamic> Function() post, {
    int attempts = 3,
  }) async {
    Object? last;
    for (var i = 0; i < attempts; i++) {
      try {
        final data = await post();
        return Map<String, dynamic>.from(data as Map);
      } catch (e) {
        last = e;
        _log('verify attempt ${i + 1}/$attempts failed', error: e);
        if (i < attempts - 1) {
          await Future<void>.delayed(Duration(milliseconds: 400 * (i + 1)));
        }
      }
    }
    throw last ?? Exception('verify_failed');
  }
}

enum IapKind { course, ai, unknown }

class IapFulfillmentResult {
  IapFulfillmentResult({
    required this.kind,
    required this.productId,
    this.courseId,
    this.expiresAt,
    this.alreadyProcessed = false,
    this.raw,
  });

  final IapKind kind;
  final String productId;
  final String? courseId;
  final String? expiresAt;
  final bool alreadyProcessed;
  final Map<String, dynamic>? raw;
}
