import 'package:flutter/material.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Professional timeline picker for choosing how many free seconds
/// students can watch before purchase.
class FreeMinutePicker extends StatelessWidget {
  const FreeMinutePicker({
    super.key,
    required this.durationSec,
    required this.valueSec,
    required this.onChanged,
    this.enabled = true,
  });

  final int durationSec;
  final int valueSec;
  final ValueChanged<int> onChanged;
  final bool enabled;

  static const _presets = [30, 60, 120, 180, 300];

  int get _max => durationSec > 15 ? durationSec : 300;

  String _fmt(int sec) {
    final m = sec ~/ 60;
    final s = sec % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final clamped = valueSec.clamp(15, _max);
    final ratio = (_max <= 0 ? 0.0 : clamped / _max).clamp(0.0, 1.0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.t('mobile.studio.freeUntilMoment'),
          style: const TextStyle(
            fontSize: 13,
            color: AppTheme.muted,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 14),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                AppTheme.accent.withValues(alpha: 0.12),
                AppTheme.primary.withValues(alpha: 0.08),
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppTheme.accent.withValues(alpha: 0.28)),
          ),
          child: Column(
            children: [
              Text(
                l10n.t('mobile.studio.freeUntilLabel'),
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.4,
                  color: AppTheme.accent.withValues(alpha: 0.9),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                _fmt(clamped),
                style: const TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.5,
                  height: 1.1,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                l10n.t('mobile.studio.ofVideoDuration', {
                  'duration': _fmt(_max),
                }),
                style: const TextStyle(fontSize: 12, color: AppTheme.muted),
              ),
              const SizedBox(height: 18),
              LayoutBuilder(
                builder: (context, constraints) {
                  return GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onHorizontalDragUpdate: enabled
                        ? (d) {
                            final w = constraints.maxWidth;
                            if (w <= 0) return;
                            final next =
                                ((d.localPosition.dx / w) * _max).round().clamp(15, _max);
                            onChanged(next);
                          }
                        : null,
                    onTapDown: enabled
                        ? (d) {
                            final w = constraints.maxWidth;
                            if (w <= 0) return;
                            final next =
                                ((d.localPosition.dx / w) * _max).round().clamp(15, _max);
                            onChanged(next);
                          }
                        : null,
                    child: SizedBox(
                      height: 44,
                      child: Stack(
                        alignment: Alignment.centerLeft,
                        children: [
                          Container(
                            height: 10,
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.08),
                              borderRadius: BorderRadius.circular(99),
                            ),
                          ),
                          FractionallySizedBox(
                            widthFactor: ratio,
                            child: Container(
                              height: 10,
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  colors: [AppTheme.accent, AppTheme.primary],
                                ),
                                borderRadius: BorderRadius.circular(99),
                                boxShadow: [
                                  BoxShadow(
                                    color: AppTheme.accent.withValues(alpha: 0.35),
                                    blurRadius: 8,
                                  ),
                                ],
                              ),
                            ),
                          ),
                          Positioned(
                            left: (constraints.maxWidth * ratio - 14)
                                .clamp(0.0, constraints.maxWidth - 28),
                            child: Container(
                              width: 28,
                              height: 28,
                              decoration: BoxDecoration(
                                color: Colors.white,
                                shape: BoxShape.circle,
                                border: Border.all(color: AppTheme.accent, width: 3),
                                boxShadow: [
                                  BoxShadow(
                                    color: AppTheme.accent.withValues(alpha: 0.4),
                                    blurRadius: 10,
                                  ),
                                ],
                              ),
                              child: const Icon(
                                Icons.play_arrow_rounded,
                                size: 16,
                                color: AppTheme.primary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('0:00', style: TextStyle(fontSize: 11, color: AppTheme.muted.withValues(alpha: 0.8))),
                  Text(
                    l10n.t('mobile.studio.lockAfter'),
                    style: TextStyle(fontSize: 11, color: AppTheme.muted.withValues(alpha: 0.8)),
                  ),
                  Text(_fmt(_max), style: TextStyle(fontSize: 11, color: AppTheme.muted.withValues(alpha: 0.8))),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final p in _presets)
              if (p <= _max)
                ChoiceChip(
                  label: Text(p < 60 ? '${p}s' : '${p ~/ 60}m'),
                  selected: (clamped - p).abs() <= 5,
                  onSelected: enabled
                      ? (_) => onChanged(p.clamp(15, _max))
                      : null,
                  selectedColor: AppTheme.accent.withValues(alpha: 0.25),
                  labelStyle: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                    color: (clamped - p).abs() <= 5 ? AppTheme.accent : null,
                  ),
                  side: BorderSide(
                    color: (clamped - p).abs() <= 5
                        ? AppTheme.accent
                        : AppTheme.cardBorder,
                  ),
                ),
          ],
        ),
      ],
    );
  }
}
