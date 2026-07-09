import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/quiz/quiz_screen.dart';
import 'package:ulearn/features/video/course_cast_screen.dart';
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
  bool _completionSaved = false;
  bool _loading = true;
  String? _error;
  bool _hasAccess = false;
  double _speed = 1.0;
  List<Map<String, dynamic>> _quizzes = [];
  String? _videoUrl;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final auth = context.read<AuthProvider>();
    final l10n = context.l10nRead;
    _protection = VideoProtectionController(
      studentName: auth.user?.fullLegalName ?? l10n.t('mobile.roles.student'),
      nationalId: auth.user?.nationalId ?? '',
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
          _error = context.l10n.t('common.subscribeToUnlock');
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
          _error = context.l10n.t('mobile.video.notAvailable');
        });
        return;
      }

      _videoUrl = url;
      _controller = VideoPlayerController.networkUrl(Uri.parse(url));
      await _controller!.initialize();
      if (!mounted) return;
      if (resumeAt > 0) {
        await _controller!.seekTo(Duration(seconds: resumeAt));
      }
      await _controller!.play();

      _controller!.addListener(_onPlaybackUpdate);
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

  void _onPlaybackUpdate() {
    final c = _controller;
    if (c == null || !c.value.isInitialized || _completionSaved) return;
    final v = c.value;
    final duration = v.duration.inSeconds;
    if (duration <= 0) return;
    final nearEnd = v.isCompleted || v.position.inSeconds >= duration - 2;
    if (nearEnd) {
      _completionSaved = true;
      _saveProgress(completed: true);
    }
  }

  Future<void> _saveProgress({bool completed = false}) async {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    try {
      final duration = c.value.duration.inSeconds;
      final position = completed && duration > 0 ? duration : c.value.position.inSeconds;
      await context.read<ApiClient>().post('/api/video/progress', {
        'lessonId': widget.lessonId,
        'positionSec': position,
        'durationSec': duration,
        'watchedDeltaSec': 10,
        if (completed) 'completed': true,
      });
    } catch (_) {}
  }

  @override
  void dispose() {
    _controller?.removeListener(_onPlaybackUpdate);
    _progressTimer?.cancel();
    _saveProgress();
    _controller?.dispose();
    _protection?.disable();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text(widget.title),
        backgroundColor: Colors.black,
        actions: [
          if (_quizzes.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.quiz_outlined, color: AppTheme.accent),
              tooltip: l10n.t('mobile.video.takeQuiz'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => QuizScreen(
                    quizId: _quizzes.first['id'] as String,
                    title: localizedText(_quizzes.first, context.localeCode),
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
                    if (_protection != null) CastingIdentityBanner(controller: _protection!),
                    if (_protection != null)
                      ScreenshotBlockOverlay(visible: _protection!.screenshotBlocked),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: _Controls(
                        controller: _controller!,
                        protection: _protection,
                        videoUrl: _videoUrl,
                        title: widget.title,
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
    required this.protection,
    required this.videoUrl,
    required this.title,
    required this.speed,
    required this.onSpeed,
  });

  final VideoPlayerController controller;
  final VideoProtectionController? protection;
  final String? videoUrl;
  final String title;
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
              if (protection != null && videoUrl != null)
                IconButton(
                  tooltip: context.l10n.castTitle,
                  icon: Icon(
                    protection!.isCasting ? Icons.cast_connected : Icons.cast_outlined,
                    color: protection!.isCasting ? AppTheme.accent : Colors.white,
                  ),
                  onPressed: () => openCourseCastScreen(
                    context,
                    url: videoUrl!,
                    title: title,
                    protection: protection!,
                    positionMs: controller.value.position.inMilliseconds,
                    onPause: () => controller.pause(),
                    onResume: () => controller.play(),
                  ),
                ),
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
