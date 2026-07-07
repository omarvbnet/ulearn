import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';

class PendingScreen extends StatelessWidget {
  const PendingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Image.asset('assets/images/logo.png', width: 80),
                const SizedBox(height: 24),
                const Text(
                  'Account Under Review',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                const Text(
                  'Your account is under review. Please wait for administrator approval.',
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
                  child: const Text('Pending Approval', style: TextStyle(color: Colors.amber)),
                ),
                const SizedBox(height: 32),
                TextButton(
                  onPressed: () => context.read<AuthProvider>().logout(),
                  child: const Text('Logout'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
