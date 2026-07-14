import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/auth/require_auth.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/video/media_cache_budget.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/cached_image.dart';
import 'package:ulearn/features/ai/ai_with_ulearn_entry.dart';
import 'package:ulearn/features/profile/completed_courses_screen.dart';
import 'package:ulearn/features/profile/favorites_screen.dart';
import 'package:ulearn/features/profile/appearance_screen.dart';
import 'package:ulearn/features/profile/language_screen.dart';
import 'package:ulearn/core/theme/theme_mode_provider.dart';
import 'package:ulearn/features/profile/saved_reels_screen.dart';
import 'package:ulearn/features/profile/profile_avatar.dart';
import 'package:ulearn/features/profile/profile_photo_service.dart';
import 'package:ulearn/features/profile/certificate_insights_screen.dart';
import 'package:ulearn/features/profile/stage_request_screen.dart';
import 'package:ulearn/features/rankings/rankings_screen.dart';
import 'package:ulearn/features/report/my_reports_screen.dart';
import 'package:ulearn/core/widgets/teacher_cover_presets.dart';
import 'package:ulearn/features/profile/teacher_specialties_section.dart';
import 'package:ulearn/features/profile/privacy_policy_screen.dart';
import 'package:ulearn/features/store/teacher_studio_screen.dart';
import 'package:ulearn/features/subscriptions/subscriptions_screen.dart';
import 'package:ulearn/core/widgets/glass.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _uploadingPhoto = false;
  bool _savingCover = false;
  Future<String>? _cacheUsageFuture;

  @override
  void initState() {
    super.initState();
    _cacheUsageFuture = MediaCacheBudget.formatUsage();
  }

  void _refreshCacheUsage() {
    setState(() {
      _cacheUsageFuture = MediaCacheBudget.formatUsage();
    });
  }

  Future<void> _clearMediaCache() async {
    final l10n = context.l10n;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.card,
        title: Text(l10n.profileStorageCacheClear),
        content: Text(l10n.profileStorageCacheClearConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(l10n.cancel),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.profileStorageCacheClear),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await MediaCacheBudget.clearAll();
    if (!mounted) return;
    _refreshCacheUsage();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.profileStorageCacheCleared)),
    );
  }

  bool get _canEditPhoto {
    final role = context.read<AuthProvider>().user?.role;
    return role == 'STUDENT' || role == 'CERTIFICATE_USER' || role == 'TEACHER';
  }

  Future<void> _onAvatarTap() async {
    if (!_canEditPhoto || _uploadingPhoto) return;

    final l10n = context.l10n;
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
              title: Text(hasPhoto ? l10n.profileChangePhoto : l10n.profileAddPhoto),
              onTap: () => Navigator.pop(ctx, 'pick'),
            ),
            if (hasPhoto)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: Colors.redAccent),
                title: Text(
                  l10n.profileRemovePhoto,
                  style: const TextStyle(color: Colors.redAccent),
                ),
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
        final oldUrl = context.read<AuthProvider>().user?.profilePhotoUrl;
        final data = await ProfilePhotoService.remove(context.read<ApiClient>());
        if (!mounted) return;
        await evictCachedImage(oldUrl);
        context.read<AuthProvider>().applyUser(data['user'] as Map<String, dynamic>);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.profilePhotoRemoved)),
        );
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(context.l10n.profilePhotoRemoveFailed)),
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
        final oldUrl = context.read<AuthProvider>().user?.profilePhotoUrl;
        final data = await ProfilePhotoService.uploadAndSave(context.read<ApiClient>());
        if (!mounted) return;
        final userJson = data['user'] as Map<String, dynamic>;
        await evictCachedImage(oldUrl);
        await evictCachedImage(userJson['profilePhotoUrl']?.toString());
        context.read<AuthProvider>().applyUser(userJson);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.profilePhotoUpdated)),
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
            SnackBar(content: Text(context.l10n.profilePhotoUpdateFailed)),
          );
        }
      } finally {
        if (mounted) setState(() => _uploadingPhoto = false);
      }
    }
  }

  Future<void> _saveCoverPreset(int preset) async {
    if (_savingCover) return;
    setState(() => _savingCover = true);
    try {
      final data = await context.read<ApiClient>().patch('/api/profile/cover', {
        'preset': preset,
      });
      if (!mounted) return;
      context.read<AuthProvider>().applyUser(data['user'] as Map<String, dynamic>);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.profileCoverUpdated)),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.profileCoverSaveFailed)),
        );
      }
    } finally {
      if (mounted) setState(() => _savingCover = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    if (user == null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 40),
          Icon(Icons.person_outline_rounded, size: 64, color: AppTheme.muted.withValues(alpha: 0.5)),
          const SizedBox(height: 16),
          Text(
            l10n.t('mobile.auth.loginRequiredTitle'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            l10n.t('mobile.auth.loginRequiredHint'),
            textAlign: TextAlign.center,
            style: TextStyle(color: AppTheme.muted, height: 1.4),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () => requireAuth(context),
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.accent,
              foregroundColor: Colors.black,
              minimumSize: const Size.fromHeight(48),
            ),
            child: Text(l10n.navLogin),
          ),
        ],
      );
    }

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
                cacheVersion: user.profilePhotoUrl,
                onTap: _canEditPhoto ? _onAvatarTap : null,
              ),
              if (_canEditPhoto) ...[
                const SizedBox(height: 8),
                Text(
                  l10n.profileTapChangePhoto,
                  style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.85), fontSize: 12),
                ),
              ],
              const SizedBox(height: 14),
              Text(
                user.fullLegalName ?? l10n.authStudent,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(user.phone, style: TextStyle(color: AppTheme.muted)),
            ],
          ),
        ),
        if (user.role == 'TEACHER') ...[
          const SizedBox(height: 16),
          const StaggeredItem(
            index: 1,
            child: TeacherSpecialtiesSection(),
          ),
          const SizedBox(height: 16),
          StaggeredItem(
            index: 2,
            child: Card(
              child: ListTile(
                leading: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: SizedBox(
                    width: 48,
                    height: 32,
                    child: TeacherCoverBanner(
                      preset: user.profileCoverPreset,
                      height: 32,
                    ),
                  ),
                ),
                title: Text(l10n.profileCoverTitle),
                subtitle: Text(
                  l10n.profileChangeCover,
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                trailing: _savingCover
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent),
                      )
                    : Icon(Icons.chevron_right, color: AppTheme.muted),
                onTap: _savingCover
                    ? null
                    : () => showTeacherCoverPickerSheet(
                          context: context,
                          selected: user.profileCoverPreset,
                          onSelected: _saveCoverPreset,
                        ),
              ),
            ),
          ),
        ],
        const SizedBox(height: 28),
        StaggeredItem(
          index: 2,
          child: _InfoCard(
            children: [
              _InfoRow(
                icon: Icons.badge_outlined,
                label: l10n.profileRole,
                value: l10n.roleLabel(user.role),
              ),
              _InfoRow(
                icon: Icons.verified_outlined,
                label: l10n.profileStatus,
                value: user.status,
              ),
              _InfoRow(
                icon: Icons.language_outlined,
                label: l10n.profileLanguage,
                value: l10n.languageName(user.locale),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const LanguageScreen()),
                ),
              ),
              Builder(
                builder: (context) {
                  final mode = context.watch<ThemeModeProvider>().mode;
                  final value = switch (mode) {
                    ThemeMode.light => l10n.profileThemeLight,
                    ThemeMode.dark => l10n.profileThemeDark,
                    ThemeMode.system => l10n.profileThemeSystem,
                  };
                  return _InfoRow(
                    icon: Icons.brightness_6_outlined,
                    label: l10n.profileAppearance,
                    value: value,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const AppearanceScreen()),
                    ),
                  );
                },
              ),
              if (user.role == 'STUDENT')
                _InfoRow(
                  icon: Icons.school_outlined,
                  label: l10n.profileStage,
                  value: user.stage?.nameFor(context.localeCode) ?? l10n.profileNotSet,
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        StaggeredItem(
          index: 2,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.flag_outlined, color: Colors.orangeAccent),
              title: Text(l10n.profileMyReports),
              subtitle: Text(
                l10n.profileMyReportsHint,
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const MyReportsScreen()),
              ),
            ),
          ),
        ),
        StaggeredItem(
          index: 3,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.leaderboard_outlined, color: AppTheme.primary),
              title: Text(l10n.rankTitle),
              subtitle: Text(
                l10n.profileRankingsHint,
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => Scaffold(
                    appBar: GlassAppBar(title: Text(l10n.rankTitle)),
                    body: const RankingsScreen(),
                  ),
                ),
              ),
            ),
          ),
        ),
        StaggeredItem(
          index: 4,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.task_alt_outlined, color: Colors.greenAccent),
              title: Text(l10n.profileCompletedCourses),
              subtitle: Text(
                l10n.profileCompletedCoursesHint,
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CompletedCoursesScreen()),
              ),
            ),
          ),
        ),
        StaggeredItem(
          index: 5,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.favorite_outline, color: Colors.redAccent),
              title: Text(l10n.profileFavorites),
              subtitle: Text(
                l10n.profileFavoritesHint,
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const FavoritesScreen()),
              ),
            ),
          ),
        ),
        StaggeredItem(
          index: 5,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.bookmark_outline, color: AppTheme.accent),
              title: Text(l10n.profileSavedReels),
              subtitle: Text(
                l10n.profileSavedReelsHint,
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const SavedReelsScreen()),
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
                title: Text(l10n.navSubscriptions),
                subtitle: Text(
                  l10n.profileSubscriptionsHint,
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
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
                title: Text(l10n.profileChangeStage),
                subtitle: Text(
                  l10n.profileChangeStageHint,
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
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
        if (user.role == 'CERTIFICATE_USER') ...[
          const SizedBox(height: 16),
          StaggeredItem(
            index: 4,
            child: Card(
              child: ListTile(
                leading: const Icon(Icons.interests_rounded, color: AppTheme.accent),
                title: Text(l10n.t('mobile.profile.insightsTitle')),
                subtitle: Text(
                  user.interestSubjects.isEmpty
                      ? l10n.t('mobile.profile.insightsHint')
                      : user.interestSubjects
                          .map((i) => i.nameFor(context.localeCode))
                          .join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
                onTap: () async {
                  final changed = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => const CertificateInsightsScreen(),
                    ),
                  );
                  if (changed == true && context.mounted) {
                    await context.read<AuthProvider>().refreshUser();
                  }
                },
              ),
            ),
          ),
        ],
        if (user.role == 'STUDENT' || user.role == 'CERTIFICATE_USER') ...[
          const SizedBox(height: 16),
          StaggeredItem(
            index: 4,
            child: Card(
              child: FutureBuilder<void>(
                future: HomeAiEntryVisibility.ensureLoaded(),
                builder: (context, _) {
                  return ValueListenableBuilder<bool>(
                    valueListenable: HomeAiEntryVisibility.hidden,
                    builder: (context, hidden, _) {
                      return SwitchListTile(
                        secondary: Icon(
                          Icons.smart_toy_outlined,
                          color: AppTheme.accent,
                        ),
                        title: Text(l10n.t('mobile.ai.showOnHome')),
                        subtitle: Text(
                          l10n.t('mobile.ai.showOnHomeHint'),
                          style: TextStyle(color: AppTheme.muted, fontSize: 12),
                        ),
                        value: !hidden,
                        activeThumbColor: AppTheme.accent,
                        onChanged: (show) =>
                            HomeAiEntryVisibility.setHidden(!show),
                      );
                    },
                  );
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
                title: Text(l10n.profileTeacherStudio),
                subtitle: Text(
                  l10n.profileTeacherStudioHint,
                  style: TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
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
            child: FutureBuilder<String>(
              future: _cacheUsageFuture,
              builder: (context, snap) {
                final size = snap.data ?? '…';
                return ListTile(
                  leading: Icon(Icons.storage_outlined, color: AppTheme.muted),
                  title: Text(l10n.profileStorageCache),
                  subtitle: Text(
                    l10n.profileStorageCacheHint(size),
                    style: TextStyle(color: AppTheme.muted, fontSize: 12),
                  ),
                  trailing: TextButton(
                    onPressed: _clearMediaCache,
                    child: Text(l10n.profileStorageCacheClear),
                  ),
                );
              },
            ),
          ),
        ),
        const SizedBox(height: 16),
        StaggeredItem(
          index: user.role == 'TEACHER' || user.role == 'STUDENT' ? 6 : 5,
          child: Card(
            child: ListTile(
              leading: Icon(Icons.privacy_tip_outlined, color: AppTheme.accent),
              title: Text(l10n.t('mobile.privacy.title')),
              subtitle: Text(
                l10n.t('mobile.privacy.profileHint'),
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              trailing: Icon(Icons.chevron_right, color: AppTheme.muted),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PrivacyPolicyScreen()),
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        StaggeredItem(
          index: user.role == 'TEACHER' || user.role == 'STUDENT' ? 7 : 6,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.delete_forever_outlined, color: Colors.redAccent),
              title: Text(
                l10n.t('mobile.profile.deleteAccount'),
                style: const TextStyle(color: Colors.redAccent),
              ),
              subtitle: Text(
                l10n.t('mobile.profile.deleteAccountHint'),
                style: TextStyle(color: AppTheme.muted, fontSize: 12),
              ),
              onTap: () => _confirmDeleteAccount(context, user.role),
            ),
          ),
        ),
        const SizedBox(height: 16),
        StaggeredItem(
          index: user.role == 'TEACHER' || user.role == 'STUDENT' ? 8 : 7,
          child: Card(
            child: ListTile(
              leading: const Icon(Icons.logout, color: Colors.redAccent),
              title: Text(l10n.navLogout, style: const TextStyle(color: Colors.redAccent)),
              onTap: () async {
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    backgroundColor: AppTheme.card,
                    title: Text(l10n.navLogout),
                    content: Text(l10n.profileLogoutConfirm),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: Text(l10n.cancel),
                      ),
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        child: Text(
                          l10n.navLogout,
                          style: const TextStyle(color: Colors.redAccent),
                        ),
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

  Future<void> _confirmDeleteAccount(BuildContext context, String role) async {
    final l10n = context.l10n;
    final isTeacher = role == 'TEACHER';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.card,
        title: Text(l10n.t('mobile.profile.deleteAccount')),
        content: SingleChildScrollView(
          child: Text(
            isTeacher
                ? l10n.t('mobile.profile.deleteAccountTeacherMessage')
                : l10n.t('mobile.profile.deleteAccountMessage'),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(l10n.cancel),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(
              l10n.t('mobile.profile.deleteAccountConfirm'),
              style: const TextStyle(color: Colors.redAccent),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    try {
      final result =
          await context.read<AuthProvider>().requestAccountDeletion();
      if (!context.mounted) return;
      final requiresAdmin = result['requiresAdminApproval'] == true;
      final message = requiresAdmin
          ? l10n.t('mobile.profile.deleteAccountTeacherSubmitted')
          : l10n.t('mobile.profile.deleteAccountScheduled');
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: AppTheme.card,
          title: Text(l10n.t('mobile.profile.deleteAccount')),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(l10n.t('common.ok')),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().isNotEmpty
                ? e.toString()
                : l10n.t('mobile.profile.deleteAccountFailed'),
          ),
        ),
      );
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
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppTheme.accent),
      title: Text(label, style: TextStyle(color: AppTheme.muted, fontSize: 13)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (onTap != null) ...[
            const SizedBox(width: 4),
            Icon(Icons.chevron_right, color: AppTheme.muted, size: 20),
          ],
        ],
      ),
      onTap: onTap,
    );
  }
}
