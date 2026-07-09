import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/media/video_cover_helper.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/store/teacher_create_course_screen.dart';
import 'package:ulearn/features/store/teacher_course_manage_screen.dart';
import 'package:ulearn/features/store/teacher_quiz_tab.dart';
import 'package:video_compress/video_compress.dart';

const _compressPrefKey = 'teacher_compress_before_upload';

/// Teacher mobile studio: upload course videos and short videos.
class TeacherStudioScreen extends StatefulWidget {
  const TeacherStudioScreen({super.key});

  @override
  State<TeacherStudioScreen> createState() => _TeacherStudioScreenState();
}

class _TeacherStudioScreenState extends State<TeacherStudioScreen> {
  List<Map<String, dynamic>> _courses = [];
  List<Map<String, dynamic>> _shorts = [];
  String? _courseId;
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  bool _loading = true;
  bool _uploading = false;
  String? _uploadStatus;
  bool _compressBeforeUpload = true;

  File? _pendingVideo;
  File? _pendingCover;
  File? _pendingPdf;
  int? _pendingDurationSec;

  @override
  void initState() {
    super.initState();
    _loadPrefs();
    _load();
  }

  Future<void> _loadPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() => _compressBeforeUpload = prefs.getBool(_compressPrefKey) ?? true);
  }

  Future<void> _setCompressBeforeUpload(bool value) async {
    setState(() => _compressBeforeUpload = value);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_compressPrefKey, value);
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    VideoCompress.dispose();
    super.dispose();
  }

  void _clearCover() => setState(() => _pendingCover = null);

  void _clearPendingMedia() {
    setState(() {
      _pendingVideo = null;
      _pendingCover = null;
      _pendingPdf = null;
      _pendingDurationSec = null;
    });
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        context.read<ApiClient>().get('/api/teacher/courses'),
        context.read<ApiClient>().get('/api/teacher/short-videos'),
      ]);
      if (!mounted) return;
      setState(() {
        _courses = ((results[0]['courses'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _shorts = ((results[1]['videos'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _courseId ??= _courses.isNotEmpty ? _courses.first['id']?.toString() : null;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<File?> _compressVideo(String sourcePath) async {
    setState(() => _uploadStatus = context.l10n.t('student.issuing'));
    try {
      final info = await VideoCompress.compressVideo(
        sourcePath,
        quality: VideoQuality.MediumQuality,
        includeAudio: true,
        deleteOrigin: false,
      );
      if (info?.path != null) return File(info!.path!);
    } catch (_) {}
    return File(sourcePath);
  }

  Future<Map<String, String>?> _uploadFile(
    File file,
    String filename,
    String contentType, {
    required String category,
    required String folder,
    bool reportProgress = false,
  }) async {
    final api = context.read<ApiClient>();
    final size = await file.length();
    setState(() => _uploadStatus = context.l10n.t('student.posting'));
    final presign = await api.post('/api/admin/uploads', {
      'filename': filename,
      'contentType': contentType,
      'size': size,
      'category': category,
      'folder': folder,
    });
    final uploadUrl = presign['uploadUrl']?.toString();
    final key = presign['key']?.toString();
    final publicUrl = presign['publicUrl']?.toString();
    if (uploadUrl == null || key == null) return null;

    await api.putFile(
      uploadUrl,
      file,
      contentType,
      onProgress: reportProgress
          ? (sent, total) {
              if (!mounted || total <= 0) return;
              final pct = ((sent / total) * 100).round().clamp(0, 100);
              setState(() => _uploadStatus = '$pct%');
            }
          : null,
    );
    return {'key': key, 'url': publicUrl ?? uploadUrl};
  }

  Future<Map<String, String>?> _uploadBytes(
    List<int> bytes,
    String filename,
    String contentType, {
    required String category,
    required String folder,
  }) async {
    final api = context.read<ApiClient>();
    setState(() => _uploadStatus = context.l10n.t('student.posting'));
    final presign = await api.post('/api/admin/uploads', {
      'filename': filename,
      'contentType': contentType,
      'size': bytes.length,
      'category': category,
      'folder': folder,
    });
    final uploadUrl = presign['uploadUrl']?.toString();
    final key = presign['key']?.toString();
    final publicUrl = presign['publicUrl']?.toString();
    if (uploadUrl == null || key == null) return null;

    await api.putBytes(uploadUrl, Uint8List.fromList(bytes), contentType);
    return {'key': key, 'url': publicUrl ?? uploadUrl};
  }

  Future<Map<String, String>?> _uploadVideoFile(File file, String folder) async {
    final name = file.path.split(Platform.pathSeparator).last;
    return _uploadFile(
      file,
      name.endsWith('.mp4') ? name : '$name.mp4',
      'video/mp4',
      category: 'video',
      folder: folder,
      reportProgress: true,
    );
  }

  Future<Map<String, String>?> _uploadPdfFile(File file) async {
    final name = file.path.split(Platform.pathSeparator).last;
    return _uploadFile(
      file,
      name.toLowerCase().endsWith('.pdf') ? name : '$name.pdf',
      'application/pdf',
      category: 'document',
      folder: 'teacher-course-pdfs',
      reportProgress: true,
    );
  }

  Future<void> _pickPdf() async {
    final pick = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
    );
    if (pick == null || pick.files.isEmpty) return;
    final file = pick.files.first;
    if (file.path != null && mounted) setState(() => _pendingPdf = File(file.path!));
  }

  Future<Map<String, String>?> _uploadCoverFile(File file, String folder) async {
    final bytes = await file.readAsBytes();
    final ext = file.path.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    return _uploadBytes(
      bytes,
      'cover_${DateTime.now().millisecondsSinceEpoch}.$ext',
      ext == 'png' ? 'image/png' : 'image/jpeg',
      category: 'image',
      folder: folder,
    );
  }

  Future<void> _selectVideo() async {
    final pick = await FilePicker.pickFiles(type: FileType.video);
    if (pick == null || pick.files.isEmpty) return;

    File? source;
    final file = pick.files.first;
    if (file.path != null) {
      source = File(file.path!);
    } else if (file.bytes != null) {
      source = File(
        '${Directory.systemTemp.path}/ulearn_upload_${DateTime.now().millisecondsSinceEpoch}.mp4',
      );
      await source.writeAsBytes(file.bytes!);
    }
    if (source == null) return;

    final duration = await VideoCoverHelper.videoDurationSec(source.path);
    if (!mounted) return;
    setState(() {
      _pendingVideo = source;
      _pendingCover = null;
      _pendingDurationSec = duration;
    });
  }

  Future<void> _pickCoverImage() async {
    if (_pendingVideo == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioPickVideoFirst)),
      );
      return;
    }
    final cover = await VideoCoverHelper.pickCoverImage();
    if (cover != null && mounted) setState(() => _pendingCover = cover);
  }

  Future<void> _autoCoverFromVideo() async {
    if (_pendingVideo == null) return;
    setState(() => _uploadStatus = context.l10n.t('student.issuing'));
    final cover = await VideoCoverHelper.thumbnailFromVideo(_pendingVideo!.path);
    if (mounted) {
      setState(() {
        _pendingCover = cover;
        _uploadStatus = null;
      });
    }
  }

  Future<File?> _prepareVideoForUpload() async {
    var video = _pendingVideo;
    if (video == null) {
      await _selectVideo();
      video = _pendingVideo;
    }
    if (video == null) return null;
    if (!_compressBeforeUpload) return video;
    return _compressVideo(video.path);
  }

  Future<Map<String, String>?> _uploadCoverIfAny(String folder) async {
    if (_pendingCover == null) return null;
    setState(() => _uploadStatus = context.l10n.t('student.posting'));
    return _uploadCoverFile(_pendingCover!, folder);
  }

  Future<void> _uploadCourseVideo() async {
    if (_courseId == null || _titleCtrl.text.trim().isEmpty) return;

    setState(() {
      _uploading = true;
      _uploadStatus = context.l10n.t('common.loading');
    });
    try {
      final videoFile = await _prepareVideoForUpload();
      if (videoFile == null) return;

      final uploaded = await _uploadVideoFile(videoFile, 'teacher-courses');
      if (uploaded == null) throw Exception('Upload failed');

      if (_pendingCover == null) {
        setState(() => _uploadStatus = context.l10n.t('student.issuing'));
        _pendingCover = await VideoCoverHelper.thumbnailFromVideo(videoFile.path);
      }
      if (_pendingDurationSec == null || _pendingDurationSec! <= 0) {
        _pendingDurationSec = await VideoCoverHelper.videoDurationSec(videoFile.path);
      }

      final cover = await _uploadCoverIfAny('teacher-covers');

      final payload = <String, dynamic>{
        'title': _titleCtrl.text.trim(),
        'fileKey': uploaded['key'],
        'fileUrl': uploaded['url'],
        if (cover != null) 'thumbnailKey': cover['key'],
        if (cover != null) 'thumbnailUrl': cover['url'],
        if (_pendingDurationSec != null) 'durationSec': _pendingDurationSec,
      };

      if (_pendingPdf != null) {
        final pdf = await _uploadPdfFile(_pendingPdf!);
        if (pdf != null) {
          payload['pdfFileKey'] = pdf['key'];
          payload['pdfFileUrl'] = pdf['url'];
          payload['pdfMimeType'] = 'application/pdf';
          payload['pdfTitle'] = '${_titleCtrl.text.trim()} — PDF';
        }
      }

      await context.read<ApiClient>().post(
            '/api/teacher/courses/$_courseId/lessons',
            payload,
          );
      if (!mounted) return;
      _titleCtrl.clear();
      _clearPendingMedia();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioVideoUploaded)),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _uploadStatus = null;
        });
      }
      if (_compressBeforeUpload) await VideoCompress.deleteAllCache();
    }
  }

  Future<void> _uploadShort() async {
    if (_titleCtrl.text.trim().isEmpty) return;

    setState(() {
      _uploading = true;
      _uploadStatus = context.l10n.t('common.loading');
    });
    try {
      final videoFile = await _prepareVideoForUpload();
      if (videoFile == null) return;

      final uploaded = await _uploadVideoFile(videoFile, 'teacher-shorts');
      if (uploaded == null) throw Exception('Upload failed');

      if (_pendingCover == null) {
        setState(() => _uploadStatus = context.l10n.t('student.issuing'));
        _pendingCover = await VideoCoverHelper.thumbnailFromVideo(videoFile.path);
      }
      if (_pendingDurationSec == null || _pendingDurationSec! <= 0) {
        _pendingDurationSec = await VideoCoverHelper.videoDurationSec(videoFile.path);
      }

      final cover = await _uploadCoverIfAny('teacher-shorts-covers');

      await context.read<ApiClient>().post('/api/teacher/short-videos', {
        'title': _titleCtrl.text.trim(),
        if (_descCtrl.text.trim().isNotEmpty) 'description': _descCtrl.text.trim(),
        'fileKey': uploaded['key'],
        'fileUrl': uploaded['url'],
        if (cover != null) 'thumbnailUrl': cover['url'],
        if (_pendingDurationSec != null) 'durationSec': _pendingDurationSec,
      });
      if (!mounted) return;
      _titleCtrl.clear();
      _descCtrl.clear();
      _clearPendingMedia();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.studioShortSubmitted)),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _uploadStatus = null;
        });
      }
      if (_compressBeforeUpload) await VideoCompress.deleteAllCache();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.profileTeacherStudio),
          actions: [
            IconButton(
              tooltip: l10n.t('mobile.teacher.manageCourse'),
              icon: const Icon(Icons.settings_outlined),
              onPressed: _courseId == null
                  ? null
                  : () async {
                      await Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => TeacherCourseManageScreen(courseId: _courseId!),
                        ),
                      );
                      if (mounted) _load();
                    },
            ),
            IconButton(
              tooltip: l10n.t('mobile.teacher.newCourse'),
              icon: const Icon(Icons.add_circle_outline),
              onPressed: () async {
                final created = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(builder: (_) => const TeacherCreateCourseScreen()),
                );
                if (created == true && mounted) _load();
              },
            ),
          ],
          bottom: TabBar(
            tabs: [
              Tab(text: l10n.t('student.videos')),
              Tab(text: l10n.t('student.quizzes')),
              Tab(text: l10n.reelsTitle),
            ],
          ),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
            : TabBarView(
                children: [
                  _UploadTab(
                    titleCtrl: _titleCtrl,
                    descCtrl: null,
                    uploading: _uploading,
                    uploadStatus: _uploadStatus,
                    courses: _courses,
                    courseId: _courseId,
                    onCourse: (id) => setState(() => _courseId = id),
                    onSelectVideo: _selectVideo,
                    onPickCover: _pickCoverImage,
                    onAutoCover: _autoCoverFromVideo,
                    onClearCover: _clearCover,
                    onClearMedia: _clearPendingMedia,
                    pendingVideo: _pendingVideo,
                    pendingCover: _pendingCover,
                    pendingPdf: _pendingPdf,
                    onPickPdf: _pickPdf,
                    onClearPdf: () => setState(() => _pendingPdf = null),
                    pendingDurationSec: _pendingDurationSec,
                    onUpload: _uploadCourseVideo,
                    compressBeforeUpload: _compressBeforeUpload,
                    onCompressChanged: _setCompressBeforeUpload,
                  ),
                  TeacherQuizTab(
                    courses: _courses,
                    courseId: _courseId,
                    onCourseChanged: (id) => setState(() => _courseId = id),
                  ),
                  _UploadTab(
                    titleCtrl: _titleCtrl,
                    descCtrl: _descCtrl,
                    uploading: _uploading,
                    uploadStatus: _uploadStatus,
                    courses: const [],
                    courseId: null,
                    onCourse: (_) {},
                    onSelectVideo: _selectVideo,
                    onPickCover: _pickCoverImage,
                    onAutoCover: _autoCoverFromVideo,
                    onClearCover: _clearCover,
                    onClearMedia: _clearPendingMedia,
                    pendingVideo: _pendingVideo,
                    pendingCover: _pendingCover,
                    pendingDurationSec: _pendingDurationSec,
                    onUpload: _uploadShort,
                    isShort: true,
                    shorts: _shorts,
                    compressBeforeUpload: _compressBeforeUpload,
                    onCompressChanged: _setCompressBeforeUpload,
                  ),
                ],
              ),
      ),
    );
  }
}

