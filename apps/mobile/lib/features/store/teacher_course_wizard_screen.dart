import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/media/video_cover_helper.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/video_process_service.dart';
import 'package:ulearn/core/video/video_upload_service.dart';
import 'package:ulearn/features/home/home_feed.dart';

/// 5-step course creation wizard: basics → free videos → quizzes → document → submit.
class TeacherCourseWizardScreen extends StatefulWidget {
  const TeacherCourseWizardScreen({super.key, this.courseId, this.initialStep = 0});

  final String? courseId;
  final int initialStep;

  @override
  State<TeacherCourseWizardScreen> createState() => _TeacherCourseWizardScreenState();
}

class _TeacherCourseWizardScreenState extends State<TeacherCourseWizardScreen> {
  static const _steps = [
    'Basics',
    'Free videos',
    'Quizzes',
    'Document',
    'Submit',
  ];

  late int _step;
  String? _courseId;
  bool _loading = true;
  bool _busy = false;
  String? _busyLabel;

  // Step 1
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _priceCtrl = TextEditingController(text: '0');
  List<Map<String, dynamic>> _specialties = [];
  List<Map<String, dynamic>> _stages = [];
  String? _subjectId;
  String? _stageId;
  File? _coverFile;
  String? _coverUrl;

  // Course payload
  Map<String, dynamic>? _course;
  Map<String, dynamic>? _readiness;

  // Step 3 quiz draft
  final _quizTitleCtrl = TextEditingController();
  final List<_WizardQuizQ> _quizQs = [_WizardQuizQ()];

  @override
  void initState() {
    super.initState();
    _step = widget.initialStep.clamp(0, _steps.length - 1);
    _courseId = widget.courseId;
    _bootstrap();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _priceCtrl.dispose();
    _quizTitleCtrl.dispose();
    for (final q in _quizQs) {
      q.dispose();
    }
    super.dispose();
  }

