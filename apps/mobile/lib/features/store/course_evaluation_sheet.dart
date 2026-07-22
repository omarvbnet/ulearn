import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Five-star course evaluation shown after all lessons and quizzes are complete.
class CourseEvaluationSheet extends StatefulWidget {
  const CourseEvaluationSheet({
    super.key,
    required this.courseId,
    required this.courseTitle,
    this.initialRating,
    this.onSubmitted,
  });

  final String courseId;
  final String courseTitle;
  final int? initialRating;
  final VoidCallback? onSubmitted;

  static Future<void> show(
    BuildContext context, {
    required String courseId,
    required String courseTitle,
    int? initialRating,
    VoidCallback? onSubmitted,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: CourseEvaluationSheet(
          courseId: courseId,
          courseTitle: courseTitle,
          initialRating: initialRating,
          onSubmitted: onSubmitted,
        ),
      ),
    );
  }

  @override
  State<CourseEvaluationSheet> createState() => _CourseEvaluationSheetState();
}

class _CourseEvaluationSheetState extends State<CourseEvaluationSheet> {
  late int _rating = widget.initialRating ?? 0;
  final _commentCtrl = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_rating < 1 || _submitting) return;
    setState(() => _submitting = true);
    try {
      await context.read<ApiClient>().post(
            '/api/store/courses/${widget.courseId}/rating',
            {
              'rating': _rating,
              if (_commentCtrl.text.trim().isNotEmpty) 'comment': _commentCtrl.text.trim(),
            },
          );
      if (!mounted) return;
      widget.onSubmitted?.call();
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.store.evaluationThanks'))),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message)),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.store.evaluationFailed'))),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppTheme.cardBorder,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              l10n.t('mobile.store.evaluateCourse'),
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              widget.courseTitle,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppTheme.muted, height: 1.35),
            ),
            const SizedBox(height: 6),
            Text(
              l10n.t('mobile.store.evaluateCourseHint'),
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, color: AppTheme.muted),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(5, (i) {
                final star = i + 1;
                final filled = star <= _rating;
                return IconButton(
                  onPressed: _submitting
                      ? null
                      : () => setState(() => _rating = star),
                  icon: Icon(
                    filled ? Icons.star_rounded : Icons.star_outline_rounded,
                    color: filled ? Colors.amber : AppTheme.muted,
                    size: 36,
                  ),
                );
              }),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _commentCtrl,
              maxLines: 3,
              maxLength: 500,
              enabled: !_submitting,
              decoration: InputDecoration(
                hintText: l10n.t('mobile.store.evaluationCommentHint'),
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _rating >= 1 && !_submitting ? _submit : null,
              child: Text(
                _submitting
                    ? l10n.t('student.posting')
                    : l10n.t('mobile.store.submitEvaluation'),
              ),
            ),
            TextButton(
              onPressed: _submitting ? null : () => Navigator.of(context).pop(),
              child: Text(l10n.t('mobile.store.evaluateLater')),
            ),
          ],
        ),
      ),
    );
  }
}
