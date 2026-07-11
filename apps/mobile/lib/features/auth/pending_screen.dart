import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';

class PendingScreen extends StatelessWidget {
  const PendingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const PulsingULearnLogo(size: 96),
                const SizedBox(height: 24),
                Text(
                  l10n.authPendingTitle,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  l10n.authPendingMessage,
                  style: TextStyle(color: AppTheme.muted),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.amber.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    l10n.pendingBadge,
                    style: const TextStyle(color: Colors.amber),
                  ),
                ),
                const SizedBox(height: 32),
                TextButton(
                  onPressed: () => context.read<AuthProvider>().logout(),
                  child: Text(l10n.navLogout),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
