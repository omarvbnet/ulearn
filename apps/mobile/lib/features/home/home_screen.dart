import 'package:flutter/material.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/courses/my_courses_screen.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/features/notifications/notifications_screen.dart';
import 'package:ulearn/features/profile/profile_screen.dart';
import 'package:ulearn/features/rankings/rankings_screen.dart';
import 'package:ulearn/features/store/store_screen.dart';
import 'package:ulearn/features/reels/reels_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  static const _titles = ['U Learn', 'My Courses', 'Store', 'Ranks', 'Reels', 'Profile'];

  @override
  Widget build(BuildContext context) {
    final isReels = _index == 4;

    const pages = [
      HomeFeed(),
      MyCoursesScreen(),
      StoreScreen(),
      RankingsScreen(),
      ReelsScreen(),
      ProfileScreen(),
    ];

    return Scaffold(
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
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 250),
        switchInCurve: Curves.easeOutCubic,
        transitionBuilder: (child, animation) => FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(0, 0.02),
              end: Offset.zero,
            ).animate(animation),
            child: child,
          ),
        ),
        child: KeyedSubtree(key: ValueKey(_index), child: pages[_index]),
      ),
      bottomNavigationBar: NavigationBar(
        backgroundColor: AppTheme.card,
        indicatorColor: AppTheme.primary.withValues(alpha: 0.25),
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.play_lesson_outlined), label: 'My Courses'),
          NavigationDestination(icon: Icon(Icons.storefront_outlined), label: 'Store'),
          NavigationDestination(icon: Icon(Icons.leaderboard_outlined), label: 'Ranks'),
          NavigationDestination(icon: Icon(Icons.movie_outlined), label: 'Reels'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
  }
}

