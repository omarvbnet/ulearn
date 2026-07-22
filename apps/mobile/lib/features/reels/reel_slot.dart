import 'package:flutter/material.dart';
import 'package:ulearn/features/reels/reel_page.dart';

/// Isolates reel playback state so swiping does not rebuild the whole feed.
///
/// Keeps the previous/next page [keepWarm] so swipe-back replay does not
/// cold-start the decoder (main cause of “lag when replaying”).
class ReelSlot extends StatelessWidget {
  const ReelSlot({
    super.key,
    required this.index,
    required this.activeIndex,
    required this.playbackActive,
    required this.video,
    required this.bottomInset,
    required this.onLike,
    required this.onComment,
    this.onSave,
    this.onTeacherTap,
    this.onMore,
  });

  final int index;
  final ValueNotifier<int> activeIndex;
  final ValueNotifier<bool> playbackActive;
  final Map<String, dynamic> video;
  final double bottomInset;
  final VoidCallback onLike;
  final VoidCallback onComment;
  final VoidCallback? onSave;
  final VoidCallback? onTeacherTap;
  final VoidCallback? onMore;

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: ValueListenableBuilder<bool>(
        valueListenable: playbackActive,
        builder: (context, playing, _) {
          return ValueListenableBuilder<int>(
            valueListenable: activeIndex,
            builder: (context, current, _) {
              final distance = (index - current).abs();
              return ReelPage(
                video: video,
                active: playing && index == current,
                keepWarm: distance <= 1,
                bottomInset: bottomInset,
                onLike: onLike,
                onComment: onComment,
                onSave: onSave,
                onTeacherTap: onTeacherTap,
                onMore: onMore,
              );
            },
          );
        },
      ),
    );
  }
}
