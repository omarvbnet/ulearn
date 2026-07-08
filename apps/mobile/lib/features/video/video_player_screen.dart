import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/quiz/quiz_screen.dart';
import 'package:ulearn/features/video/video_protection.dart';
import 'package:video_player/video_player.dart';

class VideoPlayerScreen extends StatefulWidget {
  const VideoPlayerScreen({
    super.key,
    required this.lessonId,
    required this.title,
  });

  final String lessonId;
  final String title;

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  VideoPlayerController? _controller;
  VideoProtectionController? _protection;
  Timer? _progressTimer;
  bool _loading = true;
  String? _error;
  bool _hasAccess = false;
  double _speed = 1.0;
  List<Map<String, dynamic>> _quizzes = [];

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final auth = context.read<AuthProvider>();
    _protection = VideoProtectionController(
      studentName: auth.user?.fullLegalName ?? 'Student',
      nationalId: '***',
      phone: auth.user?.phone ?? '',
    );
    _protection!.addListener(() {
      if (mounted) setState(() {});
    });
    await _protection!.enable();

    try {
      final api = context.read<ApiClient>();
      final data = await api.get('/api/lessons/${widget.lessonId}');
      if (!mounted) return;

      final lesson = data['lesson'] as Map<String, dynamic>?;
      _hasAccess = data['hasAccess'] == true;
      _quizzes = ((lesson?['quizzes'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>();
      final progress = data['progress'] as Map<String, dynamic>?;
      final resumeAt = (progress?['positionSec'] as num?)?.toInt() ?? 0;

      if (!_hasAccess) {
        setState(() {
          _loading = false;
          _error = 'Subscribe to unlock all lessons';
        });
        return;
      }

      final contents = lesson?['contents'] as List<dynamic>? ?? [];
      final video = contents.cast<Map<String, dynamic>?>().firstWhere(
            (c) => c?['type'] == 'VIDEO',
            orElse: () => null,
          );

      final url = video?['fileUrl'] as String?;
      if (url == null || url.isEmpty) {
        setState(() {
          _loading = false;
          _error = 'Video not available';
        });
        return;
      }

      _controller = VideoPlayerController.networkUrl(Uri.parse(url));
      await _controller!.initialize();
      if (!mounted) return;
      if (resumeAt > 0) {
        await _controller!.seekTo(Duration(seconds: resumeAt));
      }
      await _controller!.play();

      _progressTimer = Timer.periodic(const Duration(seconds: 10), (_) => _saveProgress());

      setState(() => _loading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _saveProgress() async {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    try {
      await context.read<ApiClient>().post('/api/video/progress', {
        'lessonId': widget.lessonId,
        'positionSec': c.value.position.inSeconds,
        'durationSec': c.value.duration.inSeconds,
        'watchedDeltaSec': 10,
      });
    } catch (_) {}
  }

  @override
  void dispose() {
    _progressTimer?.cancel();
    _saveProgress();
    _controller?.dispose();
    _protection?.disable();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text(widget.title),
        backgroundColor: Colors.black,
        actions: [
          if (_quizzes.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.quiz_outlined, color: AppTheme.accent),
              tooltip: 'Take quiz',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => QuizScreen(
                    quizId: _quizzes.first['id'] as String,
                    title: _quizzes.first['titleEn']?.toString() ?? 'Quiz',
                  ),
                ),
              ),
            ),
        ],
      ),
      body: _loading
          ? const SkeletonVideoPlayer()
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: AppTheme.muted),
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : Stack(
                  children: [
                    Center(
                      child: AspectRatio(
                        aspectRatio: _controller!.value.aspectRatio,
                        child: VideoPlayer(_controller!),
                      ),
                    ),
                    if (_protection != null) DynamicWatermark(controller: _protection!),
                    if (_protection != null)
                      ScreenshotBlockOverlay(visible: _protection!.screenshotBlocked),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: _Controls(
                        controller: _controller!,
                        speed: _speed,
                        onSpeed: (s) {
                          setState(() => _speed = s);
                          _controller!.setPlaybackSpeed(s);
                        },
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({
    required this.controller,
    required this.speed,
    required this.onSpeed,
  });

  final VideoPlayerController controller;
  final double speed;
  final ValueChanged<double> onSpeed;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black54,
      padding: const EdgeInsets.all(12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          VideoProgressIndicator(controller, allowScrubbing: true),
          Row(
            children: [
              IconButton(
                icon: Icon(
                  controller.value.isPlaying ? Icons.pause : Icons.play_arrow,
                  color: Colors.white,
                ),
                onPressed: () {
                  controller.value.isPlaying ? controller.pause() : controller.play();
                },
              ),
              PopupMenuButton<double>(
                initialValue: speed,
                onSelected: onSpeed,
                itemBuilder: (_) => [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
                    .map((s) => PopupMenuItem(value: s, child: Text('${s}x')))
                    .toList(),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Text('${speed}x', style: const TextStyle(color: Colors.white)),
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.fullscreen, color: Colors.white),
                onPressed: () {},
              ),
            ],
          ),
        ],
      ),
    );
  }
}
