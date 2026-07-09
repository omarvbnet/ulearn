import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/media/video_cover_helper.dart';
import 'package:ulearn/core/theme/app_theme.dart';
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
    setState(() => _uploadStatus = 'Compressing video…');
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

  Future<Map<String, String>?> _uploadBytes(
    List<int> bytes,
    String filename,
    String contentType, {
    required String category,
    required String folder,
  }) async {
    final api = context.read<ApiClient>();
    setState(() => _uploadStatus = 'Uploading…');
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
    final bytes = await file.readAsBytes();
    final name = file.path.split(Platform.pathSeparator).last;
    return _uploadBytes(
      bytes,
      name.endsWith('.mp4') ? name : '$name.mp4',
      'video/mp4',
      category: 'video',
      folder: folder,
    );
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
        const SnackBar(content: Text('Pick a video first')),
      );
      return;
    }
    final cover = await VideoCoverHelper.pickCoverImage();
    if (cover != null && mounted) setState(() => _pendingCover = cover);
  }

  Future<void> _autoCoverFromVideo() async {
    if (_pendingVideo == null) return;
    setState(() => _uploadStatus = 'Generating cover…');
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
    setState(() => _uploadStatus = 'Uploading cover…');
    return _uploadCoverFile(_pendingCover!, folder);
  }

  Future<void> _uploadCourseVideo() async {
    if (_courseId == null || _titleCtrl.text.trim().isEmpty) return;

    setState(() {
      _uploading = true;
      _uploadStatus = 'Preparing…';
    });
    try {
      final videoFile = await _prepareVideoForUpload();
      if (videoFile == null) return;

      final uploaded = await _uploadVideoFile(videoFile, 'teacher-courses');
      if (uploaded == null) throw Exception('Upload failed');

      if (_pendingCover == null) {
        setState(() => _uploadStatus = 'Generating cover…');
        _pendingCover = await VideoCoverHelper.thumbnailFromVideo(videoFile.path);
      }
      if (_pendingDurationSec == null || _pendingDurationSec! <= 0) {
        _pendingDurationSec = await VideoCoverHelper.videoDurationSec(videoFile.path);
      }

      final cover = await _uploadCoverIfAny('teacher-covers');

      await context.read<ApiClient>().post(
            '/api/teacher/courses/$_courseId/lessons',
            {
              'title': _titleCtrl.text.trim(),
              'fileKey': uploaded['key'],
              'fileUrl': uploaded['url'],
              if (cover != null) 'thumbnailKey': cover['key'],
              if (cover != null) 'thumbnailUrl': cover['url'],
              if (_pendingDurationSec != null) 'durationSec': _pendingDurationSec,
            },
          );
      if (!mounted) return;
      _titleCtrl.clear();
      _clearPendingMedia();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Video uploaded — pending review if course is live')),
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
      _uploadStatus = 'Preparing…';
    });
    try {
      final videoFile = await _prepareVideoForUpload();
      if (videoFile == null) return;

      final uploaded = await _uploadVideoFile(videoFile, 'teacher-shorts');
      if (uploaded == null) throw Exception('Upload failed');

      if (_pendingCover == null) {
        setState(() => _uploadStatus = 'Generating cover…');
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
        const SnackBar(content: Text('Short video submitted for review')),
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
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Teacher Studio'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Course Video'),
              Tab(text: 'Quiz'),
              Tab(text: 'Short Video'),
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
  final int? pendingDurationSec;
  final VoidCallback onUpload;
  final bool compressBeforeUpload;
  final ValueChanged<bool> onCompressChanged;
  final bool isShort;
  final List<Map<String, dynamic>> shorts;

  String get _videoName {
    if (pendingVideo == null) return 'No video selected';
    return pendingVideo!.path.split(Platform.pathSeparator).last;
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        TextField(
          controller: titleCtrl,
          decoration: InputDecoration(
            labelText: isShort ? 'Title' : 'Lesson title',
          ),
        ),
        if (isShort && descCtrl != null) ...[
          const SizedBox(height: 14),
          TextField(
            controller: descCtrl,
            maxLines: 3,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Description (shown on Reels)',
              hintText: 'What is this video about?',
              alignLabelWithHint: true,
            ),
          ),
        ],
        if (!isShort) ...[
          const SizedBox(height: 16),
          if (courses.isEmpty)
            const Text(
              'Create a course on the web teacher portal first.',
              style: TextStyle(color: AppTheme.muted),
            )
          else
            DropdownButtonFormField<String>(
              initialValue: courseId,
              decoration: const InputDecoration(labelText: 'Course'),
              items: courses
                  .map((c) => DropdownMenuItem(
                        value: c['id']?.toString(),
                        child: Text(c['titleEn']?.toString() ?? 'Course'),
                      ))
                  .toList(),
              onChanged: onCourse,
            ),
        ],
        const SizedBox(height: 16),
        const Text('Video file', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: uploading ? null : onSelectVideo,
          icon: const Icon(Icons.video_library_outlined),
          label: Text(pendingVideo == null ? 'Pick video' : 'Change video'),
        ),
        if (pendingVideo != null) ...[
          const SizedBox(height: 6),
          Text(
            _videoName,
            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
          if (pendingDurationSec != null)
            Text(
              'Duration: ${pendingDurationSec! ~/ 60}:${(pendingDurationSec! % 60).toString().padLeft(2, '0')}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
        ],
        const SizedBox(height: 16),
        const Text('Cover image (optional)', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        const Text(
          'Covers load instantly in feeds and course lists.',
          style: TextStyle(color: AppTheme.muted, fontSize: 12),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: uploading || pendingVideo == null ? null : onPickCover,
                icon: const Icon(Icons.image_outlined, size: 18),
                label: const Text('Choose cover'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: uploading || pendingVideo == null ? null : onAutoCover,
                icon: const Icon(Icons.auto_fix_high_outlined, size: 18),
                label: const Text('From video'),
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
            title: const Text(
              'Compress before upload',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
            subtitle: Text(
              compressBeforeUpload
                  ? 'Recommended — smaller files load faster.'
                  : 'Upload original quality (larger file).',
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
          label: Text(uploading ? (uploadStatus ?? 'Working…') : 'Upload video'),
        ),
        if (isShort && shorts.isNotEmpty) ...[
          const SizedBox(height: 24),
          const Text('Your short videos', style: TextStyle(fontWeight: FontWeight.bold)),
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
                subtitle: s['description'] != null
                    ? Text(
                        s['description'].toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12, color: AppTheme.muted),
                      )
                    : null,
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
