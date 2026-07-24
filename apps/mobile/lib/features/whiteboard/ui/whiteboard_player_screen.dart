import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:just_audio/just_audio.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/network/network_status.dart';
import 'package:ulearn/features/whiteboard/domain/board_state.dart';
import 'package:ulearn/features/whiteboard/domain/event_engine.dart';
import 'package:ulearn/features/whiteboard/domain/offline_store.dart';
import 'package:ulearn/features/whiteboard/domain/package.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';
import 'package:ulearn/features/whiteboard/domain/whiteboard_audio.dart';
import 'package:ulearn/features/whiteboard/ui/pdf_underlay.dart';
import 'package:ulearn/features/whiteboard/ui/whiteboard_brand_intro.dart';
import 'package:ulearn/features/whiteboard/ui/whiteboard_painter.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

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
    this.embedded = false,
    this.autoPlay = true,
    this.courseId,
    this.allowOfflineSave = true,
    this.showFullscreen = true,
  });

  final String lessonId;
  final String title;
  final String? packageUrl;
  final String? whiteboardId;
  final int? durationSec;
  final int initialPositionSec;
  final int? freePreviewSec;
  final void Function(int positionSec, int durationSec, bool completed)? onProgress;

  /// When true, fills parent (course detail stage) with no Scaffold/AppBar.
  final bool embedded;

  /// Start playback as soon as the package is ready.
  final bool autoPlay;

  /// Used when saving the lesson for offline playback.
  final String? courseId;

  /// Show download / remove-offline control when embedded in course detail.
  final bool allowOfflineSave;

  /// Show the fullscreen control.
  final bool showFullscreen;

  @override
  State<WhiteboardPlayerScreen> createState() => _WhiteboardPlayerScreenState();
}

class _WhiteboardPlayerScreenState extends State<WhiteboardPlayerScreen> {
  final _board = BoardState();
  final _engine = EventEngine();
  final _pdfCache = PdfUnderlayCache();
  final _transform = TransformationController();
  /// Dedicated audio player — do not use video_player/fvp (fails on Android
  /// for audio-only .m4a/.webm from whiteboard packages).
  final AudioPlayer _audio = AudioPlayer();
  StreamSubscription<Duration>? _audioPosSub;
  StreamSubscription<PlayerState>? _audioStateSub;
  ParsedUbrdPackage? _pkg;
  ui.Image? _pdfUnderlay;
  bool _loading = true;
  String? _error;
  bool _playing = false;
  bool _showControls = false;
  bool _offlineSource = false;
  bool _savedOffline = false;
  bool _savingOffline = false;
  bool _online = true;
  bool _inFullscreen = false;
  /// Animated brand intro before first playback (skipped when resuming mid-lesson).
  bool _showBrandIntro = false;
  double _speed = 1;
  double _zoom = 1;
  int _playheadMs = 0;
  int _durationMs = 0;
  int _eventIndex = 0;
  Timer? _tick;
  Timer? _progressTimer;
  Timer? _hideControlsTimer;
  StreamSubscription<bool>? _netSub;
  OverlayEntry? _fullscreenEntry;
  final _fsTransform = TransformationController();
  bool _fsShowControls = true;
  double _fsZoom = 1;
  Timer? _fsHideControlsTimer;

  static const double _minZoom = 1;
  static const double _maxZoom = 5;

  @override
  void initState() {
    super.initState();
    _transform.addListener(_onTransformChanged);
    _fsTransform.addListener(_onFsTransformChanged);
    _load();
    _netSub = NetworkStatus.onOnlineChanged().listen((online) {
      if (mounted) setState(() => _online = online);
    });
    NetworkStatus.isOnline().then((v) {
      if (mounted) setState(() => _online = v);
    });
  }

  @override
  void dispose() {
    _removeFullscreenOverlay(restoreSystemUi: true);
    _tick?.cancel();
    _progressTimer?.cancel();
    _hideControlsTimer?.cancel();
    _fsHideControlsTimer?.cancel();
    _netSub?.cancel();
    _transform.removeListener(_onTransformChanged);
    _fsTransform.removeListener(_onFsTransformChanged);
    _transform.dispose();
    _fsTransform.dispose();
    unawaited(_audioPosSub?.cancel());
    unawaited(_audioStateSub?.cancel());
    unawaited(_audio.dispose());
    unawaited(_pdfCache.dispose());
    unawaited(WakelockPlus.disable());
    super.dispose();
  }

