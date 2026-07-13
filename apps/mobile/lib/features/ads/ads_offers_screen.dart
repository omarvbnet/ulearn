import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/core/widgets/skeleton.dart';

/// Admin advertisements / offers board (opened from push & in-app notifications).
class AdsOffersScreen extends StatefulWidget {
  const AdsOffersScreen({super.key, this.highlightAdId});

  final String? highlightAdId;

  @override
  State<AdsOffersScreen> createState() => _AdsOffersScreenState();
}

class _AdsOffersScreenState extends State<AdsOffersScreen> {
  List<Map<String, dynamic>> _ads = [];
  List<Map<String, dynamic>> _notes = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final api = context.read<ApiClient>();
      final home = await api.get('/api/home');
      final notif = await api.get('/api/notifications');
      if (!mounted) return;
      final ads = ((home['ads'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final notes = ((notif['notifications'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((n) {
            final data = n['data'];
            if (data is Map) {
              final t = (data['type'] ?? data['screen'] ?? '')
                  .toString()
                  .toLowerCase();
              return t == 'admin' ||
                  t == 'ads' ||
                  t == 'offer' ||
                  t == 'offers' ||
                  t == 'advertisement';
            }
            return n['notificationId'] != null;
          })
          .toList();
      setState(() {
        _ads = ads;
        _notes = notes;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openLink(String? url) async {
    if (url == null || url.isEmpty) return;
    if (!mounted) return;
    await Clipboard.setData(ClipboardData(text: url));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(url)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: GlassAppBar(
        title: Text(l10n.t('mobile.adsOffers.title')),
      ),
      body: _loading
          ? SkeletonList(
              count: 5,
              itemBuilder: (_) => const SkeletonListTile(hasTrailing: false),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                children: [
                  Text(
                    l10n.t('mobile.adsOffers.offersHeading'),
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 16,
                      color: AppTheme.foreground,
                    ),
                  ),
                  const SizedBox(height: 10),
                  if (_ads.isEmpty)
                    Text(
                      l10n.t('mobile.adsOffers.emptyAds'),
                      style: TextStyle(color: AppTheme.muted),
                    )
                  else
                    ..._ads.map((ad) {
                      final id = ad['id']?.toString();
                      final highlight = widget.highlightAdId != null &&
                          widget.highlightAdId == id;
                      final image = ad['imageUrl']?.toString();
                      final title = ad['titleEn']?.toString() ??
                          ad['titleAr']?.toString() ??
                          l10n.t('mobile.adsOffers.offer');
                      return Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(
                            color: highlight
                                ? AppTheme.accent
                                : AppTheme.cardBorder,
                            width: highlight ? 2 : 1,
                          ),
                          color: AppTheme.card,
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: () => _openLink(ad['linkUrl']?.toString()),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              if (image != null && image.isNotEmpty)
                                AspectRatio(
                                  aspectRatio: 16 / 9,
                                  child: Image.network(
                                    image,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) => Container(
                                      color: AppTheme.primary
                                          .withValues(alpha: 0.15),
                                      child: const Icon(Icons.campaign_rounded),
                                    ),
                                  ),
                                ),
                              Padding(
                                padding: const EdgeInsets.all(14),
                                child: Text(
                                  title,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 15,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                  const SizedBox(height: 18),
                  Text(
                    l10n.t('mobile.adsOffers.adminNotes'),
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 16,
                      color: AppTheme.foreground,
                    ),
                  ),
                  const SizedBox(height: 10),
                  if (_notes.isEmpty)
                    Text(
                      l10n.t('mobile.adsOffers.emptyNotes'),
                      style: TextStyle(color: AppTheme.muted),
                    )
                  else
                    ..._notes.map((n) {
                      return Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: ListTile(
                          leading: Icon(
                            Icons.campaign_outlined,
                            color: AppTheme.primary,
                          ),
                          title: Text(
                            n['title']?.toString() ?? '',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(n['body']?.toString() ?? ''),
                        ),
                      );
                    }),
                ],
              ),
            ),
    );
  }
}
