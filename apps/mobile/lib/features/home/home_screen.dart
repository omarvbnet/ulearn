import 'package:flutter/material.dart';
import 'package:ulearn/core/widgets/apple_tab_bar.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/courses/my_courses_screen.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/notifications/notifications_screen.dart';
import 'package:ulearn/features/profile/profile_screen.dart';
import 'package:ulearn/features/store/store_screen.dart';
import 'package:ulearn/features/reels/reels_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  static const _titles = ['U Learn', 'My Courses', 'Store', 'Reels', 'Profile'];

  static const _tabs = [
    AppleTabItem(icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'Home'),
    AppleTabItem(
      icon: Icons.play_lesson_outlined,
      activeIcon: Icons.play_lesson_rounded,
      label: 'Courses',
    ),
    AppleTabItem(
      icon: Icons.storefront_outlined,
      activeIcon: Icons.storefront_rounded,
      label: 'Store',
    ),
    AppleTabItem(icon: Icons.movie_outlined, activeIcon: Icons.movie_rounded, label: 'Reels'),
    AppleTabItem(icon: Icons.person_outline, activeIcon: Icons.person_rounded, label: 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    final isReels = _index == 3;

    return Scaffold(
      extendBody: true,
      extendBodyBehindAppBar: isReels,
      appBar: isReels
          ? null
          : AppBar(
              title: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const ULearnLogo(size: 28),
                  const SizedBox(width: 8),
                  Text(_titles[_index]),
                ],
              ),
              actions: [
                IconButton(
                  icon: const Icon(Icons.notifications_outlined),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => Scaffold(
                        appBar: AppBar(title: const Text('Notifications')),
                        body: const NotificationsScreen(),
                      ),
                    ),
                  ),
                ),
              ],
            ),
      body: IndexedStack(
        index: _index,
        children: [
          const _TabSafeArea(child: HomeFeed()),
          const _TabSafeArea(child: MyCoursesScreen()),
          const _TabSafeArea(child: StoreScreen()),
          ReelsScreen(isTabActive: _index == 3),
          const _TabSafeArea(child: ProfileScreen()),
        ],
      ),
      bottomNavigationBar: AppleTabBar(
        items: _tabs,
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
      ),
    );
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
