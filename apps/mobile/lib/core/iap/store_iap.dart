import 'dart:async';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';
import 'package:in_app_purchase_storekit/store_kit_wrappers.dart';

/// Central StoreKit / Play Billing bootstrap for App Review + Sandbox.
///
/// Call [StoreIap.ensureInitialized] as early as possible (from [main]).
/// Listens to [purchaseStream] for the whole app lifetime so unfinished
/// Sandbox transactions are finished and do not block reviewers.
class StoreIap {
  StoreIap._();

  static final InAppPurchase _iap = InAppPurchase.instance;
  static StreamSubscription<List<PurchaseDetails>>? _sub;
  static bool _ready = false;
  static bool storeAvailable = false;

  static final _waiters = <String, Completer<PurchaseDetails>>{};
  static final _unowned =
      StreamController<PurchaseDetails>.broadcast(sync: true);
  static final _bufferedUnowned = <PurchaseDetails>[];

  /// Purchases / restores that arrived with no active [buyAndWait] waiter.
  /// Listeners (AI / course) must verify then call [completeIfNeeded].
  static Stream<PurchaseDetails> get unownedPurchases => _unowned.stream;

  /// Attach a handler and immediately receive any buffered unowned purchases.
  static StreamSubscription<PurchaseDetails> listenUnowned(
    FutureOr<void> Function(PurchaseDetails purchase) onPurchase,
  ) {
    for (final p in List<PurchaseDetails>.from(_bufferedUnowned)) {
      _bufferedUnowned.remove(p);
      Future.sync(() => onPurchase(p));
    }
    return _unowned.stream.listen((p) {
      Future.sync(() => onPurchase(p));
    });
  }

  static void _log(String message, {Object? error, StackTrace? stack}) {
    final line = '[StoreIap] $message';
    developer.log(line, name: 'iap', error: error, stackTrace: stack);
    if (kDebugMode) {
      // ignore: avoid_print
      print(line);
      if (error != null) {
        // ignore: avoid_print
        print('[StoreIap] error=$error');
      }
    }
  }

  /// Must run before any purchase. Safe to call multiple times.
  static Future<void> ensureInitialized() async {
    if (_ready) return;

    if (!kIsWeb && Platform.isIOS) {
      // Our server verifies classic App Store receipts via verifyReceipt.
      // StoreKit 2 (plugin default) returns JWS instead — force SK1 for Sandbox
      // + production compatibility with APPLE_IAP_SHARED_SECRET.
      try {
        // ignore: deprecated_member_use
        await InAppPurchaseStoreKitPlatform.enableStoreKit1();
        _log('StoreKit 1 enabled (receipt-compatible)');
      } catch (e, st) {
        _log('enableStoreKit1 failed — continuing with default', error: e, stack: st);
      }
      try {
        final addition =
            _iap.getPlatformAddition<InAppPurchaseStoreKitPlatformAddition>();
        await addition.setDelegate(_UlearnPaymentQueueDelegate());
        _log('SKPaymentQueueDelegate set');
      } catch (e, st) {
        _log('setDelegate failed', error: e, stack: st);
      }
    }

    storeAvailable = await _iap.isAvailable();
    _log('storeAvailable=$storeAvailable');

    _sub ??= _iap.purchaseStream.listen(
      _onPurchases,
      onError: (Object e, StackTrace st) {
        _log('purchaseStream error', error: e, stack: st);
      },
      cancelOnError: false,
    );

    _ready = true;
  }

  static Future<ProductDetailsResponse> queryProducts(Set<String> ids) async {
    await ensureInitialized();
    final cleaned = ids.map((e) => e.trim()).where((e) => e.isNotEmpty).toSet();
    _log('queryProductDetails ids=$cleaned');
    if (cleaned.isEmpty) {
      return ProductDetailsResponse(
        productDetails: const [],
        notFoundIDs: const [],
        error: null,
      );
    }
    final resp = await _iap.queryProductDetails(cleaned);
    _log(
      'query result found=${resp.productDetails.map((p) => p.id).toList()} '
      'notFound=${resp.notFoundIDs} error=${resp.error?.message}',
    );
    return resp;
  }

  /// Resolves the best matching [ProductDetails] for [preferredId] + [aliases].
  static ProductDetails? pickProduct(
    List<ProductDetails> products, {
    required String preferredId,
    Set<String> aliases = const {},
  }) {
    for (final p in products) {
      if (p.id == preferredId) return p;
    }
    final all = {preferredId, ...aliases};
    for (final p in products) {
      if (all.contains(p.id)) return p;
    }
    return null;
  }

