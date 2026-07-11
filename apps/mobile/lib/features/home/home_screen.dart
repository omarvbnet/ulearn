import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/widgets/apple_tab_bar.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/ai/ai_with_ulearn_entry.dart';
import 'package:ulearn/features/courses/my_courses_screen.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/notifications/notifications_screen.dart';
import 'package:ulearn/features/profile/profile_screen.dart';
import 'package:ulearn/features/store/store_screen.dart';
import 'package:ulearn/features/reels/reels_screen.dart';
import 'package:ulearn/core/widgets/glass.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;
  final _reelsRefresh = ValueNotifier(0);
  DateTime? _lastReelsTap;

  static const _reelsTabIndex = 3;

  String _title(BuildContext context) {
    final l10n = context.l10n;
    return switch (_index) {
      0 => l10n.brand,
      1 => l10n.homeMyCourses,
      2 => l10n.navStore,
      3 => l10n.reelsTitle,
      4 => l10n.navProfile,
      _ => l10n.brand,
    };
  }

  List<AppleTabItem> _tabs(BuildContext context) {
    final l10n = context.l10n;
    return [
      AppleTabItem(
        icon: Icons.home_outlined,
        activeIcon: Icons.home_rounded,
        label: l10n.navHome,
      ),
      AppleTabItem(
        icon: Icons.play_lesson_outlined,
        activeIcon: Icons.play_lesson_rounded,
        label: l10n.navCourses,
      ),
      AppleTabItem(
        icon: Icons.storefront_outlined,
        activeIcon: Icons.storefront_rounded,
        label: l10n.navStore,
      ),
      AppleTabItem(
        icon: Icons.movie_outlined,
        activeIcon: Icons.movie_rounded,
        label: l10n.reelsTitle,
      ),
      AppleTabItem(
        icon: Icons.person_outline,
        activeIcon: Icons.person_rounded,
        label: l10n.navProfile,
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final isReels = _index == _reelsTabIndex;

    return Scaffold(
      extendBody: true,
      extendBodyBehindAppBar: isReels,
      appBar: isReels
          ? null
          : GlassAppBar(
              title: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const ULearnLogo(size: 28),
                  const SizedBox(width: 8),
                  Text(_title(context)),
                ],
              ),
              actions: [
                IconButton(
                  icon: const Icon(Icons.notifications_outlined),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => Scaffold(
                        appBar: GlassAppBar(title: Text(context.l10n.navNotifications)),
                        body: const NotificationsScreen(),
                      ),
                    ),
                  ),
                ),
              ],
            ),
      body: Stack(
        children: [
          IndexedStack(
            index: _index,
            children: [
              const _TabSafeArea(child: HomeFeed()),
              const _TabSafeArea(child: MyCoursesScreen()),
              const _TabSafeArea(child: StoreScreen()),
              ReelsScreen(isTabActive: _index == _reelsTabIndex, refreshTrigger: _reelsRefresh),
              const _TabSafeArea(child: ProfileScreen()),
            ],
          ),
          if (_index == 0)
            const Positioned(
              left: 0,
              top: 0,
              bottom: 78,
              child: AiWithULearnEntry(),
            ),
        ],
      ),
      bottomNavigationBar: AppleTabBar(
        items: _tabs(context),
        currentIndex: _index,
        onTap: (i) {
          if (i == _reelsTabIndex && _index == _reelsTabIndex) {
            final now = DateTime.now();
            if (_lastReelsTap != null &&
                now.difference(_lastReelsTap!) < const Duration(milliseconds: 450)) {
              HapticFeedback.mediumImpact();
              _reelsRefresh.value++;
              _lastReelsTap = null;
              return;
            }
            _lastReelsTap = now;
          } else {
            _lastReelsTap = null;
          }
          setState(() => _index = i);
        },
      ),
    );
  }

  @override
  void dispose() {
    _reelsRefresh.dispose();
    super.dispose();
  }
}

/// Bottom inset so scroll content clears the floating tab bar.
class _TabSafeArea extends StatelessWidget {
  const _TabSafeArea({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 78),
      child: child,
    );
  }
}