  Future<void> _bootstrap() async {
    try {
      final api = context.read<ApiClient>();
      final profile = await api.get('/api/profile/teacher');
      if (!mounted) return;
      _specialties = ((profile['specialties'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();
      _stages =
          ((profile['stages'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      _subjectId =
          _specialties.length == 1 ? _specialties.first['id']?.toString() : null;

      if (_courseId != null) {
        await _reloadCourse();
        final r = await api.get('/api/teacher/courses/$_courseId/readiness');
        _readiness = r['readiness'] as Map<String, dynamic>?;
        _step = _suggestedStep(_readiness);
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  int _suggestedStep(Map<String, dynamic>? r) {
    if (r == null) return 0;
    if (r['hasTitle'] != true || r['hasCover'] != true) return 0;
    if (r['hasInterview'] != true || ((r['freeVideos'] as num?) ?? 0) < 2) return 1;
    if (((r['quizzes'] as num?) ?? 0) < 2) return 2;
    if (((r['documents'] as num?) ?? 0) < 1) return 3;
    return 4;
  }

  Future<void> _reloadCourse() async {
    if (_courseId == null) return;
    final data = await context.read<ApiClient>().get('/api/teacher/courses/$_courseId');
    final course = data['course'] as Map<String, dynamic>;
    _course = course;
    _titleCtrl.text = course['titleEn']?.toString() ?? '';
    _descCtrl.text = course['description']?.toString() ?? '';
    _priceCtrl.text = (course['price'] as num?)?.toString() ?? '0';
    _subjectId = course['subjectId']?.toString() ?? _subjectId;
    _stageId = course['stageId']?.toString() ?? _stageId;
    _coverUrl = course['thumbnail']?.toString();
  }

  Future<void> _refreshReadiness() async {
    if (_courseId == null) return;
    final r = await context.read<ApiClient>().get('/api/teacher/courses/$_courseId/readiness');
    if (!mounted) return;
    setState(() => _readiness = r['readiness'] as Map<String, dynamic>?);
  }

  List<Map<String, dynamic>> get _lessons =>
      ((_course?['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> get _quizzes =>
      ((_course?['quizzes'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> get _materials {
    final fromCourse = ((_course?['materials'] as List<dynamic>?) ?? [])
        .cast<Map<String, dynamic>>();
    if (fromCourse.isNotEmpty) return fromCourse;
    final nested = <Map<String, dynamic>>[];
    for (final l in _lessons) {
      nested.addAll(((l['materials'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>());
    }
    return nested;
  }

  int get _freeCount =>
      _lessons.where((l) => l['isFreePreview'] == true && l['deletedAt'] == null).length;

  bool get _hasInterview => _lessons.any((l) => l['isInterview'] == true);

  Future<void> _saveBasicsAndNext() async {
    if (_titleCtrl.text.trim().isEmpty || _subjectId == null || _stageId == null) {
      _toast('Fill title, subject, and stage');
      return;
    }
    final price = double.tryParse(_priceCtrl.text.trim());
    if (price == null || price < 0) {
      _toast('Enter a valid price');
      return;
    }

    setState(() {
      _busy = true;
      _busyLabel = 'Saving course…';
    });
    try {
      final api = context.read<ApiClient>();
      String? thumbnail = _coverUrl;

      if (_coverFile != null) {
        setState(() => _busyLabel = 'Uploading cover…');
        final size = await _coverFile!.length();
        final ext = _coverFile!.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
        final presign = await api.post('/api/admin/uploads', {
          'filename': 'cover_${DateTime.now().millisecondsSinceEpoch}.$ext',
          'contentType': ext == 'png' ? 'image/png' : 'image/jpeg',
          'size': size,
          'category': 'image',
          'folder': 'teacher-covers',
        });
        final uploadUrl = presign['uploadUrl']?.toString();
        final publicUrl = presign['publicUrl']?.toString();
        if (uploadUrl == null) throw Exception('Cover upload failed');
        await api.putFile(
          uploadUrl,
          _coverFile!,
          ext == 'png' ? 'image/png' : 'image/jpeg',
        );
        thumbnail = publicUrl;
      }

      if (thumbnail == null || thumbnail.isEmpty) {
        _toast('Add a course cover image');
        return;
      }

      if (_courseId == null) {
        final created = await api.post('/api/teacher/courses', {
          'titleEn': _titleCtrl.text.trim(),
          if (_descCtrl.text.trim().isNotEmpty) 'description': _descCtrl.text.trim(),
          'subjectId': _subjectId,
          'stageId': _stageId,
          'price': price,
          'thumbnail': thumbnail,
        });
        _courseId = (created['course'] as Map?)?['id']?.toString() ??
            created['id']?.toString();
      } else {
        await api.patch('/api/teacher/courses/$_courseId', {
          'titleEn': _titleCtrl.text.trim(),
          'description': _descCtrl.text.trim(),
          'subjectId': _subjectId,
          'stageId': _stageId,
          'price': price,
          'thumbnail': thumbnail,
        });
      }

      await _reloadCourse();
      await _refreshReadiness();
      if (!mounted) return;
      setState(() => _step = 1);
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
        });
      }
    }
  }

  Future<void> _uploadFreeVideo({required bool interview}) async {
    if (_courseId == null) return;
    if (!interview && !_hasInterview) {
      _toast('Upload the interview video first');
      return;
    }
    if (_freeCount >= 2) {
      _toast('Maximum 2 free preview videos');
      return;
    }

    final pick = await FilePicker.pickFiles(type: FileType.video);
    if (pick == null || pick.files.isEmpty || pick.files.first.path == null) return;
    final source = File(pick.files.first.path!);

    final titleCtrl = TextEditingController(
      text: interview ? 'Interview / Intro' : 'Free sample',
    );
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(interview ? 'Interview video' : 'Free sample video'),
        content: TextField(
          controller: titleCtrl,
          decoration: const InputDecoration(labelText: 'Video title'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(context.l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(ctx, titleCtrl.text.trim()),
            child: const Text('Upload'),
          ),
        ],
      ),
    );
    if (title == null || title.isEmpty || !mounted) return;

    setState(() {
      _busy = true;
      _busyLabel = 'Processing video…';
    });
    try {
      final api = context.read<ApiClient>();
      final upload = VideoUploadService(api);
      final wm = await upload.fetchWatermarkConfig(courseName: _titleCtrl.text.trim());
      final processed = await VideoProcessService.processForUpload(
        source: source,
        watermark: wm,
        onProgress: (p) {
          if (!mounted) return;
          setState(() => _busyLabel = 'Processing ${(p * 100).round()}%');
        },
      );

      setState(() => _busyLabel = 'Uploading…');
      final duration = await VideoCoverHelper.videoDurationSec(processed.file.path);
      final result = await upload.uploadCourseVideo(
        file: processed.file,
        courseId: _courseId!,
        scope: 'STORE_COURSE',
        durationSec: duration,
        onProgress: (sent, total) {
          if (!mounted || total <= 0) return;
          setState(() => _busyLabel = 'Uploading ${(sent * 100 / total).round()}%');
        },
      );

      await api.post('/api/teacher/courses/$_courseId/lessons', {
        'title': title,
        'fileKey': result.objectKey,
        'videoAssetId': result.videoId,
        'durationSec': duration,
        'isFreePreview': true,
        'isInterview': interview,
      });

      await _reloadCourse();
      await _refreshReadiness();
      if (mounted) setState(() {});
      _toast(interview ? 'Interview video added' : 'Free sample added');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
        });
      }
    }
  }

  Future<void> _saveQuiz() async {
    if (_courseId == null) return;
    final questions = _quizQs.map((q) => q.toPayload()).whereType<Map<String, dynamic>>().toList();
    if (_quizTitleCtrl.text.trim().isEmpty || questions.isEmpty) {
      _toast('Add quiz title and at least one valid question');
      return;
    }
    setState(() => _busy = true);
    try {
      await context.read<ApiClient>().post('/api/teacher/courses/$_courseId/quizzes', {
        'titleEn': _quizTitleCtrl.text.trim(),
        'questions': questions,
      });
      _quizTitleCtrl.clear();
      for (final q in _quizQs) {
        q.dispose();
      }
      _quizQs
        ..clear()
        ..add(_WizardQuizQ());
      await _reloadCourse();
      await _refreshReadiness();
      if (mounted) setState(() {});
      _toast('Quiz saved');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _uploadDocument() async {
    if (_courseId == null) return;
    final pick = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
    );
    if (pick == null || pick.files.isEmpty || pick.files.first.path == null) return;
    final file = File(pick.files.first.path!);
    final name = pick.files.first.name;

    setState(() {
      _busy = true;
      _busyLabel = 'Uploading document…';
    });
    try {
      final api = context.read<ApiClient>();
      final size = await file.length();
      final presign = await api.post('/api/admin/uploads', {
        'filename': name.endsWith('.pdf') ? name : '$name.pdf',
        'contentType': 'application/pdf',
        'size': size,
        'category': 'document',
        'folder': 'teacher-course-pdfs',
      });
      final uploadUrl = presign['uploadUrl']?.toString();
      final key = presign['key']?.toString();
      final publicUrl = presign['publicUrl']?.toString();
      if (uploadUrl == null || key == null) throw Exception('Upload failed');
      await api.putFile(uploadUrl, file, 'application/pdf');
      await api.post('/api/teacher/courses/$_courseId/documents', {
        'title': name.replaceAll(RegExp(r'\.pdf$', caseSensitive: false), ''),
        'fileKey': key,
        if (publicUrl != null) 'fileUrl': publicUrl,
        'mimeType': 'application/pdf',
        'fileSize': size,
        'type': 'PDF',
      });
      await _reloadCourse();
      await _refreshReadiness();
      // documents may not be on course GET — fetch separately
      try {
        final docs = await api.get('/api/teacher/courses/$_courseId/documents');
        _course = {
          ...?_course,
          'materials': docs['documents'],
        };
      } catch (_) {}
      if (mounted) setState(() {});
      _toast('Document uploaded');
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
        });
      }
    }
  }

  Future<void> _submitForReview() async {
    if (_courseId == null) return;
    setState(() => _busy = true);
    try {
      await _refreshReadiness();
      if (_readiness?['ready'] != true) {
        final missing = ((_readiness?['missing'] as List?) ?? []).join(', ');
        _toast(missing.isEmpty ? 'Course is not ready' : 'Missing: $missing');
        return;
      }
      await context.read<ApiClient>().post('/api/teacher/courses/$_courseId/submit', {});
      if (!mounted) return;
      _toast('Submitted for review');
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  bool _canGoNext() {
    switch (_step) {
      case 0:
        return _titleCtrl.text.trim().isNotEmpty &&
            _subjectId != null &&
            _stageId != null &&
            (_coverFile != null || (_coverUrl != null && _coverUrl!.isNotEmpty));
      case 1:
        return _hasInterview && _freeCount >= 2;
      case 2:
        return _quizzes.length >= 2;
      case 3:
        return _materials.isNotEmpty || ((_readiness?['documents'] as num?) ?? 0) >= 1;
      default:
        return _readiness?['ready'] == true;
    }
  }

  Future<void> _next() async {
    if (_step == 0) {
      await _saveBasicsAndNext();
      return;
    }
    if (_step < 4) {
      await _refreshReadiness();
      if (!_canGoNext()) {
        _toast('Complete this step before continuing');
        return;
      }
      setState(() => _step++);
      return;
    }
    await _submitForReview();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.t('mobile.teacher.newCourse')),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(72),
          child: _StepHeader(steps: _steps, current: _step),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
          : _specialties.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      l10n.t('mobile.teacher.specialtiesRequired'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppTheme.muted, height: 1.5),
                    ),
                  ),
                )
              : Stack(
                  children: [
                    ListView(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 120),
                      children: [
                        if (_step == 0) _buildBasics(locale),
                        if (_step == 1) _buildVideos(),
                        if (_step == 2) _buildQuizzes(),
                        if (_step == 3) _buildDocument(),
                        if (_step == 4) _buildSubmit(),
                      ],
                    ),
                    if (_busy)
                      Positioned.fill(
                        child: ColoredBox(
                          color: Colors.black54,
                          child: Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const CircularProgressIndicator(color: AppTheme.accent),
                                if (_busyLabel != null) ...[
                                  const SizedBox(height: 12),
                                  Text(_busyLabel!, style: const TextStyle(color: Colors.white)),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
      bottomNavigationBar: _specialties.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: Row(
                  children: [
                    if (_step > 0)
                      OutlinedButton(
                        onPressed: _busy ? null : () => setState(() => _step--),
                        child: const Text('Back'),
                      ),
                    const Spacer(),
                    FilledButton(
                      onPressed: _busy ? null : _next,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppTheme.accent,
                        foregroundColor: Colors.black,
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                      ),
                      child: Text(_step == 4 ? 'Submit for review' : 'Continue'),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildBasics(String locale) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Course name & cover',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        const Text(
          'Start with a clear title and an eye-catching cover students will see in the store.',
          style: TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 18),
        TextField(
          controller: _titleCtrl,
          decoration: const InputDecoration(labelText: 'Course title'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _descCtrl,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Description (optional)'),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: _subjectId,
          decoration: const InputDecoration(labelText: 'Subject'),
          items: _specialties
              .map(
                (s) => DropdownMenuItem(
                  value: s['id']?.toString(),
                  child: Text(localizedName(s, locale)),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _subjectId = v),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: _stageId,
          decoration: const InputDecoration(labelText: 'Stage'),
          items: _stages
              .map(
                (s) => DropdownMenuItem(
                  value: s['id']?.toString(),
                  child: Text(localizedName(s, locale)),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _stageId = v),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _priceCtrl,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Price (IQD)'),
        ),
        const SizedBox(height: 16),
        GestureDetector(
          onTap: () async {
            final cover = await VideoCoverHelper.pickCoverImage();
            if (cover != null) setState(() => _coverFile = cover);
          },
          child: Container(
            height: 180,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.cardBorder),
              color: AppTheme.card,
              image: _coverFile != null
                  ? DecorationImage(image: FileImage(_coverFile!), fit: BoxFit.cover)
                  : (_coverUrl != null
                      ? DecorationImage(image: NetworkImage(_coverUrl!), fit: BoxFit.cover)
                      : null),
            ),
            child: _coverFile == null && _coverUrl == null
                ? const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.add_photo_alternate_outlined, size: 40, color: AppTheme.muted),
                      SizedBox(height: 8),
                      Text('Tap to add course cover', style: TextStyle(color: AppTheme.muted)),
                    ],
                  )
                : Align(
                    alignment: Alignment.bottomRight,
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Chip(
                        label: const Text('Change'),
                        backgroundColor: Colors.black54,
                        labelStyle: const TextStyle(color: Colors.white, fontSize: 12),
                      ),
                    ),
                  ),
          ),
        ),
      ],
    );
  }

  Widget _buildVideos() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Free preview videos',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        const Text(
          'Upload an interview / intro video first, then one more free sample. Both are visible before purchase.',
          style: TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 16),
        _RequirementChip(
          label: 'Interview',
          done: _hasInterview,
        ),
        const SizedBox(height: 8),
        _RequirementChip(
          label: 'Free videos ($_freeCount / 2)',
          done: _freeCount >= 2,
        ),
        const SizedBox(height: 16),
        ..._lessons.where((l) => l['isFreePreview'] == true).map((l) {
          final interview = l['isInterview'] == true;
          return Card(
            color: AppTheme.card,
            child: ListTile(
              leading: Icon(
                interview ? Icons.mic_rounded : Icons.play_circle_outline,
                color: AppTheme.accent,
              ),
              title: Text(l['title']?.toString() ?? 'Video'),
              subtitle: Text(interview ? 'Interview / Intro' : 'Free sample'),
            ),
          );
        }),
        const SizedBox(height: 12),
        if (!_hasInterview)
          FilledButton.icon(
            onPressed: _busy ? null : () => _uploadFreeVideo(interview: true),
            icon: const Icon(Icons.mic_rounded),
            label: const Text('Upload interview video'),
            style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, foregroundColor: Colors.black),
          )
        else if (_freeCount < 2)
          FilledButton.icon(
            onPressed: _busy ? null : () => _uploadFreeVideo(interview: false),
            icon: const Icon(Icons.video_call_outlined),
            label: const Text('Upload free sample video'),
            style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, foregroundColor: Colors.black),
          ),
      ],
    );
  }

  Widget _buildQuizzes() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Quizzes',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          'Add at least 2 quizzes (${_quizzes.length} / 2).',
          style: const TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 12),
        ..._quizzes.map(
          (q) => Card(
            color: AppTheme.card,
            child: ListTile(
              leading: const Icon(Icons.quiz_outlined, color: AppTheme.accent),
              title: Text(q['titleEn']?.toString() ?? 'Quiz'),
              subtitle: Text('${(q['_count'] as Map?)?['questions'] ?? q['questionCount'] ?? '?'} questions'),
            ),
          ),
        ),
        if (_quizzes.length < 2) ...[
          const SizedBox(height: 16),
          TextField(
            controller: _quizTitleCtrl,
            decoration: const InputDecoration(labelText: 'New quiz title'),
          ),
          const SizedBox(height: 12),
          ..._quizQs.asMap().entries.map((e) {
            final i = e.key;
            final q = e.value;
            return Card(
              color: AppTheme.card,
              margin: const EdgeInsets.only(bottom: 10),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    TextField(
                      controller: q.textCtrl,
                      decoration: InputDecoration(labelText: 'Question ${i + 1}'),
                    ),
                    const SizedBox(height: 8),
                    TextField(controller: q.optA, decoration: const InputDecoration(labelText: 'Option A')),
                    TextField(controller: q.optB, decoration: const InputDecoration(labelText: 'Option B')),
                    TextField(controller: q.optC, decoration: const InputDecoration(labelText: 'Option C (optional)')),
                    DropdownButtonFormField<String>(
                      value: q.correct,
                      decoration: const InputDecoration(labelText: 'Correct answer'),
                      items: const [
                        DropdownMenuItem(value: 'A', child: Text('A')),
                        DropdownMenuItem(value: 'B', child: Text('B')),
                        DropdownMenuItem(value: 'C', child: Text('C')),
                        DropdownMenuItem(value: 'D', child: Text('D')),
                      ],
                      onChanged: (v) => setState(() => q.correct = v ?? 'A'),
                    ),
                  ],
                ),
              ),
            );
          }),
          TextButton.icon(
            onPressed: () => setState(() => _quizQs.add(_WizardQuizQ())),
            icon: const Icon(Icons.add),
            label: const Text('Add question'),
          ),
          FilledButton(
            onPressed: _busy ? null : _saveQuiz,
            style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, foregroundColor: Colors.black),
            child: const Text('Save quiz'),
          ),
        ],
      ],
    );
  }

  Widget _buildDocument() {
    final docs = _materials;
    final docCount = ((_readiness?['documents'] as num?) ?? docs.length).toInt();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Course document',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Text(
          'Upload at least one PDF ($docCount / 1).',
          style: const TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 12),
        ...docs.map(
          (d) => Card(
            color: AppTheme.card,
            child: ListTile(
              leading: const Icon(Icons.picture_as_pdf, color: AppTheme.accent),
              title: Text(d['title']?.toString() ?? 'Document'),
            ),
          ),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _uploadDocument,
          icon: const Icon(Icons.upload_file),
          label: const Text('Upload PDF'),
          style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, foregroundColor: Colors.black),
        ),
      ],
    );
  }

  Widget _buildSubmit() {
    final r = _readiness;
    final missing = ((r?['missing'] as List?) ?? []).cast<String>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Review & submit',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        const Text(
          'Confirm everything looks good, then send the course to admin review.',
          style: TextStyle(color: AppTheme.muted, height: 1.4),
        ),
        const SizedBox(height: 16),
        _RequirementChip(label: 'Title', done: r?['hasTitle'] == true),
        _RequirementChip(label: 'Cover', done: r?['hasCover'] == true),
        _RequirementChip(label: 'Interview video', done: r?['hasInterview'] == true),
        _RequirementChip(
          label: 'Free videos (${r?['freeVideos'] ?? 0} / 2)',
          done: ((r?['freeVideos'] as num?) ?? 0) >= 2,
        ),
        _RequirementChip(
          label: 'Quizzes (${r?['quizzes'] ?? 0} / 2)',
          done: ((r?['quizzes'] as num?) ?? 0) >= 2,
        ),
        _RequirementChip(
          label: 'Documents (${r?['documents'] ?? 0} / 1)',
          done: ((r?['documents'] as num?) ?? 0) >= 1,
        ),
        if (missing.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(
            'Still missing:\n• ${missing.join('\n• ')}',
            style: const TextStyle(color: Colors.orangeAccent, height: 1.5),
          ),
        ],
      ],
    );
  }
}

