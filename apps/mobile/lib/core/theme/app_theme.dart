import 'package:flutter/material.dart';

class AppTheme {
  static const background = Color(0xFF050510);
  static const card = Color(0xFF0C0C1A);
  static const cardBorder = Color(0xFF1A1A35);
  static const muted = Color(0xFF8B9BB4);
  static const primary = Color(0xFFA020F0);
  static const accent = Color(0xFF00E5FF);
  static const foreground = Color(0xFFE8F4FF);

  static const gradient = LinearGradient(
    colors: [Color(0xFFA020F0), Color(0xFF6B21FF), Color(0xFF00E5FF)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static ThemeData get dark => ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: background,
        colorScheme: const ColorScheme.dark(
          primary: primary,
          secondary: accent,
          surface: card,
          onPrimary: Colors.white,
          onSecondary: Colors.black,
          onSurface: foreground,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          elevation: 0,
          centerTitle: true,
          titleTextStyle: TextStyle(
            color: foreground,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFF0A0A16),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: cardBorder),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: cardBorder),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: accent),
          ),
          labelStyle: const TextStyle(color: muted),
        ),
        listTileTheme: const ListTileThemeData(
          textColor: foreground,
          iconColor: accent,
        ),
        textTheme: const TextTheme(
          bodyLarge: TextStyle(color: foreground),
          bodyMedium: TextStyle(color: foreground),
          bodySmall: TextStyle(color: muted),
          titleMedium: TextStyle(color: foreground, fontWeight: FontWeight.w600),
          titleSmall: TextStyle(color: foreground),
        ),
        cardTheme: CardThemeData(
          color: card,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: cardBorder),
          ),
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
      );
}
