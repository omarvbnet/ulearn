import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';

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
  bool _loading = true;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final [coursesRes, shortsRes] = await Future.wait([
        context.read<ApiClient>().get('/api/teacher/courses'),
        context.read<ApiClient>().get('/api/teacher/short-videos'),
      ]);
      if (!mounted) return;
      setState(() {
        _courses = ((coursesRes['courses'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _shorts = ((shortsRes['videos'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>();
        _courseId ??= _courses.isNotEmpty ? _courses.first['id']?.toString() : null;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<Map<String, String>?> _uploadFile(
    PlatformFile file, {
    required String category,
    required String folder,
  }) async {
    final api = context.read<ApiClient>();
    final presign = await api.post('/api/admin/uploads', {
      'filename': file.name,
      'contentType': file.extension == 'mp4' ? 'video/mp4' : 'video/*',
      'size': file.size,
      'category': category,
      'folder': folder,
    });
    final uploadUrl = presign['uploadUrl']?.toString();
    final key = presign['key']?.toString();
    final publicUrl = presign['publicUrl']?.toString();
    if (uploadUrl == null || key == null) return null;

    await api.putBytes(
      uploadUrl,
      file.bytes!,
      file.extension == 'mp4' ? 'video/mp4' : 'video/mp4',
    );
    return {'key': key, 'url': publicUrl ?? uploadUrl};
  }

  Future<void> _uploadCourseVideo() async {
    if (_courseId == null || _titleCtrl.text.trim().isEmpty) return;
    final pick = await FilePicker.pickFiles(
      type: FileType.video,
      withData: true,
    );
    if (pick == null || pick.files.isEmpty || pick.files.first.bytes == null) return;

    setState(() => _uploading = true);
    try {
      final file = pick.files.first;
      final uploaded = await _uploadFile(
        file,
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
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _uploadShort() async {
    if (_titleCtrl.text.trim().isEmpty) return;
    final pick = await FilePicker.pickFiles(
      type: FileType.video,
      withData: true,
    );
    if (pick == null || pick.files.isEmpty || pick.files.first.bytes == null) return;

    setState(() => _uploading = true);
    try {
      final file = pick.files.first;
      final uploaded = await _uploadFile(
        file,
        category: 'video',
        folder: 'teacher-shorts',
      );
      if (uploaded == null) throw Exception('Upload failed');

      await context.read<ApiClient>().post('/api/teacher/short-videos', {
        'title': _titleCtrl.text.trim(),
        'fileKey': uploaded['key'],
        'fileUrl': uploaded['url'],
      });
      if (!mounted) return;
      _titleCtrl.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Short video submitted for review')),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _uploading = false);
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
                    uploading: _uploading,
                    courses: _courses,
                    courseId: _courseId,
                    onCourse: (id) => setState(() => _courseId = id),
                    onUpload: _uploadCourseVideo,
                  ),
                  _UploadTab(
                    titleCtrl: _titleCtrl,
                    uploading: _uploading,
                    courses: const [],
                    courseId: null,
                    onCourse: (_) {},
                    onUpload: _uploadShort,
                    isShort: true,
                    shorts: _shorts,
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
    required this.uploading,
    required this.courses,
    required this.courseId,
    required this.onCourse,
    required this.onUpload,
    this.isShort = false,
    this.shorts = const [],
  });

  final TextEditingController titleCtrl;
  final bool uploading;
  final List<Map<String, dynamic>> courses;
  final String? courseId;
  final ValueChanged<String?> onCourse;
  final VoidCallback onUpload;
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
            labelText: isShort ? 'Short video title' : 'Lesson title',
          ),
        ),
        if (!isShort) ...[
          const SizedBox(height: 16),
          if (courses.isEmpty)
            const Text('Create a course on the web teacher portal first.',
                style: TextStyle(color: AppTheme.muted))
          else
            DropdownButtonFormField<String>(
              value: courseId,
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
          label: Text(uploading ? 'Uploading…' : 'Pick & upload video'),
        ),
        if (isShort && shorts.isNotEmpty) ...[
          const SizedBox(height: 24),
          const Text('Your short videos', style: TextStyle(fontWeight: FontWeight.bold)),
          ...shorts.map((s) => ListTile(
                title: Text(s['title']?.toString() ?? ''),
                trailing: Text(s['status']?.toString() ?? '', style: const TextStyle(fontSize: 12)),
              )),
        ],
      ],
    );
  }
}
