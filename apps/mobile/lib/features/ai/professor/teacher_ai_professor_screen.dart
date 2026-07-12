import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:provider/provider.dart';
import 'package:file_picker/file_picker.dart';
import 'dart:convert';

import 'package:flutter/material.dart';

/// Teacher AI Professor Studio — library, chat, exams, generate, tools.
class TeacherAiProfessorScreen extends StatefulWidget {
  const TeacherAiProfessorScreen({super.key, this.standalone = false});

  /// When true, wraps content in a Scaffold (home navigation).
  final bool standalone;

  @override
  State<TeacherAiProfessorScreen> createState() =>
      _TeacherAiProfessorScreenState();
}

class _TeacherAiProfessorScreenState extends State<TeacherAiProfessorScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _chatCtrl = TextEditingController();
  final _examTitleCtrl = TextEditingController();
  final _genTitleCtrl = TextEditingController();
  final _genTopicCtrl = TextEditingController();

  List<Map<String, dynamic>> _docs = [];
  List<Map<String, dynamic>> _courses = [];
  List<Map<String, dynamic>> _jobs = [];
  List<Map<String, dynamic>> _bank = [];
  final Set<String> _selected = {};
  final List<_Bubble> _chat = [];
  String? _conversationId;
  String? _courseId;
  String _docAction = 'SUMMARIZE';
  String _pdfTool = 'WATERMARK';
  String _genType = 'LECTURE';
  bool _loading = true;
  bool _busy = false;
  String? _message;

  static const _actions = [
    'SUMMARIZE',
    'EXPLAIN',
    'FLASHCARDS',
    'MIND_MAP',
    'NOTES',
    'QUESTIONS',
    'ASSIGNMENT',
  ];

  static const _pdfTools = [
    'MERGE',
    'SPLIT',
    'ROTATE',
    'WATERMARK',
    'COMPRESS',
    'EXTRACT_TEXT',
    'COMPARE',
  ];

  static const _genTypes = [
    'LECTURE',
    'NOTES',
    'STUDY_GUIDE',
    'SYLLABUS',
    'LESSON_PLAN',
    'LEARNING_OUTCOMES',
  ];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 7, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  @override
  void dispose() {
    _tabs.dispose();
    _chatCtrl.dispose();
    _examTitleCtrl.dispose();
    _genTitleCtrl.dispose();
    _genTopicCtrl.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final api = context.read<ApiClient>();
    try {
      final docs = await api.get('/api/teacher/ai/documents');
      final courses = await api.get('/api/teacher/courses');
      final jobs = await api.get('/api/teacher/ai/jobs');
      final bank = await api.get('/api/teacher/ai/question-bank');
      if (!mounted) return;
      setState(() {
        _docs = List<Map<String, dynamic>>.from(docs['documents'] ?? []);
        _courses = List<Map<String, dynamic>>.from(courses['courses'] ?? []);
        _jobs = List<Map<String, dynamic>>.from(jobs['jobs'] ?? []);
        _bank = List<Map<String, dynamic>>.from(bank['items'] ?? []);
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _message = e.toString();
      });
    }
  }

  Future<void> _upload() async {
    final picked = await FilePicker.pickFiles(
      allowMultiple: true,
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'doc', 'docx', 'txt', 'md'],
      withData: true,
    );
    if (picked == null || picked.files.isEmpty) return;
    final api = context.read<ApiClient>();
    final locale = context.read<LocaleProvider>().code.toLowerCase();
    setState(() => _busy = true);
    try {
      for (final f in picked.files) {
        final bytes = f.bytes;
        if (bytes == null) continue;
        final mime = _mimeFor(f.extension);
        final presign = await api.post('/api/admin/uploads', {
          'filename': f.name,
          'contentType': mime,
          'size': bytes.length,
          'category': 'document',
          'folder': 'professor-docs',
        });
        await api.putBytes(
          presign['uploadUrl'] as String,
          bytes,
          mime,
        );
        if (!mounted) return;
        await api.post('/api/teacher/ai/documents', {
          'fileName': f.name,
          'fileKey': presign['key'],
          'fileUrl': presign['publicUrl'],
          'mimeType': mime,
          'language': locale,
        });
      }
      if (!mounted) return;
      setState(() => _message = context.l10n.t('mobile.professor.uploadQueued'));
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      setState(() => _message = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _mimeFor(String? ext) {
    switch ((ext ?? '').toLowerCase()) {
      case 'pdf':
        return 'application/pdf';
      case 'doc':
        return 'application/msword';
      case 'docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'md':
        return 'text/markdown';
      default:
        return 'text/plain';
    }
  }

  Future<void> _sendChat() async {
    final q = _chatCtrl.text.trim();
    if (q.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _chat.add(_Bubble(role: 'user', text: q));
      _chatCtrl.clear();
    });
    final api = context.read<ApiClient>();
    try {
      final data = await api.post('/api/teacher/ai/chat', {
        'question': q,
        'language': context.read<LocaleProvider>().code.toLowerCase(),
        if (_selected.isNotEmpty) 'documentIds': _selected.toList(),
        if (_conversationId != null) 'conversationId': _conversationId,
      });
      if (!mounted) return;
      setState(() {
        _conversationId = data['conversationId'] as String? ?? _conversationId;
        _chat.add(_Bubble(role: 'assistant', text: '${data['answer'] ?? ''}'));
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _chat.add(_Bubble(role: 'assistant', text: e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _generateExam() async {
    if (_selected.isEmpty) {
      setState(() => _message = context.l10n.t('mobile.professor.selectDocs'));
      return;
    }
    setState(() => _busy = true);
    final api = context.read<ApiClient>();
    try {
      final data = await api.post('/api/teacher/ai/exams', {
        'documentIds': _selected.toList(),
        if (_examTitleCtrl.text.trim().isNotEmpty)
          'titleEn': _examTitleCtrl.text.trim(),
        'count': 8,
        'language': context.read<LocaleProvider>().code.toLowerCase(),
        if (_courseId != null) 'courseId': _courseId,
        'publish': _courseId != null,
        'versions': ['A', 'B', 'C'],
        'saveToBank': true,
      });
      setState(() {
        _message =
            '${context.l10n.t('mobile.professor.jobStarted')}: ${data['jobId']}';
        _tabs.index = 6;
      });
      await _refresh();
    } catch (e) {
      setState(() => _message = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _generateContent() async {
    if (_genTitleCtrl.text.trim().isEmpty) return;
    setState(() => _busy = true);
    final api = context.read<ApiClient>();
    try {
      final data = await api.post('/api/teacher/ai/generations', {
        'type': _genType,
        'title': _genTitleCtrl.text.trim(),
        'language': context.read<LocaleProvider>().code.toLowerCase(),
        'params': {
          'topic': _genTopicCtrl.text.trim(),
          'pages': 3,
          if (_selected.isNotEmpty) 'documentIds': _selected.toList(),
          'exportFormats': ['markdown', 'html', 'pdf', 'docx', 'pptx'],
        },
      });
      setState(() {
        _message =
            '${context.l10n.t('mobile.professor.jobStarted')}: ${data['jobId']}';
        _tabs.index = 6;
      });
      await _refresh();
    } catch (e) {
      setState(() => _message = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runDocAi() async {
    if (_selected.length != 1) {
      setState(() => _message = context.l10n.t('mobile.professor.selectOneDoc'));
      return;
    }
    setState(() => _busy = true);
    final api = context.read<ApiClient>();
    try {
      final data = await api.post('/api/teacher/ai/document-actions', {
        'documentId': _selected.first,
        'action': _docAction,
        'language': context.read<LocaleProvider>().code.toLowerCase(),
      });
      setState(() {
        _message =
            '${context.l10n.t('mobile.professor.jobStarted')}: ${data['jobId']}';
        _tabs.index = 6;
      });
      await _refresh();
    } catch (e) {
      setState(() => _message = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runPdf() async {
    if (_selected.isEmpty) return;
    setState(() => _busy = true);
    final api = context.read<ApiClient>();
    try {
      final data = await api.post('/api/teacher/ai/pdf-tools', {
        'tool': _pdfTool,
        'documentIds': _selected.toList(),
        'options': {
          'watermarkText': 'u learn',
          'rotateDegrees': 90,
          if (_selected.length > 1) 'compareWithDocumentId': _selected.elementAt(1),
        },
      });
      setState(() {
        _message =
            '${context.l10n.t('mobile.professor.jobStarted')}: ${data['jobId']}';
        _tabs.index = 6;
      });
      await _refresh();
    } catch (e) {
      setState(() => _message = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    if (_loading) {
      final loading = const Center(
        child: CircularProgressIndicator(color: AppTheme.accent),
      );
      if (!widget.standalone) return loading;
      return Scaffold(
        appBar: AppBar(title: Text(l10n.t('mobile.professor.title'))),
        body: loading,
      );
    }

    final body = Column(
      children: [
        if (_message != null)
          Material(
            color: AppTheme.accent.withValues(alpha: 0.12),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Row(
                children: [
                  Expanded(child: Text(_message!)),
                  IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => setState(() => _message = null),
                  ),
                ],
              ),
            ),
          ),
        TabBar(
          controller: _tabs,
          isScrollable: true,
          indicatorColor: AppTheme.accent,
          labelColor: AppTheme.accent,
          unselectedLabelColor: AppTheme.muted,
          tabs: [
            Tab(text: l10n.t('mobile.professor.tabLibrary')),
            Tab(text: l10n.t('mobile.professor.tabChat')),
            Tab(text: l10n.t('mobile.professor.tabExams')),
            Tab(text: l10n.t('mobile.professor.tabGenerate')),
            Tab(text: l10n.t('mobile.professor.tabDocAi')),
            Tab(text: l10n.t('mobile.professor.tabBank')),
            Tab(text: l10n.t('mobile.professor.tabJobs')),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              _libraryTab(l10n),
              _chatTab(l10n),
              _examsTab(l10n),
              _generateTab(l10n),
              _docAiTab(l10n),
              _bankTab(l10n),
              _jobsTab(l10n),
            ],
          ),
        ),
      ],
    );

    if (!widget.standalone) return body;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.t('mobile.professor.title')),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _loading ? null : _refresh,
          ),
        ],
      ),
      body: body,
    );
  }

  Widget _libraryTab(dynamic l10n) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        FilledButton.icon(
          onPressed: _busy ? null : _upload,
          icon: const Icon(Icons.upload_file_rounded),
          label: Text(l10n.t('mobile.professor.upload')),
          style: FilledButton.styleFrom(backgroundColor: AppTheme.accent),
        ),
        const SizedBox(height: 12),
        ..._docs.map((d) {
          final id = d['id'] as String;
          return CheckboxListTile(
            value: _selected.contains(id),
            onChanged: (_) => setState(() {
              if (_selected.contains(id)) {
                _selected.remove(id);
              } else {
                _selected.add(id);
              }
            }),
            title: Text('${d['fileName']}'),
            subtitle: Text('${d['status']} · ${d['chunkCount'] ?? 0} chunks'),
          );
        }),
        if (_docs.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 40),
            child: Text(
              l10n.t('mobile.professor.emptyDocs'),
              textAlign: TextAlign.center,
              style: TextStyle(color: AppTheme.muted),
            ),
          ),
      ],
    );
  }

  Widget _chatTab(dynamic l10n) {
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _chat.length,
            itemBuilder: (_, i) {
              final b = _chat[i];
              final mine = b.role == 'user';
              return Align(
                alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  constraints: BoxConstraints(
                    maxWidth: MediaQuery.of(context).size.width * 0.85,
                  ),
                  decoration: BoxDecoration(
                    color: mine
                        ? AppTheme.accent.withValues(alpha: 0.2)
                        : Colors.white.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Text(b.text),
                ),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _chatCtrl,
                  decoration: InputDecoration(
                    hintText: l10n.t('mobile.professor.chatHint'),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onSubmitted: (_) => _sendChat(),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                onPressed: _busy ? null : _sendChat,
                icon: const Icon(Icons.send_rounded),
                style: IconButton.styleFrom(backgroundColor: AppTheme.accent),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _examsTab(dynamic l10n) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        TextField(
          controller: _examTitleCtrl,
          decoration: InputDecoration(labelText: l10n.t('mobile.professor.examTitle')),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String?>(
          initialValue: _courseId,
          decoration: InputDecoration(labelText: l10n.t('mobile.professor.course')),
          items: [
            DropdownMenuItem(value: null, child: Text(l10n.t('mobile.professor.previewOnly'))),
            ..._courses.map(
              (c) => DropdownMenuItem(
                value: c['id'] as String,
                child: Text('${c['titleEn']}'),
              ),
            ),
          ],
          onChanged: (v) => setState(() => _courseId = v),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _generateExam,
          child: Text(l10n.t('mobile.professor.generateExam')),
        ),
      ],
    );
  }

  Widget _generateTab(dynamic l10n) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DropdownButtonFormField<String>(
          initialValue: _genType,
          items: _genTypes
              .map((t) => DropdownMenuItem(value: t, child: Text(t)))
              .toList(),
          onChanged: (v) => setState(() => _genType = v ?? _genType),
          decoration: InputDecoration(labelText: l10n.t('mobile.professor.genType')),
        ),
        TextField(
          controller: _genTitleCtrl,
          decoration: InputDecoration(labelText: l10n.t('mobile.professor.genTitle')),
        ),
        TextField(
          controller: _genTopicCtrl,
          decoration: InputDecoration(labelText: l10n.t('mobile.professor.genTopic')),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _generateContent,
          child: Text(l10n.t('mobile.professor.generateContent')),
        ),
      ],
    );
  }

  Widget _docAiTab(dynamic l10n) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DropdownButtonFormField<String>(
          initialValue: _docAction,
          items: _actions
              .map((a) => DropdownMenuItem(value: a, child: Text(a)))
              .toList(),
          onChanged: (v) => setState(() => _docAction = v ?? _docAction),
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _busy ? null : _runDocAi,
          child: Text(l10n.t('mobile.professor.runDocAi')),
        ),
        const Divider(height: 32),
        DropdownButtonFormField<String>(
          initialValue: _pdfTool,
          items: _pdfTools
              .map((a) => DropdownMenuItem(value: a, child: Text(a)))
              .toList(),
          onChanged: (v) => setState(() => _pdfTool = v ?? _pdfTool),
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _busy ? null : _runPdf,
          child: Text(l10n.t('mobile.professor.runPdf')),
        ),
      ],
    );
  }

  Widget _bankTab(dynamic l10n) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _bank.length,
      itemBuilder: (_, i) {
        final q = _bank[i];
        return Card(
          child: ListTile(
            title: Text('${q['text']}'),
            subtitle: Text('${q['questionType']} · ${q['difficulty'] ?? '-'}'),
          ),
        );
      },
    );
  }

  Widget _jobsTab(dynamic l10n) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _jobs.length,
      itemBuilder: (_, i) {
        final j = _jobs[i];
        final result = j['resultJson'];
        String? artifactId;
        if (result is Map) {
          artifactId = result['artifactId'] as String?;
          final ids = result['artifactIds'];
          if (artifactId == null && ids is List && ids.isNotEmpty) {
            artifactId = ids.first as String?;
          }
        }
        return ListTile(
          title: Text('${j['type']} · ${j['status']} · ${j['progress']}%'),
          subtitle: j['errorMessage'] != null
              ? Text('${j['errorMessage']}', style: const TextStyle(color: Colors.redAccent))
              : (artifactId != null
                  ? Text('artifact: $artifactId')
                  : Text(jsonEncode(result ?? {}))),
        );
      },
    );
  }
}

class _Bubble {
  _Bubble({required this.role, required this.text});
  final String role;
  final String text;
}
