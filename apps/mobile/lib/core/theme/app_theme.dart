import 'package:flutter/material.dart';

class AppTheme {
  static const primary = Color(0xFFA020F0);
  static const accent = Color(0xFF00E5FF);

  static const gradient = LinearGradient(
    colors: [Color(0xFFA020F0), Color(0xFF6B21FF), Color(0xFF00E5FF)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // Adaptive surfaces — updated by [applyBrightness] when theme mode changes.
  static Color background = _Dark.background;
  static Color card = _Dark.card;
  static Color cardBorder = _Dark.cardBorder;
  static Color muted = _Dark.muted;
  static Color foreground = _Dark.foreground;
  static Brightness brightness = Brightness.dark;

  static bool get isDark => brightness == Brightness.dark;

  static void applyBrightness(Brightness value) {
    brightness = value;
    if (value == Brightness.dark) {
      background = _Dark.background;
      card = _Dark.card;
      cardBorder = _Dark.cardBorder;
      muted = _Dark.muted;
      foreground = _Dark.foreground;
    } else {
      background = _Light.background;
      card = _Light.card;
      cardBorder = _Light.cardBorder;
      muted = _Light.muted;
      foreground = _Light.foreground;
    }
  }

  static ThemeData get dark => _build(Brightness.dark);

  static ThemeData get light => _build(Brightness.light);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final bg = isDark ? _Dark.background : _Light.background;
    final surface = isDark ? _Dark.card : _Light.card;
    final border = isDark ? _Dark.cardBorder : _Light.cardBorder;
    final fg = isDark ? _Dark.foreground : _Light.foreground;
    final mute = isDark ? _Dark.muted : _Light.muted;
    final inputFill = isDark ? const Color(0xFF0A0A16) : const Color(0xFFF3F5FA);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: bg,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: primary,
        onPrimary: Colors.white,
        secondary: accent,
        onSecondary: Colors.black,
        error: const Color(0xFFEF4444),
        onError: Colors.white,
        surface: surface,
        onSurface: fg,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: true,
        foregroundColor: fg,
        iconTheme: IconThemeData(color: fg),
        titleTextStyle: TextStyle(
          color: fg,
          fontSize: 18,
          fontWeight: FontWeight.w600,
        ),
      ),
      dividerColor: border,
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: inputFill,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: accent),
        ),
        labelStyle: TextStyle(color: mute),
        hintStyle: TextStyle(color: mute),
      ),
      listTileTheme: ListTileThemeData(
        textColor: fg,
        iconColor: accent,
      ),
      textTheme: TextTheme(
        bodyLarge: TextStyle(color: fg),
        bodyMedium: TextStyle(color: fg),
        bodySmall: TextStyle(color: mute),
        titleMedium: TextStyle(color: fg, fontWeight: FontWeight.w600),
        titleSmall: TextStyle(color: fg),
      ),
      cardTheme: CardThemeData(
        color: surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: border),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        titleTextStyle: TextStyle(
          color: fg,
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
        contentTextStyle: TextStyle(color: mute, height: 1.4),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surface,
        modalBackgroundColor: surface,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? const Color(0xFF1A1A35) : const Color(0xFF1E293B),
        contentTextStyle: const TextStyle(color: Colors.white),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: Colors.black,
        ),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return accent;
          return mute;
        }),
      ),
    );
  }
}

class _Dark {
  static const background = Color(0xFF050510);
  static const card = Color(0xFF0C0C1A);
  static const cardBorder = Color(0xFF1A1A35);
  static const muted = Color(0xFF8B9BB4);
  static const foreground = Color(0xFFE8F4FF);
}

class _Light {
  static const background = Color(0xFFF4F6FB);
  static const card = Color(0xFFFFFFFF);
  static const cardBorder = Color(0xFFE2E8F0);
  static const muted = Color(0xFF64748B);
  static const foreground = Color(0xFF0F172A);
}
