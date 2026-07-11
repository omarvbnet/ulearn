import 'package:flutter/material.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/features/ai/ai_assistant_screen.dart';

/// Left-side vertical glass control on the home tab — expands label on focus/tap.
class AiWithULearnEntry extends StatefulWidget {
  const AiWithULearnEntry({super.key});

  @override
  State<AiWithULearnEntry> createState() => _AiWithULearnEntryState();
}

class _AiWithULearnEntryState extends State<AiWithULearnEntry>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;
  bool _expanded = false;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat(reverse: true);
    // Expand label briefly, then collapse when idle.
    Future<void>.delayed(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _expanded = true);
    });
    Future<void>.delayed(const Duration(milliseconds: 2800), () {
      if (mounted) setState(() => _expanded = false);
    });
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  Future<void> _open() async {
    setState(() => _expanded = true);
    final ok = await requireAuth(context);
    if (!mounted) return;
    if (!ok) {
      setState(() => _expanded = false);
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const AiAssistantScreen()),
    );
    if (mounted) setState(() => _expanded = false);
  }

  @override
  Widget build(BuildContext context) {
    final label = context.l10n.t('mobile.ai.entryLabel');
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.only(left: 10),
        child: GestureDetector(
          onTap: _open,
          onLongPress: () => setState(() => _expanded = !_expanded),
          child: AnimatedBuilder(
            animation: _pulse,
            builder: (context, child) {
              final t = Curves.easeInOut.transform(_pulse.value);
              return Transform.translate(
                offset: Offset(0, (t - 0.5) * 4),
                child: child,
              );
            },
            child: GlassSurface(
              borderRadius: BorderRadius.circular(22),
              padding: EdgeInsets.symmetric(
                horizontal: _expanded ? 14 : 10,
                vertical: 12,
              ),
              child: AnimatedSize(
                duration: const Duration(milliseconds: 260),
                curve: Curves.easeOutCubic,
                alignment: Alignment.centerLeft,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppTheme.accent.withValues(alpha: 0.22),
                      ),
                      child: Icon(
                        Icons.auto_awesome_rounded,
                        size: 20,
                        color: AppTheme.foreground,
                      ),
                    ),
                    if (_expanded) ...[
                      const SizedBox(width: 10),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 120),
                        child: Text(
                          label,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13,
                            color: AppTheme.foreground,
                            height: 1.2,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
