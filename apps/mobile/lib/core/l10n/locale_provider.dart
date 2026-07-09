import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/l10n/app_localizations.dart';

/// Manages UI locale: device language on first launch, then user preference.
class LocaleProvider extends ChangeNotifier {
  static const _prefKey = 'app_locale';

  String _code = 'EN';
  AppLocalizations? _l10n;
  bool ready = false;

  String get code => _code;
  AppLocalizations get l10n => _l10n!;

  Locale get flutterLocale => switch (_code) {
        'AR' => const Locale('ar'),
        'KU' => const Locale('ku'),
        'TR' => const Locale('tr'),
        _ => const Locale('en'),
      };

  TextDirection get textDirection =>
      _code == 'AR' || _code == 'KU' ? TextDirection.rtl : TextDirection.ltr;

  /// Bootstrap before auth: prefs, else first supported device language.
  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_prefKey);
    _code = saved ?? _deviceLocaleCode();
    await _loadStrings();
    ready = true;
    notifyListeners();
  }

  /// After login, prefer the user's saved profile locale.
  Future<void> syncFromUser(String? userLocale) async {
    if (userLocale == null || userLocale.isEmpty) return;
    final upper = userLocale.toUpperCase();
    if (!AppLocalizations.supportedCodes.contains(upper)) return;
    if (_code == upper) return;
    _code = upper;
    await _loadStrings();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefKey, _code);
    notifyListeners();
  }

  Future<void> setLocale(
    String code, {
    bool persist = true,
  }) async {
    final upper = code.toUpperCase();
    if (!AppLocalizations.supportedCodes.contains(upper)) return;
    if (_code == upper && _l10n != null) return;
    _code = upper;
    await _loadStrings();
    if (persist) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, _code);
    }
    notifyListeners();
  }

  static String _deviceLocaleCode() {
    final locales = WidgetsBinding.instance.platformDispatcher.locales;
    for (final locale in locales) {
      final lang = locale.languageCode.toLowerCase();
      if (lang == 'ar') return 'AR';
      if (lang == 'tr') return 'TR';
      if (lang == 'ku' || lang == 'ckb') return 'KU';
      if (lang == 'en') return 'EN';
    }
    return 'EN';
  }

  Future<void> _loadStrings() async {
    _l10n = await AppLocalizations.load(_code);
  }
}
