import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/features/store/course_material_pdf_screen.dart';

/// Locked / unlocked professional course certificate for CERTIFICATE_USER.
class CourseCertificateCard extends StatefulWidget {
  const CourseCertificateCard({
    super.key,
    required this.courseId,
    required this.certificate,
    required this.courseTitle,
  });

  final String courseId;
  final Map<String, dynamic> certificate;
  final String courseTitle;

  @override
  State<CourseCertificateCard> createState() => _CourseCertificateCardState();
}

class _CourseCertificateCardState extends State<CourseCertificateCard> {
  bool _downloading = false;

  bool get _unlocked => widget.certificate['unlocked'] == true;
  bool get _locked => widget.certificate['locked'] != false;

  Map<String, dynamic>? get _preview =>
      widget.certificate['preview'] as Map<String, dynamic>?;

  Map<String, dynamic>? get _cert =>
      widget.certificate['certificate'] as Map<String, dynamic>?;

  String _hoursLabel(dynamic hours) {
    final h = (hours as num?)?.toDouble() ?? 0;
    if (h <= 0) return '—';
    if (h < 1) return '${(h * 60).round()} min';
    final rounded = (h * 10).round() / 10;
    return '$rounded h';
  }

  Future<void> _download() async {
    if (!_unlocked || _downloading) return;
    setState(() => _downloading = true);
    try {
      final api = context.read<ApiClient>();
      final bytes = await api.getBytes(
        '/api/store/courses/${widget.courseId}/certificate/download',
      );
      if (!mounted) return;
      final title = _cert?['courseTitle']?.toString() ?? widget.courseTitle;
      final number = _cert?['certificateNumber']?.toString() ?? 'certificate';
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CourseMaterialPdfScreen(
            bytes: Uint8List.fromList(bytes),
            title: 'U Learn — $title ($number)',
          ),
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message)),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.store.certDownloadFailed'))),
      );
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final preview = _preview;
    final teacher = preview?['teacherName']?.toString() ?? '—';
    final hours = _hoursLabel(preview?['totalHours']);
    final desc = preview?['courseDescription']?.toString();

    return Container(
      margin: const EdgeInsets.only(top: 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: _unlocked
              ? const [Color(0xFF0B1F33), Color(0xFF16324A)]
              : const [Color(0xFF1A1A22), Color(0xFF242430)],
        ),
        boxShadow: [
          BoxShadow(
            color: (_unlocked ? const Color(0xFFC4A35A) : Colors.black)
                .withValues(alpha: 0.22),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -20,
            top: -20,
            child: Icon(
              Icons.workspace_premium_rounded,
              size: 120,
              color: Colors.white.withValues(alpha: _unlocked ? 0.08 : 0.04),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: const Color(0xFFC4A35A),
                          width: 1.5,
                        ),
                        color: Colors.white.withValues(alpha: 0.06),
                      ),
                      child: Icon(
                        _unlocked
                            ? Icons.verified_rounded
                            : Icons.lock_rounded,
                        color: const Color(0xFFC4A35A),
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.t('mobile.store.certTitle'),
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                              letterSpacing: 0.2,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _unlocked
                                ? l10n.t('mobile.store.certUnlocked')
                                : l10n.t('mobile.store.certLocked'),
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.7),
                              fontSize: 12.5,
                              height: 1.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: _unlocked
                            ? const Color(0xFFC4A35A).withValues(alpha: 0.2)
                            : Colors.white.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: _unlocked
                              ? const Color(0xFFC4A35A)
                              : Colors.white24,
                        ),
                      ),
                      child: Text(
                        _unlocked
                            ? l10n.t('mobile.common.active')
                            : l10n.t('mobile.common.locked'),
                        style: TextStyle(
                          color: _unlocked
                              ? const Color(0xFFE8D5A3)
                              : Colors.white70,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.08),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'U Learn',
                        style: TextStyle(
                          color: Color(0xFFC4A35A),
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        widget.courseTitle,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                          height: 1.25,
                        ),
                      ),
                      if (desc != null && desc.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          desc,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.65),
                            fontSize: 12.5,
                            height: 1.35,
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          _MetaChip(
                            icon: Icons.person_outline_rounded,
                            label: teacher,
                          ),
                          const SizedBox(width: 8),
                          _MetaChip(
                            icon: Icons.schedule_rounded,
                            label: hours,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                if (_locked && !_unlocked)
                  Text(
                    l10n.t('mobile.store.certLockedHint'),
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.55),
                      fontSize: 12,
                      height: 1.35,
                    ),
                  )
                else
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _downloading ? null : _download,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFFC4A35A),
                        foregroundColor: const Color(0xFF0B1F33),
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      icon: _downloading
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Color(0xFF0B1F33),
                              ),
                            )
                          : const Icon(Icons.download_rounded, size: 20),
                      label: Text(
                        _downloading
                            ? l10n.t('mobile.store.certPreparing')
                            : l10n.t('mobile.store.certDownload'),
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Icon(icon, size: 15, color: const Color(0xFFC4A35A)),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