class _UploadTab extends StatelessWidget {
  const _UploadTab({
    required this.titleCtrl,
    required this.descCtrl,
    required this.uploading,
    required this.uploadStatus,
    required this.courses,
    required this.courseId,
    required this.onCourse,
    required this.onSelectVideo,
    required this.onPickCover,
    required this.onAutoCover,
    required this.onClearCover,
    required this.onClearMedia,
    required this.pendingVideo,
    required this.pendingCover,
    this.pendingPdf,
    this.onPickPdf,
    this.onClearPdf,
    required this.pendingDurationSec,
    required this.onUpload,
    required this.compressBeforeUpload,
    required this.onCompressChanged,
    this.isShort = false,
    this.shorts = const [],
  });

  final TextEditingController titleCtrl;
  final TextEditingController? descCtrl;
  final bool uploading;
  final String? uploadStatus;
  final List<Map<String, dynamic>> courses;
  final String? courseId;
  final ValueChanged<String?> onCourse;
  final VoidCallback onSelectVideo;
  final VoidCallback onPickCover;
  final VoidCallback onAutoCover;
  final VoidCallback onClearCover;
  final VoidCallback onClearMedia;
  final File? pendingVideo;
  final File? pendingCover;
  final File? pendingPdf;
  final VoidCallback? onPickPdf;
  final VoidCallback? onClearPdf;
  final int? pendingDurationSec;
  final VoidCallback onUpload;
  final bool compressBeforeUpload;
  final ValueChanged<bool> onCompressChanged;
  final bool isShort;
  final List<Map<String, dynamic>> shorts;

