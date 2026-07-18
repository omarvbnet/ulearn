import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/iap/iap_fulfillment.dart';
import 'package:ulearn/core/iap/store_iap.dart';

/// Purchase a store course via Apple / Google IAP, then verify on the server.
class CourseIapPurchase {
  CourseIapPurchase(this.api);

  final ApiClient api;

  Future<Map<String, dynamic>> buy({
    required String courseId,
    required String? appleProductId,
    required String? googleProductId,
  }) async {
    await IapFulfillment.bind(api);
    await StoreIap.ensureInitialized();

    final productId = Platform.isIOS
        ? (appleProductId?.trim().isNotEmpty == true
            ? appleProductId!.trim()
            : 'com.ulearn.mobile.course.$courseId')
        : (googleProductId?.trim().isNotEmpty == true
            ? googleProductId!.trim()
            : 'course_$courseId');

    if (!StoreIap.storeAvailable) {
      throw StoreIapException(
        'store_unavailable',
        'The App Store is not available on this device.',
      );
    }

    final aliases = <String>{
      productId,
      'com.ulearn.mobile.course.$courseId',
      'course_$courseId',
      if (appleProductId != null && appleProductId.trim().isNotEmpty)
        appleProductId.trim(),
      if (googleProductId != null && googleProductId.trim().isNotEmpty)
        googleProductId.trim(),
    };

    final resp = await StoreIap.queryProducts(aliases);
    final product = StoreIap.pickProduct(
      resp.productDetails,
      preferredId: productId,
      aliases: aliases,
    );

    if (product == null) {
      throw StoreIapException(
        'product_missing',
        'Product "$productId" was not returned by the App Store. '
        'Not found: ${resp.notFoundIDs.join(", ")}. '
        '${resp.error?.message ?? ""}'.trim(),
      );
    }

    // So orphan recovery / unowned delivery knows which course to unlock.
    IapFulfillment.rememberCourseBuy(
      productId: product.id,
      courseId: courseId,
    );

    // 1) Apple confirmation sheet → StoreKit purchased
    final purchase = await StoreIap.buyAndWait(product);

    // 2) Our servers unlock access  3) only then finish StoreKit transaction
    final result = await IapFulfillment.fulfill(
      purchase,
      courseId: courseId,
    );

    return {
      'ok': true,
      'alreadyProcessed': result.alreadyProcessed,
      'courseId': result.courseId ?? courseId,
      'expiresAt': result.expiresAt,
      ...?result.raw,
    };
  }

  /// No-op kept for call-site compatibility.
  void dispose() {}
}

/// True when we should attempt IAP (mobile + product configured or fallback).
bool shouldUseCourseIap(Map<String, dynamic>? course) {
  if (kIsWeb) return false;
  if (!Platform.isIOS && !Platform.isAndroid) return false;
  return true;
}

/// Preload whether the App Store knows this course product (for UI gating).
Future<CourseIapProductCheck> checkCourseIapProduct({
  required String courseId,
  required String? appleProductId,
  required String? googleProductId,
}) async {
  await StoreIap.ensureInitialized();
  if (!StoreIap.storeAvailable) {
    return const CourseIapProductCheck(
      available: false,
      reason: 'store_unavailable',
    );
  }
  final productId = Platform.isIOS
      ? (appleProductId?.trim().isNotEmpty == true
          ? appleProductId!.trim()
          : 'com.ulearn.mobile.course.$courseId')
      : (googleProductId?.trim().isNotEmpty == true
          ? googleProductId!.trim()
          : 'course_$courseId');
  final aliases = <String>{
    productId,
    'com.ulearn.mobile.course.$courseId',
    if (appleProductId != null && appleProductId.trim().isNotEmpty)
      appleProductId.trim(),
  };
  final resp = await StoreIap.queryProducts(aliases);
  final product = StoreIap.pickProduct(
    resp.productDetails,
    preferredId: productId,
    aliases: aliases,
  );
  if (product == null) {
    return CourseIapProductCheck(
      available: false,
      reason: 'product_missing',
      productId: productId,
    );
  }
  return CourseIapProductCheck(
    available: true,
    productId: product.id,
    priceLabel: product.price,
  );
}

class CourseIapProductCheck {
  const CourseIapProductCheck({
    required this.available,
    this.reason,
    this.productId,
    this.priceLabel,
  });

  final bool available;
  final String? reason;
  final String? productId;
  final String? priceLabel;
}
