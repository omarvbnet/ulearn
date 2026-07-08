import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/features/profile/favorites_screen.dart';
import 'package:ulearn/features/profile/profile_avatar.dart';
import 'package:ulearn/features/profile/profile_photo_service.dart';
import 'package:ulearn/features/profile/stage_request_screen.dart';
import 'package:ulearn/features/store/teacher_studio_screen.dart';
import 'package:ulearn/features/subscriptions/subscriptions_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _uploadingPhoto = false;

  bool get _canEditPhoto {
    final role = context.read<AuthProvider>().user?.role;
    return role == 'STUDENT' || role == 'CERTIFICATE_USER' || role == 'TEACHER';
  }

  Future<void> _onAvatarTap() async {
    if (!_canEditPhoto || _uploadingPhoto) return;

    final user = context.read<AuthProvider>().user;
    final hasPhoto = user?.profilePhotoUrl?.isNotEmpty == true;

    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined, color: AppTheme.accent),
              title: Text(hasPhoto ? 'Change photo' : 'Add photo'),
              onTap: () => Navigator.pop(ctx, 'pick'),
            ),
            if (hasPhoto)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: Colors.redAccent),
                title: const Text('Remove photo', style: TextStyle(color: Colors.redAccent)),
                onTap: () => Navigator.pop(ctx, 'remove'),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );

    if (!mounted || action == null) return;

    if (action == 'remove') {
      setState(() => _uploadingPhoto = true);
      try {
        final data = await ProfilePhotoService.remove(context.read<ApiClient>());
        if (!mounted) return;
        context.read<AuthProvider>().applyUser(data['user'] as Map<String, dynamic>);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile photo removed')),
        );
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not remove photo')),
          );
        }
      } finally {
        if (mounted) setState(() => _uploadingPhoto = false);
      }
      return;
    }

    if (action == 'pick') {
      setState(() => _uploadingPhoto = true);
      try {
        final data = await ProfilePhotoService.uploadAndSave(context.read<ApiClient>());
        if (!mounted) return;
        context.read<AuthProvider>().applyUser(data['user'] as Map<String, dynamic>);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile photo updated')),
        );
      } on ProfilePhotoException catch (e) {
        if (e.message != 'cancelled' && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(e.message)),
          );
        }
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not update photo')),
          );
        }
      } finally {
        if (mounted) setState(() => _uploadingPhoto = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    if (user == null) return const SizedBox.shrink();

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        ScaleIn(
          child: Column(
            children: [
              ProfileAvatar(
                name: user.fullLegalName,
                photoUrl: user.profilePhotoUrl,
                size: 108,
                editable: _canEditPhoto,
                uploading: _uploadingPhoto,
                onTap: _canEditPhoto ? _onAvatarTap : null,
              ),
              if (_canEditPhoto) ...[
                const SizedBox(height: 8),
                Text(
                  'Tap to change photo',
                  style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.85), fontSize: 12),
                ),
              ],
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
              if (user.role == 'STUDENT')
                _InfoRow(
                  icon: Icons.school_outlined,
                  label: 'Stage',
                  value: user.stage?.nameFor(user.locale) ?? 'Not set',
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        StaggeredItem(
          index: 2,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.favorite_outline, color: Colors.redAccent),
              title: const Text('My Favorites'),
              subtitle: const Text(
                'Saved courses and videos',
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              trailing: const Icon(Icons.chevron_right, color: AppTheme.muted),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const FavoritesScreen()),
              ),
            ),
          ),
        ),
        if (user.role != 'TEACHER') ...[
          const SizedBox(height: 16),
          StaggeredItem(
            index: 3,
            child: Card(
              child: ListTile(
                leading: const Icon(Icons.card_membership_outlined, color: AppTheme.primary),
                title: const Text('Subscriptions'),
                subtitle: const Text(
                  'Packages, activation codes & plans',
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                trailing: const Icon(Icons.chevron_right, color: AppTheme.muted),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const SubscriptionsScreen()),
                ),
              ),
            ),
          ),
        ],
        if (user.role == 'STUDENT') ...[
          const SizedBox(height: 16),
          StaggeredItem(
            index: 4,
            child: Card(
              child: ListTile(
                leading: const Icon(Icons.swap_vert_rounded, color: AppTheme.accent),
                title: const Text('Change stage'),
                subtitle: const Text(
                  'Request a move with your certificate',
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                trailing: const Icon(Icons.chevron_right, color: AppTheme.muted),
                onTap: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const StageRequestScreen()),
                  );
                  if (context.mounted) {
                    await context.read<AuthProvider>().refreshUser();
                  }
                },
              ),
            ),
          ),
        ],
        if (user.role == 'TEACHER') ...[
          const SizedBox(height: 16),
          StaggeredItem(
            index: 3,
            child: Card(
              child: ListTile(
                leading: const Icon(Icons.video_call_outlined, color: AppTheme.accent),
                title: const Text('Teacher Studio'),
                subtitle: const Text(
                  'Upload course videos & short videos',
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                trailing: const Icon(Icons.chevron_right, color: AppTheme.muted),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const TeacherStudioScreen()),
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        StaggeredItem(
          index: user.role == 'TEACHER' || user.role == 'STUDENT' ? 5 : 4,
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
