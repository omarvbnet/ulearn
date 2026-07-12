import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/features/ai/ai_assistant_screen.dart';
import 'package:ulearn/features/ai/professor/teacher_ai_professor_screen.dart';

const kHomeAiEntryHiddenPref = 'home_ai_entry_hidden';

/// Shared visibility for the home AI floating entry (students / certificate).
class HomeAiEntryVisibility {
  HomeAiEntryVisibility._();

  static final ValueNotifier<bool> hidden = ValueNotifier(false);
  static bool _loaded = false;

  static Future<void> ensureLoaded() async {
    if (_loaded) return;
    final prefs = await SharedPreferences.getInstance();
    hidden.value = prefs.getBool(kHomeAiEntryHiddenPref) ?? false;
    _loaded = true;
  }

  static Future<void> setHidden(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(kHomeAiEntryHiddenPref, value);
    hidden.value = value;
    _loaded = true;
  }
}

/// Floating AI entry above the tab bar.
/// AR/KU → bottom-end; EN/TR → bottom-start.
/// Role labels: teacher → AI Professor, student → student tutor,
/// certificate → professional insights assistant.
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
    HomeAiEntryVisibility.ensureLoaded();
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

  String _labelForRole(String? role) {
    final l10n = context.l10n;
    switch (role) {
      case 'TEACHER':
        return l10n.t('mobile.ai.entryLabelTeacher');
      case 'CERTIFICATE_USER':
        return l10n.t('mobile.ai.entryLabelProfessional');
      default:
        return l10n.t('mobile.ai.entryLabelStudent');
    }
  }

  IconData _iconForRole(String? role) {
    switch (role) {
      case 'TEACHER':
        return Icons.school_rounded;
      case 'CERTIFICATE_USER':
        return Icons.workspace_premium_rounded;
      default:
        return Icons.menu_book_rounded;
    }
  }

  Future<void> _hideEntry() async {
    await HomeAiEntryVisibility.setHidden(true);
    if (!mounted) return;
    setState(() => _expanded = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.l10n.t('mobile.ai.hideSnack'))),
    );
  }

  Future<void> _open(String? role) async {
    setState(() => _expanded = true);
    final ok = await requireAuth(context);
    if (!mounted) return;
    if (!ok) {
      setState(() => _expanded = false);
      return;
    }
    final Widget screen = role == 'TEACHER'
        ? const TeacherAiProfessorScreen(standalone: true)
        : const AiAssistantScreen();
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => screen),
    );
    if (mounted) setState(() => _expanded = false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final role = auth.user?.role;
    final canHide = role == 'STUDENT' || role == 'CERTIFICATE_USER';

    return ValueListenableBuilder<bool>(
      valueListenable: HomeAiEntryVisibility.hidden,
      builder: (context, hidden, _) {
        if (canHide && hidden) return const SizedBox.shrink();

        final label = _labelForRole(role);
        final icon = _iconForRole(role);
        final code = context.watch<LocaleProvider>().code.toUpperCase();
        final rtl = code == 'AR' || code == 'KU';
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
              onTap: () => _open(role),
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
                    horizontal: _expanded ? 10 : 8,
                    vertical: 8,
                  ),
                  child: AnimatedSize(
                    duration: const Duration(milliseconds: 260),
                    curve: Curves.easeOutCubic,
                    alignment:
                        alignEnd ? Alignment.centerRight : Alignment.centerLeft,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      textDirection:
                          alignEnd ? TextDirection.rtl : TextDirection.ltr,
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: AppTheme.accent.withValues(alpha: 0.16),
                          ),
                          child: Icon(icon, color: AppTheme.accent, size: 22),
                        ),
                        if (_expanded) ...[
                          const SizedBox(width: 8),
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 130),
                            child: Text(
                              label,
                              textAlign:
                                  alignEnd ? TextAlign.right : TextAlign.left,
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 12,
                                color: AppTheme.foreground,
                                height: 1.15,
                              ),
                            ),
                          ),
                          if (canHide) ...[
                            const SizedBox(width: 2),
                            InkWell(
                              onTap: _hideEntry,
                              borderRadius: BorderRadius.circular(12),
                              child: Padding(
                                padding: const EdgeInsets.all(4),
                                child: Icon(
                                  Icons.close_rounded,
                                  size: 16,
                                  color: AppTheme.muted,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
