import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Report reasons aligned with backend `ContentReportReason`.
class ReportReason {
  const ReportReason(this.apiValue);

  final String apiValue;

  static const all = [
    ReportReason('INAPPROPRIATE'),
    ReportReason('SPAM'),
    ReportReason('HARASSMENT'),
    ReportReason('COPYRIGHT'),
    ReportReason('VIOLENCE'),
    ReportReason('MISLEADING'),
    ReportReason('OTHER'),
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
    final l10n = context.l10n;
    if (_reason == null) return l10n.t('mobile.report.selectReason');
    final details = _detailsCtrl.text.trim();
    if (details.length < 10) {
      return l10n.t('mobile.report.detailsTooShort');
    }
    if (_reason!.apiValue == 'OTHER' && details.length < 20) {
      return l10n.t('mobile.report.otherTooShort');
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
        SnackBar(
          content: Text(context.l10n.reportSubmitted),
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
        _error = context.l10n.t('mobile.report.submitFailed');
      });
    }
  }

  String _friendlyError(String code) {
    final l10n = context.l10n;
    switch (code) {
      case 'ALREADY_REPORTED':
        return l10n.t('mobile.report.alreadyReported');
      case 'OWN_CONTENT':
        return l10n.t('mobile.report.ownContent');
      case 'NOT_FOUND':
        return l10n.t('mobile.report.notFound');
      case 'DETAILS_TOO_SHORT':
        return l10n.t('mobile.report.detailsTooShort');
      case 'OTHER_REQUIRES_DETAILS':
        return l10n.t('mobile.report.otherTooShort');
      default:
        return code;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
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
                    l10n.reelsReportContent,
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
                  onPressed: () => Navigator.of(context).maybePop(),
                  icon: const Icon(Icons.close_rounded),
                  style: IconButton.styleFrom(
                    foregroundColor: AppTheme.muted,
                    backgroundColor: AppTheme.card,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              widget.contentTitle,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: AppTheme.muted, fontSize: 13),
            ),
            const SizedBox(height: 8),
            Text(
              l10n.t('mobile.report.confidentiality'),
              style: TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.4),
            ),
            const SizedBox(height: 16),
            ...ReportReason.all.map((r) {
              final selected = _reason?.apiValue == r.apiValue;
              final label = l10n.t('mobile.report.reasons.${r.apiValue}');
              final description = l10n.t('mobile.report.reasonDescriptions.${r.apiValue}');
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
                                  label,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w600,
                                    color: selected ? AppTheme.foreground : AppTheme.muted,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  description,
                                  style: TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.35),
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
              decoration: InputDecoration(
                labelText: l10n.t('mobile.report.additionalDetails'),
                hintText: l10n.t('mobile.report.detailsHint'),
                alignLabelWithHint: true,
                border: const OutlineInputBorder(),
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
              label: Text(_submitting ? l10n.quizSubmitting : l10n.t('mobile.report.submitReport')),
            ),
          ],
        ),
      ),
    );
  }
}