  Future<void> _setKeepAwake(bool enabled) async {
    try {
      if (enabled) {
        await WakelockPlus.enable();
      } else {
        await WakelockPlus.disable();
      }
    } catch (_) {}
  }

  void _onTransformChanged() {
    final next = _transform.value.getMaxScaleOnAxis();
    if ((next - _zoom).abs() < 0.01) return;
    if (mounted) setState(() => _zoom = next);
  }

  void _onFsTransformChanged() {
    final next = _fsTransform.value.getMaxScaleOnAxis();
    if ((next - _fsZoom).abs() < 0.01) return;
    _fsZoom = next;
    _fullscreenEntry?.markNeedsBuild();
  }

  void _setZoom(double scale) {
    final clamped = scale.clamp(_minZoom, _maxZoom);
    final matrix = Matrix4.identity()..scaleByDouble(clamped, clamped, 1, 1);
    _transform.value = matrix;
    setState(() => _zoom = clamped);
  }

  void _zoomBy(double factor) {
    _setZoom(_zoom * factor);
    _scheduleHideControls();
  }

  void _resetZoom() {
    _setZoom(1);
    _scheduleHideControls();
  }

  void _setFsZoom(double scale) {
    final clamped = scale.clamp(_minZoom, _maxZoom);
    _fsTransform.value = Matrix4.identity()..scaleByDouble(clamped, clamped, 1, 1);
    _fsZoom = clamped;
    _fullscreenEntry?.markNeedsBuild();
  }

