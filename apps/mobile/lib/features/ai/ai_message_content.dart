import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// Renders tutor answers with Markdown + optional follow-up chips.
class AiMessageContent extends StatelessWidget {
  const AiMessageContent({
    super.key,
    required this.text,
    required this.isUser,
    this.followUps = const [],
    this.onFollowUp,
  });

  final String text;
  final bool isUser;
  final List<String> followUps;
  final void Function(String prompt)? onFollowUp;

  static String normalizeMath(String raw) {
    var s = raw;
    // Simple LaTeX fractions → readable ASCII
    s = s.replaceAllMapped(
      RegExp(r'\\frac\{([^}]+)\}\{([^}]+)\}'),
      (m) => '${m[1]}/${m[2]}',
    );
    s = s.replaceAllMapped(
      RegExp(r'\\\((.+?)\\\)'),
      (m) => m[1] ?? '',
    );
    s = s.replaceAllMapped(
      RegExp(r'\\\[(.+?)\\\]', dotAll: true),
      (m) => '\n`${m[1]?.trim() ?? ''}`\n',
    );
    s = s.replaceAllMapped(
      RegExp(r'\$\$([\s\S]+?)\$\$'),
      (m) => '\n`${m[1]?.trim() ?? ''}`\n',
    );
    s = s.replaceAllMapped(
      RegExp(r'(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)'),
      (m) => m[1] ?? '',
    );
    return s.trim();
  }

  /// Recover follow-ups if the model wrote them as a trailing question list.
  static List<String> inferFollowUps(String text) {
    final block = RegExp(
      r'\[\[FOLLOW_UPS\]\]([\s\S]*?)\[\[/FOLLOW_UPS\]\]',
      caseSensitive: false,
    ).firstMatch(text);
    if (block != null) {
      return block
          .group(1)!
          .split('\n')
          .map((l) => l.replaceFirst(RegExp(r'^[-*•\d.)\s]+'), '').trim())
          .where((l) => l.length >= 4 && l.length <= 160)
          .take(3)
          .toList();
    }
    return const [];
  }

  static String stripFollowUpMarkers(String text) {
    return text
        .replaceAll(
          RegExp(
            r'\[\[FOLLOW_UPS\]\][\s\S]*?\[\[/FOLLOW_UPS\]\]',
            caseSensitive: false,
          ),
          '',
        )
        .trim();
  }

  @override
  Widget build(BuildContext context) {
    final display = normalizeMath(stripFollowUpMarkers(text));
    final chips = followUps.isNotEmpty
        ? followUps
        : inferFollowUps(text);

    if (isUser) {
      return Text(
        display,
        style: TextStyle(
          color: AppTheme.foreground,
          height: 1.45,
        ),
      );
    }

    final scheme = Theme.of(context).colorScheme;
    final baseStyle = MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
      p: TextStyle(
        color: AppTheme.foreground,
        height: 1.5,
        fontSize: 14.5,
      ),
      h1: TextStyle(
        color: AppTheme.foreground,
        fontWeight: FontWeight.w800,
        fontSize: 18,
        height: 1.35,
      ),
      h2: TextStyle(
        color: AppTheme.foreground,
        fontWeight: FontWeight.w800,
        fontSize: 16.5,
        height: 1.35,
      ),
      h3: TextStyle(
        color: AppTheme.accent,
        fontWeight: FontWeight.w700,
        fontSize: 15,
        height: 1.35,
      ),
      strong: TextStyle(
        color: AppTheme.foreground,
        fontWeight: FontWeight.w800,
      ),
      em: TextStyle(
        color: AppTheme.foreground,
        fontStyle: FontStyle.italic,
      ),
      listBullet: TextStyle(color: AppTheme.accent, fontSize: 14),
      blockquote: TextStyle(
        color: AppTheme.muted,
        fontStyle: FontStyle.italic,
        height: 1.45,
      ),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: AppTheme.accent.withValues(alpha: 0.7), width: 3),
        ),
        color: AppTheme.accent.withValues(alpha: 0.06),
      ),
      code: TextStyle(
        color: AppTheme.accent,
        backgroundColor: AppTheme.background,
        fontFamily: 'monospace',
        fontSize: 13.5,
      ),
      codeblockDecoration: BoxDecoration(
        color: AppTheme.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      horizontalRuleDecoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: AppTheme.cardBorder),
        ),
      ),
      a: TextStyle(
        color: scheme.primary,
        decoration: TextDecoration.underline,
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        MarkdownBody(
          data: display.isEmpty ? ' ' : display,
          selectable: true,
          styleSheet: baseStyle,
        ),
        if (chips.isNotEmpty && onFollowUp != null) ...[
          const SizedBox(height: 12),
          Text(
            context.l10n.t('mobile.ai.continueLearning'),
            style: TextStyle(
              color: AppTheme.muted,
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: chips
                .map(
                  (q) => ActionChip(
                    onPressed: () => onFollowUp!(q),
                    backgroundColor: AppTheme.primary.withValues(alpha: 0.12),
                    side: BorderSide(
                      color: AppTheme.accent.withValues(alpha: 0.35),
                    ),
                    label: Text(
                      q,
                      style: TextStyle(
                        color: AppTheme.foreground,
                        fontSize: 12.5,
                        height: 1.25,
                      ),
                    ),
                    avatar: Icon(
                      Icons.tips_and_updates_outlined,
                      size: 16,
                      color: AppTheme.accent,
                    ),
                  ),
                )
                .toList(),
          ),
        ],
      ],
    );
  }
}