class _StepHeader extends StatelessWidget {
  const _StepHeader({required this.steps, required this.current});

  final List<String> steps;
  final int current;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Row(
        children: [
          for (var i = 0; i < steps.length; i++) ...[
            if (i > 0) Expanded(child: Container(height: 2, color: i <= current ? AppTheme.accent : AppTheme.cardBorder)),
            CircleAvatar(
              radius: 14,
              backgroundColor: i <= current ? AppTheme.accent : AppTheme.cardBorder,
              child: Text(
                '${i + 1}',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: i <= current ? Colors.black : AppTheme.muted,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _RequirementChip extends StatelessWidget {
  const _RequirementChip({required this.label, required this.done});

  final String label;
  final bool done;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(
            done ? Icons.check_circle : Icons.radio_button_unchecked,
            color: done ? Colors.greenAccent : AppTheme.muted,
            size: 20,
          ),
          const SizedBox(width: 8),
          Text(label, style: TextStyle(color: done ? Colors.white : AppTheme.muted)),
        ],
      ),
    );
  }
}

class _WizardQuizQ {
  final textCtrl = TextEditingController();
  final optA = TextEditingController();
  final optB = TextEditingController();
  final optC = TextEditingController();
  final optD = TextEditingController();
  String correct = 'A';

  void dispose() {
    textCtrl.dispose();
    optA.dispose();
    optB.dispose();
    optC.dispose();
    optD.dispose();
  }

  Map<String, dynamic>? toPayload() {
    if (textCtrl.text.trim().isEmpty) return null;
    if (optA.text.trim().isEmpty || optB.text.trim().isEmpty) return null;
    return {
      'textEn': textCtrl.text.trim(),
      'options': {
        'A': optA.text.trim(),
        'B': optB.text.trim(),
        if (optC.text.trim().isNotEmpty) 'C': optC.text.trim(),
        if (optD.text.trim().isNotEmpty) 'D': optD.text.trim(),
      },
      'correctKey': correct,
    };
  }
}
