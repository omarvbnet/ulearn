import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/l10n/app_localizations.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';

extension L10nContext on BuildContext {
  AppLocalizations get l10n {
    final provider = watch<LocaleProvider>();
    return provider.l10n;
  }

  AppLocalizations get l10nRead => read<LocaleProvider>().l10n;

  String get localeCode => read<LocaleProvider>().code;
}
