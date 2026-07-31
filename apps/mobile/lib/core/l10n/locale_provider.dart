import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/l10n/app_localizations.dart';

/// Manages UI locale: device language on first launch, then user preference.
class LocaleProvider extends ChangeNotifier {
  static const _prefKey = 'app_locale';
  // Marks that *this device* explicitly chose a language (via the Language
  // screen or an earlier server sync). Once set, later logins/bootstraps must
  // never silently overwrite it — otherwise a student who picked Arabic here
  // gets bounced back to whatever stale locale sits on their account record
  // (e.g. after a fresh reinstall), and the AI Teacher ends up speaking the
  // wrong language despite the student's clear on-device choice.
  static const _explicitKey = 'app_locale_explicit';

  String _code = 'EN';
  AppLocalizations? _l10n;
  bool ready = false;
  bool _explicit = false;

  String get code => _code;
  AppLocalizations get l10n => _l10n!;

  Locale get flutterLocale => switch (_code) {
        'AR' => const Locale('ar'),
        'KU' => const Locale('ku'),
        'TR' => const Locale('tr'),
        _ => const Locale('en'),
      };

  /// Locale for Flutter Material/Cupertino delegates.
  /// Kurdish (`ku`) is not shipped by `GlobalMaterialLocalizations`, which
  /// otherwise throws and whites out screens — use Arabic (RTL) for Material
  /// chrome while our own `ku.json` strings stay Kurdish.
  Locale get materialLocale => switch (_code) {
        'AR' => const Locale('ar'),
        'KU' => const Locale('ar'),
        'TR' => const Locale('tr'),
        _ => const Locale('en'),
      };

  TextDirection get textDirection =>
      _code == 'AR' || _code == 'KU' ? TextDirection.rtl : TextDirection.ltr;

  /// Bootstrap before auth: prefs, else first supported device language.
  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_prefKey);
    // Migration for installs from before the explicit-choice flag existed:
    // a locale already on disk represents a value this device is actively
    // using, so treat it as explicit immediately instead of letting one more
    // account-record sync silently flip it before the flag takes effect.
    _explicit = prefs.getBool(_explicitKey) ?? (saved != null);
    _code = saved ?? _deviceLocaleCode();
    await _loadStrings();
    ready = true;
    notifyListeners();
  }

  /// After login, fall back to the user's saved profile locale — but only
  /// when this device hasn't already had an explicit language chosen. An
  /// explicit on-device choice (Language screen, or a prior successful sync)
  /// always wins over the account record so a stale/mismatched profile value
  /// can never silently flip the student's language — and with it the AI
  /// Teacher's spoken/board language — back after a fresh app launch.
  Future<void> syncFromUser(String? userLocale) async {
    if (_explicit) return;
    if (userLocale == null || userLocale.isEmpty) return;
    final upper = userLocale.toUpperCase();
    if (!AppLocalizations.supportedCodes.contains(upper)) return;
    _explicit = true;
    if (_code == upper) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_explicitKey, true);
      return;
    }
    _code = upper;
    await _loadStrings();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefKey, _code);
    await prefs.setBool(_explicitKey, true);
    notifyListeners();
  }

  Future<void> setLocale(
    String code, {
    bool persist = true,
  }) async {
    final upper = code.toUpperCase();
    if (!AppLocalizations.supportedCodes.contains(upper)) return;
    if (_code == upper && _l10n != null) {
      if (persist && !_explicit) {
        _explicit = true;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setBool(_explicitKey, true);
      }
      return;
    }
    _code = upper;
    await _loadStrings();
    if (persist) {
      _explicit = true;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, _code);
      await prefs.setBool(_explicitKey, true);
    }
    notifyListeners();
  }

  /// Clears the on-device explicit-choice flag (call on logout) so the next
  /// account to sign in on this device gets its own profile locale applied.
  Future<void> resetExplicit() async {
    _explicit = false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_explicitKey);
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
