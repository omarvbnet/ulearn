import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/animations.dart';
import 'package:ulearn/core/widgets/skeleton.dart';

/// Request a move to a different educational stage. Requires a certificate
/// attachment (image or PDF) which the admin reviews before approving.
class StageRequestScreen extends StatefulWidget {
  const StageRequestScreen({super.key});

  @override
  State<StageRequestScreen> createState() => _StageRequestScreenState();
}

class _StageRequestScreenState extends State<StageRequestScreen> {
  List<Map<String, dynamic>> _stages = [];
  List<Map<String, dynamic>> _requests = [];
  String? _selectedStageId;
  PlatformFile? _certificate;
  final _note = TextEditingController();
  bool _loading = true;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/api/stages'),
        api.get('/api/profile/stage-request'),
      ]);
      if (!mounted) return;
      setState(() {
        _stages =
            ((results[0]['stages'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _requests =
            ((results[1]['requests'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = context.l10n.t('mobile.stageRequest.loadFailed');
      });
    }
  }

  Future<void> _pickCertificate() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
      withData: true,
    );
    if (result != null && result.files.isNotEmpty) {
      setState(() => _certificate = result.files.first);
    }
  }

  String _contentType(String name) {
    final ext = name.split('.').last.toLowerCase();
    return switch (ext) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'pdf' => 'application/pdf',
      _ => 'application/octet-stream',
    };
  }

  Future<void> _submit() async {
    final stageId = _selectedStageId;
    final cert = _certificate;
    if (stageId == null) {
      setState(() => _error = context.l10n.t('mobile.stageRequest.chooseStage'));
      return;
    }
    if (cert == null) {
      setState(() => _error = context.l10n.t('mobile.stageRequest.certificateRequired'));
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();

      Uint8List? bytes = cert.bytes;
      if (bytes == null && cert.path != null) {
        bytes = await File(cert.path!).readAsBytes();
      }
      if (bytes == null) throw Exception('Could not read the attached file');

      final contentType = _contentType(cert.name);
      final presign = await api.post('/api/uploads', {
        'filename': cert.name,
        'contentType': contentType,
        'size': bytes.length,
        'category': contentType == 'application/pdf' ? 'document' : 'image',
      });

      await api.putBytes(presign['uploadUrl'] as String, bytes, contentType);

      await api.post('/api/profile/stage-request', {
        'requestedStageId': stageId,
        'certificateKey': presign['key'],
        if (presign['publicUrl'] != null) 'certificateUrl': presign['publicUrl'],
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });

      if (!mounted) return;
      setState(() {
        _selectedStageId = null;
        _certificate = null;
        _note.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.stageRequestSent)),
      );
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = switch (e.message) {
            'ALREADY_PENDING' => context.l10n.t('mobile.stageRequest.alreadyPending'),
            'SAME_STAGE' => context.l10n.t('mobile.stageRequest.sameStage'),
            'CERTIFICATE_REQUIRED' => context.l10n.t('mobile.stageRequest.certificateRequired'),
            _ => e.message,
          });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = context.l10n.t('mobile.stageRequest.submitFailed'));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final locale = context.localeCode;
    final l10n = context.l10n;
    final currentStage = auth.user?.stage;
    final hasPending = _requests.any((r) => r['status'] == 'PENDING');

    String stageName(Map<String, dynamic> stage) {
      final key = switch (locale) {
        'AR' => 'nameAr',
        'KU' => 'nameKu',
        'TR' => 'nameTr',
        _ => 'nameEn',
      };
      final name = stage[key]?.toString() ?? '';
      return name.isNotEmpty ? name : (stage['nameEn']?.toString() ?? '');
    }

    return Scaffold(
      appBar: AppBar(title: Text(l10n.stageRequestTitle)),
      body: _loading
          ? Skeleton(
              child: ListView(
                physics: const NeverScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                children: const [
                  SkeletonBox(height: 64, radius: 16),
                  SizedBox(height: 16),
                  SkeletonBox(height: 56, radius: 12),
                  SizedBox(height: 16),
                  SkeletonBox(height: 120, radius: 16),
                  SizedBox(height: 16),
                  SkeletonBox(height: 96, radius: 12),
                  SizedBox(height: 24),
                  SkeletonBox(height: 48, radius: 12),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                StaggeredItem(
                  index: 0,
                  child: Card(
                    child: ListTile(
                      leading: const Icon(Icons.school_outlined, color: AppTheme.accent),
                      title: Text(
                        l10n.stageRequestCurrentStage,
                        style: TextStyle(color: AppTheme.muted, fontSize: 13),
                      ),
                      trailing: Text(
                        currentStage?.nameFor(locale) ?? l10n.profileNotSet,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                if (hasPending)
                  StaggeredItem(
                    index: 1,
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(
                          children: [
                            const Icon(Icons.hourglass_top, color: Colors.amber),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                l10n.t('mobile.stageRequest.pendingReview'),
                                style: TextStyle(
                                  color: AppTheme.foreground.withValues(alpha: 0.85),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  )
                else ...[
                  StaggeredItem(
                    index: 1,
                    child: DropdownButtonFormField<String>(
                      initialValue: _selectedStageId,
                      items: _stages
                          .where((s) => s['id'] != currentStage?.id)
                          .map((s) => DropdownMenuItem(
                                value: s['id'].toString(),
                                child: Text(stageName(s)),
                              ))
                          .toList(),
                      onChanged: (v) => setState(() => _selectedStageId = v),
                      decoration: InputDecoration(labelText: l10n.stageRequestRequestedStage),
                    ),
                  ),
                  const SizedBox(height: 12),
                  StaggeredItem(
                    index: 2,
                    child: InkWell(
                      onTap: _pickCertificate,
                      borderRadius: BorderRadius.circular(14),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: _certificate != null
                                ? AppTheme.accent
                                : AppTheme.cardBorder,
                          ),
                          color: AppTheme.card,
                        ),
                        child: Row(
                          children: [
                            Icon(
                              _certificate != null
                                  ? Icons.check_circle_outline
                                  : Icons.attach_file,
                              color: _certificate != null
                                  ? AppTheme.accent
                                  : AppTheme.muted,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                _certificate?.name ??
                                    l10n.t('mobile.stageRequest.attachCertificate'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: _certificate != null
                                      ? AppTheme.foreground
                                      : AppTheme.muted,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  StaggeredItem(
                    index: 3,
                    child: TextField(
                      controller: _note,
                      maxLines: 3,
                      decoration:
                          InputDecoration(labelText: l10n.t('mobile.stageRequest.noteOptional')),
                    ),
                  ),
                  const SizedBox(height: 20),
                  StaggeredItem(
                    index: 4,
                    child: ElevatedButton.icon(
                      onPressed: _submitting ? null : _submit,
                      icon: const Icon(Icons.send_rounded, size: 18),
                      label: Text(_submitting ? l10n.t('auth.sending') : l10n.stageRequestSubmit),
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                ],
                if (_requests.isNotEmpty) ...[
                  const SizedBox(height: 28),
                  Text(
                    l10n.t('mobile.stageRequest.previousRequests'),
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 10),
                  ..._requests.asMap().entries.map((e) {
                    final r = e.value;
                    final status = r['status']?.toString() ?? 'PENDING';
                    final requested = r['requestedStage'] as Map<String, dynamic>?;
                    final (color, icon) = switch (status) {
                      'APPROVED' => (Colors.greenAccent, Icons.check_circle_outline),
                      'REJECTED' => (Colors.redAccent, Icons.cancel_outlined),
                      _ => (Colors.amber, Icons.hourglass_top),
                    };
                    return StaggeredItem(
                      index: e.key + 5,
                      child: Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: Icon(icon, color: color),
                          title: Text(
                            requested != null ? stageName(requested) : l10n.profileStage,
                            style: const TextStyle(fontSize: 14.5),
                          ),
                          subtitle: r['reviewNotes'] != null
                              ? Text(
                                  r['reviewNotes'].toString(),
                                  style: TextStyle(
                                      fontSize: 12, color: AppTheme.muted),
                                )
                              : null,
                          trailing: Text(
                            status,
                            style: TextStyle(
                              color: color,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                ],
              ],
            ),
    );
  }
}
