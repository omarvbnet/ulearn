import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Skeleton loading primitives.
///
/// Wrap a layout of [SkeletonBox] / [SkeletonCircle] / [SkeletonLine]
/// in a single [Skeleton] widget — it drives one shared pulse animation
/// for the whole subtree.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, required this.child});

  final Widget child;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: FadeTransition(
        opacity: Tween(begin: 0.45, end: 1.0).animate(
          CurvedAnimation(parent: _pulse, curve: Curves.easeInOut),
        ),
        child: widget.child,
      ),
    );
  }
}

class SkeletonBox extends StatelessWidget {
  const SkeletonBox({
    super.key,
    this.width,
    this.height = 100,
    this.radius = 12,
    this.margin = EdgeInsets.zero,
  });

  final double? width;
  final double height;
  final double radius;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      margin: margin,
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: AppTheme.cardBorder),
      ),
    );
  }
}

class SkeletonCircle extends StatelessWidget {
  const SkeletonCircle({super.key, this.size = 40});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: AppTheme.card,
        shape: BoxShape.circle,
        border: Border.all(color: AppTheme.cardBorder),
      ),
    );
  }
}

/// A thin rounded bar standing in for a line of text.
class SkeletonLine extends StatelessWidget {
  const SkeletonLine({super.key, this.width, this.height = 12});

  final double? width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppTheme.cardBorder,
        borderRadius: BorderRadius.circular(height / 2),
      ),
    );
  }
}

// ── Prebuilt layouts ───────────────────────────────────────────

/// List-tile shaped placeholder: circle avatar + two text lines +
/// a small trailing block. Used for rankings, notifications, videos.
class SkeletonListTile extends StatelessWidget {
  const SkeletonListTile({super.key, this.hasTrailing = true});

  final bool hasTrailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Row(
        children: [
          const SkeletonCircle(size: 42),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                SkeletonLine(width: 140),
                SizedBox(height: 8),
                SkeletonLine(width: 90, height: 10),
              ],
            ),
          ),
          if (hasTrailing) const SkeletonLine(width: 48),
        ],
      ),
    );
  }
}

/// Text-card placeholder: title row + subtitle + short description.
/// Used for store courses and course subjects.
class SkeletonTextCard extends StatelessWidget {
  const SkeletonTextCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          Row(
            children: [
              Expanded(child: SkeletonLine(width: 180, height: 14)),
              SizedBox(width: 12),
              SkeletonLine(width: 64),
            ],
          ),
          SizedBox(height: 12),
          SkeletonLine(width: 140, height: 10),
          SizedBox(height: 8),
          SkeletonLine(height: 10),
          SizedBox(height: 6),
          SkeletonLine(width: 220, height: 10),
        ],
      ),
    );
  }
}

/// Rich course-card placeholder: cover image block + meta rows.
/// Matches the home feed / favorites course cards.
class SkeletonCourseCard extends StatelessWidget {
  const SkeletonCourseCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SkeletonBox(height: 150, radius: 18),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                SkeletonLine(width: 190, height: 14),
                SizedBox(height: 10),
                Row(
                  children: [
                    SkeletonCircle(size: 26),
                    SizedBox(width: 8),
                    SkeletonLine(width: 110, height: 10),
                  ],
                ),
                SizedBox(height: 12),
                Row(
                  children: [
                    SkeletonLine(width: 54, height: 10),
                    SizedBox(width: 12),
                    SkeletonLine(width: 54, height: 10),
                    SizedBox(width: 12),
                    SkeletonLine(width: 54, height: 10),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Convenience: a non-scrollable padded list of identical placeholders.
class SkeletonList extends StatelessWidget {
  const SkeletonList({
    super.key,
    this.count = 6,
    this.padding = const EdgeInsets.all(16),
    required this.itemBuilder,
  });

  final int count;
  final EdgeInsets padding;
  final Widget Function(int index) itemBuilder;

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: ListView.builder(
        physics: const NeverScrollableScrollPhysics(),
        padding: padding,
        itemCount: count,
        itemBuilder: (_, i) => itemBuilder(i),
      ),
    );
  }
}

/// Video player placeholder: 16:9 dark stage with a play circle,
/// followed by title/meta lines.
class SkeletonVideoPlayer extends StatelessWidget {
  const SkeletonVideoPlayer({super.key});

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: Container(
              color: AppTheme.card,
              child: const Center(child: SkeletonCircle(size: 64)),
            ),
          ),
          const Padding(
            padding: EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonLine(width: 220, height: 14),
                SizedBox(height: 10),
                SkeletonLine(width: 140, height: 10),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
