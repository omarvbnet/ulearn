import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/courses/courses_screen.dart';
import 'package:ulearn/features/notifications/notifications_screen.dart';
import 'package:ulearn/features/profile/profile_screen.dart';
import 'package:ulearn/features/rankings/rankings_screen.dart';
import 'package:ulearn/features/subscriptions/subscriptions_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  static const _titles = ['U Learn', 'Courses', 'Rankings', 'Subscribe', 'Profile'];

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final pages = [
      _HomeTab(name: auth.user?.fullLegalName),
      const CoursesScreen(),
      const RankingsScreen(),
      const SubscriptionsScreen(),
      const ProfileScreen(),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/images/logo.png', width: 28, height: 28),
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
          NavigationDestination(icon: Icon(Icons.menu_book_outlined), label: 'Courses'),
          NavigationDestination(icon: Icon(Icons.leaderboard_outlined), label: 'Ranks'),
          NavigationDestination(icon: Icon(Icons.card_membership_outlined), label: 'Subscribe'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
        ],
      ),
    );
  }
}

class _HomeTab extends StatefulWidget {
  const _HomeTab({this.name});
  final String? name;

  @override
  State<_HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<_HomeTab> {
  List<dynamic> _subjects = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/courses');
      setState(() => _subjects = data['subjects'] as List<dynamic>? ?? []);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Welcome${widget.name != null ? ', ${widget.name}' : ''}',
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        const Text('Continue learning', style: TextStyle(color: AppTheme.muted)),
        const SizedBox(height: 20),
        ..._subjects.map((s) {
          final subject = s as Map<String, dynamic>;
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              title: Text(subject['nameEn']?.toString() ?? 'Subject'),
              subtitle: Text(
                '${(subject['chapters'] as List?)?.length ?? 0} chapters',
                style: const TextStyle(color: AppTheme.muted),
              ),
              trailing: const Icon(Icons.chevron_right, color: AppTheme.accent),
            ),
          );
        }),
        if (_subjects.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'No courses yet. Free lessons unlock after approval.',
                style: TextStyle(color: AppTheme.muted),
                textAlign: TextAlign.center,
              ),
            ),
          ),
      ],
    );
  }
}
