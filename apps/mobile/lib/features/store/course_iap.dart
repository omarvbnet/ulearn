import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:ulearn/core/api/api_client.dart';

/// Purchase a store course via Apple / Google IAP, then verify on the server.
class CourseIapPurchase {
  CourseIapPurchase(this.api);

  final ApiClient api;
  final InAppPurchase _iap = InAppPurchase.instance;
  StreamSubscription<List<PurchaseDetails>>? _sub;
  Completer<PurchaseDetails>? _wait;

  Future<Map<String, dynamic>> buy({
    required String courseId,
    required String? appleProductId,
    required String? googleProductId,
  }) async {
    final productId = Platform.isIOS
        ? (appleProductId?.trim().isNotEmpty == true
            ? appleProductId!.trim()
            : 'com.ulearn.mobile.course.$courseId')
        : (googleProductId?.trim().isNotEmpty == true
            ? googleProductId!.trim()
            : 'course_$courseId');

    final available = await _iap.isAvailable();
    if (!available) {
      throw Exception('store_unavailable');
    }

    _sub ??= _iap.purchaseStream.listen(_onPurchases);
    final resp = await _iap.queryProductDetails({productId});
    if (resp.productDetails.isEmpty) {
      // Also try short aliases.
      final aliases = <String>{
        productId,
        'com.ulearn.mobile.course.$courseId',
        'course_$courseId',
        if (appleProductId != null) appleProductId,
        if (googleProductId != null) googleProductId,
      }.whereType<String>().toSet();
      final again = await _iap.queryProductDetails(aliases);
      if (again.productDetails.isEmpty) {
        throw Exception('product_missing');
      }
      resp.productDetails.addAll(again.productDetails);
    }

    final product = resp.productDetails.firstWhere(
      (p) => p.id == productId,
      orElse: () => resp.productDetails.first,
    );

    _wait = Completer<PurchaseDetails>();
    final ok = await _iap.buyNonConsumable(
      purchaseParam: PurchaseParam(productDetails: product),
    );
    if (!ok) throw Exception('purchase_start_failed');

    final purchase = await _wait!.future.timeout(
      const Duration(minutes: 2),
      onTimeout: () => throw Exception('purchase_timeout'),
    );

    final platform = Platform.isIOS ? 'APPLE' : 'GOOGLE';
    final transactionId = purchase.purchaseID ??
        purchase.verificationData.serverVerificationData.hashCode.toString();

    final verified = await api.post('/api/store/courses/iap/verify', {
      'courseId': courseId,
      'platform': platform,
      'productId': purchase.productID,
      'transactionId': transactionId,
      'purchaseToken': purchase.verificationData.serverVerificationData,
      'receiptData': purchase.verificationData.localVerificationData,
    });

    if (purchase.pendingCompletePurchase) {
      await _iap.completePurchase(purchase);
    }

    return Map<String, dynamic>.from(verified);
  }

  void _onPurchases(List<PurchaseDetails> purchases) {
    for (final p in purchases) {
      if (p.status == PurchaseStatus.pending) continue;
      if (p.status == PurchaseStatus.error) {
        _wait?.completeError(
          Exception(p.error?.message ?? 'Purchase failed'),
        );
        _wait = null;
        continue;
      }
      if (p.status == PurchaseStatus.purchased ||
          p.status == PurchaseStatus.restored) {
        _wait?.complete(p);
        _wait = null;
      } else if (p.status == PurchaseStatus.canceled) {
        _wait?.completeError(Exception('purchase_canceled'));
        _wait = null;
      }
    }
  }

  void dispose() {
    _sub?.cancel();
  }
}

/// True when we should attempt IAP (mobile + product configured or fallback).
bool shouldUseCourseIap(Map<String, dynamic>? course) {
  if (kIsWeb) return false;
  if (!Platform.isIOS && !Platform.isAndroid) return false;
  return true;
}
