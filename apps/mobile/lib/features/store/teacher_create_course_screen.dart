import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/home/home_feed.dart';

/// Teacher creates a store course — must pick one specialty + one stage.
class TeacherCreateCourseScreen extends StatefulWidget {
  const TeacherCreateCourseScreen({super.key});

  @override
  State<TeacherCreateCourseScreen> createState() => _TeacherCreateCourseScreenState();
}

class _TeacherCreateCourseScreenState extends State<TeacherCreateCourseScreen> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _priceCtrl = TextEditingController(text: '0');

  List<Map<String, dynamic>> _specialties = [];
  List<Map<String, dynamic>> _stages = [];
  String? _subjectId;
  String? _stageId;
  bool _loading = true;
  bool _saving = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _priceCtrl.dispose();
    super.dispose();
  }

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
        _specialties = ((data['specialties'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _stages = ((data['stages'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _subjectId = _specialties.length == 1 ? _specialties.first['id']?.toString() : null;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    final l10n = context.l10n;
    if (_titleCtrl.text.trim().isEmpty || _subjectId == null || _stageId == null) return;

    final price = double.tryParse(_priceCtrl.text.trim());
    if (price == null || price < 0) return;

    setState(() => _saving = true);
    try {
      await context.read<ApiClient>().post('/api/teacher/courses', {
        'titleEn': _titleCtrl.text.trim(),
        if (_descCtrl.text.trim().isNotEmpty) 'description': _descCtrl.text.trim(),
        'subjectId': _subjectId,
        'stageId': _stageId,
        'price': price,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.t('mobile.teacher.courseSubmitted'))),
      );
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (!mounted) return;
      final msg = e.message.contains('NO_SPECIALTIES') || e.message.contains('specialt')
          ? l10n.t('mobile.teacher.specialtiesRequired')
          : e.message;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.t('mobile.teacher.newCourse'))),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
          : _specialties.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      l10n.t('mobile.teacher.specialtiesRequired'),
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppTheme.muted, height: 1.5),
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    Text(
                      l10n.t('mobile.teacher.newCourseHint'),
                      style: TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.4),
                    ),
                    const SizedBox(height: 18),
                    TextField(
                      controller: _titleCtrl,
                      decoration: InputDecoration(
                        labelText: l10n.t('mobile.teacher.courseTitle'),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _descCtrl,
                      maxLines: 3,
                      decoration: InputDecoration(
                        labelText: l10n.t('mobile.teacher.courseDescription'),
                      ),
                    ),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: _subjectId,
                      decoration: InputDecoration(
                        labelText: l10n.t('mobile.teacher.courseSpecialty'),
                      ),
                      items: _specialties
                          .map(
                            (s) => DropdownMenuItem(
                              value: s['id']?.toString(),
                              child: Text(localizedText(s, locale, prefix: 'name')),
                            ),
                          )
                          .toList(),
                      onChanged: (v) => setState(() => _subjectId = v),
                    ),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: _stageId,
                      decoration: InputDecoration(
                        labelText: l10n.t('mobile.teacher.courseStage'),
                      ),
                      items: _stages
                          .map(
                            (s) => DropdownMenuItem(
                              value: s['id']?.toString(),
                              child: Text(localizedText(s, locale, prefix: 'name')),
                            ),
                          )
                          .toList(),
                      onChanged: (v) => setState(() => _stageId = v),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: _priceCtrl,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        labelText: l10n.t('mobile.teacher.coursePrice'),
                      ),
                    ),
                    const SizedBox(height: 28),
                    SizedBox(
                      height: 48,
                      child: FilledButton(
                        onPressed: _saving ||
                                _subjectId == null ||
                                _stageId == null ||
                                _titleCtrl.text.trim().isEmpty
                            ? null
                            : _submit,
                        child: _saving
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : Text(l10n.t('mobile.teacher.submitCourse')),
                      ),
                    ),
                  ],
                ),
    );
  }
}
