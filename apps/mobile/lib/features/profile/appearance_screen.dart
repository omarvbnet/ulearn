import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/theme/theme_mode_provider.dart';

class AppearanceScreen extends StatelessWidget {
  const AppearanceScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeModeProvider>();
    final l10n = context.l10n;

    final options = <(ThemeMode, IconData, String, String)>[
      (
        ThemeMode.system,
        Icons.brightness_auto_rounded,
        l10n.profileThemeSystem,
        l10n.profileThemeSystemHint,
      ),
      (
        ThemeMode.light,
        Icons.light_mode_rounded,
        l10n.profileThemeLight,
        l10n.profileThemeLightHint,
      ),
      (
        ThemeMode.dark,
        Icons.dark_mode_rounded,
        l10n.profileThemeDark,
        l10n.profileThemeDarkHint,
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileAppearanceTitle)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          Text(
            l10n.profileAppearanceHint,
            style: TextStyle(color: AppTheme.muted, height: 1.4),
          ),
          const SizedBox(height: 16),
          for (final (mode, icon, title, subtitle) in options)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Material(
                color: AppTheme.card,
                borderRadius: BorderRadius.circular(16),
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => theme.setMode(mode),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: theme.mode == mode
                            ? AppTheme.accent.withValues(alpha: 0.7)
                            : AppTheme.cardBorder,
                        width: theme.mode == mode ? 1.5 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: theme.mode == mode
                                ? AppTheme.accent.withValues(alpha: 0.15)
                                : AppTheme.background,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(
                            icon,
                            color: theme.mode == mode
                                ? AppTheme.accent
                                : AppTheme.muted,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                title,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 15,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                subtitle,
                                style: TextStyle(
                                  color: AppTheme.muted,
                                  fontSize: 12.5,
                                  height: 1.3,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          theme.mode == mode
                              ? Icons.check_circle_rounded
                              : Icons.circle_outlined,
                          color: theme.mode == mode
                              ? AppTheme.accent
                              : AppTheme.muted.withValues(alpha: 0.5),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
