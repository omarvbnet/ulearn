import 'package:flutter/material.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';

/// In-app Privacy Policy aligned with Apple App Store and Google Play
/// account-deletion / education / payment disclosure requirements.
class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final sections = <(String, String)>[
      (
        l10n.t('mobile.privacy.whoWeAreTitle'),
        l10n.t('mobile.privacy.whoWeAreBody'),
      ),
      (
        l10n.t('mobile.privacy.dataWeCollectTitle'),
        l10n.t('mobile.privacy.dataWeCollectBody'),
      ),
      (
        l10n.t('mobile.privacy.teachingTitle'),
        l10n.t('mobile.privacy.teachingBody'),
      ),
      (
        l10n.t('mobile.privacy.paymentsTitle'),
        l10n.t('mobile.privacy.paymentsBody'),
      ),
      (
        l10n.t('mobile.privacy.retentionTitle'),
        l10n.t('mobile.privacy.retentionBody'),
      ),
      (
        l10n.t('mobile.privacy.deletionTitle'),
        l10n.t('mobile.privacy.deletionBody'),
      ),
      (
        l10n.t('mobile.privacy.sharingTitle'),
        l10n.t('mobile.privacy.sharingBody'),
      ),
      (
        l10n.t('mobile.privacy.childrenTitle'),
        l10n.t('mobile.privacy.childrenBody'),
      ),
      (
        l10n.t('mobile.privacy.contactTitle'),
        l10n.t('mobile.privacy.contactBody'),
      ),
    ];

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.background,
        foregroundColor: AppTheme.foreground,
        title: Text(
          l10n.t('mobile.privacy.title'),
          style: TextStyle(color: AppTheme.foreground),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
        children: [
          Text(
            l10n.t('mobile.privacy.updated'),
            style: TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
          const SizedBox(height: 8),
          Text(
            l10n.t('mobile.privacy.intro'),
            style: TextStyle(
              color: AppTheme.foreground,
              fontSize: 14,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 20),
          for (final (title, body) in sections) ...[
            Text(
              title,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppTheme.foreground,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              body,
              style: TextStyle(
                color: AppTheme.muted,
                fontSize: 14,
                height: 1.55,
              ),
            ),
            const SizedBox(height: 20),
          ],
        ],
      ),
    );
  }
}
