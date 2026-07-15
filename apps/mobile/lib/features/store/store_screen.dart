import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/product_detail_screen.dart';

/// Physical product store — pins, books, boards, and supplies.
/// Students request orders; admin confirms payment offline.
class StoreScreen extends StatefulWidget {
  const StoreScreen({super.key});

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  List<dynamic>? _products;
  List<String> _categories = [];
  String? _selectedCategory;
  String _sort = 'newest';
  String? _priceFilter;
  final _searchCtrl = TextEditingController();
  String _query = '';
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _searchCtrl.addListener(_onSearchChanged);
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      setState(() => _query = _searchCtrl.text.trim());
      _load();
    });
  }

  Future<void> _load() async {
    try {
      final params = <String, String>{'sort': _sort};
      if (_selectedCategory != null) params['category'] = _selectedCategory!;
      if (_query.isNotEmpty) params['q'] = _query;
      final price = _priceFilter;
      if (price == 'under10') {
        params['maxPrice'] = '10000';
      } else if (price == '10to25') {
        params['minPrice'] = '10000';
        params['maxPrice'] = '25000';
      } else if (price == 'over25') {
        params['minPrice'] = '25000';
      }
      final qs = params.entries.map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}').join('&');
      final data = await context.read<ApiClient>().get('/api/store/products?$qs');
      if (!mounted) return;
      setState(() {
        _products = data['products'] as List<dynamic>? ?? [];
        _categories = ((data['categories'] as List<dynamic>?) ?? [])
            .map((c) => c.toString())
            .toList();
      });
    } catch (_) {
      if (mounted) setState(() => _products = []);
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

  String _formatPrice(num price, String currency) {
    if (price >= 1000) return '${(price / 1000).toStringAsFixed(price % 1000 == 0 ? 0 : 1)}K $currency';
    return '${price.toStringAsFixed(0)} $currency';
  }

  Widget _statusChip(String? status, dynamic l10n) {
    if (status == null) return const SizedBox.shrink();
    final (label, color) = switch (status) {
      'PAID' => (l10n.t('mobile.products.ordered'), Colors.green),
      'PENDING' => (l10n.t('mobile.products.pending'), Colors.orange),
      _ => (status, AppTheme.muted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w600)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.localeCode;
    final l10n = context.l10n;
    final products = _products;

    if (products == null) {
      return SkeletonList(itemBuilder: (_) => const SkeletonTextCard());
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: TextField(
            controller: _searchCtrl,
            decoration: InputDecoration(
              hintText: l10n.t('mobile.products.searchHint'),
              prefixIcon: Icon(Icons.search, color: AppTheme.muted),
              suffixIcon: _query.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.close, size: 20),
                      onPressed: () {
                        _searchCtrl.clear();
                        setState(() => _query = '');
                        _load();
                      },
                    )
                  : null,
              filled: true,
              fillColor: AppTheme.card,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            ),
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 38,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children: [
              _FilterChip(
                label: l10n.t('mobile.products.all'),
                selected: _selectedCategory == null,
                onTap: () {
                  setState(() => _selectedCategory = null);
                  _load();
                },
              ),
              ..._categories.map(
                (c) => _FilterChip(
                  label: _categoryLabel(c, l10n),
                  selected: _selectedCategory == c,
                  onTap: () {
                    setState(() => _selectedCategory = c);
                    _load();
                  },
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _sort,
                  decoration: InputDecoration(
                    labelText: l10n.t('mobile.products.sort'),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  items: [
                    DropdownMenuItem(value: 'newest', child: Text(l10n.t('mobile.products.sortNewest'))),
                    DropdownMenuItem(value: 'popular', child: Text(l10n.t('mobile.products.sortPopular'))),
                    DropdownMenuItem(value: 'price_asc', child: Text(l10n.t('mobile.products.sortPriceLow'))),
                    DropdownMenuItem(value: 'price_desc', child: Text(l10n.t('mobile.products.sortPriceHigh'))),
                  ],
                  onChanged: (v) {
                    if (v == null) return;
                    setState(() => _sort = v);
                    _load();
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<String?>(
                  initialValue: _priceFilter,
                  decoration: InputDecoration(
                    labelText: l10n.t('mobile.products.price'),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  items: [
                    DropdownMenuItem(value: null, child: Text(l10n.t('mobile.products.all'))),
                    DropdownMenuItem(value: 'under10', child: Text(l10n.t('mobile.products.priceUnder10'))),
                    DropdownMenuItem(value: '10to25', child: Text(l10n.t('mobile.products.price10to25'))),
                    DropdownMenuItem(value: 'over25', child: Text(l10n.t('mobile.products.priceOver25'))),
                  ],
                  onChanged: (v) {
                    setState(() => _priceFilter = v);
                    _load();
                  },
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: products.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      l10n.t('mobile.products.empty'),
                      style: TextStyle(color: AppTheme.muted),
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: GridView.builder(
                    padding: const EdgeInsets.all(16),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 0.72,
                    ),
                    itemCount: products.length,
                    itemBuilder: (context, i) {
                      final p = products[i] as Map<String, dynamic>;
                      final name = p['name']?.toString() ?? localizedText(p, locale, prefix: 'name');
                      final image = p['imageUrl']?.toString();
                      final price = (p['price'] as num?)?.toDouble() ?? 0;
                      final currency = p['currency']?.toString() ?? 'IQD';
                      final category = p['category']?.toString() ?? '';
                      final status = p['purchaseStatus']?.toString();

                      return GestureDetector(
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => ProductDetailScreen(productId: p['id'].toString()),
                          ),
                        ),
                        child: Card(
                          clipBehavior: Clip.antiAlias,
                          color: AppTheme.card,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Expanded(
                                child: image != null && image.isNotEmpty
                                    ? CachedImage(
                                        url: image,
                                        fit: BoxFit.cover,
                                        width: double.infinity,
                                        height: double.infinity,
                                      )
                                    : Container(
                                        color: AppTheme.primary.withValues(alpha: 0.1),
                                        child: Icon(Icons.shopping_bag_outlined, size: 40, color: AppTheme.muted),
                                      ),
                              ),
                              Padding(
                                padding: const EdgeInsets.all(10),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _categoryLabel(category, l10n),
                                      style: TextStyle(
                                        color: AppTheme.accent.withValues(alpha: 0.9),
                                        fontSize: 10,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      name,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                    ),
                                    const SizedBox(height: 6),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            _formatPrice(price, currency),
                                            style: const TextStyle(
                                              color: AppTheme.accent,
                                              fontWeight: FontWeight.w700,
                                              fontSize: 13,
                                            ),
                                          ),
                                        ),
                                        _statusChip(status, l10n),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: FilterChip(
        label: Text(label, style: TextStyle(fontSize: 12, color: selected ? Colors.white : AppTheme.foreground)),
        selected: selected,
        onSelected: (_) => onTap(),
        selectedColor: AppTheme.accent,
        backgroundColor: AppTheme.card,
        checkmarkColor: Colors.white,
        side: BorderSide(color: selected ? AppTheme.accent : AppTheme.muted.withValues(alpha: 0.3)),
        padding: const EdgeInsets.symmetric(horizontal: 4),
      ),
    );
  }
}
