import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';
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

  Future<Map<String, String>?> _uploadFile(
    File file, {
    required String category,
    required String folder,
  }) async {
    final api = context.read<ApiClient>();
    final bytes = await file.readAsBytes();
    final name = file.path.split(Platform.pathSeparator).last;

    setState(() => _uploadStatus = 'Uploading…');
    final presign = await api.post('/api/admin/uploads', {
      'filename': name.endsWith('.mp4') ? name : '$name.mp4',
      'contentType': 'video/mp4',
      'size': bytes.length,
      'category': category,
      'folder': folder,
    });
    final uploadUrl = presign['uploadUrl']?.toString();
    final key = presign['key']?.toString();
    final publicUrl = presign['publicUrl']?.toString();
    if (uploadUrl == null || key == null) return null;

    await api.putBytes(uploadUrl, bytes, 'video/mp4');
    return {'key': key, 'url': publicUrl ?? uploadUrl};
  }

  Future<File?> _pickVideoFile() async {
    final pick = await FilePicker.pickFiles(type: FileType.video);
    if (pick == null || pick.files.isEmpty) return null;

    final file = pick.files.first;
    if (file.path != null) return File(file.path!);

    if (file.bytes != null) {
      final temp = File(
        '${Directory.systemTemp.path}/ulearn_upload_${DateTime.now().millisecondsSinceEpoch}.mp4',
      );
      await temp.writeAsBytes(file.bytes!);
      return temp;
    }
    return null;
  }

  Future<File?> _pickVideoForUpload() async {
    final source = await _pickVideoFile();
    if (source == null) return null;
    if (!_compressBeforeUpload) return source;
    return _compressVideo(source.path);
  }

  Future<void> _uploadCourseVideo() async {
    if (_courseId == null || _titleCtrl.text.trim().isEmpty) return;

    setState(() {
      _uploading = true;
      _uploadStatus = 'Preparing…';
    });
    try {
      final videoFile = await _pickVideoForUpload();
      if (videoFile == null) return;

      final uploaded = await _uploadFile(
        videoFile,
        category: 'video',
        folder: 'teacher-courses',
      );
      if (uploaded == null) throw Exception('Upload failed');

      await context.read<ApiClient>().post(
            '/api/teacher/courses/$_courseId/lessons',
            {
              'title': _titleCtrl.text.trim(),
              'fileKey': uploaded['key'],
              'fileUrl': uploaded['url'],
            },
          );
      if (!mounted) return;
      _titleCtrl.clear();
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
      final videoFile = await _pickVideoForUpload();
      if (videoFile == null) return;

      final uploaded = await _uploadFile(
        videoFile,
        category: 'video',
        folder: 'teacher-shorts',
      );
      if (uploaded == null) throw Exception('Upload failed');

      await context.read<ApiClient>().post('/api/teacher/short-videos', {
        'title': _titleCtrl.text.trim(),
        if (_descCtrl.text.trim().isNotEmpty) 'description': _descCtrl.text.trim(),
        'fileKey': uploaded['key'],
        'fileUrl': uploaded['url'],
      });
      if (!mounted) return;
      _titleCtrl.clear();
      _descCtrl.clear();
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
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Teacher Studio'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Course Video'),
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
                    onUpload: _uploadCourseVideo,
                    compressBeforeUpload: _compressBeforeUpload,
                    onCompressChanged: _setCompressBeforeUpload,
                  ),
                  _UploadTab(
                    titleCtrl: _titleCtrl,
                    descCtrl: _descCtrl,
                    uploading: _uploading,
                    uploadStatus: _uploadStatus,
                    courses: const [],
                    courseId: null,
                    onCourse: (_) {},
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
  final VoidCallback onUpload;
  final bool compressBeforeUpload;
  final ValueChanged<bool> onCompressChanged;
  final bool isShort;
  final List<Map<String, dynamic>> shorts;

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
                  ? 'Recommended — smaller files load faster in Reels.'
                  : 'Upload original quality (larger file, slower on mobile data).',
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
          label: Text(uploading ? (uploadStatus ?? 'Working…') : 'Pick & upload video'),
        ),
        if (isShort && shorts.isNotEmpty) ...[
          const SizedBox(height: 24),
          const Text('Your short videos', style: TextStyle(fontWeight: FontWeight.bold)),
          ...shorts.map((s) {
            final status = s['status']?.toString() ?? '';
            return Card(
              margin: const EdgeInsets.only(top: 8),
              child: ListTile(
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
