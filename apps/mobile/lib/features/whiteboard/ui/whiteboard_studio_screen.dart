import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import 'package:ulearn/features/whiteboard/ui/board_theme.dart';
import 'package:ulearn/features/whiteboard/ui/whiteboard_painter.dart';
import 'package:uuid/uuid.dart';

/// Undoable teacher action (local + recorded as erase/shape_delete/re-add).
class _UndoItem {
  _UndoItem({required this.kind, required this.payload});
  final String kind; // stroke | shape | text | erase
  final Map<String, dynamic> payload;
}

/// Teacher Whiteboard Studio — records mic + vector events into a .ubrd package.
class WhiteboardStudioScreen extends StatefulWidget {
  const WhiteboardStudioScreen({
    super.key,
    required this.courseId,
    required this.courseTitle,
    this.initialTitle,
    this.lessonId,
    this.whiteboardId,
    this.sectionId,
  });

  final String courseId;
  final String courseTitle;
  final String? initialTitle;
  /// When set with [whiteboardId], opens edit mode for an existing lesson.
  final String? lessonId;
  final String? whiteboardId;
  final String? sectionId;

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
  double _strokeWidth = 3.5;
  final _viewTransform = TransformationController();
  double _viewZoom = 1;
  static const _minViewZoom = 1.0;
  static const _maxViewZoom = 5.0;
  /// Active raw pointers on the board (pinch = 2+ → block ink).
  int _pointerCount = 0;
  /// True only while an actual pinch/scale zoom is in progress.
  bool _pinchZooming = false;
  double? _interactionStartScale;
  bool _recording = false;
  bool _saving = false;
  /// 0–100 overall publish progress while finishing a board lesson.
  int _publishPercent = 0;
  String _publishPhase = '';
  String? _audioPath;
  BoardStroke? _activeStroke;
  String? _shapeId;
  Offset? _shapeStart;
  BoardShape? _draftShape;
  final List<_UndoItem> _undoStack = [];
  final List<_UndoItem> _redoStack = [];
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
    _viewTransform.addListener(_onViewTransformChanged);
    _autosaveTimer = Timer.periodic(const Duration(seconds: 20), (_) => _autosaveDraft());
    if (_editMode) {
      _loadingEdit = true;
      unawaited(_loadExistingPackage());
    } else {
      _restoreDraftIfAny();
    }
  }

  void _onViewTransformChanged() {
    final next = _viewTransform.value.getMaxScaleOnAxis();
    if ((next - _viewZoom).abs() < 0.01) return;
    if (mounted) setState(() => _viewZoom = next);
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

  Future<void> _attachPdfMenu() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.folder_open),
              title: const Text('Course PDF'),
              subtitle: const Text('Pick a document already on this course'),
              onTap: () => Navigator.pop(ctx, 'course'),
            ),
            ListTile(
              leading: const Icon(Icons.upload_file),
              title: const Text('Import from device'),
              subtitle: const Text('Upload a PDF from this phone/tablet'),
              onTap: () => Navigator.pop(ctx, 'device'),
            ),
          ],
        ),
      ),
    );
    if (choice == 'course') {
      await _attachCoursePdf();
    } else if (choice == 'device') {
      await _importDevicePdf();
    }
  }

  Future<void> _importDevicePdf() async {
    try {
      final pick = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf'],
        withData: true,
      );
      if (pick == null || pick.files.isEmpty) return;
      final file = pick.files.first;
      final bytes = file.bytes ??
          (file.path != null ? await File(file.path!).readAsBytes() : null);
      if (bytes == null || bytes.isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not read that PDF file')),
          );
        }
        return;
      }
      setState(() => _pdfLoading = true);
      final api = context.read<ApiClient>();
      final title = (file.name).trim().isEmpty ? 'Board PDF' : file.name;
      final presign = await api.post('/api/admin/uploads', {
        'filename': title.endsWith('.pdf') ? title : '$title.pdf',
        'contentType': 'application/pdf',
        'folder': 'course-materials',
      });
      final uploadUrl = presign['uploadUrl']?.toString();
      final key = (presign['key'] ?? presign['fileKey'])?.toString();
      final publicUrl = (presign['publicUrl'] ?? presign['url'])?.toString();
      if (uploadUrl == null || key == null) {
        throw StateError('Upload URL missing');
      }
      await api.putBytes(uploadUrl, bytes, 'application/pdf');
      final docRes = await api.post('/api/teacher/courses/${widget.courseId}/documents', {
        'title': title.replaceAll(RegExp(r'\.pdf$', caseSensitive: false), ''),
        'fileKey': key,
        'fileUrl': publicUrl ?? '/api/media/${key.split('/').map(Uri.encodeComponent).join('/')}',
        'mimeType': 'application/pdf',
        'fileSize': bytes.length,
        'type': 'PDF',
      });
      final doc = (docRes['document'] as Map?)?.cast<String, dynamic>() ??
          <String, dynamic>{
            'id': key,
            'title': title,
            'fileKey': key,
            'fileUrl': publicUrl,
          };
      await _openPdfAsset(
        assetId: 'pdf_${doc['id'] ?? _uuid.v4()}',
        materialId: doc['id']?.toString(),
        fileKey: doc['fileKey']?.toString() ?? key,
        fileUrl: doc['fileUrl']?.toString() ?? publicUrl,
        title: doc['title']?.toString() ?? title,
        localBytes: bytes,
      );
    } catch (e) {
      if (mounted) {
        setState(() => _pdfLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('PDF import failed: $e')),
        );
      }
    }
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
          const SnackBar(content: Text('No course PDFs found — import one from your device')),
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
      setState(() => _pdfLoading = true);
      await _openPdfAsset(
        assetId: 'pdf_${chosen['id']}',
        materialId: chosen['id']?.toString(),
        fileKey: chosen['fileKey']?.toString(),
        fileUrl: chosen['fileUrl']?.toString(),
        title: chosen['title']?.toString() ?? 'PDF',
      );
    } catch (e) {
      if (mounted) {
        setState(() => _pdfLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('PDF attach failed: $e')));
      }
    }
  }

  Future<void> _openPdfAsset({
    required String assetId,
    String? materialId,
    String? fileKey,
    String? fileUrl,
    required String title,
    Uint8List? localBytes,
  }) async {
    final asset = UbrdPdfAsset(
      assetId: assetId,
      materialId: materialId,
      fileKey: fileKey,
      fileUrl: fileUrl,
      title: title,
    );
    if (localBytes != null) {
      await _pdfCache.preloadBytes(assetId, localBytes);
    } else {
      if (resolveUbrdPdfUrl(asset) == null) {
        if (mounted) {
          setState(() => _pdfLoading = false);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('This PDF has no downloadable file URL')),
          );
        }
        return;
      }
      await _pdfCache.preload(asset);
    }
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
      page.pdfZoom = 1;
    }
    if (_recording) {
      _engine.push('pdf_open', {'assetId': assetId, 'title': title});
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
        SnackBar(content: Text('PDF opened: $title')),
      );
    }
  }

  void _nudgePdfZoom(double factor) {
    final page = _board.currentPage;
    if (page == null || page.kind != 'pdf' || page.pdfAssetId == null) return;
    final next = (page.pdfZoom * factor).clamp(0.5, 5.0);
    page.pdfZoom = next;
    if (_recording) {
      _engine.push('pdf_zoom', {'assetId': page.pdfAssetId, 'zoom': next});
    }
    setState(() {});
  }

  void _setViewZoom(double scale) {
    final clamped = scale.clamp(_minViewZoom, _maxViewZoom);
    _discardInProgressInk();
    _viewTransform.value = Matrix4.identity()..scaleByDouble(clamped, clamped, 1, 1);
    setState(() => _viewZoom = clamped);
  }

  void _nudgeViewZoom(double factor) => _setViewZoom(_viewZoom * factor);

  void _resetViewZoom() => _setViewZoom(1);

  /// Block ink only during a real multi-touch pinch zoom.
  bool get _drawingBlocked => _pinchZooming || _pointerCount >= 2;

  /// Drop any in-progress stroke/shape without committing (used during zoom).
  void _discardInProgressInk() {
    final stroke = _activeStroke;
    if (stroke != null) {
      if (_recording) {
        _engine.push('erase', {
          'pageId': stroke.pageId,
          'strokeIds': [stroke.id],
        });
      }
      _activeStroke = null;
    }
    if (_shapeId != null) {
      if (_recording) {
        _engine.push('shape_delete', {'shapeId': _shapeId});
      }
      _shapeId = null;
      _shapeStart = null;
      _draftShape = null;
    }
    if (_board.laser != null) {
      final pageId = _board.currentPageId ?? 'page_0';
      _board.laser = BoardLaser(pageId: pageId, x: 0, y: 0, visible: false);
      if (_recording) {
        _engine.push('laser_move', {
          'pageId': pageId,
          'x': 0,
          'y': 0,
          'visible': false,
        });
      }
    }
  }

  void _endZoomGesture() {
    if (!_pinchZooming && _pointerCount == 0) return;
    _pinchZooming = false;
    _interactionStartScale = null;
    // Heal stuck pointer counts after a gesture ends.
    if (_pointerCount < 0) _pointerCount = 0;
  }

  void _onViewInteractionStart(ScaleStartDetails details) {
    _interactionStartScale = _viewTransform.value.getMaxScaleOnAxis();
    // Only multi-touch starts a zoom block — never single-finger draw.
    if (details.pointerCount >= 2) {
      _pinchZooming = true;
      _discardInProgressInk();
      if (mounted) setState(() {});
    }
  }

  void _onViewInteractionUpdate(ScaleUpdateDetails details) {
    // Require 2+ fingers — ignore scale jitter from single-finger / stylus.
    if (details.pointerCount < 2) return;
    if (!_pinchZooming) {
      _pinchZooming = true;
      _discardInProgressInk();
      if (mounted) setState(() {});
    }
  }

  void _onViewInteractionEnd(ScaleEndDetails _) {
    _endZoomGesture();
    if (mounted) setState(() {});
  }

  void _pushUndo(_UndoItem item) {
    _undoStack.add(item);
    _redoStack.clear();
  }

  void _undo() {
    if (_undoStack.isEmpty) return;
    final item = _undoStack.removeLast();
    final page = _board.currentPage;
    if (item.kind == 'stroke') {
      final id = item.payload['strokeId']?.toString();
      final pageId = item.payload['pageId']?.toString();
      BoardStroke? stroke;
      for (final s in page?.strokes ?? const <BoardStroke>[]) {
        if (s.id == id) stroke = s;
      }
      final snapshot = stroke == null
          ? null
          : {
              'strokeId': stroke.id,
              'pageId': stroke.pageId,
              'tool': stroke.tool.wire,
              'color': stroke.color,
              'opacity': stroke.opacity,
              'width': stroke.width,
              'points': stroke.points.map((p) => p.toJson()).toList(),
            };
      page?.strokes.removeWhere((s) => s.id == id);
      if (_recording && id != null) {
        _engine.push('erase', {
          'pageId': pageId ?? page?.id,
          'strokeIds': [id],
        });
      }
      if (snapshot != null) {
        _redoStack.add(_UndoItem(kind: 'stroke', payload: snapshot));
      }
    } else if (item.kind == 'shape') {
      final id = item.payload['shapeId']?.toString();
      BoardShape? shape;
      for (final p in _board.pages) {
        for (final s in p.shapes) {
          if (s.id == id) shape = s;
        }
      }
      final snapshot = shape == null
          ? null
          : {
              'shapeId': shape.id,
              'pageId': shape.pageId,
              'kind': shape.kind,
              'x1': shape.x1,
              'y1': shape.y1,
              'x2': shape.x2,
              'y2': shape.y2,
              'color': shape.color,
              'width': shape.width,
            };
      for (final p in _board.pages) {
        p.shapes.removeWhere((s) => s.id == id);
      }
      if (_recording && id != null) {
        _engine.push('shape_delete', {'shapeId': id});
      }
      if (snapshot != null) {
        _redoStack.add(_UndoItem(kind: 'shape', payload: snapshot));
      }
    } else if (item.kind == 'text') {
      final id = item.payload['textId']?.toString();
      BoardText? text;
      for (final p in _board.pages) {
        for (final t in p.texts) {
          if (t.id == id) text = t;
        }
      }
      final snapshot = text == null
          ? null
          : {
              'textId': text.id,
              'pageId': text.pageId,
              'x': text.x,
              'y': text.y,
              'text': text.text,
              'color': text.color,
              'fontSize': text.fontSize,
            };
      for (final p in _board.pages) {
        p.texts.removeWhere((t) => t.id == id);
      }
      if (_recording && id != null) {
        _engine.push('text_delete', {'textId': id});
      }
      if (snapshot != null) {
        _redoStack.add(_UndoItem(kind: 'text', payload: snapshot));
      }
    }
    setState(() {});
  }

  void _redo() {
    if (_redoStack.isEmpty) return;
    final item = _redoStack.removeLast();
    if (item.kind == 'stroke') {
      final p = item.payload;
      final stroke = BoardStroke(
        id: p['strokeId'].toString(),
        pageId: p['pageId'].toString(),
        tool: WhiteboardToolX.parse(p['tool'] as String?),
        color: p['color']?.toString() ?? _color,
        opacity: p['opacity'] is num ? (p['opacity'] as num).toDouble() : 1,
        width: p['width'] is num ? (p['width'] as num).toDouble() : 3.5,
        points: ((p['points'] as List?) ?? [])
            .map((e) => StrokePoint.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
      );
      BoardPage? page;
      for (final pg in _board.pages) {
        if (pg.id == stroke.pageId) page = pg;
      }
      page ??= _board.currentPage;
      page?.strokes.removeWhere((s) => s.id == stroke.id);
      page?.strokes.add(stroke);
      if (_recording) {
        _engine.push('stroke_begin', {
          'strokeId': stroke.id,
          'pageId': stroke.pageId,
          'tool': stroke.tool.wire,
          'color': stroke.color,
          'opacity': stroke.opacity,
          'width': stroke.width,
        });
        _engine.push('stroke_end', {
          'strokeId': stroke.id,
          'pageId': stroke.pageId,
          'points': stroke.points.map((pt) => pt.toJson()).toList(),
        });
      }
      _undoStack.add(_UndoItem(kind: 'stroke', payload: {
        'strokeId': stroke.id,
        'pageId': stroke.pageId,
      }));
    } else if (item.kind == 'shape') {
      final p = item.payload;
      _board.apply(UbrdEvent(
        id: _uuid.v4(),
        t: _engine.now(),
        type: 'shape_add',
        payload: p,
      ));
      if (_recording) _engine.push('shape_add', p);
      _undoStack.add(_UndoItem(kind: 'shape', payload: {
        'shapeId': p['shapeId'],
        'pageId': p['pageId'],
      }));
    } else if (item.kind == 'text') {
      final p = item.payload;
      _board.apply(UbrdEvent(
        id: _uuid.v4(),
        t: _engine.now(),
        type: 'text_insert',
        payload: p,
      ));
      if (_recording) _engine.push('text_insert', p);
      _undoStack.add(_UndoItem(kind: 'text', payload: {
        'textId': p['textId'],
        'pageId': p['pageId'],
      }));
    }
    setState(() {});
  }

  Future<void> _refreshPdfUnderlay() async {
    try {
      final page = _board.currentPage;
      if (page == null || page.kind != 'pdf' || page.pdfAssetId == null) {
        if (mounted) setState(() => _pdfUnderlay = null);
        return;
      }
      final img = await _pdfCache.imageFor(page.pdfAssetId!, page.pdfPage ?? 1);
      if (!mounted) return;
      setState(() => _pdfUnderlay = img);
    } catch (e) {
      debugPrint('WhiteboardStudio PDF underlay: $e');
      if (mounted) setState(() => _pdfUnderlay = null);
    }
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
    _viewTransform.removeListener(_onViewTransformChanged);
    _viewTransform.dispose();
    _recorder.dispose();
    unawaited(_pdfCache.dispose());
    super.dispose();
  }

  Color get _chromeBg => boardThemeStyle(_board.theme).chromeBg;
  Color get _chromeFg => boardThemeStyle(_board.theme).chromeFg;

  Future<void> _toggleTheme() async {
    setState(() {
      _board.theme = _board.theme.next;
      _color = boardThemeStyle(_board.theme).defaultInk;
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
        if (widget.sectionId != null) 'sectionId': widget.sectionId,
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
    // Mouse / stylus are always single-pointer — never treat as pinch.
    if (e.kind == ui.PointerDeviceKind.mouse ||
        e.kind == ui.PointerDeviceKind.stylus ||
        e.kind == ui.PointerDeviceKind.invertedStylus) {
      _pointerCount = 1;
      _pinchZooming = false;
    } else {
      _pointerCount++;
    }
    if (_drawingBlocked) {
      _discardInProgressInk();
      if (mounted) setState(() {});
      return;
    }
    // Select pans via InteractiveViewer when zoomed; never starts ink.
    if (_tool == WhiteboardTool.select) {
      return;
    }
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
      _draftShape = BoardShape(
        id: _shapeId!,
        pageId: pageId,
        kind: _tool.wire,
        x1: logical.dx,
        y1: logical.dy,
        x2: logical.dx,
        y2: logical.dy,
        color: _color,
        width: resolveStrokeWidth(WhiteboardTool.pen, _strokeWidth).clamp(1.5, 8.0),
      );
      // Students see the shape grow from press → release.
      if (_recording) {
        _engine.push('shape_add', {
          'shapeId': _shapeId,
          'pageId': pageId,
          'kind': _tool.wire,
          'x1': logical.dx,
          'y1': logical.dy,
          'x2': logical.dx,
          'y2': logical.dy,
          'color': _color,
          'width': _draftShape!.width,
        });
      }
      setState(() {});
      return;
    }

    if (_tool == WhiteboardTool.eraser) {
      _eraseNear(logical, pageId);
      return;
    }

    final strokeId = _uuid.v4();
    final first = StrokePoint(x: logical.dx, y: logical.dy, p: e.pressure);
    final baseW = resolveStrokeWidth(_tool, _strokeWidth);
    _activeStroke = BoardStroke(
      id: strokeId,
      pageId: pageId,
      tool: _tool,
      color: _color,
      opacity: defaultOpacityForTool(_tool),
      width: baseW * (0.55 + (e.pressure.clamp(0.0, 1.0) * 0.7)),
      points: [first],
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
      // First sample so playback shows a tap-dot immediately.
      _engine.push('stroke_point', {
        'strokeId': strokeId,
        'x': logical.dx,
        'y': logical.dy,
        'p': e.pressure,
      });
    }
    setState(() {});
  }

  void _onPointerMove(PointerMoveEvent e, Size size) {
    if (_drawingBlocked) {
      _discardInProgressInk();
      return;
    }
    if (_tool == WhiteboardTool.select) {
      return;
    }
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

    if (_draftShape != null && _shapeStart != null) {
      _draftShape!
        ..x2 = logical.dx
        ..y2 = logical.dy;
      if (_recording && _shapeId != null) {
        _engine.push('shape_update', {
          'shapeId': _shapeId,
          'x1': _shapeStart!.dx,
          'y1': _shapeStart!.dy,
          'x2': logical.dx,
          'y2': logical.dy,
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
    if (_pointerCount > 0) _pointerCount--;
    // Still pinching / another finger down → discard, don't commit.
    if (_pinchZooming || _pointerCount >= 1) {
      _discardInProgressInk();
      if (_pointerCount == 0) _endZoomGesture();
      if (mounted) setState(() {});
      return;
    }
    // Zoom finished — clear flags and allow this / next stroke.
    _endZoomGesture();
    if (_tool == WhiteboardTool.select) {
      return;
    }
    final logical = logicalFromLocal(e.localPosition, size, kLogicalBoardWidth, kLogicalBoardHeight);
    final pageId = _board.currentPageId ?? 'page_0';

    if (_shapeId != null && _shapeStart != null) {
      final end = logical ?? _shapeStart!;
      final kind = _tool.wire;
      final payload = {
        'shapeId': _shapeId,
        'pageId': pageId,
        'kind': kind,
        'x1': _shapeStart!.dx,
        'y1': _shapeStart!.dy,
        'x2': end.dx,
        'y2': end.dy,
        'color': _color,
        'width': _draftShape?.width ?? 2.5,
      };
      if (_recording) {
        _engine.push('shape_update', payload);
      }
      _board.apply(UbrdEvent(
        id: _uuid.v4(),
        t: _engine.now(),
        type: 'shape_add',
        payload: payload,
      ));
      _pushUndo(_UndoItem(kind: 'shape', payload: {
        'shapeId': _shapeId,
        'pageId': pageId,
      }));
      _shapeId = null;
      _shapeStart = null;
      _draftShape = null;
      setState(() {});
      return;
    }

    if (_activeStroke == null) return;
    final stroke = _activeStroke!;
    // Keep a single tap as one point (dot); only smooth longer strokes.
    if (stroke.points.length > 1) {
      stroke.points = smoothStrokePoints(stroke.points);
    }
    final page = _board.currentPage;
    page?.strokes.add(stroke);
    if (_recording) {
      _engine.push('stroke_end', {
        'strokeId': stroke.id,
        'pageId': stroke.pageId,
        'points': stroke.points.map((p) => p.toJson()).toList(),
      });
    }
    _pushUndo(_UndoItem(kind: 'stroke', payload: {
      'strokeId': stroke.id,
      'pageId': stroke.pageId,
    }));
    _activeStroke = null;
    setState(() {});
  }

  void _onPointerCancel(PointerCancelEvent e) {
    if (_pointerCount > 0) _pointerCount--;
    _discardInProgressInk();
    if (_pointerCount == 0) _endZoomGesture();
    if (mounted) setState(() {});
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
    _pushUndo(_UndoItem(kind: 'text', payload: {'textId': id, 'pageId': pageId}));
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
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        iconTheme: IconThemeData(color: _chromeFg),
        actionsIconTheme: IconThemeData(color: _chromeFg),
        systemOverlayStyle: _board.theme == WhiteboardThemeId.white
            ? SystemUiOverlayStyle.dark
            : SystemUiOverlayStyle.light,
        title: TextField(
          controller: _titleCtrl,
          style: TextStyle(color: _chromeFg, fontWeight: FontWeight.w600),
          cursorColor: _chromeFg,
          decoration: InputDecoration(
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            disabledBorder: InputBorder.none,
            filled: false,
            isDense: true,
            hintText: 'Lesson title',
            hintStyle: TextStyle(color: _chromeFg.withValues(alpha: 0.45)),
          ),
        ),
        actions: [
          IconButton(
            tooltip: boardThemeStyle(_board.theme).label,
            onPressed: _toggleTheme,
            color: _chromeFg,
            icon: Icon(
              switch (_board.theme) {
                WhiteboardThemeId.white => Icons.crop_portrait_rounded,
                WhiteboardThemeId.green => Icons.dashboard_customize_rounded,
                WhiteboardThemeId.black => Icons.dark_mode_rounded,
              },
              color: _chromeFg,
            ),
          ),
          if (_editMode && !_recording)
            IconButton(
              tooltip: 'Cut time range',
              onPressed: _saving || _loadingEdit ? null : _cutTimeRangeDialog,
              color: _chromeFg,
              icon: Icon(Icons.content_cut, color: _chromeFg),
            ),
          if (_editMode && !_recording)
            TextButton(
              style: TextButton.styleFrom(foregroundColor: _chromeFg),
              onPressed: (_saving || _loadingEdit || _dirtyRanges.isEmpty)
                  ? null
                  : _publishEditPackage,
              child: Text(_saving ? '$_publishPercent%' : 'Publish edit'),
            ),
          if (!_recording)
            TextButton(
              style: TextButton.styleFrom(foregroundColor: _chromeFg),
              onPressed: (_saving || _loadingEdit) ? null : _startRecording,
              child: Text(_editMode ? 'Continue recording' : 'Start Recording'),
            )
          else
            TextButton(
              style: TextButton.styleFrom(foregroundColor: _chromeFg),
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
                    return InteractiveViewer(
                      transformationController: _viewTransform,
                      minScale: _minViewZoom,
                      maxScale: _maxViewZoom,
                      // Pan only with Select. Pinch zoom always available; ink blocks only while 2 fingers are down.
                      panEnabled: _tool == WhiteboardTool.select,
                      scaleEnabled: true,
                      // Avoid trackpad scroll accidentally scaling and locking ink.
                      trackpadScrollCausesScale: false,
                      boundaryMargin: const EdgeInsets.all(120),
                      clipBehavior: Clip.hardEdge,
                      onInteractionStart: _onViewInteractionStart,
                      onInteractionUpdate: _onViewInteractionUpdate,
                      onInteractionEnd: _onViewInteractionEnd,
                      child: Listener(
                        behavior: HitTestBehavior.opaque,
                        onPointerDown: (e) => _onPointerDown(e, size),
                        onPointerMove: (e) => _onPointerMove(e, size),
                        onPointerUp: (e) => _onPointerUp(e, size),
                        onPointerCancel: _onPointerCancel,
                        child: SizedBox(
                          width: size.width,
                          height: size.height,
                          child: CustomPaint(
                            painter: WhiteboardPainter(
                              state: _board,
                              boardWidth: kLogicalBoardWidth,
                              boardHeight: kLogicalBoardHeight,
                              activeStroke: _activeStroke,
                              activeShape: _draftShape,
                              pdfUnderlay: _pdfUnderlay,
                            ),
                            size: size,
                          ),
                        ),
                      ),
                    );
                  },
                ),
                if (_viewZoom > 1.05)
                  Positioned(
                    top: 8,
                    right: 8,
                    child: Material(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(16),
                      child: InkWell(
                        onTap: _resetViewZoom,
                        borderRadius: BorderRadius.circular(16),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          child: Text(
                            '${_viewZoom.toStringAsFixed(1)}× Reset',
                            style: const TextStyle(color: Colors.white, fontSize: 12),
                          ),
                        ),
                      ),
                    ),
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
    final tools = <(WhiteboardTool, IconData, String)>[
      (WhiteboardTool.pen, Icons.edit, 'Pen'),
      (WhiteboardTool.pencil, Icons.edit_outlined, 'Pencil'),
      (WhiteboardTool.highlighter, Icons.highlight, 'Highlighter'),
      (WhiteboardTool.eraser, Icons.auto_fix_off, 'Eraser'),
      (WhiteboardTool.text, Icons.text_fields, 'Text'),
      (WhiteboardTool.laser, Icons.highlight_alt, 'Laser'),
      (WhiteboardTool.rect, Icons.rectangle_outlined, 'Rectangle'),
      (WhiteboardTool.circle, Icons.circle_outlined, 'Circle'),
      (WhiteboardTool.line, Icons.show_chart, 'Line'),
      (WhiteboardTool.arrow, Icons.arrow_right_alt, 'Arrow'),
      (WhiteboardTool.select, Icons.near_me, 'Select'),
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
              child: Tooltip(
                message: t.$3,
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
          const SizedBox(width: 6),
          ...kStrokeWidthPresets.map((w) {
            final selected = (_strokeWidth - w).abs() < 0.01;
            final dot = (6.0 + (w * 1.1)).clamp(8.0, 22.0);
            return Padding(
              padding: const EdgeInsets.only(right: 4),
              child: InkWell(
                onTap: () => setState(() => _strokeWidth = w),
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  width: iconSize + 8,
                  height: iconSize + 8,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: selected ? const Color(0xFF2563EB) : Colors.black12,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Container(
                    width: dot,
                    height: dot,
                    decoration: BoxDecoration(
                      color: selected ? Colors.white : _chromeFg,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ),
            );
          }),
          IconButton(
            tooltip: 'Undo',
            onPressed: _undoStack.isEmpty ? null : _undo,
            icon: Icon(Icons.undo, color: _chromeFg, size: iconSize),
          ),
          IconButton(
            tooltip: 'Redo',
            onPressed: _redoStack.isEmpty ? null : _redo,
            icon: Icon(Icons.redo, color: _chromeFg, size: iconSize),
          ),
          IconButton(
            tooltip: 'Clear page',
            onPressed: _clearPage,
            icon: Icon(Icons.cleaning_services, color: _chromeFg, size: iconSize),
          ),
          IconButton(
            tooltip: 'Add PDF',
            onPressed: _attachPdfMenu,
            icon: Icon(Icons.picture_as_pdf, color: _chromeFg, size: iconSize),
          ),
          IconButton(
            tooltip: 'Zoom board out',
            onPressed: () => _nudgeViewZoom(1 / 1.35),
            icon: Icon(Icons.zoom_out_map, color: _chromeFg, size: iconSize),
          ),
          IconButton(
            tooltip: 'Zoom board in',
            onPressed: () => _nudgeViewZoom(1.35),
            icon: Icon(Icons.zoom_in_map, color: _chromeFg, size: iconSize),
          ),
          IconButton(
            tooltip: 'Zoom PDF out',
            onPressed: () => _nudgePdfZoom(1 / 1.25),
            icon: Icon(Icons.zoom_out, color: _chromeFg, size: iconSize),
          ),
          IconButton(
            tooltip: 'Zoom PDF in',
            onPressed: () => _nudgePdfZoom(1.25),
            icon: Icon(Icons.zoom_in, color: _chromeFg, size: iconSize),
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
