import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/core/widgets/skeleton.dart';

/// Multi-select Professional Certificate insights (areas of interest).
/// Saved insights drive home/store course filters and AI materials.
class CertificateInsightsScreen extends StatefulWidget {
  const CertificateInsightsScreen({super.key});

  @override
  State<CertificateInsightsScreen> createState() =>
      _CertificateInsightsScreenState();
}

class _CertificateInsightsScreenState extends State<CertificateInsightsScreen> {
  static const _maxInsights = 5;

  List<Map<String, dynamic>> _options = [];
  final Set<String> _selected = {};
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  Future<void> _bootstrap() async {
    final auth = context.read<AuthProvider>();
    _selected
      ..clear()
      ..addAll(auth.user?.interestSubjects.map((i) => i.id) ?? const []);
    try {
      final api = context.read<ApiClient>();
      final data = await api.get('/api/certificate-interests');
      final list = ((data['interests'] as List?) ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      if (!mounted) return;
      setState(() {
        _options = list;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException
            ? e.message
            : context.l10n.t('mobile.profile.insightsLoadFailed');
      });
    }
  }

  String _nameFor(Map<String, dynamic> row) {
    final locale = context.read<LocaleProvider>().code.toUpperCase();
    final en = row['nameEn']?.toString() ?? '';
    final localized = switch (locale) {
      'AR' => row['nameAr']?.toString(),
      'KU' => row['nameKu']?.toString(),
      'TR' => row['nameTr']?.toString(),
      _ => en,
    };
    final name = (localized ?? '').trim();
    return name.isNotEmpty ? name : (en.isNotEmpty ? en : 'Insight');
  }

  void _toggle(String id, bool on) {
    setState(() {
      if (on) {
        if (_selected.length >= _maxInsights) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(context.l10n.t('mobile.profile.insightsMax')),
            ),
          );
          return;
        }
        _selected.add(id);
      } else {
        _selected.remove(id);
      }
      _error = null;
    });
  }

  Future<void> _save() async {
    if (_selected.isEmpty) {
      setState(() => _error = context.l10n.t('mobile.profile.insightsMin'));
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      await api.patch('/api/profile/certificate-interests', {
        'interestSubjectIds': _selected.toList(),
      });
      if (!mounted) return;
      await context.read<AuthProvider>().refreshUser();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.profile.insightsSaved'))),
      );
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e is ApiException
            ? e.message
            : context.l10n.t('mobile.profile.insightsSaveFailed');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: GlassAppBar(title: Text(l10n.t('mobile.profile.insightsTitle'))),
      body: _loading
          ? Skeleton(
              child: ListView(
                physics: const NeverScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                children: const [
                  SkeletonBox(height: 48, radius: 12),
                  SizedBox(height: 16),
                  SkeletonBox(height: 120, radius: 16),
                  SizedBox(height: 16),
                  SkeletonBox(height: 48, radius: 12),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                StaggeredItem(
                  index: 0,
                  child: Text(
                    l10n.t('mobile.profile.insightsHint'),
                    style: TextStyle(color: AppTheme.muted, height: 1.35),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  l10n.t('mobile.profile.insightsCount', {
                    'count': '${_selected.length}',
                    'max': '$_maxInsights',
                  }),
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: AppTheme.accent,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 16),
                if (_options.isEmpty)
                  Text(
                    l10n.t('mobile.profile.insightsEmptyCatalog'),
                    style: TextStyle(color: AppTheme.muted),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final option in _options)
                        FilterChip(
                          label: Text(_nameFor(option)),
                          selected:
                              _selected.contains(option['id']?.toString()),
                          onSelected: (on) {
                            final id = option['id']?.toString();
                            if (id == null || id.isEmpty) return;
                            _toggle(id, on);
                          },
                          selectedColor:
                              AppTheme.accent.withValues(alpha: 0.22),
                          checkmarkColor: AppTheme.accent,
                        ),
                    ],
                  ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style: const TextStyle(color: Colors.redAccent),
                  ),
                ],
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: _saving || _loading ? null : _save,
                  child: Text(
                    _saving
                        ? l10n.t('quiz.submitting')
                        : l10n.t('mobile.profile.insightsSave'),
                  ),
                ),
              ],
            ),
    );
  }
}
