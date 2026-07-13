import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Loads AI entitlement and purchases monthly (USD) / yearly (IQD) via store IAP.
class AiUpgradeController {
  AiUpgradeController(this.api);

  final ApiClient api;
  final InAppPurchase _iap = InAppPurchase.instance;

  Map<String, dynamic>? status;
  bool loading = true;
  String? error;
  bool purchasing = false;

  StreamSubscription<List<PurchaseDetails>>? _sub;
  List<ProductDetails> products = [];

  bool get access => status?['access'] == true;
  bool get hasCourseOffer => status?['hasCourseOffer'] == true;

  double get monthlyUsd =>
      (status?['monthlyUsd'] as num?)?.toDouble() ??
      (status?['monthlyPrice'] as num?)?.toDouble() ??
      4.99;

  double get yearlyIqd =>
      (status?['yearlyIqd'] as num?)?.toDouble() ?? 60000;

  String get appleMonthly =>
      status?['appleProductIdMonthly']?.toString() ?? 'com.ulearn.ai.monthly';
  String get appleYearly =>
      status?['appleProductIdYearly']?.toString() ?? 'com.ulearn.ai.yearly';
  String get googleMonthly =>
      status?['googleProductIdMonthly']?.toString() ?? 'ai_monthly';
  String get googleYearly =>
      status?['googleProductIdYearly']?.toString() ?? 'ai_yearly';

  String get monthlyProductId =>
      Platform.isIOS ? appleMonthly : googleMonthly;
  String get yearlyProductId =>
      Platform.isIOS ? appleYearly : googleYearly;

  Future<void> init() async {
    loading = true;
    error = null;
    try {
      await refreshStatus();
      final available = await _iap.isAvailable();
      if (available) {
        _sub ??= _iap.purchaseStream.listen(
          _onPurchases,
          onError: (e) {
            error = e.toString();
          },
        );
        await _loadProducts();
      }
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
    }
  }

  Future<void> refreshStatus() async {
    final data = await api.get('/api/ai/creative/status');
    status = Map<String, dynamic>.from(
      (data['status'] as Map?) ?? data,
    );
  }

  Future<void> _loadProducts() async {
    final ids = {monthlyProductId, yearlyProductId};
    final resp = await _iap.queryProductDetails(ids);
    products = resp.productDetails;
  }

  ProductDetails? productFor(String id) {
    for (final p in products) {
      if (p.id == id) return p;
    }
    return null;
  }

  Future<void> buyMonthly() => _buy(monthlyProductId);
  Future<void> buyYearly() => _buy(yearlyProductId);

  Future<void> _buy(String productId) async {
    purchasing = true;
    error = null;
    try {
      final available = await _iap.isAvailable();
      if (!available) {
        throw Exception('Store not available');
      }
      var product = productFor(productId);
      if (product == null) {
        await _loadProducts();
        product = productFor(productId);
      }
      if (product == null) {
        throw Exception('Product not found: $productId');
      }
      final param = PurchaseParam(productDetails: product);
      final ok = await _iap.buyNonConsumable(purchaseParam: param);
      if (!ok) {
        throw Exception('Purchase could not start');
      }
    } catch (e) {
      error = e.toString();
      purchasing = false;
      rethrow;
    }
  }

  Future<void> _onPurchases(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      if (purchase.status == PurchaseStatus.pending) {
        purchasing = true;
        continue;
      }
      if (purchase.status == PurchaseStatus.error) {
        purchasing = false;
        error = purchase.error?.message ?? 'Purchase failed';
        continue;
      }
      if (purchase.status == PurchaseStatus.purchased ||
          purchase.status == PurchaseStatus.restored) {
        try {
          await _verify(purchase);
          if (purchase.pendingCompletePurchase) {
            await _iap.completePurchase(purchase);
          }
          await refreshStatus();
        } catch (e) {
          error = e.toString();
        } finally {
          purchasing = false;
        }
      } else if (purchase.status == PurchaseStatus.canceled) {
        purchasing = false;
      }
    }
  }

  Future<void> _verify(PurchaseDetails purchase) async {
    final platform = Platform.isIOS ? 'APPLE' : 'GOOGLE';
    final transactionId = purchase.purchaseID ??
        purchase.verificationData.serverVerificationData.hashCode.toString();
    await api.post('/api/ai/creative/iap/verify', {
      'platform': platform,
      'productId': purchase.productID,
      'transactionId': transactionId,
      'purchaseToken': purchase.verificationData.serverVerificationData,
      'receiptData': purchase.verificationData.localVerificationData,
    });
  }

  void dispose() {
    _sub?.cancel();
  }
}

