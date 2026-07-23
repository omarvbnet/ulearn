import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/features/whiteboard/domain/board_state.dart';
import 'package:ulearn/features/whiteboard/domain/event_engine.dart';
import 'package:ulearn/features/whiteboard/domain/package.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';
import 'package:ulearn/features/whiteboard/ui/whiteboard_painter.dart';
import 'package:video_player/video_player.dart';

/// Student/teacher viewer — reconstructs a recorded whiteboard lesson.
class WhiteboardPlayerScreen extends StatefulWidget {
  const WhiteboardPlayerScreen({
    super.key,
    required this.lessonId,
    required this.title,
    this.packageUrl,
    this.whiteboardId,
    this.durationSec,
    this.initialPositionSec = 0,
    this.freePreviewSec,
    this.onProgress,
  });

  final String lessonId;
  final String title;
  final String? packageUrl;
  final String? whiteboardId;
  final int? durationSec;
  final int initialPositionSec;
  final int? freePreviewSec;
  final void Function(int positionSec, int durationSec, bool completed)? onProgress;

  @override
  State<WhiteboardPlayerScreen> createState() => _WhiteboardPlayerScreenState();
}

class _WhiteboardPlayerScreenState extends State<WhiteboardPlayerScreen> {
  final _board = BoardState();
  final _engine = EventEngine();
  VideoPlayerController? _audio;
  ParsedUbrdPackage? _pkg;
  bool _loading = true;
  String? _error;
  bool _playing = false;
  double _speed = 1;
  int _playheadMs = 0;
  int _durationMs = 0;
  int _eventIndex = 0;
  Timer? _tick;
  Timer? _progressTimer;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _tick?.cancel();
    _progressTimer?.cancel();
    _audio?.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = context.read<ApiClient>();
      var url = widget.packageUrl;
      if ((url == null || url.isEmpty) && widget.whiteboardId != null) {
        final res = await api.get('/api/whiteboards/${widget.whiteboardId}');
        url = (res['playback'] as Map?)?['packageUrl'] as String?;
      }
      if (url == null || url.isEmpty) throw StateError('NO_PACKAGE_URL');

      final res = await http.get(Uri.parse(ApiClient.absoluteUrl(url)));
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw StateError('PACKAGE_DOWNLOAD_${res.statusCode}');
      }
      final pkg = parseUbrdPackage(Uint8List.fromList(res.bodyBytes));
      _engine.load(pkg.events);
      _board.reset();
      _board.theme = pkg.manifest.theme;

      final dir = await getTemporaryDirectory();
      final audioFile = File('${dir.path}/wb_play_${widget.lessonId}_${pkg.audioFileName}');
      await audioFile.writeAsBytes(pkg.audioBytes, flush: true);
      final audio = VideoPlayerController.file(audioFile);
      await audio.initialize();
      audio.setPlaybackSpeed(_speed);
      audio.addListener(_onAudioTick);

      _pkg = pkg;
      _audio = audio;
      _durationMs = pkg.manifest.durationMs;
      if (widget.initialPositionSec > 0) {
        await _seekTo(widget.initialPositionSec * 1000);
      } else {
        _applyUntil(0);
      }
      _progressTimer = Timer.periodic(const Duration(seconds: 5), (_) => _emitProgress());
      setState(() => _loading = false);
    } catch (e) {
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  void _onAudioTick() {
    final audio = _audio;
    if (audio == null || !audio.value.isInitialized) return;
    final ms = audio.value.position.inMilliseconds;
    if (ms == _playheadMs) return;
    _playheadMs = ms;
    _applyForward(ms);
    final preview = widget.freePreviewSec;
    if (preview != null && preview > 0 && ms >= preview * 1000) {
      _pause();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Free preview ended — purchase to continue')),
        );
      }
    }
    if (mounted) setState(() {});
  }

  void _applyUntil(int ms) {
    _board.reset();
    if (_pkg != null) _board.theme = _pkg!.manifest.theme;
    _eventIndex = 0;
    _applyForward(ms);
  }

  void _applyForward(int ms) {
    final events = _engine.all;
    while (_eventIndex < events.length && events[_eventIndex].t <= ms) {
      _board.apply(events[_eventIndex]);
      _eventIndex++;
    }
  }

  Future<void> _seekTo(int ms) async {
    final clamped = ms.clamp(0, _durationMs);
    await _audio?.seekTo(Duration(milliseconds: clamped));
    _playheadMs = clamped;
    _applyUntil(clamped);
    setState(() {});
  }

  Future<void> _play() async {
    await _audio?.play();
    setState(() => _playing = true);
  }

  Future<void> _pause() async {
    await _audio?.pause();
    setState(() => _playing = false);
    _emitProgress();
  }

  void _emitProgress() {
    final dur = (_durationMs / 1000).round().clamp(1, 1 << 30);
    final pos = (_playheadMs / 1000).round();
    final completed = pos >= dur * 0.9;
    widget.onProgress?.call(pos, dur, completed);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.title)),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.title)),
        body: Center(child: Text(_error!)),
      );
    }

    final bg = _board.theme == WhiteboardThemeId.black ? const Color(0xFF0B0F14) : const Color(0xFFF1F5F9);

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          PopupMenuButton<double>(
            initialValue: _speed,
            onSelected: (v) async {
              _speed = v;
              await _audio?.setPlaybackSpeed(v);
              setState(() {});
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 0.75, child: Text('0.75x')),
              PopupMenuItem(value: 1, child: Text('1x')),
              PopupMenuItem(value: 1.25, child: Text('1.25x')),
              PopupMenuItem(value: 1.5, child: Text('1.5x')),
              PopupMenuItem(value: 2, child: Text('2x')),
            ],
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Center(child: Text('${_speed}x')),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: CustomPaint(
              painter: WhiteboardPainter(
                state: _board,
                boardWidth: _pkg?.manifest.boardWidth ?? kLogicalBoardWidth,
                boardHeight: _pkg?.manifest.boardHeight ?? kLogicalBoardHeight,
              ),
              size: Size.infinite,
            ),
          ),
          _controls(),
        ],
      ),
    );
  }

  Widget _controls() {
    final dur = _durationMs <= 0 ? 1.0 : _durationMs.toDouble();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
        child: Column(
          children: [
            Slider(
              value: _playheadMs.clamp(0, _durationMs).toDouble(),
              max: dur,
              onChanged: (v) => _seekTo(v.round()),
            ),
            Row(
              children: [
                IconButton(
                  onPressed: () => _seekTo(_playheadMs - 10000),
                  icon: const Icon(Icons.replay_10),
                ),
                IconButton(
                  onPressed: () => _playing ? _pause() : _play(),
                  icon: Icon(_playing ? Icons.pause_circle : Icons.play_circle, size: 40),
                ),
                IconButton(
                  onPressed: () => _seekTo(_playheadMs + 10000),
                  icon: const Icon(Icons.forward_10),
                ),
                const Spacer(),
                Text(_fmt(_playheadMs)),
                const Text(' / '),
                Text(_fmt(_durationMs)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _fmt(int ms) {
    final s = ms ~/ 1000;
    final m = s ~/ 60;
    final r = s % 60;
    return '${m.toString().padLeft(2, '0')}:${r.toString().padLeft(2, '0')}';
  }
}
