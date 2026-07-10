import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/media/video_cover_helper.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/video_process_service.dart';
import 'package:ulearn/core/video/video_upload_service.dart';
import 'package:ulearn/features/store/widgets/free_minute_picker.dart';

const _compressPrefKey = 'teacher_compress_before_upload';

/// Full-screen lesson upload for a specific course (from Courses hub / Manage).
class TeacherLessonUploadScreen extends StatefulWidget {
  const TeacherLessonUploadScreen({
    super.key,
    required this.courseId,
    required this.courseTitle,
  });

  final String courseId;
  final String courseTitle;

  @override
  State<TeacherLessonUploadScreen> createState() =>
      _TeacherLessonUploadScreenState();
}

class _TeacherLessonUploadScreenState extends State<TeacherLessonUploadScreen> {
  final _titleCtrl = TextEditingController();
  bool _uploading = false;
  double _progress = 0;
  String? _busyLabel;
  bool _compress = true;
  String _accessMode = 'paid';
  int _freePreviewSec = 120;
  File? _video;
  File? _cover;
  File? _pdf;
  int? _durationSec;
  Timer? _uiTimer;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      if (mounted) {
        setState(() => _compress = p.getBool(_compressPrefKey) ?? true);
      }
    });
  }

  @override
  void dispose() {
    _uiTimer?.cancel();
    _titleCtrl.dispose();
    super.dispose();
  }

  void _setProgress(double p, String label, {bool force = false}) {
    _progress = p.clamp(0.0, 1.0);
    _busyLabel = label;
    if (force) {
      _uiTimer?.cancel();
      _uiTimer = null;
      if (mounted) setState(() {});
      return;
    }
    if (_uiTimer?.isActive ?? false) return;
    _uiTimer = Timer(const Duration(milliseconds: 80), () {
      _uiTimer = null;
      if (mounted) setState(() {});
    });
  }

  Future<void> _pickVideo() async {
    final pick = await FilePicker.pickFiles(type: FileType.video);
    if (pick == null || pick.files.isEmpty || pick.files.first.path == null) {
      return;
    }
    final source = File(pick.files.first.path!);
    final duration = await VideoCoverHelper.videoDurationSec(source.path);
    if (!mounted) return;
    setState(() {
      _video = source;
      _cover = null;
      _durationSec = duration;
    });
  }

  Future<void> _pickCover() async {
    final cover = await VideoCoverHelper.pickCoverImage();
    if (cover != null && mounted) setState(() => _cover = cover);
  }

  Future<void> _autoCover() async {
    if (_video == null) return;
    final cover = await VideoCoverHelper.thumbnailFromVideo(_video!.path);
    if (!mounted) return;
    if (cover == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.studio.coverFromVideoFailed'))),
      );
      return;
    }
    setState(() => _cover = cover);
  }

  Future<void> _pickPdf() async {
    final pick = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
    );
    if (pick == null || pick.files.isEmpty || pick.files.first.path == null) {
      return;
    }
    setState(() => _pdf = File(pick.files.first.path!));
  }

  Future<void> _upload() async {
    final l10n = context.l10n;
    FocusManager.instance.primaryFocus?.unfocus();
    if (_titleCtrl.text.trim().isEmpty || _video == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.t('mobile.studio.pickVideoFirst'))),
      );
      return;
    }
    if (_cover == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.t('mobile.studio.coverRequired'))),
      );
      return;
    }

    setState(() {
      _uploading = true;
      _progress = 0.02;
      _busyLabel = l10n.t('mobile.studio.uploadPreparing');
    });

    try {
      final api = context.read<ApiClient>();
      final upload = VideoUploadService(api);
      File videoFile = _video!;

      if (_compress) {
        final wm = await upload.fetchWatermarkConfig(courseName: widget.courseTitle);
        final sourceSize = await _video!.length();
        final processed = await VideoProcessService.processForUpload(
          source: _video!,
          watermark: wm,
          onProgress: (p) {
            _setProgress(
              p * 0.45,
              l10n.t('mobile.teacher.convertingVideo', {
                'size': VideoProcessService.formatBytes(sourceSize),
                'percent': '${(p * 100).round()}',
              }),
            );
          },
        );
        videoFile = processed.file;
      }

      _setProgress(0.5, l10n.t('mobile.studio.uploadUploadingVideo'), force: true);
      final duration =
          _durationSec ?? await VideoCoverHelper.videoDurationSec(videoFile.path);
      final result = await upload.uploadCourseVideo(
        file: videoFile,
        courseId: widget.courseId,
        scope: 'STORE_COURSE',
        durationSec: duration,
        watermarkApplied: _compress,
        onProgress: (sent, total) {
          if (total <= 0) return;
          final pct = sent / total;
          _setProgress(
            0.5 + pct * 0.35,
            l10n.t('mobile.teacher.uploadingProgress', {
              'sent': VideoProcessService.formatBytes(sent),
              'total': VideoProcessService.formatBytes(total),
              'percent': '${(pct * 100).round()}',
            }),
          );
        },
      );

      _setProgress(0.88, l10n.t('mobile.studio.uploadingCoverBusy'), force: true);
      final coverSize = await _cover!.length();
      final ext = _cover!.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      final coverPresign = await api.post('/api/admin/uploads', {
        'filename': 'cover_${DateTime.now().millisecondsSinceEpoch}.$ext',
        'contentType': ext == 'png' ? 'image/png' : 'image/jpeg',
        'size': coverSize,
        'category': 'image',
        'folder': 'teacher-covers',
      });
      final coverUploadUrl = coverPresign['uploadUrl']?.toString();
      final coverKey = coverPresign['key']?.toString();
      final coverUrl = coverPresign['publicUrl']?.toString();
      if (coverUploadUrl == null || coverKey == null) {
        throw Exception(l10n.t('mobile.teacher.coverUploadFailed'));
      }
      await api.putFile(
        coverUploadUrl,
        _cover!,
        ext == 'png' ? 'image/png' : 'image/jpeg',
      );

      final payload = <String, dynamic>{
        'title': _titleCtrl.text.trim(),
        'fileKey': result.objectKey,
        'videoAssetId': result.videoId,
        'thumbnailKey': coverKey,
        'thumbnailUrl': coverUrl,
        if (duration != null) 'durationSec': duration,
        'isFreePreview': _accessMode == 'fullFree',
        if (_accessMode == 'timedFree') 'freePreviewSec': _freePreviewSec,
        if (_accessMode != 'timedFree') 'freePreviewSec': null,
      };

      if (_pdf != null) {
        _setProgress(0.93, l10n.t('mobile.studio.uploadUploadingPdf'), force: true);
        final pdfSize = await _pdf!.length();
        final name = _pdf!.path.split(Platform.pathSeparator).last;
        final pdfPresign = await api.post('/api/admin/uploads', {
          'filename': name.endsWith('.pdf') ? name : '$name.pdf',
          'contentType': 'application/pdf',
          'size': pdfSize,
          'category': 'document',
          'folder': 'teacher-course-pdfs',
        });
        final pdfUrl = pdfPresign['uploadUrl']?.toString();
        final pdfKey = pdfPresign['key']?.toString();
        final pdfPublic = pdfPresign['publicUrl']?.toString();
        if (pdfUrl != null && pdfKey != null) {
          await api.putFile(pdfUrl, _pdf!, 'application/pdf');
          payload['pdfFileKey'] = pdfKey;
          payload['pdfFileUrl'] = pdfPublic ?? pdfUrl;
          payload['pdfMimeType'] = 'application/pdf';
          payload['pdfTitle'] = '${_titleCtrl.text.trim()} — PDF';
        }
      }

      _setProgress(0.97, l10n.t('mobile.studio.uploadSaving'), force: true);
      await api.post('/api/teacher/courses/${widget.courseId}/lessons', payload);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.t('mobile.studio.videoUploaded'))),
      );
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _busyLabel = null;
          _progress = 0;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final canPublish = _titleCtrl.text.trim().isNotEmpty &&
        _video != null &&
        _cover != null &&
        !_uploading;

    return GestureDetector(
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      behavior: HitTestBehavior.translucent,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.t('mobile.studio.addVideo')),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(28),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  widget.courseTitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                ),
              ),
            ),
          ),
        ),
        body: Stack(
          children: [
            ListView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
              children: [
                TextField(
                  controller: _titleCtrl,
                  enabled: !_uploading,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    labelText: l10n.t('mobile.studio.lessonTitle'),
                    prefixIcon: const Icon(Icons.title_rounded, size: 20),
                  ),
                ),
                const SizedBox(height: 16),
                _PickerCard(
                  icon: Icons.videocam_rounded,
                  title: _video == null
                      ? l10n.t('mobile.studio.tapToSelectVideo')
                      : _video!.path.split(Platform.pathSeparator).last,
                  subtitle: _durationSec != null
                      ? '${_durationSec! ~/ 60}:${(_durationSec! % 60).toString().padLeft(2, '0')}'
                      : null,
                  selected: _video != null,
                  onTap: _uploading ? null : _pickVideo,
                ),
                const SizedBox(height: 12),
                Text(
                  l10n.t('mobile.studio.coverRequiredTitle'),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _uploading || _video == null ? null : _pickCover,
                        icon: const Icon(Icons.photo_library_outlined),
                        label: Text(l10n.t('mobile.studio.chooseCover')),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _uploading || _video == null ? null : _autoCover,
                        icon: const Icon(Icons.auto_fix_high_outlined),
                        label: Text(l10n.t('mobile.studio.fromVideo')),
                      ),
                    ),
                  ],
                ),
                if (_cover != null) ...[
                  const SizedBox(height: 12),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: AspectRatio(
                      aspectRatio: 16 / 9,
                      child: Image.file(_cover!, fit: BoxFit.cover),
                    ),
                  ),
                ],
                const SizedBox(height: 18),
                Text(
                  l10n.t('mobile.studio.accessTitle'),
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                ),
                const SizedBox(height: 8),
                Text(
                  l10n.t('mobile.studio.accessHint'),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, height: 1.4),
                ),
                const SizedBox(height: 10),
                for (final opt in [
                  ('paid', l10n.t('mobile.studio.accessPaid'), Icons.lock_outline),
                  ('timedFree', l10n.t('mobile.studio.accessTimed'), Icons.timelapse),
                  ('fullFree', l10n.t('mobile.studio.accessFullFree'), Icons.lock_open),
                ])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      enabled: !_uploading,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(
                          color: _accessMode == opt.$1
                              ? AppTheme.accent
                              : AppTheme.cardBorder,
                        ),
                      ),
                      leading: Icon(opt.$3, color: AppTheme.accent),
                      title: Text(opt.$2),
                      trailing: _accessMode == opt.$1
                          ? const Icon(Icons.check_circle, color: AppTheme.accent)
                          : null,
                      onTap: () => setState(() => _accessMode = opt.$1),
                    ),
                  ),
                if (_accessMode == 'timedFree') ...[
                  const SizedBox(height: 8),
                  FreeMinutePicker(
                    durationSec: _durationSec ?? 600,
                    valueSec: _freePreviewSec,
                    enabled: !_uploading,
                    onChanged: (v) => setState(() => _freePreviewSec = v),
                  ),
                ],
                const SizedBox(height: 14),
                OutlinedButton.icon(
                  onPressed: _uploading ? null : _pickPdf,
                  icon: const Icon(Icons.picture_as_pdf_outlined),
                  label: Text(
                    _pdf == null
                        ? l10n.t('mobile.teacher.attachPdfOptional')
                        : _pdf!.path.split(Platform.pathSeparator).last,
                  ),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _compress,
                  onChanged: _uploading
                      ? null
                      : (v) async {
                          setState(() => _compress = v);
                          final p = await SharedPreferences.getInstance();
                          await p.setBool(_compressPrefKey, v);
                        },
                  title: Text(l10n.t('mobile.studio.compressToggleTitle')),
                  subtitle: Text(
                    _compress
                        ? l10n.t('mobile.studio.compressToggleOn')
                        : l10n.t('mobile.studio.compressToggleOff'),
                  ),
                  activeThumbColor: AppTheme.accent,
                ),
              ],
            ),
            if (_uploading)
              Positioned.fill(
                child: ColoredBox(
                  color: Colors.black54,
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SizedBox(
                            width: 64,
                            height: 64,
                            child: CircularProgressIndicator(
                              value: _progress > 0.02 ? _progress : null,
                              color: AppTheme.accent,
                              strokeWidth: 5,
                            ),
                          ),
                          if (_busyLabel != null) ...[
                            const SizedBox(height: 16),
                            Text(
                              _busyLabel!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                          const SizedBox(height: 12),
                          Text(
                            '${(_progress * 100).round()}%',
                            style: const TextStyle(
                              color: Colors.white70,
                              fontWeight: FontWeight.w700,
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
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: FilledButton(
              onPressed: canPublish ? _upload : null,
              style: FilledButton.styleFrom(
                backgroundColor: AppTheme.accent,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: Text(
                l10n.t('mobile.studio.mediaReady'),
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PickerCard extends StatelessWidget {
  const _PickerCard({
    required this.icon,
    required this.title,
    this.subtitle,
    required this.selected,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Ink(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? AppTheme.accent : AppTheme.cardBorder,
            ),
            color: AppTheme.card,
          ),
          child: Row(
            children: [
              Icon(icon, color: AppTheme.accent),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
                    if (subtitle != null)
                      Text(subtitle!, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
