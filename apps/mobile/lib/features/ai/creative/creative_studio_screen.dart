import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';

class CreativeStudioScreen extends StatefulWidget {
  const CreativeStudioScreen({super.key});

  @override
  State<CreativeStudioScreen> createState() => _CreativeStudioScreenState();
}

class _CreativeStudioScreenState extends State<CreativeStudioScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  Map<String, dynamic>? _status;
  bool _loadingStatus = true;
  bool _busy = false;
  String? _error;

  // Merge
  final List<_PickedFile> _mergeFiles = [];

  // Design
  String _designFormat = 'ppt';
  final _titleCtrl = TextEditingController();
  final _promptCtrl = TextEditingController();
  final _outlineCtrl = TextEditingController();

  // Image
  String _imageMode = 'design';
  final _imagePromptCtrl = TextEditingController();
  _PickedFile? _editImage;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadStatus());
  }

  @override
  void dispose() {
    _tabs.dispose();
    _titleCtrl.dispose();
    _promptCtrl.dispose();
    _outlineCtrl.dispose();
    _imagePromptCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    setState(() {
      _loadingStatus = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final data = await api.get('/api/ai/creative/status');
      if (!mounted) return;
      setState(() {
        _status = Map<String, dynamic>.from(data['status'] as Map);
        _loadingStatus = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingStatus = false;
        _error = e.toString();
      });
    }
  }

  Future<_PickedFile?> _pickOne({
    FileType type = FileType.any,
    List<String>? extensions,
  }) async {
    final pick = await FilePicker.pickFiles(
      type: type,
      allowedExtensions: extensions,
      withData: true,
    );
    final f = pick?.files.firstOrNull;
    if (f?.bytes == null) return null;
    if (f!.bytes!.length > 40 * 1024 * 1024) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.t('mobile.ai.creative.fileTooLarge'))),
        );
      }
      return null;
    }
    final mime = _guessMime(f.name, f.extension);
    return _PickedFile(fileName: f.name, mimeType: mime, bytes: f.bytes!);
  }

  String _guessMime(String name, String? ext) {
    final e = (ext ?? name.split('.').last).toLowerCase();
    switch (e) {
      case 'pdf':
        return 'application/pdf';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'webp':
        return 'image/webp';
      case 'svg':
        return 'image/svg+xml';
      case 'ppt':
      case 'pptx':
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      default:
        return 'application/octet-stream';
    }
  }

  Future<Map<String, dynamic>> _uploadFile(_PickedFile file, {required String category}) async {
    final api = context.read<ApiClient>();
    final presign = await api.post('/api/uploads', {
      'filename': file.fileName,
      'contentType': file.mimeType,
      'size': file.bytes.length,
      'category': category,
      'folder': 'ai-creative',
    });
    final uploadUrl = presign['uploadUrl']?.toString();
    if (uploadUrl == null) throw ApiException('Upload setup failed', 500);
    await api.putBytes(uploadUrl, file.bytes, file.mimeType);
    return {
      'fileName': file.fileName,
      'mimeType': file.mimeType,
      'fileKey': presign['key'],
      if (presign['publicUrl'] != null) 'fileUrl': presign['publicUrl'],
    };
  }

  Future<void> _saveResult(Map<String, dynamic> result) async {
    final name = result['fileName'] as String? ?? 'creative-result.bin';
    final b64 = result['dataBase64'] as String?;
    final downloadUrl = result['downloadUrl'] as String?;
    late final Uint8List bytes;
    if (b64 != null && b64.isNotEmpty) {
      bytes = base64Decode(b64);
    } else if (downloadUrl != null && downloadUrl.isNotEmpty) {
      bytes = await context.read<ApiClient>().getBytes(downloadUrl);
    } else {
      return;
    }
    final path = await FilePicker.saveFile(
      fileName: name,
      bytes: bytes,
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          path != null
              ? context.l10n.t('mobile.ai.creative.saved')
              : context.l10n.t('mobile.ai.creative.saveCancelled'),
        ),
      ),
    );
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() call) async {
    if (_busy) return;
    final access = _status?['access'] == true;
    if (!access) {
      await _showUpgradeSheet();
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await call();
      final result = Map<String, dynamic>.from(data['result'] as Map);
      await _loadStatus();
      if (!mounted) return;
      await _saveResult(result);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 402) {
        await _loadStatus();
        await _showUpgradeSheet();
      } else {
        setState(() => _error = e.message);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showUpgradeSheet() async {
    final status = _status;
    if (status == null) return;
    final packages = (status['packages'] as List?) ?? [];
    final offers = (status['offers'] as List?) ?? [];
    final l10n = context.l10n;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.background,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            16,
            20,
            24 + MediaQuery.of(ctx).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.t('mobile.ai.creative.upgradeTitle'),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                l10n.t('mobile.ai.creative.upgradeBody', {
                  'unlock': '${status['unlockCount']}',
                  'courses': '${status['courseCount']}',
                  'price':
                      '${status['monthlyUsd'] ?? status['monthlyPrice']} USD / ${status['yearlyIqd'] ?? ''} IQD',
                }),
                style: TextStyle(color: Colors.grey.shade700, height: 1.4),
              ),
              const SizedBox(height: 16),
              ...packages.map((p) {
                final pkg = Map<String, dynamic>.from(p as Map);
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: FilledButton(
                    onPressed: () async {
                      Navigator.pop(ctx);
                      await _requestPackage(pkg['id'] as String);
                    },
                    child: Text(
                      '${pkg['nameEn']} — ${pkg['price']} ${pkg['currency']}',
                    ),
                  ),
                );
              }),
              ...offers.map((o) {
                final offer = Map<String, dynamic>.from(o as Map);
                final packageId = offer['packageId'] as String?;
                if (packageId == null) {
                  return ListTile(
                    dense: true,
                    title: Text('${offer['label']}'),
                    subtitle: Text(
                      '${offer['price']} ${status['currency']} · ${offer['durationDays']} days',
                    ),
                  );
                }
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: OutlinedButton(
                    onPressed: () async {
                      Navigator.pop(ctx);
                      await _requestPackage(packageId);
                    },
                    child: Text(
                      '${offer['label']} — ${offer['price']} ${status['currency']}',
                    ),
                  ),
                );
              }),
              if (packages.isEmpty && offers.isEmpty)
                Text(
                  l10n.t('mobile.ai.creative.noPackages'),
                  style: TextStyle(color: Colors.grey.shade600),
                ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _requestPackage(String packageId) async {
    try {
      final api = context.read<ApiClient>();
      await api.post('/api/subscriptions', {'packageId': packageId});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.t('mobile.ai.creative.requestSent'))),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final remaining = _status?['remaining'] as int? ?? 0;
    final reason = _status?['reason'] as String? ?? 'NONE';
    final access = _status?['access'] == true;

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: GlassAppBar(
        title: Text(l10n.t('mobile.ai.creative.title')),
        actions: [
          IconButton(
            tooltip: l10n.t('mobile.ai.creative.upgrade'),
            onPressed: _showUpgradeSheet,
            icon: const Icon(Icons.workspace_premium_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: _StatusBanner(
              loading: _loadingStatus,
              access: access,
              remaining: remaining,
              reason: reason,
              courseCount: _status?['courseCount'] as int? ?? 0,
              unlockCount: _status?['unlockCount'] as int? ?? 6,
              onUpgrade: _showUpgradeSheet,
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            ),
          TabBar(
            controller: _tabs,
            labelColor: AppTheme.accent,
            tabs: [
              Tab(text: l10n.t('mobile.ai.creative.tabMerge')),
              Tab(text: l10n.t('mobile.ai.creative.tabDesign')),
              Tab(text: l10n.t('mobile.ai.creative.tabImages')),
            ],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _buildMergeTab(l10n),
                _buildDesignTab(l10n),
                _buildImageTab(l10n),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMergeTab(dynamic l10n) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          l10n.t('mobile.ai.creative.mergeHint'),
          style: TextStyle(color: Colors.grey.shade700),
        ),
        const SizedBox(height: 12),
        ..._mergeFiles.map(
          (f) => ListTile(
            leading: const Icon(Icons.picture_as_pdf_outlined),
            title: Text(f.fileName, maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: IconButton(
              icon: const Icon(Icons.close),
              onPressed: () => setState(() => _mergeFiles.remove(f)),
            ),
          ),
        ),
        OutlinedButton.icon(
          onPressed: _busy
              ? null
              : () async {
                  final f = await _pickOne(
                    type: FileType.custom,
                    extensions: ['pdf'],
                  );
                  if (f != null) setState(() => _mergeFiles.add(f));
                },
          icon: const Icon(Icons.add),
          label: Text(l10n.t('mobile.ai.creative.addPdf')),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy || _mergeFiles.length < 2
              ? null
              : () => _run(() async {
                    final api = context.read<ApiClient>();
                    final uploaded = <Map<String, dynamic>>[];
                    for (final f in _mergeFiles) {
                      uploaded.add(await _uploadFile(f, category: 'document'));
                    }
                    return api.post('/api/ai/creative/merge', {
                      'files': uploaded,
                    });
                  }),
          child: _busy
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.t('mobile.ai.creative.runMerge')),
        ),
      ],
    );
  }

  Widget _buildDesignTab(dynamic l10n) {
    final locale = context.read<LocaleProvider>().code.toLowerCase();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'ppt', label: Text(l10n.t('mobile.ai.creative.ppt'))),
            ButtonSegment(value: 'pdf', label: Text(l10n.t('mobile.ai.creative.pdf'))),
          ],
          selected: {_designFormat},
          onSelectionChanged: (s) => setState(() => _designFormat = s.first),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _titleCtrl,
          decoration: InputDecoration(labelText: l10n.t('mobile.ai.creative.titleField')),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _promptCtrl,
          maxLines: 4,
          decoration: InputDecoration(labelText: l10n.t('mobile.ai.creative.prompt')),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _outlineCtrl,
          maxLines: 3,
          decoration: InputDecoration(
            labelText: l10n.t('mobile.ai.creative.outlineOptional'),
          ),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ||
                  _titleCtrl.text.trim().isEmpty ||
                  _promptCtrl.text.trim().isEmpty
              ? null
              : () => _run(() async {
                    final api = context.read<ApiClient>();
                    return api.post('/api/ai/creative/design', {
                      'format': _designFormat,
                      'title': _titleCtrl.text.trim(),
                      'prompt': _promptCtrl.text.trim(),
                      'outline': _outlineCtrl.text.trim().isEmpty
                          ? null
                          : _outlineCtrl.text.trim(),
                      'language': locale,
                    });
                  }),
          child: _busy
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.t('mobile.ai.creative.runDesign')),
        ),
      ],
    );
  }

  Widget _buildImageTab(dynamic l10n) {
    final locale = context.read<LocaleProvider>().code.toLowerCase();
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        SegmentedButton<String>(
          segments: [
            ButtonSegment(
              value: 'design',
              label: Text(l10n.t('mobile.ai.creative.imageDesign')),
            ),
            ButtonSegment(
              value: 'edit',
              label: Text(l10n.t('mobile.ai.creative.imageEdit')),
            ),
          ],
          selected: {_imageMode},
          onSelectionChanged: (s) => setState(() => _imageMode = s.first),
        ),
        const SizedBox(height: 12),
        if (_imageMode == 'edit') ...[
          if (_editImage != null)
            ListTile(
              leading: const Icon(Icons.image_outlined),
              title: Text(_editImage!.fileName),
              trailing: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => setState(() => _editImage = null),
              ),
            ),
          OutlinedButton.icon(
            onPressed: _busy
                ? null
                : () async {
                    final f = await _pickOne(type: FileType.image);
                    if (f != null) setState(() => _editImage = f);
                  },
            icon: const Icon(Icons.upload),
            label: Text(l10n.t('mobile.ai.creative.uploadImage')),
          ),
          const SizedBox(height: 8),
        ],
        TextField(
          controller: _imagePromptCtrl,
          maxLines: 4,
          decoration: InputDecoration(labelText: l10n.t('mobile.ai.creative.prompt')),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ||
                  _imagePromptCtrl.text.trim().isEmpty ||
                  (_imageMode == 'edit' && _editImage == null)
              ? null
              : () => _run(() async {
                    final api = context.read<ApiClient>();
                    Map<String, dynamic>? imagePayload;
                    if (_editImage != null) {
                      imagePayload = await _uploadFile(
                        _editImage!,
                        category: 'image',
                      );
                    }
                    return api.post('/api/ai/creative/image', {
                      'mode': _imageMode,
                      'prompt': _imagePromptCtrl.text.trim(),
                      'language': locale,
                      if (imagePayload != null) 'image': imagePayload,
                    });
                  }),
          child: _busy
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.t('mobile.ai.creative.runImage')),
        ),
      ],
    );
  }
}

