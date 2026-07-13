import 'dart:async';
import 'dart:io';

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
  bool storeAvailable = false;
  Set<String> notFoundIds = {};

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

  int get courseCount => (status?['courseCount'] as num?)?.toInt() ?? 0;
  int get unlockCount => (status?['unlockCount'] as num?)?.toInt() ?? 6;

  /// Prefer admin config; fall back to bundle-aligned IDs.
  String get appleMonthly => _id(
        status?['appleProductIdMonthly'],
        'com.ulearn.mobile.ai.monthly',
      );
  String get appleYearly => _id(
        status?['appleProductIdYearly'],
        'com.ulearn.mobile.ai.yearly',
      );
  String get googleMonthly =>
      _id(status?['googleProductIdMonthly'], 'ai_monthly');
  String get googleYearly =>
      _id(status?['googleProductIdYearly'], 'ai_yearly');

  String get configuredMonthlyId =>
      Platform.isIOS ? appleMonthly : googleMonthly;
  String get configuredYearlyId =>
      Platform.isIOS ? appleYearly : googleYearly;

  static String _id(dynamic raw, String fallback) {
    final s = raw?.toString().trim() ?? '';
    return s.isEmpty ? fallback : s;
  }

  /// Resolved store product (may differ from configured id if aliases match).
  ProductDetails? get monthlyProduct => _resolveProduct(yearly: false);
  ProductDetails? get yearlyProduct => _resolveProduct(yearly: true);

  bool get canBuyMonthly => monthlyProduct != null;
  bool get canBuyYearly => yearlyProduct != null;
  bool get hasAnyStoreProduct => canBuyMonthly || canBuyYearly;

  List<Map<String, dynamic>> get packages {
    final raw = status?['packages'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  Map<String, dynamic>? packageForPlan({required bool yearly}) {
    final wantDays = yearly ? 300 : 35;
    Map<String, dynamic>? best;
    for (final p in packages) {
      final days = (p['durationDays'] as num?)?.toInt();
      if (days == null) continue;
      if (yearly && days >= wantDays) {
        best ??= p;
        if (days >= 360) return p;
      }
      if (!yearly && days > 0 && days <= wantDays) {
        best ??= p;
        if (days >= 28 && days <= 35) return p;
      }
    }
    return best ?? (packages.isNotEmpty ? packages.first : null);
  }

  Future<void> init() async {
    loading = true;
    error = null;
    try {
      await refreshStatus();
      storeAvailable = await _iap.isAvailable();
      if (storeAvailable) {
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

  Set<String> _candidateIds({required bool yearly}) {
    if (yearly) {
      return {
        configuredYearlyId,
        appleYearly,
        googleYearly,
        'com.ulearn.mobile.ai.yearly',
        'com.ulearn.ai.yearly',
        'ai_yearly',
        'ai.yearly',
      };
    }
    return {
      configuredMonthlyId,
      appleMonthly,
      googleMonthly,
      'com.ulearn.mobile.ai.monthly',
      'com.ulearn.ai.monthly',
      'ai_monthly',
      'ai.monthly',
    };
  }

  Future<void> reloadProducts() => _loadProducts();

  Future<void> _loadProducts() async {
    final ids = {
      ..._candidateIds(yearly: false),
      ..._candidateIds(yearly: true),
    };
    final resp = await _iap.queryProductDetails(ids);
    products = resp.productDetails;
    notFoundIds = resp.notFoundIDs.toSet();
    if (resp.error != null && products.isEmpty) {
      error = resp.error!.message;
    }
  }

  ProductDetails? _resolveProduct({required bool yearly}) {
    final preferred = yearly ? configuredYearlyId : configuredMonthlyId;
    for (final p in products) {
      if (p.id == preferred) return p;
    }
    final aliases = _candidateIds(yearly: yearly);
    for (final p in products) {
      if (aliases.contains(p.id)) return p;
    }
    // Heuristic: id contains monthly/year
    final key = yearly ? 'year' : 'month';
    for (final p in products) {
      final id = p.id.toLowerCase();
      if (id.contains(key) || id.contains(yearly ? 'annual' : 'mo')) {
        return p;
      }
    }
    return null;
  }

  Future<void> buyMonthly() => _buyStore(yearly: false);
  Future<void> buyYearly() => _buyStore(yearly: true);

  Future<void> _buyStore({required bool yearly}) async {
    purchasing = true;
    error = null;
    try {
      if (!storeAvailable) {
        throw _PurchaseException('store_unavailable');
      }
      await _loadProducts();
      final product = yearly ? yearlyProduct : monthlyProduct;
      if (product == null) {
        throw _PurchaseException('product_missing');
      }
      final param = PurchaseParam(productDetails: product);
      // Subscriptions and non-consumables share this entry point in the plugin.
      final ok = await _iap.buyNonConsumable(purchaseParam: param);
      if (!ok) {
        throw _PurchaseException('purchase_start_failed');
      }
    } catch (e) {
      error = e.toString();
      purchasing = false;
      rethrow;
    }
  }

  /// Fallback when App Store / Play products are not listed yet.
  Future<void> requestPackageActivation({required bool yearly}) async {
    purchasing = true;
    error = null;
    try {
      final pkg = packageForPlan(yearly: yearly);
      if (pkg == null) {
        throw _PurchaseException('no_package');
      }
      final id = pkg['id']?.toString();
      if (id == null || id.isEmpty) {
        throw _PurchaseException('no_package');
      }
      await api.post('/api/subscriptions', {'packageId': id});
      await refreshStatus();
    } catch (e) {
      error = e.toString();
      purchasing = false;
      rethrow;
    } finally {
      purchasing = false;
    }
  }

  Future<void> restorePurchases() async {
    purchasing = true;
    error = null;
    try {
      await _iap.restorePurchases();
      await Future<void>.delayed(const Duration(milliseconds: 800));
      await refreshStatus();
    } catch (e) {
      error = e.toString();
      rethrow;
    } finally {
      purchasing = false;
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

class _PurchaseException implements Exception {
  _PurchaseException(this.code);
  final String code;

  @override
  String toString() => code;
}

Future<bool?> showAiUpgradeSheet(
  BuildContext context, {
  required AiUpgradeController controller,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.55),
    builder: (ctx) => _AiUpgradeSheet(controller: controller),
  );
}

class _AiUpgradeSheet extends StatefulWidget {
  const _AiUpgradeSheet({required this.controller});

  final AiUpgradeController controller;

  @override
  State<_AiUpgradeSheet> createState() => _AiUpgradeSheetState();
}

class _AiUpgradeSheetState extends State<_AiUpgradeSheet>
    with SingleTickerProviderStateMixin {
  late AiUpgradeController _c;
  bool _busy = false;
  String? _err;
  bool _yearlySelected = true;
  late AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _c = widget.controller;
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat(reverse: true);
    // Refresh products when sheet opens.
    unawaited(_warm());
  }

  Future<void> _warm() async {
    try {
      await _c.refreshStatus();
      if (_c.storeAvailable) await _c.reloadProducts();
    } catch (_) {}
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  String _friendlyError(Object e) {
    final s = e.toString();
    final l10n = context.l10n;
    if (s.contains('product_missing') || s.contains('Product not found')) {
      return l10n.t('mobile.ai.upgradeProductMissing');
    }
    if (s.contains('store_unavailable')) {
      return l10n.t('mobile.ai.upgradeStoreUnavailable');
    }
    if (s.contains('no_package')) {
      return l10n.t('mobile.ai.upgradeNoPackage');
    }
    if (s.contains('purchase_start_failed')) {
      return l10n.t('mobile.ai.upgradeStartFailed');
    }
    if (s.contains('Exception: ')) {
      return s.replaceFirst('Exception: ', '');
    }
    return s;
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await action();
      for (var i = 0; i < 24; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 350));
        if (_c.access) break;
        if (_c.error != null &&
            !_c.error!.contains('product_missing') &&
            i > 2) {
          break;
        }
      }
      if (!mounted) return;
      if (_c.access) {
        Navigator.pop(context, true);
        return;
      }
      setState(() {
        _err = _c.error != null
            ? _friendlyError(_c.error!)
            : context.l10n.t('mobile.ai.upgradePending');
        _busy = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _err = _friendlyError(e);
        _busy = false;
      });
    }
  }

  Future<void> _buySelected() async {
    final yearly = _yearlySelected;
    final canStore = yearly ? _c.canBuyYearly : _c.canBuyMonthly;
    if (canStore) {
      await _run(yearly ? _c.buyYearly : _c.buyMonthly);
      return;
    }
    // Store product missing → activation request fallback when packages exist.
    if (_c.packageForPlan(yearly: yearly) != null) {
      setState(() {
        _busy = true;
        _err = null;
      });
      try {
        await _c.requestPackageActivation(yearly: yearly);
        if (!mounted) return;
        if (_c.access) {
          Navigator.pop(context, true);
          return;
        }
        setState(() {
          _busy = false;
          _err = null;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(context.l10n.t('mobile.ai.upgradeRequestSent')),
            behavior: SnackBarBehavior.floating,
          ),
        );
      } catch (e) {
        if (!mounted) return;
        setState(() {
          _err = _friendlyError(e);
          _busy = false;
        });
      }
      return;
    }
    setState(() {
      _err = context.l10n.t('mobile.ai.upgradeProductMissing');
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    final monthlyStore = _c.monthlyProduct;
    final yearlyStore = _c.yearlyProduct;
    final monthlyLabel =
        monthlyStore?.price ?? '${_c.monthlyUsd.toStringAsFixed(2)} USD';
    final yearlyLabel =
        yearlyStore?.price ?? '${_c.yearlyIqd.toStringAsFixed(0)} IQD';
    final progress = _c.unlockCount <= 0
        ? 1.0
        : (_c.courseCount / _c.unlockCount).clamp(0.0, 1.0);

    return AnimatedBuilder(
      animation: _pulse,
      builder: (context, _) {
        final glow = 0.18 + _pulse.value * 0.14;
        return Padding(
          padding: EdgeInsets.only(top: MediaQuery.of(context).padding.top + 24),
          child: Container(
            decoration: BoxDecoration(
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(28)),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppTheme.card,
                  AppTheme.isDark
                      ? const Color(0xFF0C0A18)
                      : const Color(0xFFF7F5FF),
                  AppTheme.card,
                ],
              ),
              border: Border.all(
                color: AppTheme.primary.withValues(alpha: 0.35),
              ),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.primary.withValues(alpha: glow),
                  blurRadius: 40,
                  spreadRadius: 2,
                  offset: const Offset(0, -8),
                ),
              ],
            ),
            child: SafeArea(
              top: false,
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(20, 10, 20, 20 + bottom),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 44,
                        height: 5,
                        decoration: BoxDecoration(
                          color: AppTheme.muted.withValues(alpha: 0.35),
                          borderRadius: BorderRadius.circular(99),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    _HeroHeader(pulse: _pulse.value),
                    const SizedBox(height: 18),
                    Text(
                      l10n.t('mobile.ai.upgradeTitle'),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w900,
                        color: AppTheme.foreground,
                        letterSpacing: -0.4,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.t('mobile.ai.upgradeSubtitle'),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AppTheme.muted,
                        height: 1.45,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 18),
                    _CourseUnlockCard(
                      courses: _c.courseCount,
                      unlock: _c.unlockCount,
                      progress: progress,
                      unlocked: _c.hasCourseOffer,
                    ),
                    const SizedBox(height: 18),
                    Text(
                      l10n.t('mobile.ai.upgradeChoosePlan'),
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                        color: AppTheme.foreground,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _PlanCard(
                            selected: !_yearlySelected,
                            badge: null,
                            title: l10n.t('mobile.ai.upgradeMonthlyLabel'),
                            price: monthlyLabel,
                            hint: l10n.t('mobile.ai.upgradeMonthlyHint'),
                            storeReady: _c.canBuyMonthly,
                            onTap: _busy
                                ? null
                                : () => setState(() => _yearlySelected = false),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _PlanCard(
                            selected: _yearlySelected,
                            badge: l10n.t('mobile.ai.upgradeBestValue'),
                            title: l10n.t('mobile.ai.upgradeYearlyLabel'),
                            price: yearlyLabel,
                            hint: l10n.t('mobile.ai.upgradeYearlyHint'),
                            storeReady: _c.canBuyYearly,
                            onTap: _busy
                                ? null
                                : () => setState(() => _yearlySelected = true),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    if (!_c.hasAnyStoreProduct && _c.packages.isEmpty) ...[
                      _InfoBanner(
                        icon: Icons.info_outline_rounded,
                        text: l10n.t('mobile.ai.upgradeProductMissing'),
                      ),
                      const SizedBox(height: 14),
                    ] else if (!_c.hasAnyStoreProduct &&
                        _c.packages.isNotEmpty) ...[
                      _InfoBanner(
                        icon: Icons.mark_email_read_outlined,
                        text: l10n.t('mobile.ai.upgradeFallbackHint'),
                      ),
                      const SizedBox(height: 14),
                    ],
                    DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(18),
                        gradient: AppTheme.gradient,
                        boxShadow: [
                          BoxShadow(
                            color: AppTheme.primary.withValues(alpha: 0.35),
                            blurRadius: 18,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(18),
                          onTap: _busy || _c.hasCourseOffer
                              ? null
                              : _buySelected,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                if (_busy)
                                  const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.2,
                                      color: Colors.white,
                                    ),
                                  )
                                else
                                  const Icon(
                                    Icons.workspace_premium_rounded,
                                    color: Colors.white,
                                  ),
                                const SizedBox(width: 10),
                                Text(
                                  _c.hasCourseOffer
                                      ? l10n.t('mobile.ai.upgradeCourseUnlocked')
                                      : (_yearlySelected
                                          ? l10n.t(
                                              'mobile.ai.upgradeCtaYearly',
                                              {'price': yearlyLabel},
                                            )
                                          : l10n.t(
                                              'mobile.ai.upgradeCtaMonthly',
                                              {'price': monthlyLabel},
                                            )),
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextButton.icon(
                            onPressed: _busy
                                ? null
                                : () => _run(_c.restorePurchases),
                            icon: Icon(
                              Icons.restore_rounded,
                              size: 18,
                              color: AppTheme.muted,
                            ),
                            label: Text(
                              l10n.t('mobile.ai.upgradeRestore'),
                              style: TextStyle(color: AppTheme.muted),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Platform.isIOS
                              ? Icons.apple
                              : Icons.shop_two_outlined,
                          size: 16,
                          color: AppTheme.muted,
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            Platform.isIOS
                                ? l10n.t('mobile.ai.upgradePayApple')
                                : l10n.t('mobile.ai.upgradePayGoogle'),
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 12,
                              color: AppTheme.muted,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (_err != null) ...[
                      const SizedBox(height: 14),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEF4444).withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color:
                                const Color(0xFFEF4444).withValues(alpha: 0.35),
                          ),
                        ),
                        child: Text(
                          _err!,
                          style: const TextStyle(
                            color: Color(0xFFFF8A80),
                            fontSize: 13,
                            height: 1.35,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _HeroHeader extends StatelessWidget {
  const _HeroHeader({required this.pulse});
  final double pulse;

  @override
  Widget build(BuildContext context) {
    final scale = 1 + pulse * 0.04;
    return Center(
      child: Transform.scale(
        scale: scale,
        child: Container(
          width: 88,
          height: 88,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: AppTheme.gradient,
            boxShadow: [
              BoxShadow(
                color: AppTheme.accent.withValues(alpha: 0.35 + pulse * 0.2),
                blurRadius: 28,
                spreadRadius: 2,
              ),
            ],
          ),
          child: const Icon(
            Icons.auto_awesome_rounded,
            color: Colors.white,
            size: 40,
          ),
        ),
      ),
    );
  }
}

class _CourseUnlockCard extends StatelessWidget {
  const _CourseUnlockCard({
    required this.courses,
    required this.unlock,
    required this.progress,
    required this.unlocked,
  });

  final int courses;
  final int unlock;
  final double progress;
  final bool unlocked;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        color: AppTheme.background.withValues(alpha: 0.55),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                unlocked
                    ? Icons.verified_rounded
                    : Icons.school_outlined,
                color: unlocked ? AppTheme.accent : AppTheme.primary,
                size: 20,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  unlocked
                      ? l10n.t('mobile.ai.upgradeCourseUnlocked')
                      : l10n.t('mobile.ai.upgradeCourseProgress', {
                          'courses': '$courses',
                          'unlock': '$unlock',
                        }),
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                    color: AppTheme.foreground,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 8,
              backgroundColor: AppTheme.cardBorder,
              color: unlocked ? AppTheme.accent : AppTheme.primary,
            ),
          ),
        ],
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.selected,
    required this.badge,
    required this.title,
    required this.price,
    required this.hint,
    required this.storeReady,
    required this.onTap,
  });

  final bool selected;
  final String? badge;
  final String title;
  final String price;
  final String hint;
  final bool storeReady;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          padding: const EdgeInsets.fromLTRB(14, 16, 14, 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: selected
                ? LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      AppTheme.primary.withValues(alpha: 0.28),
                      AppTheme.accent.withValues(alpha: 0.12),
                    ],
                  )
                : null,
            color: selected ? null : AppTheme.background.withValues(alpha: 0.45),
            border: Border.all(
              color: selected
                  ? AppTheme.accent.withValues(alpha: 0.7)
                  : AppTheme.cardBorder,
              width: selected ? 1.6 : 1,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: AppTheme.primary.withValues(alpha: 0.22),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                    ),
                  ]
                : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                        color: AppTheme.foreground,
                      ),
                    ),
                  ),
                  if (badge != null)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(99),
                        gradient: AppTheme.gradient,
                      ),
                      child: Text(
                        badge!,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                price,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                  color: AppTheme.foreground,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                hint,
                style: TextStyle(
                  fontSize: 11,
                  color: AppTheme.muted,
                  height: 1.3,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Icon(
                    selected
                        ? Icons.check_circle_rounded
                        : Icons.circle_outlined,
                    size: 16,
                    color: selected ? AppTheme.accent : AppTheme.muted,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    storeReady ? 'IAP' : '·',
                    style: TextStyle(
                      fontSize: 10,
                      color: storeReady
                          ? AppTheme.accent
                          : AppTheme.muted.withValues(alpha: 0.5),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoBanner extends StatelessWidget {
  const _InfoBanner({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: AppTheme.accent.withValues(alpha: 0.08),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppTheme.accent),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: AppTheme.foreground.withValues(alpha: 0.85),
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
          ),
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
    return Stack(
      children: [
        Positioned.fill(
          child: CustomPaint(painter: _OrbPainter()),
        ),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 110,
                  height: 110,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: AppTheme.gradient,
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.primary.withValues(alpha: 0.4),
                        blurRadius: 32,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.lock_person_rounded,
                    size: 48,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 22),
                Text(
                  l10n.t('mobile.ai.lockedTitle'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                    color: AppTheme.foreground,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  l10n.t('mobile.ai.lockedBody'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AppTheme.muted,
                    height: 1.5,
                    fontSize: 14.5,
                  ),
                ),
                const SizedBox(height: 28),
                if (loading)
                  const CircularProgressIndicator(strokeWidth: 2)
                else
                  DecoratedBox(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(18),
                      gradient: AppTheme.gradient,
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.accent.withValues(alpha: 0.3),
                          blurRadius: 20,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(18),
                        onTap: onUpgrade,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 28,
                            vertical: 16,
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(
                                Icons.workspace_premium_rounded,
                                color: Colors.white,
                              ),
                              const SizedBox(width: 10),
                              Text(
                                l10n.t('mobile.ai.upgradePlan'),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 16,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _OrbPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..style = PaintingStyle.fill;
    paint.shader = RadialGradient(
      colors: [
        AppTheme.primary.withValues(alpha: 0.22),
        AppTheme.primary.withValues(alpha: 0.0),
      ],
    ).createShader(
      Rect.fromCircle(
        center: Offset(size.width * 0.2, size.height * 0.25),
        radius: size.width * 0.55,
      ),
    );
    canvas.drawCircle(
      Offset(size.width * 0.2, size.height * 0.25),
      size.width * 0.55,
      paint,
    );
    paint.shader = RadialGradient(
      colors: [
        AppTheme.accent.withValues(alpha: 0.16),
        AppTheme.accent.withValues(alpha: 0.0),
      ],
    ).createShader(
      Rect.fromCircle(
        center: Offset(size.width * 0.85, size.height * 0.7),
        radius: size.width * 0.5,
      ),
    );
    canvas.drawCircle(
      Offset(size.width * 0.85, size.height * 0.7),
      size.width * 0.5,
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
