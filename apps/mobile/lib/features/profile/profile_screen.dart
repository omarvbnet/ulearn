import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    if (user == null) return const SizedBox.shrink();

    final initials = (user.fullLegalName ?? '?')
        .trim()
        .split(RegExp(r'\s+'))
        .take(2)
        .map((w) => w.isEmpty ? '' : w[0].toUpperCase())
        .join();

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        ScaleIn(
          child: Column(
            children: [
              Container(
                width: 96,
                height: 96,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: AppTheme.gradient,
                ),
                child: Center(
                  child: Text(
                    initials,
                    style: const TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                user.fullLegalName ?? 'Student',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(user.phone, style: const TextStyle(color: AppTheme.muted)),
            ],
          ),
        ),
        const SizedBox(height: 28),
        StaggeredItem(
          index: 1,
          child: _InfoCard(
            children: [
              _InfoRow(icon: Icons.badge_outlined, label: 'Role', value: _roleLabel(user.role)),
              _InfoRow(icon: Icons.verified_outlined, label: 'Status', value: user.status),
              _InfoRow(icon: Icons.language_outlined, label: 'Language', value: user.locale),
            ],
          ),
        ),
        const SizedBox(height: 16),
        StaggeredItem(
          index: 2,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.logout, color: Colors.redAccent),
              title: const Text('Logout', style: TextStyle(color: Colors.redAccent)),
              onTap: () async {
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    backgroundColor: AppTheme.card,
                    title: const Text('Logout'),
                    content: const Text('Are you sure you want to log out?'),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: const Text('Cancel'),
                      ),
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        child: const Text('Logout', style: TextStyle(color: Colors.redAccent)),
                      ),
                    ],
                  ),
                );
                if (confirmed == true && context.mounted) {
                  await context.read<AuthProvider>().logout();
                }
              },
            ),
          ),
        ),
      ],
    );
  }

  static String _roleLabel(String role) {
    switch (role) {
      case 'STUDENT':
        return 'Student';
      case 'CERTIFICATE_USER':
        return 'Certificate User';
      case 'TEACHER':
        return 'Teacher';
      default:
        return role;
    }
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(children: children),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppTheme.accent),
      title: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 13)),
      trailing: Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
    );
  }
}
