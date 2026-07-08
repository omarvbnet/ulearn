import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/store/course_video_screen.dart';

/// Store course detail: cover, teacher, stats, lesson list with up to
/// 2 free preview videos, and the purchase ("subscribe") flow.
class CourseDetailScreen extends StatefulWidget {
  const CourseDetailScreen({
    super.key,
    required this.courseId,
    this.summary,
  });

  final String courseId;

  /// Card data from the feed, used to paint the screen instantly
  /// while the full detail loads.
  final Map<String, dynamic>? summary;

  @override
  State<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends State<CourseDetailScreen> {
  Map<String, dynamic>? _course;
  bool _purchased = false;
  bool _buying = false;
  bool _favorited = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _course = widget.summary != null ? Map.of(widget.summary!) : null;
    _load();
    _countView();
  }

  Future<void> _countView() async {
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/courses/${widget.courseId}/view', {});
      if (!mounted) return;
      setState(() => _course?['viewCount'] = data['viewCount']);
    } catch (_) {}
  }

  Future<void> _load() async {
    try {
      final data =
          await context.read<ApiClient>().get('/api/store/courses/${widget.courseId}');
      if (!mounted) return;
      final course = data['course'] as Map<String, dynamic>;
      setState(() {
        // Keep feed-only stats (likes, views, rating) that the detail API lacks.
        final merged = {...?_course, ...course};
        _course = merged;
        _purchased = data['purchased'] == true;
        _favorited = data['favoritedByMe'] == true;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load the course');
    }
  }

  Future<void> _react(String type) async {
    final course = _course;
    if (course == null) return;
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/courses/${widget.courseId}/react', {'type': type});
      if (!mounted) return;
      setState(() {
        course['likes'] = data['likes'];
        course['dislikes'] = data['dislikes'];
        course['myReaction'] = data['myReaction'];
      });
    } catch (_) {}
  }

  Future<void> _toggleFavorite() async {
    final was = _favorited;
    setState(() => _favorited = !was);
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/courses/${widget.courseId}/favorite', {});
      if (!mounted) return;
      setState(() {
        _favorited = data['favoritedByMe'] == true;
        _course?['favoritedByMe'] = _favorited;
        _course?['favorites'] = data['favorites'];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _favorited = was);
    }
  }

  Future<void> _toggleLessonLike(Map<String, dynamic> lesson) async {
    final id = lesson['id'].toString();
    final wasLiked = lesson['likedByMe'] == true;
    setState(() {
      lesson['likedByMe'] = !wasLiked;
      lesson['likes'] = ((lesson['likes'] as num?)?.toInt() ?? 0) + (wasLiked ? -1 : 1);
    });
    try {
      final data =
          await context.read<ApiClient>().post('/api/store/lessons/$id/like', {});
      if (!mounted) return;
      setState(() {
        lesson['likes'] = data['likes'];
        lesson['likedByMe'] = data['likedByMe'];
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        lesson['likedByMe'] = wasLiked;
        lesson['likes'] = ((lesson['likes'] as num?)?.toInt() ?? 0) + (wasLiked ? 1 : -1);
      });
    }
  }

  Future<void> _toggleLessonFavorite(Map<String, dynamic> lesson) async {
    final id = lesson['id'].toString();
    final was = lesson['favoritedByMe'] == true;
    setState(() => lesson['favoritedByMe'] = !was);
    try {
      final data = await context
          .read<ApiClient>()
          .post('/api/store/lessons/$id/favorite', {});
      if (!mounted) return;
      setState(() => lesson['favoritedByMe'] = data['favoritedByMe'] == true);
    } catch (_) {
      if (!mounted) return;
      setState(() => lesson['favoritedByMe'] = was);
    }
  }

  Future<void> _buy() async {
    setState(() => _buying = true);
    try {
      await context
          .read<ApiClient>()
          .post('/api/store/courses/${widget.courseId}/purchase', {});
      if (!mounted) return;
      setState(() => _course?['purchaseStatus'] = 'PENDING');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Subscription requested — we\'ll confirm your payment shortly'),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.message == 'ALREADY_REQUESTED'
                ? 'You already requested this course'
                : 'Failed to request the subscription',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _buying = false);
    }
  }

  void _openLesson(Map<String, dynamic> lesson) {
    final url = lesson['fileUrl']?.toString();
    if (url == null || url.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CourseVideoScreen(
          url: ApiClient.absoluteUrl(url),
          title: lesson['title']?.toString() ?? 'Lesson',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final locale = auth.user?.locale ?? 'AR';
    final course = _course;

    if (course == null) {
      return Scaffold(
        appBar: AppBar(),
        body: _error != null
            ? Center(child: Text(_error!, style: const TextStyle(color: AppTheme.muted)))
            : Skeleton(
                child: ListView(
                  physics: const NeverScrollableScrollPhysics(),
                  padding: EdgeInsets.zero,
                  children: const [
                    SkeletonBox(height: 210, radius: 0),
                    Padding(
                      padding: EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SkeletonLine(width: 220, height: 16),
                          SizedBox(height: 12),
                          Row(
                            children: [
                              SkeletonCircle(size: 34),
                              SizedBox(width: 10),
                              SkeletonLine(width: 130, height: 11),
                            ],
                          ),
                          SizedBox(height: 14),
                          Row(
                            children: [
                              SkeletonLine(width: 60, height: 10),
                              SizedBox(width: 12),
                              SkeletonLine(width: 60, height: 10),
                              SizedBox(width: 12),
                              SkeletonLine(width: 60, height: 10),
                            ],
                          ),
                          SizedBox(height: 20),
                          SkeletonBox(height: 48, radius: 12),
                          SizedBox(height: 20),
                        ],
                      ),
                    ),
                    Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16),
                      child: Column(
                        children: [
                          SkeletonListTile(),
                          SkeletonListTile(),
                          SkeletonListTile(),
                          SkeletonListTile(),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
      );
    }

    final title = localizedText(course, locale);
    final teacher = course['teacher'] as Map<String, dynamic>?;
    final teacherName =
        (teacher?['user'] as Map<String, dynamic>?)?['fullLegalName']?.toString() ?? 'Teacher';
    final rating = (course['teacherRating'] as num?)?.toDouble() ?? 0;
    final views = (course['viewCount'] as num?)?.toInt() ?? 0;
    final likes = (course['likes'] as num?)?.toInt() ?? 0;
    final dislikes = (course['dislikes'] as num?)?.toInt() ?? 0;
    final myReaction = course['myReaction']?.toString();
    final price = (course['price'] as num?)?.toDouble() ?? 0;
    final currency = course['currency']?.toString() ?? 'IQD';
    final isFree = price <= 0;
    final purchaseStatus = course['purchaseStatus']?.toString();
    final thumbnail = course['thumbnail']?.toString();
    final description = course['description']?.toString();
    final lessons =
        ((course['lessons'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    final totalSec = lessons.fold<int>(
      0,
      (s, l) => s + ((l['durationSec'] as num?)?.toInt() ?? 0),
    );
    final unlocked = _purchased || purchaseStatus == 'PAID' || isFree;

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 230,
            pinned: true,
            backgroundColor: AppTheme.background,
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: FavoriteButton(
                  active: _favorited,
                  onTap: _toggleFavorite,
                  size: 36,
                ),
              ),
            ],
            flexibleSpace: FlexibleSpaceBar(
              background: Hero(
                tag: 'course-cover-${widget.courseId}',
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (thumbnail != null && thumbnail.isNotEmpty)
                      Image.network(
                        ApiClient.absoluteUrl(thumbnail),
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => Container(
                          decoration: BoxDecoration(gradient: AppTheme.gradient),
                        ),
                      )
                    else
                      Container(decoration: const BoxDecoration(gradient: AppTheme.gradient)),
                    DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            Colors.transparent,
                            AppTheme.background.withValues(alpha: 0.95),
                          ],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 120),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  StaggeredItem(
                    index: 0,
                    child: Text(
                      title,
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(height: 12),
                  StaggeredItem(
                    index: 1,
                    child: Row(
                      children: [
                        Container(
                          width: 38,
                          height: 38,
                          decoration: const BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: AppTheme.gradient,
                          ),
                          child: Center(
                            child: Text(
                              teacherName.isNotEmpty ? teacherName[0].toUpperCase() : '?',
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                teacherName,
                                style: const TextStyle(fontWeight: FontWeight.w600),
                              ),
                              Row(
                                children: [
                                  const Icon(Icons.star_rounded,
                                      size: 15, color: Colors.amber),
                                  const SizedBox(width: 3),
                                  Text(
                                    rating > 0 ? rating.toStringAsFixed(1) : 'No ratings yet',
                                    style: const TextStyle(
                                        fontSize: 12.5, color: AppTheme.muted),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.visibility_outlined,
                                    size: 15, color: AppTheme.muted),
                                const SizedBox(width: 4),
                                Text(
                                  '${formatCount(views)} views',
                                  style: const TextStyle(
                                      fontSize: 12.5, color: AppTheme.muted),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                const Icon(Icons.schedule, size: 15, color: AppTheme.muted),
                                const SizedBox(width: 4),
                                Text(
                                  formatDuration(totalSec),
                                  style: const TextStyle(
                                      fontSize: 12.5, color: AppTheme.muted),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  StaggeredItem(
                    index: 2,
                    child: Row(
                      children: [
                        ReactionButton(
                          icon: Icons.thumb_up_outlined,
                          activeIcon: Icons.thumb_up,
                          active: myReaction == 'LIKE',
                          activeColor: AppTheme.accent,
                          count: likes,
                          onTap: () => _react('LIKE'),
                        ),
                        const SizedBox(width: 18),
                        ReactionButton(
                          icon: Icons.thumb_down_outlined,
                          activeIcon: Icons.thumb_down,
                          active: myReaction == 'DISLIKE',
                          activeColor: Colors.redAccent,
                          count: dislikes,
                          onTap: () => _react('DISLIKE'),
                        ),
                      ],
                    ),
                  ),
                  if (description != null && description.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    StaggeredItem(
                      index: 3,
                      child: Text(
                        description,
                        style: const TextStyle(color: AppTheme.muted, height: 1.5),
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  StaggeredItem(
                    index: 4,
                    child: Row(
                      children: [
                        const Text(
                          'Lessons',
                          style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '${lessons.length}',
                          style: const TextStyle(color: AppTheme.muted),
                        ),
                        const Spacer(),
                        if (!unlocked)
                          const Text(
                            'Previews are free',
                            style: TextStyle(fontSize: 12, color: AppTheme.accent),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  ...lessons.asMap().entries.map((e) {
                    final lesson = e.value;
                    final isPreview = lesson['isFreePreview'] == true;
                    final canWatch =
                        (unlocked || isPreview) && lesson['fileUrl'] != null;
                    return StaggeredItem(
                      index: e.key + 5,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        decoration: BoxDecoration(
                          color: AppTheme.card,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: canWatch
                                ? AppTheme.accent.withValues(alpha: 0.35)
                                : AppTheme.cardBorder,
                          ),
                        ),
                        child: ListTile(
                          onTap: canWatch ? () => _openLesson(lesson) : null,
                          leading: Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: canWatch
                                  ? AppTheme.accent.withValues(alpha: 0.15)
                                  : AppTheme.cardBorder.withValues(alpha: 0.5),
                            ),
                            child: Icon(
                              canWatch
                                  ? Icons.play_arrow_rounded
                                  : Icons.lock_outline_rounded,
                              color: canWatch ? AppTheme.accent : AppTheme.muted,
                              size: 22,
                            ),
                          ),
                          title: Text(
                            '${e.key + 1}. ${lesson['title'] ?? 'Lesson'}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14.5,
                              color: canWatch ? AppTheme.foreground : AppTheme.muted,
                            ),
                          ),
                          subtitle: lesson['durationSec'] != null
                              ? Text(
                                  formatDuration(
                                      (lesson['durationSec'] as num).toInt()),
                                  style: const TextStyle(
                                      fontSize: 12, color: AppTheme.muted),
                                )
                              : null,
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (isPreview && !unlocked)
                                Container(
                                  margin: const EdgeInsets.only(right: 10),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.green.withValues(alpha: 0.15),
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: const Text(
                                    'FREE',
                                    style: TextStyle(
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.greenAccent,
                                    ),
                                  ),
                                ),
                              ReactionButton(
                                icon: Icons.thumb_up_outlined,
                                activeIcon: Icons.thumb_up,
                                active: lesson['likedByMe'] == true,
                                activeColor: AppTheme.accent,
                                count: (lesson['likes'] as num?)?.toInt() ?? 0,
                                onTap: () => _toggleLessonLike(lesson),
                              ),
                              const SizedBox(width: 10),
                              GestureDetector(
                                onTap: () => _toggleLessonFavorite(lesson),
                                behavior: HitTestBehavior.opaque,
                                child: AnimatedScale(
                                  scale: lesson['favoritedByMe'] == true ? 1.15 : 1,
                                  duration: const Duration(milliseconds: 300),
                                  curve: Curves.elasticOut,
                                  child: Icon(
                                    lesson['favoritedByMe'] == true
                                        ? Icons.favorite
                                        : Icons.favorite_border,
                                    size: 18,
                                    color: lesson['favoritedByMe'] == true
                                        ? Colors.redAccent
                                        : AppTheme.muted,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomSheet: unlocked
          ? null
          : Container(
              padding: EdgeInsets.fromLTRB(
                  18, 12, 18, 12 + MediaQuery.of(context).padding.bottom),
              decoration: const BoxDecoration(
                color: AppTheme.card,
                border: Border(top: BorderSide(color: AppTheme.cardBorder)),
              ),
              child: Row(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Full access',
                        style: TextStyle(fontSize: 12, color: AppTheme.muted),
                      ),
                      Text(
                        '${price.toStringAsFixed(0)} $currency',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.accent,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: SizedBox(
                      height: 48,
                      child: purchaseStatus == 'PENDING'
                          ? OutlinedButton.icon(
                              onPressed: null,
                              icon: const Icon(Icons.hourglass_top, size: 18),
                              label: const Text('Awaiting confirmation'),
                            )
                          : FilledButton.icon(
                              style: FilledButton.styleFrom(
                                backgroundColor: AppTheme.primary,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(14),
                                ),
                              ),
                              onPressed: _buying ? null : _buy,
                              icon: const Icon(Icons.workspace_premium_outlined),
                              label: Text(_buying ? 'Requesting…' : 'Subscribe'),
                            ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
