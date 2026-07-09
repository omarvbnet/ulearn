import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/home/home_feed.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/video/video_player_screen.dart';

class CoursesScreen extends StatefulWidget {
  const CoursesScreen({super.key});

  @override
  State<CoursesScreen> createState() => _CoursesScreenState();
}

class _CoursesScreenState extends State<CoursesScreen> {
  List<dynamic> _subjects = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/courses');
      setState(() {
        _subjects = data['subjects'] as List<dynamic>? ?? [];
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;

    if (_loading) {
      return SkeletonList(itemBuilder: (_) => const SkeletonTextCard());
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _subjects.length,
      itemBuilder: (context, i) {
        final subject = _subjects[i] as Map<String, dynamic>;
        final chapters = subject['chapters'] as List<dynamic>? ?? [];
        return Card(
          margin: const EdgeInsets.only(bottom: 16),
          child: ExpansionTile(
            title: Text(localizedText(subject, locale, prefix: 'name')),
            children: chapters.map((c) {
              final chapter = c as Map<String, dynamic>;
              final lessons = chapter['lessons'] as List<dynamic>? ?? [];
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                    child: Text(
                      localizedText(chapter, locale, prefix: 'name'),
                      style: const TextStyle(fontWeight: FontWeight.w600, color: AppTheme.accent),
                    ),
                  ),
                  ...lessons.map((l) {
                    final lesson = l as Map<String, dynamic>;
                    final isFree = lesson['isFree'] == true;
                    final lessonTitle = localizedText(lesson, locale, prefix: 'name');
                    return ListTile(
                      title: Text(lessonTitle),
                      subtitle: Text(
                        isFree ? l10n.free : l10n.t('common.subscribeToUnlock'),
                        style: TextStyle(
                          color: isFree ? AppTheme.accent : AppTheme.muted,
                          fontSize: 12,
                        ),
                      ),
                      trailing: Icon(
                        isFree ? Icons.play_circle_outline : Icons.lock_outline,
                        color: isFree ? AppTheme.primary : AppTheme.muted,
                      ),
                      onTap: isFree
                          ? () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => VideoPlayerScreen(
                                    lessonId: lesson['id'] as String,
                                    title: lessonTitle,
                                  ),
                                ),
                              )
                          : null,
                    );
                  }),
                ],
              );
            }).toList(),
          ),
        );
      },
    );
  }
}
