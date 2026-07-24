import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new/return_code.dart';
import 'package:http/http.dart' as http;
import 'package:ulearn/features/whiteboard/domain/edit_diff.dart';
import 'package:ulearn/features/whiteboard/domain/board_state.dart';
import 'package:ulearn/features/whiteboard/domain/event_engine.dart';
import 'package:ulearn/features/whiteboard/domain/package.dart';
import 'package:ulearn/features/whiteboard/domain/smoothing.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';
import 'package:ulearn/features/whiteboard/ui/pdf_underlay.dart';
import 'package:ulearn/features/whiteboard/ui/whiteboard_painter.dart';
import 'package:uuid/uuid.dart';

/// Teacher Whiteboard Studio — records mic + vector events into a .ubrd package.
class WhiteboardStudioScreen extends StatefulWidget {
  const WhiteboardStudioScreen({
    super.key,
    required this.courseId,
    required this.courseTitle,
    this.initialTitle,
    this.lessonId,
    this.whiteboardId,
  });

  final String courseId;
  final String courseTitle;
  final String? initialTitle;
  /// When set with [whiteboardId], opens edit mode for an existing lesson.
  final String? lessonId;
  final String? whiteboardId;

  @override
  State<WhiteboardStudioScreen> createState() => _WhiteboardStudioScreenState();
}

class _WhiteboardStudioScreenState extends State<WhiteboardStudioScreen> {
  final _engine = EventEngine();
  final _board = BoardState();
  final _recorder = AudioRecorder();
  final _uuid = const Uuid();
  final _titleCtrl = TextEditingController();

  WhiteboardTool _tool = WhiteboardTool.pen;
  String _color = '#111827';
  bool _recording = false;
  bool _saving = false;
  /// 0–100 overall publish progress while finishing a board lesson.
  int _publishPercent = 0;
  String _publishPhase = '';
  String? _audioPath;
  BoardStroke? _activeStroke;
  String? _shapeId;
  Offset? _shapeStart;
  Timer? _autosaveTimer;
  final List<UbrdPdfAsset> _pdfs = [];
  final _pdfCache = PdfUnderlayCache();
  ui.Image? _pdfUnderlay;
  bool _pdfLoading = false;
  bool get _editMode =>
      widget.lessonId != null &&
      widget.lessonId!.isNotEmpty &&
      widget.whiteboardId != null &&
      widget.whiteboardId!.isNotEmpty;
  List<WhiteboardEditRange> _dirtyRanges = [];
  int _previousDurationMs = 0;
  bool _loadingEdit = false;
  String? _baseAudioPath;

  void _markDirty(int startMs, int endMs, {String kind = 'redraw'}) {
    if (!_editMode) return;
    setState(() {
      _dirtyRanges = markDirtyRange(_dirtyRanges, startMs, endMs, kind: kind);
    });
  }

  void _setPublishProgress(int percent, String phase) {
    if (!mounted) return;
    setState(() {
      _publishPercent = percent.clamp(0, 100);
      _publishPhase = phase;
    });
  }

  @override
  void initState() {
    super.initState();
    _titleCtrl.text = widget.initialTitle ?? 'Whiteboard lesson';
    _board.theme = WhiteboardThemeId.white;
    _autosaveTimer = Timer.periodic(const Duration(seconds: 20), (_) => _autosaveDraft());
    if (_editMode) {
      _loadingEdit = true;
      unawaited(_loadExistingPackage());
    } else {
      _restoreDraftIfAny();
    }
  }