class _PickedFile {
  _PickedFile({
    required this.fileName,
    required this.mimeType,
    required this.bytes,
  });

  final String fileName;
  final String mimeType;
  final Uint8List bytes;

  Map<String, dynamic> toJson() => {
        'fileName': fileName,
        'mimeType': mimeType,
        'dataBase64': base64Encode(bytes),
      };
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({
    required this.loading,
    required this.access,
    required this.remaining,
    required this.reason,
    required this.courseCount,
    required this.unlockCount,
    required this.onUpgrade,
  });

  final bool loading;
  final bool access;
  final int remaining;
  final String reason;
  final int courseCount;
  final int unlockCount;
  final VoidCallback onUpgrade;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    if (loading) {
      return const LinearProgressIndicator(minHeight: 3);
    }
    String text;
    if (reason == 'SUBSCRIPTION') {
      text = l10n.t('mobile.ai.creative.statusSub');
    } else if (reason == 'COURSES_UNLOCK') {
      text = l10n.t('mobile.ai.creative.statusCourses', {
        'count': '$courseCount',
        'unlock': '$unlockCount',
      });
    } else if (access) {
      text = l10n.t('mobile.ai.creative.statusFree', {'remaining': '$remaining'});
    } else {
      text = l10n.t('mobile.ai.creative.statusLocked');
    }
    return Material(
      color: access
          ? AppTheme.accent.withValues(alpha: 0.12)
          : Colors.orange.withValues(alpha: 0.15),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: access ? null : onUpgrade,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Icon(
                access ? Icons.check_circle_outline : Icons.lock_outline,
                color: access ? AppTheme.accent : Colors.orange.shade800,
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(text)),
              if (!access)
                TextButton(
                  onPressed: onUpgrade,
                  child: Text(l10n.t('mobile.ai.creative.upgrade')),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
