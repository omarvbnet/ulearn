import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/app_localizations.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';

class LanguageScreen extends StatelessWidget {
  const LanguageScreen({super.key});

  static const _codes = AppLocalizations.supportedCodes;

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<LocaleProvider>();
    final l10n = context.l10n;

    return Scaffold(
      appBar: GlassAppBar(title: Text(l10n.profileLanguageTitle)),
      body: ListView(
        children: [
          for (final code in _codes)
            RadioListTile<String>(
              value: code,
              groupValue: locale.code,
              activeColor: AppTheme.accent,
              title: Text(
                l10n.languageName(code),
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(code, style: TextStyle(color: AppTheme.muted, fontSize: 12)),
              onChanged: (value) async {
                if (value == null || value == locale.code) return;
                final api = context.read<ApiClient>();
                final auth = context.read<AuthProvider>();
                await locale.setLocale(value);
                if (auth.isAuthenticated) {
                  try {
                    final data = await api.patch('/api/profile/locale', {
                      'locale': value,
                    });
                    auth.applyUser(data['user'] as Map<String, dynamic>);
                  } catch (_) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(context.l10n.t('mobile.error.generic'))),
                      );
                    }
                    return;
                  }
                }
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(context.l10n.profileLanguageSaved)),
                  );
                }
              },
            ),
        ],
      ),
    );
  }
}
