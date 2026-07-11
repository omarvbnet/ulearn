import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/home/home_feed.dart';

/// Teacher profile: pick up to 3 teaching specialties (subjects).
class TeacherSpecialtiesSection extends StatefulWidget {
  const TeacherSpecialtiesSection({super.key});

  @override
  State<TeacherSpecialtiesSection> createState() => _TeacherSpecialtiesSectionState();
}

class _TeacherSpecialtiesSectionState extends State<TeacherSpecialtiesSection> {
  List<Map<String, dynamic>> _selected = [];
  List<Map<String, dynamic>> _available = [];
  int _max = 3;
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/profile/teacher');
      if (!mounted) return;
      setState(() {
        _selected = ((data['specialties'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _available = ((data['available'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _max = (data['maxSpecialties'] as num?)?.toInt() ?? 3;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openPicker() async {
    final locale = context.localeCode;
    final l10n = context.l10n;
    final draft = _selected.map((s) => s['id'].toString()).toSet();

    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return SafeArea(
              child: Padding(
                padding: EdgeInsets.only(
                  left: 20,
                  right: 20,
                  top: 16,
                  bottom: MediaQuery.paddingOf(context).bottom + 16,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.t('mobile.teacher.specialtiesTitle'),
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      l10n.t('mobile.teacher.specialtiesHint', {'max': '$_max'}),
                      style: TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.4),
                    ),
                    const SizedBox(height: 16),
                    Flexible(
                      child: SingleChildScrollView(
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: _available.map((item) {
                            final id = item['id'].toString();
                            final active = draft.contains(id);
                            final atMax = draft.length >= _max && !active;
                            return FilterChip(
                              label: Text(localizedText(item, locale, prefix: 'name')),
                              selected: active,
                              onSelected: atMax && !active
                                  ? null
                                  : (_) {
                                      setSheetState(() {
                                        if (active) {
                                          draft.remove(id);
                                        } else {
                                          draft.add(id);
                                        }
                                      });
                                    },
                            );
                          }).toList(),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      l10n.t('mobile.teacher.specialtiesSelected', {
                        'count': '${draft.length}',
                        'max': '$_max',
                      }),
                      style: TextStyle(color: AppTheme.muted, fontSize: 12),
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: draft.isEmpty ? null : () => Navigator.pop(ctx, true),
                      child: Text(l10n.t('common.save')),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );

    if (saved != true || !mounted) return;

    setState(() => _saving = true);
    try {
      final data = await context.read<ApiClient>().patch('/api/profile/teacher', {
        'subjectIds': draft.toList(),
      });
      if (!mounted) return;
      setState(() {
        _selected = ((data['specialties'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.t('mobile.teacher.specialtiesSaved'))),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.menu_book_outlined, color: AppTheme.accent, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.t('mobile.teacher.specialtiesTitle'),
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                  ),
                ),
                if (_saving)
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent),
                  )
                else
                  TextButton(
                    onPressed: _loading ? null : _openPicker,
                    child: Text(
                      _selected.isEmpty
                          ? l10n.t('mobile.teacher.specialtiesChoose')
                          : l10n.t('common.edit'),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              l10n.t('mobile.teacher.specialtiesHint', {'max': '$_max'}),
              style: TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.35),
            ),
            const SizedBox(height: 12),
            if (_loading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(12),
                  child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent),
                ),
              )
            else if (_selected.isEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.orangeAccent.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.orangeAccent.withValues(alpha: 0.35)),
                ),
                child: Text(
                  l10n.t('mobile.teacher.specialtiesRequired'),
                  style: const TextStyle(color: Colors.orangeAccent, fontSize: 13),
                ),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _selected.map((s) {
                  return Chip(
                    label: Text(localizedText(s, locale, prefix: 'name')),
                    backgroundColor: AppTheme.primary.withValues(alpha: 0.18),
                    side: BorderSide(color: AppTheme.accent.withValues(alpha: 0.35)),
                  );
                }).toList(),
              ),
          ],
        ),
      ),
    );
  }
}