  String _videoName(BuildContext context) {
    final l10n = context.l10n;
    if (pendingVideo == null) return l10n.studioVideoFile;
    return pendingVideo!.path.split(Platform.pathSeparator).last;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        TextField(
          controller: titleCtrl,
          decoration: InputDecoration(
            labelText: isShort ? l10n.t('student.videos') : l10n.t('student.videos'),
          ),
        ),
        if (isShort && descCtrl != null) ...[
          const SizedBox(height: 14),
          TextField(
            controller: descCtrl,
            maxLines: 3,
            maxLength: 500,
            decoration: InputDecoration(
              labelText: l10n.t('student.comment'),
              hintText: l10n.t('student.comment'),
              alignLabelWithHint: true,
            ),
          ),
        ],
        if (!isShort) ...[
          const SizedBox(height: 16),
          if (courses.isEmpty)
            Text(
              l10n.t('student.noCertificatesHint'),
              style: const TextStyle(color: AppTheme.muted),
            )
          else
            DropdownButtonFormField<String>(
              initialValue: courseId,
              decoration: InputDecoration(labelText: l10n.t('student.storeTitle')),
              items: courses
                  .map((c) => DropdownMenuItem(
                        value: c['id']?.toString(),
                        child: Text(c['titleEn']?.toString() ?? l10n.t('student.storeTitle')),
                      ))
                  .toList(),
              onChanged: onCourse,
            ),
        ],
        const SizedBox(height: 16),
        Text(l10n.studioVideoFile, style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: uploading ? null : onSelectVideo,
          icon: const Icon(Icons.video_library_outlined),
          label: Text(pendingVideo == null ? l10n.studioVideoFile : l10n.t('common.save')),
        ),
        if (pendingVideo != null) ...[
          const SizedBox(height: 6),
          Text(
            _videoName(context),
            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
          if (pendingDurationSec != null)
            Text(
              '${l10n.t('student.min')}: ${pendingDurationSec! ~/ 60}:${(pendingDurationSec! % 60).toString().padLeft(2, '0')}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
        ],
        const SizedBox(height: 16),
        Text(l10n.studioCoverOptional, style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text(
          l10n.t('student.coursesDescription'),
          style: const TextStyle(color: AppTheme.muted, fontSize: 12),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: uploading || pendingVideo == null ? null : onPickCover,
                icon: const Icon(Icons.image_outlined, size: 18),
                label: Text(l10n.studioChooseCover),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: uploading || pendingVideo == null ? null : onAutoCover,
                icon: const Icon(Icons.auto_fix_high_outlined, size: 18),
                label: Text(l10n.studioFromVideo),
              ),
            ),
          ],
        ),
        if (pendingCover != null) ...[
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Image.file(pendingCover!, fit: BoxFit.cover),
                  Positioned(
                    top: 6,
                    right: 6,
                    child: IconButton.filled(
                      style: IconButton.styleFrom(
                        backgroundColor: Colors.black54,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(32, 32),
                      ),
                      onPressed: uploading ? null : onClearCover,
                      icon: const Icon(Icons.close, size: 18),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
        if (!isShort) ...[
          const SizedBox(height: 16),
          Text(l10n.t('mobile.teacher.attachPdfOptional'),
              style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: uploading ? null : onPickPdf,
            icon: const Icon(Icons.picture_as_pdf_outlined),
            label: Text(
              pendingPdf != null
                  ? pendingPdf!.path.split(Platform.pathSeparator).last
                  : l10n.t('mobile.teacher.choosePdf'),
            ),
          ),
          if (pendingPdf != null && onClearPdf != null) ...[
            const SizedBox(height: 6),
            TextButton(onPressed: onClearPdf, child: Text(l10n.t('mobile.teacher.removePdf'))),
          ],
        ],
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppTheme.cardBorder),
          ),
          child: SwitchListTile(
            value: compressBeforeUpload,
            onChanged: uploading ? null : onCompressChanged,
            activeThumbColor: AppTheme.accent,
            secondary: const Icon(Icons.compress_outlined, color: AppTheme.accent),
            title: Text(
              l10n.t('student.speed'),
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
            subtitle: Text(
              compressBeforeUpload
                  ? l10n.t('student.coursesDescription')
                  : l10n.t('student.packagesDescription'),
              style: const TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.35),
            ),
          ),
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: uploading ? null : onUpload,
          icon: uploading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.upload_file),
          label: Text(uploading ? (uploadStatus ?? l10n.t('common.loading')) : l10n.t('student.videos')),
        ),
        if (isShort && shorts.isNotEmpty) ...[
          const SizedBox(height: 24),
          Text(l10n.studioYourShorts, style: const TextStyle(fontWeight: FontWeight.bold)),
          ...shorts.map((s) {
            final status = s['status']?.toString() ?? '';
            return Card(
              margin: const EdgeInsets.only(top: 8),
              child: ListTile(
                leading: s['thumbnailUrl'] != null
                    ? ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: Image.network(
                          s['thumbnailUrl'].toString(),
                          width: 48,
                          height: 48,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(Icons.movie_outlined),
                        ),
                      )
                    : const Icon(Icons.movie_outlined),
                title: Text(s['title']?.toString() ?? ''),
                subtitle: Text(
                  [
                    if (s['description'] != null && s['description'].toString().trim().isNotEmpty)
                      s['description'].toString(),
                    '${l10n.homeViews((s['viewCount'] as num?)?.toInt() ?? 0)} · ${l10n.homeLikes((s['likes'] as num?)?.toInt() ?? 0)} · ${l10n.homeSaves((s['saves'] as num?)?.toInt() ?? 0)}',
                  ].where((t) => t.isNotEmpty).join('\n'),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppTheme.muted, height: 1.35),
                ),
                trailing: Chip(
                  label: Text(status.replaceAll('_', ' '), style: const TextStyle(fontSize: 10)),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            );
          }),
        ],
      ],
    );
  }
}
