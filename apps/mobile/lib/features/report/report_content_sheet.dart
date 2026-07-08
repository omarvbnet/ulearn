import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Report reasons aligned with backend `ContentReportReason`.
class ReportReason {
  const ReportReason(this.apiValue, this.label, this.description);

  final String apiValue;
  final String label;
  final String description;

  static const all = [
    ReportReason(
      'INAPPROPRIATE',
      'Inappropriate content',
      'Sexual, offensive, or not suitable for learners',
    ),
    ReportReason(
      'SPAM',
      'Spam or misleading',
      'Unwanted promotion, scams, or repetitive content',
    ),
    ReportReason(
      'HARASSMENT',
      'Harassment or hate',
      'Bullying, threats, or hate speech',
    ),
    ReportReason(
      'COPYRIGHT',
      'Copyright violation',
      'Uses content you own without permission',
    ),
    ReportReason(
      'VIOLENCE',
      'Violence or dangerous acts',
      'Harmful or dangerous behavior shown',
    ),
    ReportReason(
      'MISLEADING',
      'False information',
      'Incorrect or deceptive educational claims',
    ),
    ReportReason(
      'OTHER',
      'Other',
      'Something else — please describe in detail',
    ),
  ];
}

/// Bottom sheet for reporting reels, courses, or lessons.
class ReportContentSheet extends StatefulWidget {
  const ReportContentSheet({
    super.key,
    required this.targetType,
    required this.targetId,
    required this.contentTitle,
  });

  final String targetType;
  final String targetId;
  final String contentTitle;

  static Future<bool?> show(
    BuildContext context, {
    required String targetType,
    required String targetId,
    required String contentTitle,
  }) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: ReportContentSheet(
          targetType: targetType,
          targetId: targetId,
          contentTitle: contentTitle,
        ),
      ),
    );
  }

  @override
  State<ReportContentSheet> createState() => _ReportContentSheetState();
}

class _ReportContentSheetState extends State<ReportContentSheet> {
  ReportReason? _reason;
  final _detailsCtrl = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _detailsCtrl.dispose();
    super.dispose();
  }

  String? _validate() {
    if (_reason == null) return 'Please select a reason';
    final details = _detailsCtrl.text.trim();
    if (details.length < 10) {
      return 'Please describe the issue (at least 10 characters)';
    }
    if (_reason!.apiValue == 'OTHER' && details.length < 20) {
      return 'Please provide more detail for "Other" (at least 20 characters)';
    }
    return null;
  }

  Future<void> _submit() async {
    final validation = _validate();
    if (validation != null) {
      setState(() => _error = validation);
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await context.read<ApiClient>().post('/api/reports', {
        'targetType': widget.targetType,
        'targetId': widget.targetId,
        'reason': _reason!.apiValue,
        'details': _detailsCtrl.text.trim(),
      });
      if (!mounted) return;
      Navigator.pop(context, true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Report submitted. Our team will review it.'),
          backgroundColor: AppTheme.primary,
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = _friendlyError(e.message);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = 'Could not submit report. Try again.';
      });
    }
  }

  String _friendlyError(String code) {
    switch (code) {
      case 'ALREADY_REPORTED':
        return 'You already reported this content';
      case 'OWN_CONTENT':
        return 'You cannot report your own content';
      case 'NOT_FOUND':
        return 'This content is no longer available';
      case 'DETAILS_TOO_SHORT':
        return 'Please provide at least 10 characters describing the issue';
      case 'OTHER_REQUIRES_DETAILS':
        return 'Please provide more detail for "Other" (min 20 characters)';
      default:
        return code;
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppTheme.muted.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Icon(Icons.flag_outlined, color: Colors.orangeAccent),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Report content',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              widget.contentTitle,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AppTheme.muted, fontSize: 13),
            ),
            const SizedBox(height: 8),
            const Text(
              'Reports are confidential. False reports may lead to account restrictions.',
              style: TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.4),
            ),
            const SizedBox(height: 16),
            ...ReportReason.all.map((r) {
              final selected = _reason?.apiValue == r.apiValue;
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Material(
                  color: selected ? AppTheme.primary.withValues(alpha: 0.12) : AppTheme.background,
                  borderRadius: BorderRadius.circular(12),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => setState(() => _reason = r),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            selected ? Icons.radio_button_checked : Icons.radio_button_off,
                            color: selected ? AppTheme.accent : AppTheme.muted,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  r.label,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w600,
                                    color: selected ? AppTheme.foreground : AppTheme.muted,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  r.description,
                                  style: const TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.35),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            }),
            const SizedBox(height: 8),
            TextField(
              controller: _detailsCtrl,
              maxLines: 4,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: 'Additional details *',
                hintText: 'What happened? Include timestamps or context if helpful.',
                alignLabelWithHint: true,
                border: OutlineInputBorder(),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
            ],
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.send_outlined),
              label: Text(_submitting ? 'Submitting…' : 'Submit report'),
            ),
          ],
        ),
      ),
    );
  }
}
