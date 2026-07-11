import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// App appearance: follows the phone by default; user can force light/dark.
class ThemeModeProvider extends ChangeNotifier with WidgetsBindingObserver {
  static const _prefKey = 'app_theme_mode';

  ThemeMode _mode = ThemeMode.system;
  bool ready = false;

  ThemeModeProvider() {
    // Match phone immediately so the first frame isn't stuck on dark.
    AppTheme.applyBrightness(platformBrightness);
  }

  ThemeMode get mode => _mode;

  Brightness get platformBrightness =>
      SchedulerBinding.instance.platformDispatcher.platformBrightness;

  Brightness get effectiveBrightness {
    return switch (_mode) {
      ThemeMode.light => Brightness.light,
      ThemeMode.dark => Brightness.dark,
      ThemeMode.system => platformBrightness,
    };
  }

  Future<void> init() async {
    WidgetsBinding.instance.addObserver(this);
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_prefKey);
    _mode = switch (saved) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      'system' => ThemeMode.system,
      _ => ThemeMode.system,
    };
    _applyChrome();
    ready = true;
    notifyListeners();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangePlatformBrightness() {
    if (_mode == ThemeMode.system) {
      _applyChrome();
      notifyListeners();
    }
  }

  Future<void> setMode(ThemeMode mode) async {
    if (_mode == mode) return;
    _mode = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _prefKey,
      switch (mode) {
        ThemeMode.light => 'light',
        ThemeMode.dark => 'dark',
        ThemeMode.system => 'system',
      },
    );
    _applyChrome();
    notifyListeners();
  }

  void _applyChrome() {
    AppTheme.applyBrightness(effectiveBrightness);
    final lightIcons = effectiveBrightness == Brightness.dark;
    SystemChrome.setSystemUIOverlayStyle(
      SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness:
            lightIcons ? Brightness.light : Brightness.dark,
        statusBarBrightness: lightIcons ? Brightness.dark : Brightness.light,
        systemNavigationBarColor: AppTheme.background,
        systemNavigationBarIconBrightness:
            lightIcons ? Brightness.light : Brightness.dark,
      ),
    );
  }
}
