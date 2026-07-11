import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/ai/ai_assistant_screen.dart';

/// Floating AI entry above the tab bar.
/// AR/KU → bottom-end (right in LTR coords / visual end in RTL).
/// EN/TR → bottom-start (left).
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
    Future<void>.delayed(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _expanded = true);
    });
    Future<void>.delayed(const Duration(milliseconds: 2600), () {
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
    final code = context.watch<LocaleProvider>().code.toUpperCase();
    final rtl = code == 'AR' || code == 'KU';
    // User request: AR/KU bottom-right; others bottom-left (above tab bar).
    final alignEnd = rtl;

    return Align(
      alignment: alignEnd ? Alignment.bottomRight : Alignment.bottomLeft,
      child: Padding(
        padding: EdgeInsets.only(
          left: alignEnd ? 0 : 14,
          right: alignEnd ? 14 : 0,
          bottom: 14,
        ),
        child: GestureDetector(
          onTap: _open,
          onLongPress: () => setState(() => _expanded = !_expanded),
          child: AnimatedBuilder(
            animation: _pulse,
            builder: (context, child) {
              final t = Curves.easeInOut.transform(_pulse.value);
              return Transform.translate(
                offset: Offset(0, (t - 0.5) * 3),
                child: child,
              );
            },
            child: GlassSurface(
              borderRadius: BorderRadius.circular(22),
              padding: EdgeInsets.symmetric(
                horizontal: _expanded ? 12 : 8,
                vertical: 8,
              ),
              child: AnimatedSize(
                duration: const Duration(milliseconds: 260),
                curve: Curves.easeOutCubic,
                alignment: alignEnd ? Alignment.centerRight : Alignment.centerLeft,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  textDirection: alignEnd ? TextDirection.rtl : TextDirection.ltr,
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppTheme.accent.withValues(alpha: 0.14),
                      ),
                      child: const ULearnLogo(size: 28, glow: 0.75),
                    ),
                    if (_expanded) ...[
                      const SizedBox(width: 8),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 110),
                        child: Text(
                          label,
                          textAlign: alignEnd ? TextAlign.right : TextAlign.left,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                            color: AppTheme.foreground,
                            height: 1.15,
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
