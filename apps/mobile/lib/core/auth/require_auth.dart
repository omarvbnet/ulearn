import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/auth/login_screen.dart';

/// Returns true if the user is signed in. Otherwise shows login / register.
Future<bool> requireAuth(BuildContext context) async {
  final auth = context.read<AuthProvider>();
  if (auth.isAuthenticated) return true;

  final l10n = context.l10n;
  final action = await showModalBottomSheet<String>(
    context: context,
    backgroundColor: AppTheme.card,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTheme.muted.withValues(alpha: 0.35),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                l10n.t('mobile.auth.loginRequiredTitle'),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              Text(
                l10n.t('mobile.auth.loginRequiredHint'),
                textAlign: TextAlign.center,
                style: TextStyle(color: AppTheme.muted, height: 1.4),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, 'login'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.accent,
                  foregroundColor: Colors.black,
                  minimumSize: const Size.fromHeight(48),
                ),
                child: Text(l10n.navLogin),
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                onPressed: () => Navigator.pop(ctx, 'register'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.foreground,
                  minimumSize: const Size.fromHeight(48),
                  side: BorderSide(color: AppTheme.cardBorder),
                ),
                child: Text(l10n.authRegister),
              ),
              const SizedBox(height: 4),
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: Text(l10n.cancel),
              ),
            ],
          ),
        ),
      );
    },
  );

  if (!context.mounted || action == null) return false;

  if (action == 'login') {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  } else if (action == 'register') {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const LoginScreen(startAsRegister: true)),
    );
  }

  return context.mounted && context.read<AuthProvider>().isAuthenticated;
}
