import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';
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
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: AppTheme.accent));
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
            title: Text(subject['nameEn']?.toString() ?? 'Subject'),
            children: chapters.map((c) {
              final chapter = c as Map<String, dynamic>;
              final lessons = chapter['lessons'] as List<dynamic>? ?? [];
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                    child: Text(
                      chapter['nameEn']?.toString() ?? 'Chapter',
                      style: const TextStyle(fontWeight: FontWeight.w600, color: AppTheme.accent),
                    ),
                  ),
                  ...lessons.map((l) {
                    final lesson = l as Map<String, dynamic>;
                    final isFree = lesson['isFree'] == true;
                    return ListTile(
                      title: Text(lesson['nameEn']?.toString() ?? 'Lesson'),
                      subtitle: Text(
                        isFree ? 'Free' : 'Subscribe to unlock all lessons',
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
                                    title: lesson['nameEn']?.toString() ?? 'Lesson',
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