  Future<void> _loadExistingPackage() async {
    try {
      final api = context.read<ApiClient>();
      final res = await api.get('/api/whiteboards/${widget.whiteboardId}');
      final url = (res['playback'] as Map?)?['packageUrl']?.toString();
      if (url == null || url.isEmpty) throw StateError('NO_PACKAGE_URL');
      final bin = await http.get(Uri.parse(ApiClient.absoluteUrl(url)));
      if (bin.statusCode < 200 || bin.statusCode >= 300) {
        throw StateError('PACKAGE_DOWNLOAD_${bin.statusCode}');
      }
      final parsed = parseUbrdPackage(Uint8List.fromList(bin.bodyBytes));
      _engine.load(parsed.events);
      _board.reset();
      _board.theme = parsed.manifest.theme;
      _board.applyEvents(parsed.events);
      _pdfs
        ..clear()
        ..addAll(parsed.pdfs);
      _previousDurationMs = parsed.manifest.durationMs;
      final dir = await getApplicationDocumentsDirectory();
      final audioPath =
          '${dir.path}/wb_edit_${widget.lessonId}_${parsed.audioFileName}';
      await File(audioPath).writeAsBytes(parsed.audioBytes, flush: true);
      _audioPath = audioPath;
      _baseAudioPath = audioPath;
      if (!mounted) return;
      setState(() {
        _loadingEdit = false;
        _tool = WhiteboardTool.pen;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingEdit = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not load board for edit: $e')),
      );
    }
  }

  Future<void> _restoreDraftIfAny() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final draft = File('${dir.path}/wb_draft_${widget.courseId}.json');
      if (!await draft.exists()) return;
      final raw = jsonDecode(await draft.readAsString()) as Map<String, dynamic>;
      final events = ((raw['events'] as List?) ?? [])
          .map((e) => UbrdEvent.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList();
      if (events.isEmpty || !mounted) return;
      final restore = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Recover draft?'),
          content: Text('Found a whiteboard draft from ${raw['savedAt'] ?? 'earlier'}.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Discard')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Restore')),
          ],
        ),
      );
      if (restore != true || !mounted) {
        if (restore == false) await draft.delete();
        return;
      }
      _engine.load(events);
      _board.reset();
      _board.applyEvents(events);
      if (raw['title'] is String) _titleCtrl.text = raw['title'] as String;
      if (raw['theme'] is String) {
        _board.theme = WhiteboardThemeIdX.parse(raw['theme'] as String);
      }
      setState(() {});
    } catch (_) {}
  }

  Future<void> _attachCoursePdf() async {
    try {
      final api = context.read<ApiClient>();
      final res = await api.get('/api/teacher/courses/${widget.courseId}/documents');
      final docs = ((res['documents'] as List?) ?? (res['materials'] as List?) ?? [])
          .cast<Map<String, dynamic>>()
          .where((d) {
            final type = (d['type']?.toString() ?? 'PDF').toUpperCase();
            final mime = (d['mimeType']?.toString() ?? '').toLowerCase();
            return type == 'PDF' || mime.contains('pdf');
          })
          .toList();
      if (docs.isEmpty || !mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No course PDFs found — upload a document first')),
        );
        return;
      }
      final chosen = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        builder: (ctx) => SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: [
              for (final d in docs)
                ListTile(
                  leading: const Icon(Icons.picture_as_pdf),
                  title: Text(d['title']?.toString() ?? 'PDF'),
                  onTap: () => Navigator.pop(ctx, d),
                ),
            ],
          ),
        ),
      );
      if (chosen == null || !mounted) return;
      final assetId = 'pdf_${chosen['id']}';
      final asset = UbrdPdfAsset(
        assetId: assetId,
        materialId: chosen['id']?.toString(),
        fileKey: chosen['fileKey']?.toString(),
        fileUrl: chosen['fileUrl']?.toString(),
        title: chosen['title']?.toString() ?? 'PDF',
      );
      if (resolveUbrdPdfUrl(asset) == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('This PDF has no downloadable file URL')),
        );
        return;
      }
      setState(() => _pdfLoading = true);
      await _pdfCache.preload(asset);
      _pdfs.removeWhere((p) => p.assetId == assetId);
      _pdfs.add(UbrdPdfAsset(
        assetId: asset.assetId,
        materialId: asset.materialId,
        fileKey: asset.fileKey,
        fileUrl: asset.fileUrl,
        title: asset.title,
        pageCount: _pdfCache.pageCount(assetId),
      ));
      final pageId = 'page_${_uuid.v4()}';
      _board.addBlankPage(pageId);
      final page = _board.currentPage;
      if (page != null) {
        page.kind = 'pdf';
        page.pdfAssetId = assetId;
        page.pdfPage = 1;
      }
      if (_recording) {
        _engine.push('pdf_open', {'assetId': assetId, 'title': chosen['title']});
        _engine.push('page_add', {
          'pageId': pageId,
          'index': _board.pages.length - 1,
          'kind': 'pdf',
          'pdfAssetId': assetId,
          'pdfPage': 1,
        });
        _engine.push('page_select', {'pageId': pageId});
      }
      await _refreshPdfUnderlay();
      if (mounted) {
        setState(() => _pdfLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('PDF opened: ${asset.title}')),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _pdfLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('PDF attach failed: $e')));
      }
    }
  }

  Future<void> _refreshPdfUnderlay() async {
    final page = _board.currentPage;
    if (page == null || page.kind != 'pdf' || page.pdfAssetId == null) {
      if (mounted) setState(() => _pdfUnderlay = null);
      return;
    }
    final img = await _pdfCache.imageFor(page.pdfAssetId!, page.pdfPage ?? 1);
    if (!mounted) return;
    setState(() => _pdfUnderlay = img);
  }

  Future<void> _shiftPdfPage(int delta) async {
    final page = _board.currentPage;
    if (page == null || page.kind != 'pdf' || page.pdfAssetId == null) return;
    final total = _pdfCache.pageCount(page.pdfAssetId!) ?? 1;
    final next = ((page.pdfPage ?? 1) + delta).clamp(1, total);
    if (next == page.pdfPage) return;
    page.pdfPage = next;
    if (_recording) {
      _engine.push('pdf_page', {'assetId': page.pdfAssetId, 'page': next});
    }
    await _refreshPdfUnderlay();
  }

  @override
  void dispose() {
    _autosaveTimer?.cancel();
    _titleCtrl.dispose();
    _recorder.dispose();
    unawaited(_pdfCache.dispose());
    super.dispose();
  }

  Color get _chromeBg =>
      _board.theme == WhiteboardThemeId.black ? const Color(0xFF111827) : const Color(0xFFEEF2F7);
  Color get _chromeFg =>
      _board.theme == WhiteboardThemeId.black ? Colors.white : const Color(0xFF0F172A);

  Future<void> _toggleTheme() async {
    setState(() {
      _board.theme = _board.theme == WhiteboardThemeId.white
          ? WhiteboardThemeId.black
          : WhiteboardThemeId.white;
      _color = _board.theme == WhiteboardThemeId.black ? '#F8FAFC' : '#111827';
    });
    if (_recording) {
      _engine.push('theme_change', {'theme': _board.theme.wire});
      _engine.push('color_change', {'color': _color});
    }
  }

  Future<void> _startRecording() async {
    final ok = await _recorder.hasPermission();
    if (!ok) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Microphone permission required')),
        );
      }
      return;
    }
    final dir = await getTemporaryDirectory();
    _audioPath = '${dir.path}/wb_${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 128000, sampleRate: 44100),
      path: _audioPath!,
    );
    if (_editMode && _engine.length > 0) {
      _engine.resumeAt(_previousDurationMs);
      _markDirty(_previousDurationMs, _previousDurationMs + 1, kind: 'audio');
    } else {
      _engine.start();
      _engine.push('session_start', {
        'theme': _board.theme.wire,
        'boardWidth': kLogicalBoardWidth,
        'boardHeight': kLogicalBoardHeight,
      });
      // Capture pages/PDFs attached before recording so drawing over them is replayed.
      for (final pdf in _pdfs) {
        _engine.push('pdf_open', {'assetId': pdf.assetId, 'title': pdf.title});
      }
      for (var i = 0; i < _board.pages.length; i++) {
        final page = _board.pages[i];
        // Default blank page_0 already exists on playback reset — skip recreating it.
        if (page.id == 'page_0' && page.kind == 'blank') continue;
        _engine.push('page_add', {
          'pageId': page.id,
          'index': i,
          'kind': page.kind,
          if (page.pdfAssetId != null) 'pdfAssetId': page.pdfAssetId,
          if (page.pdfPage != null) 'pdfPage': page.pdfPage,
        });
      }
      _engine.push('page_select', {'pageId': _board.currentPageId});
      final current = _board.currentPage;
      if (current?.kind == 'pdf' && current?.pdfAssetId != null) {
        _engine.push('pdf_page', {
          'assetId': current!.pdfAssetId,
          'page': current.pdfPage ?? 1,
        });
      }
    }
    setState(() => _recording = true);
    if (mounted && _board.currentPage?.kind == 'pdf') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Recording — draw or highlight on the PDF to explain'),
          duration: Duration(seconds: 3),
        ),
      );
    }
  }

  Future<void> _cutTimeRangeDialog() async {
    if (!_editMode || _baseAudioPath == null) return;
    final startCtrl = TextEditingController(text: '0');
    final endCtrl = TextEditingController(
      text: (_previousDurationMs / 1000).round().toString(),
    );
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cut time range'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: startCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Start (seconds)'),
            ),
            TextField(
              controller: endCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'End (seconds)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cut')),
        ],
      ),
    );
    if (ok != true) return;
    final lo = ((double.tryParse(startCtrl.text) ?? 0) * 1000).round();
    final hi = ((double.tryParse(endCtrl.text) ?? 0) * 1000).round();
    if (hi - lo < 100) return;
    final removed = _engine.cutRange(lo, hi);
    final dir = await getTemporaryDirectory();
    final outPath = '${dir.path}/wb_cut_${DateTime.now().millisecondsSinceEpoch}.m4a';
    final inPath = _baseAudioPath!;
    final session = await FFmpegKit.execute(
      "-y -i '${inPath.replaceAll("'", r"'\''")}' "
      "-af \"aselect='not(between(t\\,${lo / 1000}\\,${hi / 1000}))',asetpts=N/SR/TB\" "
      "-c:a aac -b:a 128k '${outPath.replaceAll("'", r"'\''")}'",
    );
    final code = await session.getReturnCode();
    if (ReturnCode.isSuccess(code) && await File(outPath).exists()) {
      _baseAudioPath = outPath;
      _audioPath = outPath;
    }
    _previousDurationMs = (_previousDurationMs - removed).clamp(0, 1 << 30);
    setState(() {
      _dirtyRanges = markDirtyRange(_dirtyRanges, lo, lo, kind: 'trim')
          .map((r) => r.kind == 'trim' && (r.startMs - lo).abs() < 2000
              ? WhiteboardEditRange(
                  id: r.id,
                  startMs: r.startMs,
                  endMs: r.endMs,
                  kind: 'trim',
                  removedMs: removed,
                )
              : r)
          .toList();
    });
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Cut ${removed}ms — publish to submit for review')),
      );
    }
  }

  Future<void> _publishEditPackage() async {
    if (!_editMode || _recording || _saving || _dirtyRanges.isEmpty) return;
    setState(() {
      _saving = true;
      _publishPercent = 0;
      _publishPhase = 'Packaging edit…';
    });
    try {
      final audioPath = _baseAudioPath ?? _audioPath;
      if (audioPath == null || !await File(audioPath).exists()) {
        throw StateError('AUDIO_MISSING');
      }
      final durationMs = _previousDurationMs > 0
          ? _previousDurationMs
          : (_engine.all.isNotEmpty ? _engine.all.last.t : 0);
      final audioBytes = Uint8List.fromList(await File(audioPath).readAsBytes());
      final packageBytes = await buildUbrdPackage(
        engine: _engine,
        audioBytes: audioBytes,
        theme: _board.theme,
        pageCount: _board.pages.length,
        durationMs: durationMs,
        pdfs: _pdfs,
      );
      final api = context.read<ApiClient>();
      _setPublishProgress(22, 'Preparing upload…');
      final upload = await api.post('/api/whiteboards/upload-url', {
        'courseId': widget.courseId,
        'filename': 'lesson.ubrd',
        'contentType': 'application/octet-stream',
        'size': packageBytes.length,
        'theme': _board.theme.wire,
      });
      final uploadUrl = upload['uploadUrl'] as String;
      final whiteboardId = upload['whiteboardId'] as String;
      final objectKey = upload['objectKey'] as String?;
      _setPublishProgress(28, 'Uploading…');
      await api.putBytes(
        uploadUrl,
        packageBytes,
        'application/octet-stream',
        onProgress: (sent, total) {
          if (total <= 0) return;
          final uploadPct = (sent / total).clamp(0.0, 1.0);
          _setPublishProgress((28 + uploadPct * 60).round(), 'Uploading…');
        },
      );
      await api.post('/api/whiteboards/complete', {
        'whiteboardId': whiteboardId,
        'size': packageBytes.length,
        'durationSec': (durationMs / 1000).ceil(),
        'theme': _board.theme.wire,
        'schemaVersion': kUbrdSchemaVersion,
      });
      final patch = await api.patch(
        '/api/teacher/courses/${widget.courseId}/lessons/${widget.lessonId}',
        {
          'whiteboardAssetId': whiteboardId,
          'durationSec': (durationMs / 1000).ceil(),
          if (objectKey != null) 'fileKey': objectKey,
          'editDiff': {
            'ranges': _dirtyRanges.map((e) => e.toJson()).toList(),
            'previousDurationMs': _previousDurationMs,
            'newDurationMs': durationMs,
          },
        },
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              patch['pendingReview'] == true
                  ? 'Whiteboard edit submitted for admin review'
                  : 'Whiteboard lesson updated',
            ),
          ),
        );
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
          _publishPercent = 0;
          _publishPhase = '';
        });
      }
    }
  }

  Future<void> _stopAndPublish() async {
    if (!_recording || _saving) return;
    setState(() {
      _saving = true;
      _publishPercent = 0;
      _publishPhase = 'Packaging lesson…';
    });
    try {
      _setPublishProgress(5, 'Stopping recording…');
      final path = await _recorder.stop();
      final durationMs = _engine.stop();
      final audioFile = File(path ?? _audioPath ?? '');
      if (!await audioFile.exists()) {
        throw StateError('AUDIO_MISSING');
      }
      _setPublishProgress(12, 'Building board package…');
      var audioBytes = Uint8List.fromList(await audioFile.readAsBytes());
      // Edit continue-recording: properly concatenate AAC with FFmpeg.
      if (_editMode &&
          _baseAudioPath != null &&
          _baseAudioPath != audioFile.path &&
          await File(_baseAudioPath!).exists()) {
        final dir = await getTemporaryDirectory();
        final outPath =
            '${dir.path}/wb_concat_${DateTime.now().millisecondsSinceEpoch}.m4a';
        final session = await FFmpegKit.execute(
          "-y -i '${_baseAudioPath!.replaceAll("'", r"'\''")}' "
          "-i '${audioFile.path.replaceAll("'", r"'\''")}' "
          "-filter_complex '[0:a][1:a]concat=n=2:v=0:a=1[a]' -map '[a]' -c:a aac -b:a 128k "
          "'${outPath.replaceAll("'", r"'\''")}'",
        );
        final code = await session.getReturnCode();
        if (ReturnCode.isSuccess(code) && await File(outPath).exists()) {
          audioBytes = Uint8List.fromList(await File(outPath).readAsBytes());
        }
      }
      final packageBytes = await buildUbrdPackage(
        engine: _engine,
        audioBytes: audioBytes,
        theme: _board.theme,
        pageCount: _board.pages.length,
        durationMs: durationMs,
        pdfs: _pdfs,
      );

      _setPublishProgress(22, 'Preparing upload…');
      final api = context.read<ApiClient>();
      final upload = await api.post('/api/whiteboards/upload-url', {
        'courseId': widget.courseId,
        'filename': 'lesson.ubrd',
        'contentType': 'application/octet-stream',
        'size': packageBytes.length,
        'theme': _board.theme.wire,
      });
      final uploadUrl = upload['uploadUrl'] as String;
      final whiteboardId = upload['whiteboardId'] as String;
      final objectKey = upload['objectKey'] as String?;

      _setPublishProgress(28, 'Uploading board… 0%');
      await api.putBytes(
        uploadUrl,
        packageBytes,
        'application/octet-stream',
        onProgress: (sent, total) {
          if (total <= 0) return;
          // Map byte upload into 28% → 88% of the overall bar.
          final uploadPct = (sent / total).clamp(0.0, 1.0);
          final overall = (28 + (uploadPct * 60)).round();
          final uploadOnly = (uploadPct * 100).round();
          _setPublishProgress(overall, 'Uploading board… $uploadOnly%');
        },
      );

      _setPublishProgress(90, 'Finalizing upload…');
      await api.post('/api/whiteboards/complete', {
        'whiteboardId': whiteboardId,
        'size': packageBytes.length,
        'durationSec': (durationMs / 1000).ceil(),
        'theme': _board.theme.wire,
        'schemaVersion': kUbrdSchemaVersion,
      });

      _setPublishProgress(95, _editMode ? 'Submitting edit…' : 'Creating lesson…');
      if (_editMode) {
        final patch = await api.patch(
          '/api/teacher/courses/${widget.courseId}/lessons/${widget.lessonId}',
          {
            'whiteboardAssetId': whiteboardId,
            'durationSec': (durationMs / 1000).ceil(),
            if (objectKey != null) 'fileKey': objectKey,
            'editDiff': {
              'ranges': _dirtyRanges.map((e) => e.toJson()).toList(),
              'previousDurationMs': _previousDurationMs,
              'newDurationMs': durationMs,
            },
          },
        );
        _setPublishProgress(100, 'Submitted');
        if (mounted) {
          final pending = patch['pendingReview'] == true;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                pending
                    ? 'Whiteboard edit submitted for admin review'
                    : 'Whiteboard lesson updated',
              ),
            ),
          );
          Navigator.of(context).pop(true);
        }
        return;
      }

      await api.post('/api/teacher/courses/${widget.courseId}/lessons', {
        'title': _titleCtrl.text.trim().isEmpty ? 'Whiteboard lesson' : _titleCtrl.text.trim(),
        'lessonType': 'WHITEBOARD',
        'whiteboardAssetId': whiteboardId,
        'durationSec': (durationMs / 1000).ceil(),
        if (objectKey != null) 'fileKey': objectKey,
      });

      _setPublishProgress(100, 'Published');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Whiteboard lesson published')),
        );
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _recording = false;
          _saving = false;
          _publishPercent = 0;
          _publishPhase = '';
        });
      }
    }
  }

  Future<void> _autosaveDraft() async {
    if (!_recording || _engine.length == 0) return;
    try {
      final dir = await getApplicationDocumentsDirectory();
      final draft = File('${dir.path}/wb_draft_${widget.courseId}.json');
      await draft.writeAsString(jsonEncode({
        'events': _engine.all.map((e) => e.toJson()).toList(),
        'theme': _board.theme.wire,
        'title': _titleCtrl.text,
        'savedAt': DateTime.now().toIso8601String(),
      }));
    } catch (_) {}
  }

  void _selectTool(WhiteboardTool tool) {
    setState(() {
      _tool = tool;
      _board.tool = tool;
      if (tool == WhiteboardTool.highlighter &&
          (_color == '#111827' || _color == '#F8FAFC')) {
        _color = '#FACC15';
      }
    });
    if (_recording) {
      _engine.push('tool_change', {'tool': tool.wire});
      if (tool == WhiteboardTool.highlighter) {
        _engine.push('color_change', {'color': _color});
      }
    }
  }

  void _onPointerDown(PointerDownEvent e, Size size) {
    final logical = logicalFromLocal(e.localPosition, size, kLogicalBoardWidth, kLogicalBoardHeight);
    if (logical == null) return;
    final pageId = _board.currentPageId ?? 'page_0';

    if (_tool == WhiteboardTool.laser) {
      _board.laser = BoardLaser(pageId: pageId, x: logical.dx, y: logical.dy);
      if (_recording) {
        _engine.push('laser_move', {
          'pageId': pageId,
          'x': logical.dx,
          'y': logical.dy,
          'visible': true,
        });
      }
      setState(() {});
      return;
    }

    if (_tool == WhiteboardTool.text) {
      _promptText(logical, pageId);
      return;
    }

    if ({WhiteboardTool.rect, WhiteboardTool.circle, WhiteboardTool.line, WhiteboardTool.arrow}
        .contains(_tool)) {
      _shapeId = _uuid.v4();
      _shapeStart = logical;
      return;
    }

    if (_tool == WhiteboardTool.eraser) {
      _eraseNear(logical, pageId);
      return;
    }

    final strokeId = _uuid.v4();
    _activeStroke = BoardStroke(
      id: strokeId,
      pageId: pageId,
      tool: _tool,
      color: _color,
      opacity: defaultOpacityForTool(_tool),
      width: defaultWidthForTool(_tool) * (0.5 + (e.pressure.clamp(0.0, 1.0) * 0.8)),
      points: [StrokePoint(x: logical.dx, y: logical.dy, p: e.pressure)],
    );
    if (_recording) {
      _engine.push('stroke_begin', {
        'strokeId': strokeId,
        'pageId': pageId,
        'tool': _tool.wire,
        'color': _color,
        'opacity': _activeStroke!.opacity,
        'width': _activeStroke!.width,
      });
    }
    setState(() {});
  }

  void _onPointerMove(PointerMoveEvent e, Size size) {
    final logical = logicalFromLocal(e.localPosition, size, kLogicalBoardWidth, kLogicalBoardHeight);
    if (logical == null) return;
    final pageId = _board.currentPageId ?? 'page_0';

    if (_tool == WhiteboardTool.laser) {
      _board.laser = BoardLaser(pageId: pageId, x: logical.dx, y: logical.dy);
      if (_recording) {
        _engine.push('laser_move', {
          'pageId': pageId,
          'x': logical.dx,
          'y': logical.dy,
          'visible': true,
        });
      }
      setState(() {});
      return;
    }

    if (_activeStroke == null) return;
    _activeStroke!.points.add(StrokePoint(x: logical.dx, y: logical.dy, p: e.pressure));
    if (_recording) {
      _engine.push('stroke_point', {
        'strokeId': _activeStroke!.id,
        'x': logical.dx,
        'y': logical.dy,
        'p': e.pressure,
      });
    }
    setState(() {});
  }

  void _onPointerUp(PointerUpEvent e, Size size) {
    final logical = logicalFromLocal(e.localPosition, size, kLogicalBoardWidth, kLogicalBoardHeight);
    final pageId = _board.currentPageId ?? 'page_0';

    if (_shapeId != null && _shapeStart != null && logical != null) {
      final kind = _tool.wire;
      if (_recording) {
        _engine.push('shape_add', {
          'shapeId': _shapeId,
          'pageId': pageId,
          'kind': kind,
          'x1': _shapeStart!.dx,
          'y1': _shapeStart!.dy,
          'x2': logical.dx,
          'y2': logical.dy,
          'color': _color,
          'width': 2.5,
        });
      }
      _board.apply(UbrdEvent(
        id: _uuid.v4(),
        t: _engine.now(),
        type: 'shape_add',
        payload: {
          'shapeId': _shapeId,
          'pageId': pageId,
          'kind': kind,
          'x1': _shapeStart!.dx,
          'y1': _shapeStart!.dy,
          'x2': logical.dx,
          'y2': logical.dy,
          'color': _color,
          'width': 2.5,
        },
      ));
      _shapeId = null;
      _shapeStart = null;
      setState(() {});
      return;
    }

    if (_activeStroke == null) return;
    final stroke = _activeStroke!;
    stroke.points = smoothStrokePoints(stroke.points);
    final page = _board.currentPage;
    page?.strokes.add(stroke);
    if (_recording) {
      _engine.push('stroke_end', {
        'strokeId': stroke.id,
        'pageId': stroke.pageId,
        'points': stroke.points.map((p) => p.toJson()).toList(),
      });
    }
    _activeStroke = null;
    setState(() {});
  }

  void _eraseNear(Offset logical, String pageId) {
    final page = _board.currentPage;
    if (page == null) return;
    final hit = <String>[];
    for (final s in page.strokes) {
      for (final p in s.points) {
        final dx = p.x - logical.dx;
        final dy = p.y - logical.dy;
        if (dx * dx + dy * dy < 400) {
          hit.add(s.id);
          break;
        }
      }
    }
    if (hit.isEmpty) return;
    page.strokes.removeWhere((s) => hit.contains(s.id));
    if (_recording) {
      _engine.push('erase', {'pageId': pageId, 'strokeIds': hit});
    }
    setState(() {});
  }

  Future<void> _promptText(Offset logical, String pageId) async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Insert text'),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
        ],
      ),
    );
    if (ok != true || ctrl.text.trim().isEmpty) return;
    final id = _uuid.v4();
    final payload = {
      'textId': id,
      'pageId': pageId,
      'x': logical.dx,
      'y': logical.dy,
      'text': ctrl.text.trim(),
      'color': _color,
      'fontSize': 28.0,
    };
    _board.apply(UbrdEvent(id: id, t: _engine.now(), type: 'text_insert', payload: payload));
    if (_recording) _engine.push('text_insert', payload);
    setState(() {});
  }

  void _addPage() {
    final id = 'page_${_uuid.v4()}';
    _board.addBlankPage(id);
    if (_recording) {
      _engine.push('page_add', {'pageId': id, 'index': _board.pages.length - 1, 'kind': 'blank'});
      _engine.push('page_select', {'pageId': id});
    }
    setState(() {});
  }

  void _duplicatePage() {
    final src = _board.currentPage;
    if (src == null) return;
    final id = 'page_${_uuid.v4()}';
    if (_recording) {
      _engine.push('page_duplicate', {
        'pageId': src.id,
        'newPageId': id,
        'index': _board.pages.indexOf(src) + 1,
      });
    }
    _board.apply(UbrdEvent(
      id: _uuid.v4(),
      t: _engine.now(),
      type: 'page_duplicate',
      payload: {
        'pageId': src.id,
        'newPageId': id,
        'index': _board.pages.indexOf(src) + 1,
      },
    ));
    setState(() {});
  }

  void _deletePage() {
    if (_board.pages.length <= 1) return;
    final id = _board.currentPageId;
    if (id == null) return;
    if (_recording) _engine.push('page_delete', {'pageId': id});
    _board.apply(UbrdEvent(id: _uuid.v4(), t: _engine.now(), type: 'page_delete', payload: {'pageId': id}));
    setState(() {});
  }

  void _clearPage() {
    final id = _board.currentPageId;
    if (id == null) return;
    if (_recording) _engine.push('page_clear', {'pageId': id});
    _board.apply(UbrdEvent(id: _uuid.v4(), t: _engine.now(), type: 'page_clear', payload: {'pageId': id}));
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final shortest = MediaQuery.sizeOf(context).shortestSide;
    final iconSize = shortest < 600 ? 20.0 : 24.0;

    return Scaffold(
      backgroundColor: _chromeBg,
      appBar: AppBar(
        backgroundColor: _chromeBg,
        foregroundColor: _chromeFg,
        title: TextField(
          controller: _titleCtrl,
          style: TextStyle(color: _chromeFg, fontWeight: FontWeight.w600),
          decoration: const InputDecoration(border: InputBorder.none, hintText: 'Lesson title'),
        ),
        actions: [
          IconButton(
            tooltip: 'Board theme',
            onPressed: _toggleTheme,
            icon: Icon(_board.theme == WhiteboardThemeId.black ? Icons.dark_mode : Icons.light_mode),
          ),
          if (_editMode && !_recording)
            IconButton(
              tooltip: 'Cut time range',
              onPressed: _saving || _loadingEdit ? null : _cutTimeRangeDialog,
              icon: const Icon(Icons.content_cut),
            ),
          if (_editMode && !_recording)
            TextButton(
              onPressed: (_saving || _loadingEdit || _dirtyRanges.isEmpty)
                  ? null
                  : _publishEditPackage,
              child: Text(_saving ? '$_publishPercent%' : 'Publish edit'),
            ),
          if (!_recording)
            TextButton(
              onPressed: (_saving || _loadingEdit) ? null : _startRecording,
              child: Text(_editMode ? 'Continue recording' : 'Start Recording'),
            )
          else
            TextButton(
              onPressed: _saving ? null : _stopAndPublish,
              child: Text(_saving ? '$_publishPercent%' : (_editMode ? 'Stop & Publish edit' : 'Stop & Publish')),
            ),
        ],
      ),
      body: Column(
        children: [
          _toolRail(iconSize),
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                LayoutBuilder(
                  builder: (context, constraints) {
                    final size = Size(constraints.maxWidth, constraints.maxHeight);
                    return Listener(
                      onPointerDown: (e) => _onPointerDown(e, size),
                      onPointerMove: (e) => _onPointerMove(e, size),
                      onPointerUp: (e) => _onPointerUp(e, size),
                      child: CustomPaint(
                        painter: WhiteboardPainter(
                          state: _board,
                          boardWidth: kLogicalBoardWidth,
                          boardHeight: kLogicalBoardHeight,
                          activeStroke: _activeStroke,
                          pdfUnderlay: _pdfUnderlay,
                        ),
                        size: Size.infinite,
                      ),
                    );
                  },
                ),
                if (_pdfLoading)
                  const ColoredBox(
                    color: Color(0x66000000),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                if (_saving) _publishOverlay(),
              ],
            ),
          ),
          _pageStrip(),
        ],
      ),
    );
  }

  Widget _publishOverlay() {
    final pct = _publishPercent.clamp(0, 100);
    return ColoredBox(
      color: const Color(0xCC0F172A),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 320),
          child: Material(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(22, 24, 22, 22),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: 64,
                    height: 64,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        CircularProgressIndicator(
                          value: pct > 0 ? pct / 100 : null,
                          strokeWidth: 5,
                          color: const Color(0xFF38BDF8),
                          backgroundColor: const Color(0xFF334155),
                        ),
                        Text(
                          '$pct%',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'Publishing whiteboard lesson',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _publishPhase.isEmpty ? 'Please wait…' : _publishPhase,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFFCBD5E1),
                      fontSize: 13,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: LinearProgressIndicator(
                      value: pct > 0 ? pct / 100 : null,
                      minHeight: 8,
                      color: const Color(0xFF38BDF8),
                      backgroundColor: const Color(0xFF334155),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _toolRail(double iconSize) {
    final tools = [
      (WhiteboardTool.pen, Icons.edit),
      (WhiteboardTool.pencil, Icons.edit_outlined),
      (WhiteboardTool.highlighter, Icons.highlight),
      (WhiteboardTool.eraser, Icons.auto_fix_off),
      (WhiteboardTool.text, Icons.text_fields),
      (WhiteboardTool.laser, Icons.highlight_alt),
      (WhiteboardTool.rect, Icons.crop_square),
      (WhiteboardTool.circle, Icons.circle_outlined),
      (WhiteboardTool.line, Icons.show_chart),
      (WhiteboardTool.arrow, Icons.arrow_right_alt),
      (WhiteboardTool.select, Icons.near_me),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          ...tools.map((t) {
            final selected = _tool == t.$1;
            return Padding(
              padding: const EdgeInsets.only(right: 4),
              child: InkWell(
                onTap: () => _selectTool(t.$1),
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  padding: EdgeInsets.all(iconSize * 0.35),
                  decoration: BoxDecoration(
                    color: selected ? const Color(0xFF2563EB) : Colors.black12,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(t.$2, size: iconSize, color: selected ? Colors.white : _chromeFg),
                ),
              ),
            );
          }),
          const SizedBox(width: 8),
          ...['#111827', '#EF4444', '#2563EB', '#22C55E', '#F59E0B', '#F8FAFC'].map((c) {
            return GestureDetector(
              onTap: () {
                setState(() => _color = c);
                if (_recording) _engine.push('color_change', {'color': c});
              },
              child: Container(
                width: iconSize,
                height: iconSize,
                margin: const EdgeInsets.only(right: 4),
                decoration: BoxDecoration(
                  color: Color(int.parse('FF${c.substring(1)}', radix: 16)),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: _color == c ? const Color(0xFF2563EB) : Colors.black26,
                    width: 2,
                  ),
                ),
              ),
            );
          }),
          IconButton(
            tooltip: 'Clear page',
            onPressed: _clearPage,
            icon: Icon(Icons.cleaning_services, color: _chromeFg, size: iconSize),
          ),
          IconButton(
            tooltip: 'Open course PDF',
            onPressed: _attachCoursePdf,
            icon: Icon(Icons.picture_as_pdf, color: _chromeFg, size: iconSize),
          ),
        ],
      ),
    );
  }

  Widget _pageStrip() {
    final pdfPage = _board.currentPage;
    final isPdf = pdfPage?.kind == 'pdf' && pdfPage?.pdfAssetId != null;
    final pdfTotal = isPdf ? (_pdfCache.pageCount(pdfPage!.pdfAssetId!) ?? 1) : 1;
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        children: [
          IconButton(onPressed: _addPage, icon: Icon(Icons.add, color: _chromeFg)),
          IconButton(onPressed: _duplicatePage, icon: Icon(Icons.copy, color: _chromeFg)),
          IconButton(onPressed: _deletePage, icon: Icon(Icons.delete_outline, color: _chromeFg)),
          if (isPdf) ...[
            IconButton(
              tooltip: 'Previous PDF page',
              onPressed: () => _shiftPdfPage(-1),
              icon: Icon(Icons.chevron_left, color: _chromeFg),
            ),
            Text(
              'PDF ${(pdfPage!.pdfPage ?? 1)}/$pdfTotal',
              style: TextStyle(color: _chromeFg, fontSize: 12),
            ),
            IconButton(
              tooltip: 'Next PDF page',
              onPressed: () => _shiftPdfPage(1),
              icon: Icon(Icons.chevron_right, color: _chromeFg),
            ),
          ],
          Expanded(
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: _board.pages.length,
              itemBuilder: (context, i) {
                final p = _board.pages[i];
                final selected = p.id == _board.currentPageId;
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                  child: ChoiceChip(
                    label: Text(p.kind == 'pdf' ? 'PDF${i + 1}' : 'P${i + 1}'),
                    selected: selected,
                    onSelected: (_) async {
                      setState(() => _board.currentPageId = p.id);
                      if (_recording) _engine.push('page_select', {'pageId': p.id});
                      await _refreshPdfUnderlay();
                    },
                  ),
                );
              },
            ),
          ),
          if (_recording)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Row(
                children: [
                  const Icon(Icons.fiber_manual_record, color: Colors.red, size: 14),
                  const SizedBox(width: 4),
                  Text(_formatMs(_engine.now()), style: TextStyle(color: _chromeFg)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  String _formatMs(int ms) {
    final s = ms ~/ 1000;
    final m = s ~/ 60;
    final r = s % 60;
    return '${m.toString().padLeft(2, '0')}:${r.toString().padLeft(2, '0')}';
  }
}