  /// Starts a non-consumable / subscription purchase and waits for the matching update.
  static Future<PurchaseDetails> buyAndWait(
    ProductDetails product, {
    Duration timeout = const Duration(minutes: 3),
  }) async {
    await ensureInitialized();
    if (!storeAvailable) {
      throw StoreIapException(
        'store_unavailable',
        'The App Store is not available on this device.',
      );
    }

    final existing = _waiters.remove(product.id);
    if (existing != null && !existing.isCompleted) {
      existing.completeError(
        StoreIapException(
          'purchase_replaced',
          'A newer purchase replaced this wait.',
        ),
      );
    }

    final completer = Completer<PurchaseDetails>();
    _waiters[product.id] = completer;
    _log('buyNonConsumable product=${product.id} price=${product.price}');

    final ok = await _iap.buyNonConsumable(
      purchaseParam: PurchaseParam(productDetails: product),
    );
    if (!ok) {
      _waiters.remove(product.id);
      throw StoreIapException(
        'purchase_start_failed',
        'StoreKit rejected starting the purchase for ${product.id}.',
      );
    }

    try {
      return await completer.future.timeout(
        timeout,
        onTimeout: () {
          _waiters.remove(product.id);
          throw StoreIapException(
            'purchase_timeout',
            'Timed out waiting for StoreKit purchase of ${product.id}.',
          );
        },
      );
    } finally {
      _waiters.remove(product.id);
    }
  }

  static Future<void> restorePurchases() async {
    await ensureInitialized();
    _log('restorePurchases');
    await _iap.restorePurchases();
  }

  static Future<void> completeIfNeeded(PurchaseDetails purchase) async {
    if (!purchase.pendingCompletePurchase) return;
    try {
      _log(
        'completePurchase product=${purchase.productID} status=${purchase.status}',
      );
      await _iap.completePurchase(purchase);
    } catch (e, st) {
      _log('completePurchase failed', error: e, stack: st);
    }
  }

  static Future<void> _onPurchases(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      _log(
        'update product=${purchase.productID} status=${purchase.status} '
        'purchaseID=${purchase.purchaseID} '
        'pendingComplete=${purchase.pendingCompletePurchase} '
        'error=${purchase.error?.code}|${purchase.error?.message}|${purchase.error?.details}',
      );

      final waiter = _waiters[purchase.productID];

      switch (purchase.status) {
        case PurchaseStatus.pending:
          break;
        case PurchaseStatus.error:
          final msg = purchase.error?.message ??
              purchase.error?.code ??
              'Purchase failed';
          if (waiter != null && !waiter.isCompleted) {
            waiter.completeError(
              StoreIapException(
                'storekit_error',
                msg,
                storeKitCode: purchase.error?.code,
                details: purchase.error?.details?.toString(),
              ),
            );
          }
          await completeIfNeeded(purchase);
        case PurchaseStatus.canceled:
          if (waiter != null && !waiter.isCompleted) {
            waiter.completeError(
              StoreIapException('purchase_canceled', 'Purchase was canceled.'),
            );
          }
          await completeIfNeeded(purchase);
        case PurchaseStatus.purchased:
        case PurchaseStatus.restored:
          if (waiter != null && !waiter.isCompleted) {
            waiter.complete(purchase);
          } else {
            // Deliver to AI/course handlers for verify → complete.
            if (_unowned.hasListener) {
              _unowned.add(purchase);
            } else {
              _bufferedUnowned.add(purchase);
              _log(
                'buffered unowned purchase product=${purchase.productID}',
              );
            }
          }
      }
    }
  }
}

class StoreIapException implements Exception {
  StoreIapException(
    this.code,
    this.message, {
    this.storeKitCode,
    this.details,
  });

  final String code;
  final String message;
  final String? storeKitCode;
  final String? details;

  @override
  String toString() {
    final sk = storeKitCode != null ? ' (storeKit=$storeKitCode)' : '';
    final d = details != null && details!.isNotEmpty ? ' [$details]' : '';
    return '$code: $message$sk$d';
  }
}

class _UlearnPaymentQueueDelegate implements SKPaymentQueueDelegateWrapper {
  @override
  bool shouldContinueTransaction(
    SKPaymentTransactionWrapper transaction,
    SKStorefrontWrapper storefront,
  ) {
    return true;
  }

  @override
  bool shouldShowPriceConsent() {
    return false;
  }
}
