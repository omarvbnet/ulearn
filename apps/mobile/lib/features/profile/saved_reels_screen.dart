import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/reels/teacher_reels_viewer.dart';

/// Saved short videos from the reels feed.
class SavedReelsScreen extends StatefulWidget {
  const SavedReelsScreen({super.key});

  @override
  State<SavedReelsScreen> createState() => _SavedReelsScreenState();
}

class _SavedReelsScreenState extends State<SavedReelsScreen> {
  List<Map<String, dynamic>> _videos = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await context.read<ApiClient>().get('/api/profile/saved-reels');
      if (!mounted) return;
      setState(() {
        _videos = ((data['videos'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileSavedReels)),
      body: _loading
          ? GridView.builder(
              padding: const EdgeInsets.all(12),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                crossAxisSpacing: 8,
                mainAxisSpacing: 8,
                childAspectRatio: 9 / 14,
              ),
              itemCount: 6,
              itemBuilder: (_, i) => const _SavedReelSkeleton(),
            )
          : _videos.isEmpty
              ? Center(
                  child: Text(
                    l10n.profileSavedReelsHint,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppTheme.muted, height: 1.4),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: GridView.builder(
                    padding: const EdgeInsets.all(12),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 3,
                      crossAxisSpacing: 8,
                      mainAxisSpacing: 8,
                      childAspectRatio: 9 / 14,
                    ),
                    itemCount: _videos.length,
                    itemBuilder: (context, index) {
                      final video = _videos[index];
                      final thumb = video['thumbnailUrl']?.toString();
                      final title = video['title']?.toString() ?? l10n.reelsTitle;
                      final views = (video['viewCount'] as num?)?.toInt() ?? 0;
                      final likes = (video['likes'] as num?)?.toInt() ?? 0;

                      return GestureDetector(
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => TeacherReelsViewer(
                              videos: _videos,
                              initialIndex: index,
                            ),
                          ),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              if (thumb != null && thumb.isNotEmpty)
                                Image.network(
                                  thumb,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, e, st) => _fallback(title),
                                )
                              else
                                _fallback(title),
                              DecoratedBox(
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    colors: [
                                      Colors.transparent,
                                      Colors.black.withValues(alpha: 0.75),
                                    ],
                                    begin: Alignment.topCenter,
                                    end: Alignment.bottomCenter,
                                  ),
                                ),
                              ),
                              Positioned(
                                left: 6,
                                right: 6,
                                bottom: 6,
                                child: Text(
                                  '${l10n.homeViews(views)} · ${l10n.homeLikes(likes)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(color: Colors.white, fontSize: 9),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }

  Widget _fallback(String title) {
    return Container(
      color: AppTheme.card,
      alignment: Alignment.center,
      child: Text(
        title.isNotEmpty ? title[0].toUpperCase() : '?',
        style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.white24),
      ),
    );
  }
}

class _SavedReelSkeleton extends StatelessWidget {
  const _SavedReelSkeleton();

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: Container(
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(10),
        ),
      ),
    );
  }
}