Future<bool?> showAiUpgradeSheet(
  BuildContext context, {
  required AiUpgradeController controller,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppTheme.card,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (ctx) => _AiUpgradeSheet(controller: controller),
  );
}

class _AiUpgradeSheet extends StatefulWidget {
  const _AiUpgradeSheet({required this.controller});

  final AiUpgradeController controller;

  @override
  State<_AiUpgradeSheet> createState() => _AiUpgradeSheetState();
}

class _AiUpgradeSheetState extends State<_AiUpgradeSheet> {
  late AiUpgradeController _c;
  bool _busy = false;
  String? _err;

  @override
  void initState() {
    super.initState();
    _c = widget.controller;
  }

  Future<void> _purchase(Future<void> Function() buy) async {
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await buy();
      // Wait briefly for purchase stream + verify
      for (var i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 400));
        if (_c.access) break;
        if (_c.error != null) {
          _err = _c.error;
          break;
        }
      }
      if (!mounted) return;
      if (_c.access) {
        Navigator.pop(context, true);
        return;
      }
      setState(() {
        _err ??= _c.error ?? context.l10n.t('mobile.ai.upgradePending');
        _busy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _err = e.toString();
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final monthlyStore = _c.productFor(_c.monthlyProductId);
    final yearlyStore = _c.productFor(_c.yearlyProductId);
    final monthlyLabel = monthlyStore?.price ??
        '${_c.monthlyUsd.toStringAsFixed(2)} USD';
    final yearlyLabel = yearlyStore?.price ??
        '${_c.yearlyIqd.toStringAsFixed(0)} IQD';

    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        16,
        20,
        24 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.t('mobile.ai.upgradeTitle'),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            l10n.t('mobile.ai.upgradeBody', {
              'courses': '${_c.status?['courseCount'] ?? 0}',
              'unlock': '${_c.status?['unlockCount'] ?? 6}',
              'monthly': monthlyLabel,
              'yearly': yearlyLabel,
            }),
            style: TextStyle(color: AppTheme.muted, height: 1.4),
          ),
          if (_c.hasCourseOffer) ...[
            const SizedBox(height: 10),
            Text(
              l10n.t('mobile.ai.upgradeCourseUnlocked'),
              style: TextStyle(
                color: AppTheme.accent,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy || _c.hasCourseOffer
                ? null
                : () => _purchase(_c.buyMonthly),
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.primary,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            child: Text(
              l10n.t('mobile.ai.upgradeMonthly', {'price': monthlyLabel}),
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: _busy || _c.hasCourseOffer
                ? null
                : () => _purchase(_c.buyYearly),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              side: BorderSide(color: AppTheme.accent.withValues(alpha: 0.5)),
            ),
            child: Text(
              l10n.t('mobile.ai.upgradeYearly', {'price': yearlyLabel}),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            Platform.isIOS
                ? l10n.t('mobile.ai.upgradePayApple')
                : l10n.t('mobile.ai.upgradePayGoogle'),
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: AppTheme.muted),
          ),
          if (_busy) ...[
            const SizedBox(height: 12),
            const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          ],
          if (_err != null) ...[
            const SizedBox(height: 10),
            Text(
              _err!,
              style: const TextStyle(color: Colors.redAccent, fontSize: 13),
            ),
          ],
          if (kDebugMode && _c.products.isEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Debug: store products not loaded. Check product IDs in admin settings.',
              style: TextStyle(fontSize: 11, color: AppTheme.muted),
            ),
          ],
        ],
      ),
    );
  }
}

/// Full-screen lock when free plan / subscription ended.
class AiLockedGate extends StatelessWidget {
  const AiLockedGate({
    super.key,
    required this.onUpgrade,
    this.loading = false,
  });

  final VoidCallback onUpgrade;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.lock_outline_rounded,
              size: 56,
              color: AppTheme.accent.withValues(alpha: 0.9),
            ),
            const SizedBox(height: 16),
            Text(
              l10n.t('mobile.ai.lockedTitle'),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              l10n.t('mobile.ai.lockedBody'),
              textAlign: TextAlign.center,
              style: TextStyle(color: AppTheme.muted, height: 1.45),
            ),
            const SizedBox(height: 22),
            if (loading)
              const CircularProgressIndicator(strokeWidth: 2)
            else
              FilledButton.icon(
                onPressed: onUpgrade,
                icon: const Icon(Icons.workspace_premium_rounded),
                label: Text(l10n.t('mobile.ai.upgradePlan')),
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.primary,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 22,
                    vertical: 14,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