  void _removeFullscreenOverlay({bool restoreSystemUi = false}) {
    _fullscreenEntry?.remove();
    _fullscreenEntry = null;
    _fsHideControlsTimer?.cancel();
    if (restoreSystemUi) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    }
  }

  Future<void> _enterFullscreen() async {
    if (_pkg == null || _inFullscreen) return;
    final overlay = Overlay.maybeOf(context, rootOverlay: true);
    if (overlay == null) return;

    setState(() {
      _inFullscreen = true;
      _fsShowControls = true;
      _fsZoom = 1;
      _fsTransform.value = Matrix4.identity();
    });

    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    // Keep portrait + landscape so the course page can rotate without remounting a second player.
    await SystemChrome.setPreferredOrientations(DeviceOrientation.values);

    _fullscreenEntry = OverlayEntry(
      builder: (ctx) => _buildFullscreenOverlay(ctx),
    );
    overlay.insert(_fullscreenEntry!);
    _scheduleFsHideControls();
  }

  Future<void> _exitFullscreen() async {
    if (!_inFullscreen) return;
    _removeFullscreenOverlay(restoreSystemUi: true);
    if (!mounted) return;
    setState(() => _inFullscreen = false);
  }

  void _scheduleFsHideControls() {
    _fsHideControlsTimer?.cancel();
    if (!_playing) return;
    _fsHideControlsTimer = Timer(const Duration(seconds: 3), () {
      if (!_inFullscreen || !_playing) return;
      _fsShowControls = false;
      _fullscreenEntry?.markNeedsBuild();
    });
  }

  void _toggleFsControls() {
    _fsShowControls = !_fsShowControls;
    _fullscreenEntry?.markNeedsBuild();
    if (_fsShowControls) _scheduleFsHideControls();
  }

  String _fmt(int ms) {
    final s = ms ~/ 1000;
    final m = s ~/ 60;
    final r = s % 60;
    return '${m.toString().padLeft(2, '0')}:${r.toString().padLeft(2, '0')}';
  }

  Widget _buildFullscreenOverlay(BuildContext context) {
    final bg = _board.theme == WhiteboardThemeId.black
        ? const Color(0xFF0B0F14)
        : const Color(0xFFF1F5F9);
    final dur = _durationMs <= 0 ? 1.0 : _durationMs.toDouble();

    return Material(
      color: Colors.black,
      child: PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _exitFullscreen();
        },
        child: ColoredBox(
        color: bg,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Positioned.fill(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final size = Size(constraints.maxWidth, constraints.maxHeight);
                  return InteractiveViewer(
                    transformationController: _fsTransform,
                    minScale: _minZoom,
                    maxScale: _maxZoom,
                    boundaryMargin: const EdgeInsets.all(120),
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: _toggleFsControls,
                      onDoubleTap: () {
                        if (_fsZoom > 1.05) {
                          _setFsZoom(1);
                        } else {
                          _setFsZoom(2.5);
                        }
                        _scheduleFsHideControls();
                      },
                      child: SizedBox(
                        width: size.width,
                        height: size.height,
                        child: CustomPaint(
                          painter: WhiteboardPainter(
                            state: _board,
                            boardWidth: _pkg?.manifest.boardWidth ?? kLogicalBoardWidth,
                            boardHeight: _pkg?.manifest.boardHeight ?? kLogicalBoardHeight,
                            pdfUnderlay: _pdfUnderlay,
                          ),
                          size: size,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: IgnorePointer(
                ignoring: !_fsShowControls,
                child: AnimatedOpacity(
                  opacity: _fsShowControls ? 1 : 0,
                  duration: const Duration(milliseconds: 180),
                  child: SafeArea(
                    bottom: false,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: Row(
                        children: [
                          IconButton(
                            onPressed: _exitFullscreen,
                            icon: const Icon(Icons.fullscreen_exit, color: Colors.white),
                          ),
                          Expanded(
                            child: Text(
                              widget.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (_fsZoom > 1.05)
                            TextButton(
                              onPressed: () {
                                _setFsZoom(1);
                                _scheduleFsHideControls();
                              },
                              child: Text(
                                '${_fsZoom.toStringAsFixed(1)}x Reset',
                                style: const TextStyle(color: Colors.white70),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: IgnorePointer(
                ignoring: !_fsShowControls,
                child: AnimatedOpacity(
                  opacity: _fsShowControls ? 1 : 0,
                  duration: const Duration(milliseconds: 180),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.transparent,
                          Colors.black.withValues(alpha: 0.75),
                        ],
                      ),
                    ),
                    child: SafeArea(
                      top: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(8, 24, 8, 8),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SliderTheme(
                              data: SliderTheme.of(context).copyWith(
                                trackHeight: 2,
                                thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                              ),
                              child: Slider(
                                value: _playheadMs.clamp(0, _durationMs).toDouble(),
                                max: dur,
                                onChanged: (v) {
                                  _seekTo(v.round());
                                  _scheduleFsHideControls();
                                  _fullscreenEntry?.markNeedsBuild();
                                },
                              ),
                            ),
                            Row(
                              children: [
                                IconButton(
                                  onPressed: () {
                                    _seekTo(_playheadMs - 10000);
                                    _scheduleFsHideControls();
                                    _fullscreenEntry?.markNeedsBuild();
                                  },
                                  icon: const Icon(Icons.replay_10, color: Colors.white),
                                ),
                                IconButton(
                                  onPressed: () async {
                                    if (_playing) {
                                      await _pause();
                                      _fsShowControls = true;
                                    } else {
                                      await _play();
                                      _scheduleFsHideControls();
                                    }
                                    _fullscreenEntry?.markNeedsBuild();
                                  },
                                  icon: Icon(
                                    _playing ? Icons.pause_circle : Icons.play_circle,
                                    color: Colors.white,
                                    size: 40,
                                  ),
                                ),
                                IconButton(
                                  onPressed: () {
                                    _seekTo(_playheadMs + 10000);
                                    _scheduleFsHideControls();
                                    _fullscreenEntry?.markNeedsBuild();
                                  },
                                  icon: const Icon(Icons.forward_10, color: Colors.white),
                                ),
                                IconButton(
                                  onPressed: _fsZoom <= _minZoom
                                      ? null
                                      : () {
                                          _setFsZoom(_fsZoom / 1.35);
                                          _scheduleFsHideControls();
                                        },
                                  icon: const Icon(Icons.zoom_out, color: Colors.white),
                                ),
                                IconButton(
                                  onPressed: _fsZoom >= _maxZoom
                                      ? null
                                      : () {
                                          _setFsZoom(_fsZoom * 1.35);
                                          _scheduleFsHideControls();
                                        },
                                  icon: const Icon(Icons.zoom_in, color: Colors.white),
                                ),
                                const Spacer(),
                                PopupMenuButton<double>(
                                  initialValue: _speed,
                                  onSelected: (v) async {
                                    _speed = v;
                                    await _audio.setSpeed(v);
                                    if (mounted) setState(() {});
                                    _scheduleFsHideControls();
                                    _fullscreenEntry?.markNeedsBuild();
                                  },
                                  itemBuilder: (_) => const [
                                    PopupMenuItem(value: 0.75, child: Text('0.75x')),
                                    PopupMenuItem(value: 1, child: Text('1x')),
                                    PopupMenuItem(value: 1.25, child: Text('1.25x')),
                                    PopupMenuItem(value: 1.5, child: Text('1.5x')),
                                    PopupMenuItem(value: 2, child: Text('2x')),
                                  ],
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 8),
                                    child: Text(
                                      '${_speed}x',
                                      style: const TextStyle(color: Colors.white70),
                                    ),
                                  ),
                                ),
                                Text(
                                  '${_fmt(_playheadMs)} / ${_fmt(_durationMs)}',
                                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                                ),
                                const SizedBox(width: 8),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
      ),
    );
  }

  Future<void> _load() async {
    try {
      final offline = await WhiteboardOfflineStore.get(widget.lessonId);
      _savedOffline = offline != null;

      late final Uint8List packageBytes;
      Map<String, String> localPdfs = {};

      if (offline != null) {
        final pkgPath = await WhiteboardOfflineStore.resolvedPackagePath(offline);
        packageBytes = await File(pkgPath).readAsBytes();
        localPdfs = await WhiteboardOfflineStore.resolvedPdfPaths(offline);
        _offlineSource = true;
      } else {
        final online = await NetworkStatus.isOnline();
        if (!online) {
          throw StateError('OFFLINE_NOT_SAVED');
        }
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
        packageBytes = Uint8List.fromList(res.bodyBytes);
        _offlineSource = false;
      }

      final pkg = parseUbrdPackage(packageBytes);
      _engine.load(pkg.events);
      _board.reset();
      _board.theme = pkg.manifest.theme;

      // PDF underlay is optional — never block strokes/audio on Android PdfRenderer.
      for (final pdf in pkg.pdfs) {
        await _pdfCache.preload(pdf, localFilePath: localPdfs[pdf.assetId]);
      }

      await _audioPosSub?.cancel();
      await _audioStateSub?.cancel();
      await _audio.stop();

      final hasAudio = pkg.audioBytes.isNotEmpty;
      if (hasAudio) {
        final audioFile = await writeWhiteboardAudioFile(
          lessonId: widget.lessonId,
          audioFileName: pkg.audioFileName,
          audioBytes: pkg.audioBytes,
        );

        Future<void> loadPath(String path) =>
            _audio.setFilePath(path, preload: true);

        try {
          // Web-studio boards ship Opus/WebM; transcode on Android first.
          if (Platform.isAndroid &&
              whiteboardAudioLikelyNeedsTranscode(
                pkg.audioFileName,
                codec: pkg.manifest.audioCodec,
              )) {
            final aac = await transcodeWhiteboardAudioToAac(audioFile);
            await loadPath(aac.path);
          } else {
            await loadPath(audioFile.path);
          }
        } catch (_) {
          if (Platform.isAndroid) {
            final aac = await transcodeWhiteboardAudioToAac(audioFile);
            await loadPath(aac.path);
          } else {
            rethrow;
          }
        }
        await _audio.setSpeed(_speed);
        _audioPosSub = _audio.positionStream.listen((pos) {
          _onAudioPosition(pos.inMilliseconds);
        });
        _audioStateSub = _audio.playerStateStream.listen((state) {
          if (state.processingState == ProcessingState.completed) {
            _onAudioPosition(_durationMs);
            if (mounted) setState(() => _playing = false);
            unawaited(_setKeepAwake(false));
            _emitProgress();
          }
        });
      }

      _pkg = pkg;
      _durationMs = pkg.manifest.durationMs > 0
          ? pkg.manifest.durationMs
          : (_audio.duration?.inMilliseconds ?? 0);
      if (widget.initialPositionSec > 0) {
        await _seekTo(widget.initialPositionSec * 1000);
      } else {
        _applyUntil(0);
      }
      await _refreshPdfUnderlay();
      _progressTimer = Timer.periodic(const Duration(seconds: 5), (_) => _emitProgress());
      if (!mounted) return;
      final showIntro = widget.initialPositionSec < 3;
      setState(() {
        _loading = false;
        _showBrandIntro = showIntro;
      });
      if (!showIntro) {
        if (widget.autoPlay) {
          await _play();
          _scheduleHideControls();
        } else {
          setState(() => _showControls = true);
        }
      }
    } catch (e) {
      if (!mounted) return;
      final raw = e.toString();
      setState(() {
        _loading = false;
        // pdfx release builds surface R8 names like PlatformException(d, h5.d: Unknown error…)
        final isPdfNative = raw.contains('PlatformException') &&
            (raw.contains('Unknown error') || raw.contains('pdf_renderer'));
        _error = raw.contains('OFFLINE_NOT_SAVED')
            ? 'No internet — save this board lesson while online to watch offline'
            : isPdfNative
                ? 'Could not load the PDF background on this device — try again or re-save the lesson'
                : raw.contains('AUDIO_') ||
                        raw.contains('media open') ||
                        raw.contains('PlayerException')
                    ? 'Could not play board audio on this device'
                    : raw;
      });
    }
  }

  Future<void> _onBrandIntroFinished() async {
    if (!mounted || !_showBrandIntro) return;
    setState(() => _showBrandIntro = false);
    if (widget.autoPlay) {
      await _play();
      _scheduleHideControls();
    } else if (mounted) {
      setState(() => _showControls = true);
    }
  }

  Future<void> _toggleOfflineSave() async {
    if (_savingOffline) return;
    setState(() => _savingOffline = true);
    try {
      if (_savedOffline) {
        await WhiteboardOfflineStore.remove(widget.lessonId);
        if (!mounted) return;
        setState(() {
          _savedOffline = false;
          _savingOffline = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Removed offline board lesson')),
        );
        return;
      }
      if (!await NetworkStatus.isOnline()) {
        throw StateError('Need internet to download');
      }
      final api = context.read<ApiClient>();
      await WhiteboardOfflineStore.saveLesson(
        api: api,
        lessonId: widget.lessonId,
        courseId: widget.courseId ?? '',
        title: widget.title,
        packageUrl: widget.packageUrl,
        whiteboardId: widget.whiteboardId,
        durationSec: widget.durationSec ?? (_durationMs / 1000).round(),
      );
      if (!mounted) return;
      setState(() {
        _savedOffline = true;
        _savingOffline = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Board lesson saved for offline')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingOffline = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Offline save failed: $e')),
      );
    }
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
      // Never fail playback for underlay — Android PdfRenderer is fragile.
      debugPrint('WhiteboardPlayer PDF underlay: $e');
      if (mounted) setState(() => _pdfUnderlay = null);
    }
  }

  void _onAudioPosition(int ms) {
    if (ms == _playheadMs) return;
    final prevPageId = _board.currentPageId;
    final prevPdfPage = _board.currentPage?.pdfPage;
    _playheadMs = ms;
    _applyForward(ms);
    final preview = widget.freePreviewSec;
    if (preview != null && preview > 0 && ms >= preview * 1000) {
      unawaited(_pause());
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Free preview ended — purchase to continue')),
        );
      }
    }
    final pageChanged =
        prevPageId != _board.currentPageId || prevPdfPage != _board.currentPage?.pdfPage;
    if (pageChanged) {
      unawaited(_refreshPdfUnderlay());
    }
    if (_inFullscreen) {
      _fullscreenEntry?.markNeedsBuild();
    } else if (mounted) {
      setState(() {});
    }
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
    try {
      if (_audio.audioSource != null) {
        await _audio.seek(Duration(milliseconds: clamped));
      }
    } catch (_) {}
    _playheadMs = clamped;
    _applyUntil(clamped);
    await _refreshPdfUnderlay();
    if (mounted) setState(() {});
  }

  Future<void> _play() async {
    try {
      if (_audio.audioSource != null) {
        await _audio.play();
      } else if (_durationMs > 0) {
        // Silent board (no audio track) — advance via ticker.
        _tick?.cancel();
        _tick = Timer.periodic(const Duration(milliseconds: 50), (_) {
          if (!_playing) return;
          final next = (_playheadMs + 50).clamp(0, _durationMs);
          _onAudioPosition(next);
          if (next >= _durationMs) {
            _tick?.cancel();
            if (mounted) setState(() => _playing = false);
            unawaited(_setKeepAwake(false));
            _emitProgress();
          }
        });
      }
    } catch (e) {
      debugPrint('WhiteboardPlayer play: $e');
    }
    if (mounted) setState(() => _playing = true);
    unawaited(_setKeepAwake(true));
  }

  Future<void> _pause() async {
    _tick?.cancel();
    try {
      if (_audio.audioSource != null) await _audio.pause();
    } catch (_) {}
    if (mounted) setState(() => _playing = false);
    unawaited(_setKeepAwake(false));
    _emitProgress();
  }

  void _emitProgress() {
    final dur = (_durationMs / 1000).round().clamp(1, 1 << 30);
    final pos = (_playheadMs / 1000).round();
    final completed = pos >= dur * 0.9;
    widget.onProgress?.call(pos, dur, completed);
  }

  void _toggleControls() {
    setState(() => _showControls = !_showControls);
    if (_showControls) {
      _scheduleHideControls();
    } else {
      _hideControlsTimer?.cancel();
    }
  }

  void _scheduleHideControls() {
    _hideControlsTimer?.cancel();
    if (!_playing) return;
    _hideControlsTimer = Timer(const Duration(seconds: 3), () {
      if (mounted && _playing) setState(() => _showControls = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return _wrapShell(
        child: const Center(child: CircularProgressIndicator(color: Colors.white)),
      );
    }
    if (_error != null) {
      return _wrapShell(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
          ),
        ),
      );
    }

    final bg = _board.theme == WhiteboardThemeId.black ? const Color(0xFF0B0F14) : const Color(0xFFF1F5F9);

    final board = ColoredBox(
      color: bg,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned.fill(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final size = Size(constraints.maxWidth, constraints.maxHeight);
                return InteractiveViewer(
                  transformationController: _transform,
                  minScale: _minZoom,
                  maxScale: _maxZoom,
                  boundaryMargin: const EdgeInsets.all(80),
                  clipBehavior: Clip.hardEdge,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onDoubleTap: () {
                      if (_zoom > 1.05) {
                        _resetZoom();
                      } else {
                        _setZoom(2.2);
                      }
                      _scheduleHideControls();
                    },
                    onTap: _toggleControls,
                    child: SizedBox(
                      width: size.width,
                      height: size.height,
                      child: CustomPaint(
                        painter: WhiteboardPainter(
                          state: _board,
                          boardWidth: _pkg?.manifest.boardWidth ?? kLogicalBoardWidth,
                          boardHeight: _pkg?.manifest.boardHeight ?? kLogicalBoardHeight,
                          pdfUnderlay: _pdfUnderlay,
                        ),
                        size: size,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          if (!_online || _offlineSource)
            Positioned(
              top: 8,
              left: 8,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.55),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _online ? Icons.offline_pin : Icons.wifi_off_rounded,
                        color: Colors.white,
                        size: 14,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        _online ? 'Playing offline copy' : 'Offline mode',
                        style: const TextStyle(color: Colors.white, fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (_zoom > 1.05)
            Positioned(
              top: 8,
              right: 8,
              child: Material(
                color: Colors.black.withValues(alpha: 0.55),
                borderRadius: BorderRadius.circular(16),
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: _resetZoom,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    child: Text(
                      '${_zoom.toStringAsFixed(1)}x  Reset',
                      style: const TextStyle(color: Colors.white, fontSize: 11),
                    ),
                  ),
                ),
              ),
            ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: IgnorePointer(
              ignoring: !_showControls,
              child: AnimatedOpacity(
                opacity: _showControls ? 1 : 0,
                duration: const Duration(milliseconds: 180),
                child: _controlsOverlay(),
              ),
            ),
          ),
        ],
      ),
    );

    // Fullscreen is an Overlay owned by this State — keep an inert placeholder underneath
    // so rotation cannot spawn a second playing board in the course layout.
    if (_inFullscreen) {
      return _wrapShell(
        child: const AbsorbPointer(
          child: ColoredBox(color: Colors.black, child: SizedBox.expand()),
        ),
      );
    }

    final content = _showBrandIntro
        ? Stack(
            fit: StackFit.expand,
            children: [
              board,
              Positioned.fill(
                child: WhiteboardBrandIntro(
                  lessonTitle: widget.title,
                  onFinished: () => unawaited(_onBrandIntroFinished()),
                ),
              ),
            ],
          )
        : board;

    return _wrapShell(child: content, showAppBar: !widget.embedded);
  }

  Widget _wrapShell({required Widget child, bool showAppBar = false}) {
    if (widget.embedded) {
      return ColoredBox(color: Colors.black, child: child);
    }
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: showAppBar
          ? AppBar(
              title: Text(widget.title),
              actions: [
                PopupMenuButton<double>(
                  initialValue: _speed,
                  onSelected: (v) async {
                    _speed = v;
                    await _audio.setSpeed(v);
                    setState(() {});
                    _scheduleHideControls();
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
            )
          : null,
      body: child,
    );
  }

  Widget _controlsOverlay() {
    final dur = _durationMs <= 0 ? 1.0 : _durationMs.toDouble();
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.transparent,
            Colors.black.withValues(alpha: 0.72),
          ],
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 28, 8, 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SliderTheme(
                data: SliderTheme.of(context).copyWith(
                  trackHeight: 2,
                  thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                ),
                child: Slider(
                  value: _playheadMs.clamp(0, _durationMs).toDouble(),
                  max: dur,
                  onChanged: (v) {
                    _seekTo(v.round());
                    _scheduleHideControls();
                  },
                ),
              ),
              Row(
                children: [
                  IconButton(
                    onPressed: () {
                      _seekTo(_playheadMs - 10000);
                      _scheduleHideControls();
                    },
                    icon: const Icon(Icons.replay_10, color: Colors.white),
                  ),
                  IconButton(
                    onPressed: () async {
                      if (_playing) {
                        await _pause();
                        setState(() => _showControls = true);
                      } else {
                        await _play();
                        _scheduleHideControls();
                      }
                    },
                    icon: Icon(
                      _playing ? Icons.pause_circle : Icons.play_circle,
                      color: Colors.white,
                      size: 40,
                    ),
                  ),
                  IconButton(
                    onPressed: () {
                      _seekTo(_playheadMs + 10000);
                      _scheduleHideControls();
                    },
                    icon: const Icon(Icons.forward_10, color: Colors.white),
                  ),
                  if (widget.allowOfflineSave)
                    IconButton(
                      tooltip: _savedOffline ? 'Remove offline copy' : 'Save for offline',
                      onPressed: _savingOffline ? null : _toggleOfflineSave,
                      icon: _savingOffline
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Icon(
                              _savedOffline ? Icons.download_done_rounded : Icons.download_rounded,
                              color: _savedOffline ? Colors.lightGreenAccent : Colors.white,
                            ),
                    ),
                  IconButton(
                    tooltip: 'Zoom out',
                    onPressed: _zoom <= _minZoom ? null : () => _zoomBy(1 / 1.35),
                    icon: const Icon(Icons.zoom_out, color: Colors.white),
                  ),
                  IconButton(
                    tooltip: 'Zoom in',
                    onPressed: _zoom >= _maxZoom ? null : () => _zoomBy(1.35),
                    icon: const Icon(Icons.zoom_in, color: Colors.white),
                  ),
                  if (widget.showFullscreen)
                    IconButton(
                      tooltip: 'Fullscreen',
                      onPressed: _enterFullscreen,
                      icon: const Icon(Icons.fullscreen, color: Colors.white),
                    ),
                  const Spacer(),
                  PopupMenuButton<double>(
                    initialValue: _speed,
                    onSelected: (v) async {
                      _speed = v;
                      await _audio.setSpeed(v);
                      setState(() {});
                      _scheduleHideControls();
                    },
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 0.75, child: Text('0.75x')),
                      PopupMenuItem(value: 1, child: Text('1x')),
                      PopupMenuItem(value: 1.25, child: Text('1.25x')),
                      PopupMenuItem(value: 1.5, child: Text('1.5x')),
                      PopupMenuItem(value: 2, child: Text('2x')),
                    ],
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Text('${_speed}x', style: const TextStyle(color: Colors.white70)),
                    ),
                  ),
                  Text(
                    '${_fmt(_playheadMs)} / ${_fmt(_durationMs)}',
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                  const SizedBox(width: 8),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
