import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/core/widgets/glass.dart';

class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.productId});

  final String productId;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Map<String, dynamic>? _product;
  bool _busy = false;
  int _quantity = 1;
  final _notesCtrl = TextEditingController();
  int _imageIndex = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _notesCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/store/products/${widget.productId}');
      if (!mounted) return;
      setState(() => _product = data['product'] as Map<String, dynamic>?);
    } catch (_) {
      if (mounted) setState(() => _product = {});
    }
  }

  Future<void> _requestOrder() async {
    if (!await requireAuth(context)) return;
    if (!mounted) return;
    final p = _product;
    if (p == null || p.isEmpty) return;
    final status = p['purchaseStatus']?.toString();
    if (status == 'PENDING' || status == 'PAID') return;

    setState(() => _busy = true);
    try {
      await context.read<ApiClient>().post(
        '/api/store/products/${widget.productId}/purchase',
        {'quantity': _quantity, 'notes': _notesCtrl.text.trim()},
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.products.orderRequested'))),
      );
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      final msg = switch (e.message) {
        'ALREADY_REQUESTED' => context.l10n.t('mobile.products.alreadyRequested'),
        'OUT_OF_STOCK' => context.l10n.t('mobile.products.outOfStock'),
        _ => context.l10n.t('mobile.error.generic'),
      };
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _categoryLabel(String cat, dynamic l10n) {
    return switch (cat) {
      'PINS' => l10n.t('mobile.products.catPins'),
      'BOOKS' => l10n.t('mobile.products.catBooks'),
      'BOARDS' => l10n.t('mobile.products.catBoards'),
      'SUPPLIES' => l10n.t('mobile.products.catSupplies'),
      'STATIONERY' => l10n.t('mobile.products.catStationery'),
      _ => l10n.t('mobile.products.catOther'),
    };
  }

  List<String> _allImages(Map<String, dynamic> p) {
    final main = p['imageUrl']?.toString();
    final extra = (p['images'] as List<dynamic>?)?.map((e) => e.toString()).where((u) => u.isNotEmpty).toList() ?? [];
    final all = <String>[];
    if (main != null && main.isNotEmpty) all.add(main);
    for (final u in extra) {
      if (!all.contains(u)) all.add(u);
    }
    return all;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final p = _product;

    if (p == null) {
      return Scaffold(
        appBar: GlassAppBar(title: Text(l10n.t('mobile.products.title'))),
        body: SkeletonList(itemBuilder: (_) => const SkeletonTextCard()),
      );
    }
    if (p.isEmpty) {
      return Scaffold(
        appBar: GlassAppBar(title: Text(l10n.t('mobile.products.title'))),
        body: Center(child: Text(l10n.t('mobile.error.generic'), style: TextStyle(color: AppTheme.muted))),
      );
    }

    final name = p['name']?.toString() ?? '';
    final description = p['description']?.toString() ?? '';
    final price = (p['price'] as num?)?.toDouble() ?? 0;
    final currency = p['currency']?.toString() ?? 'IQD';
    final category = p['category']?.toString() ?? '';
    final stock = p['stock'] as num?;
    final status = p['purchaseStatus']?.toString();
    final images = _allImages(p);
    final total = price * _quantity;
    final canOrder = status != 'PENDING' && status != 'PAID' && (stock == null || stock >= _quantity);

    return Scaffold(
      appBar: GlassAppBar(title: Text(l10n.t('mobile.products.title'))),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 100),
        children: [
          if (images.isNotEmpty)
            AspectRatio(
              aspectRatio: 1,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  CachedImage(url: images[_imageIndex.clamp(0, images.length - 1)], fit: BoxFit.cover),
                  if (images.length > 1)
                    Positioned(
                      bottom: 12,
                      left: 0,
                      right: 0,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(
                          images.length,
                          (i) => GestureDetector(
                            onTap: () => setState(() => _imageIndex = i),
                            child: Container(
                              width: 8,
                              height: 8,
                              margin: const EdgeInsets.symmetric(horizontal: 4),
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: i == _imageIndex ? AppTheme.accent : Colors.white54,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _categoryLabel(category, l10n),
                  style: TextStyle(color: AppTheme.accent, fontWeight: FontWeight.w600, fontSize: 12),
                ),
                const SizedBox(height: 6),
                Text(name, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text(
                  '${price.toStringAsFixed(0)} $currency',
                  style: const TextStyle(color: AppTheme.accent, fontSize: 22, fontWeight: FontWeight.w800),
                ),
                if (stock != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    l10n.t('mobile.products.inStock', {'count': stock.toInt().toString()}),
                    style: TextStyle(color: AppTheme.muted, fontSize: 13),
                  ),
                ],
                if (status == 'PENDING') ...[
                  const SizedBox(height: 12),
                  _StatusBanner(
                    color: Colors.orange,
                    text: l10n.t('mobile.products.pendingDetail'),
                    icon: Icons.hourglass_top_rounded,
                  ),
                ],
                if (status == 'PAID') ...[
                  const SizedBox(height: 12),
                  _StatusBanner(
                    color: Colors.green,
                    text: l10n.t('mobile.products.orderedDetail'),
                    icon: Icons.check_circle_outline,
                  ),
                ],
                const SizedBox(height: 16),
                Text(
                  description.isNotEmpty ? description : l10n.t('mobile.store.noDescription'),
                  style: TextStyle(height: 1.5, color: AppTheme.foreground),
                ),
                const SizedBox(height: 24),
                Text(l10n.t('mobile.products.quantity'), style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    IconButton(
                      onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null,
                      icon: const Icon(Icons.remove_circle_outline),
                    ),
                    Text('$_quantity', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                    IconButton(
                      onPressed: stock != null && _quantity >= stock.toInt()
                          ? null
                          : () => setState(() => _quantity++),
                      icon: const Icon(Icons.add_circle_outline),
                    ),
                    const Spacer(),
                    Text(
                      '${l10n.t('mobile.products.total')}: ${total.toStringAsFixed(0)} $currency',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _notesCtrl,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: InputDecoration(
                    labelText: l10n.t('mobile.products.deliveryNotes'),
                    hintText: l10n.t('mobile.products.deliveryNotesHint'),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: FilledButton(
            onPressed: canOrder && !_busy ? _requestOrder : null,
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.accent,
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            child: _busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Text(
                    status == 'PENDING'
                        ? l10n.t('mobile.products.pending')
                        : status == 'PAID'
                            ? l10n.t('mobile.products.ordered')
                            : l10n.t('mobile.products.requestOrder'),
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                  ),
          ),
        ),
      ),
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.color, required this.text, required this.icon});

  final Color color;
  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}
