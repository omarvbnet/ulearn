import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';

class _PendingAttachment {
  _PendingAttachment({
    required this.fileName,
    required this.mimeType,
    required this.bytes,
  });

  final String fileName;
  final String mimeType;
  final Uint8List bytes;

  bool get isImage => mimeType.startsWith('image/');
}

class AiAssistantScreen extends StatefulWidget {
  const AiAssistantScreen({super.key});

  @override
  State<AiAssistantScreen> createState() => _AiAssistantScreenState();
}

class _AiAssistantScreenState extends State<AiAssistantScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  String? _conversationId;
  bool _sending = false;
  final List<_ChatBubble> _messages = [];
  final List<_PendingAttachment> _pending = [];

  static const _maxBytes = 4 * 1024 * 1024;
  static const _maxFiles = 4;

  @override
  void dispose() {
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  String _mimeFor(String? ext, {required bool image}) {
    final e = (ext ?? '').toLowerCase();
    return switch (e) {
      'png' => 'image/png',
      'jpg' || 'jpeg' => 'image/jpeg',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      'pdf' => 'application/pdf',
      'txt' => 'text/plain',
      'docx' =>
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc' => 'application/msword',
      _ => image ? 'image/jpeg' : 'application/octet-stream',
    };
  }

  Future<void> _pick({required bool imagesOnly}) async {
    if (_pending.length >= _maxFiles) {
      _toast(context.l10n.t('mobile.ai.attachLimit'));
      return;
    }
    final pick = await FilePicker.pickFiles(
      type: imagesOnly ? FileType.image : FileType.custom,
      allowedExtensions: imagesOnly
          ? null
          : const ['pdf', 'txt', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'webp'],
      withData: true,
      allowMultiple: true,
    );
    if (!mounted) return;
    if (pick == null || pick.files.isEmpty) return;

    final next = <_PendingAttachment>[..._pending];
    for (final f in pick.files) {
      if (next.length >= _maxFiles) break;
      final bytes = f.bytes;
      if (bytes == null || bytes.isEmpty) continue;
      if (bytes.length > _maxBytes) {
        _toast(context.l10n.t('mobile.ai.attachTooLarge'));
        continue;
      }
      final mime = _mimeFor(f.extension, image: imagesOnly);
      next.add(
        _PendingAttachment(
          fileName: f.name,
          mimeType: mime,
          bytes: bytes,
        ),
      );
    }
    if (!mounted) return;
    setState(() {
      _pending
        ..clear()
        ..addAll(next);
    });
  }

  void _toast(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _send() async {
    final q = _controller.text.trim();
    if ((q.isEmpty && _pending.isEmpty) || _sending) return;

    final attachments = List<_PendingAttachment>.from(_pending);
    final displayText = q.isEmpty
        ? context.l10n.t('mobile.ai.askAboutAttachments')
        : q;

    setState(() {
      _sending = true;
      _messages.add(
        _ChatBubble(
          role: 'user',
          text: displayText,
          attachmentNames: attachments.map((a) => a.fileName).toList(),
          previewImages: attachments
              .where((a) => a.isImage)
              .map((a) => a.bytes)
              .toList(),
        ),
      );
      _controller.clear();
      _pending.clear();
    });
    _scrollToEnd();

    try {
      final api = context.read<ApiClient>();
      final auth = context.read<AuthProvider>();
      final locale = context.read<LocaleProvider>().code.toLowerCase();
      final unavailable = context.l10n.t('mobile.ai.unavailable');

      final data = await api.post('/api/ai/chat', {
        'question': q,
        'language': locale,
        if (_conversationId != null) 'conversationId': _conversationId,
        if (auth.user?.stage?.id != null) 'stageId': auth.user!.stage!.id,
        if (attachments.isNotEmpty)
          'attachments': attachments
              .map(
                (a) => {
                  'fileName': a.fileName,
                  'mimeType': a.mimeType,
                  'dataBase64': base64Encode(a.bytes),
                },
              )
              .toList(),
      });
      if (!mounted) return;
      final answer = data['answer']?.toString() ?? unavailable;
      final citations = (data['citations'] as List?) ?? const [];
      setState(() {
        _conversationId = data['conversationId']?.toString() ?? _conversationId;
        _messages.add(
          _ChatBubble(
            role: 'assistant',
            text: answer,
            citations: citations
                .map((c) {
                  if (c is! Map) return null;
                  final name = c['documentName']?.toString() ?? '';
                  final page = c['page'];
                  if (name.isEmpty) return null;
                  return page != null ? '$name · p.$page' : name;
                })
                .whereType<String>()
                .toList(),
          ),
        );
      });
    } catch (e) {
      if (!mounted) return;
      final unavailable = context.l10n.t('mobile.ai.unavailable');
      setState(() {
        _messages.add(
          _ChatBubble(
            role: 'assistant',
            text: unavailable,
          ),
        );
      });
    } finally {
      if (mounted) setState(() => _sending = false);
      _scrollToEnd();
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent + 120,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final auth = context.watch<AuthProvider>();
    final locale = context.watch<LocaleProvider>().code;
    final name = auth.user?.fullLegalName;
    final stageName = auth.user?.stage?.nameFor(locale);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: GlassAppBar(title: Text(l10n.t('mobile.ai.title'))),
      body: Column(
        children: [
          if (name != null || stageName != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  [
                    if (name != null && name.isNotEmpty) name,
                    if (stageName != null && stageName.isNotEmpty) stageName,
                  ].join(' · '),
                  style: TextStyle(
                    color: AppTheme.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          Expanded(
            child: _messages.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: Text(
                        l10n.t('mobile.ai.emptyHint'),
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppTheme.muted, height: 1.45),
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                    itemCount: _messages.length + (_sending ? 1 : 0),
                    itemBuilder: (context, i) {
                      if (_sending && i == _messages.length) {
                        return Align(
                          alignment: Alignment.centerLeft,
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Text(
                              l10n.t('mobile.ai.thinking'),
                              style: TextStyle(color: AppTheme.muted),
                            ),
                          ),
                        );
                      }
                      final m = _messages[i];
                      final isUser = m.role == 'user';
                      return Align(
                        alignment:
                            isUser ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          constraints: BoxConstraints(
                            maxWidth: MediaQuery.sizeOf(context).width * 0.86,
                          ),
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          decoration: BoxDecoration(
                            color: isUser
                                ? AppTheme.accent.withValues(alpha: 0.18)
                                : AppTheme.card,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: AppTheme.cardBorder),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (m.previewImages.isNotEmpty) ...[
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: m.previewImages
                                      .map(
                                        (b) => ClipRRect(
                                          borderRadius: BorderRadius.circular(10),
                                          child: Image.memory(
                                            b,
                                            width: 72,
                                            height: 72,
                                            fit: BoxFit.cover,
                                          ),
                                        ),
                                      )
                                      .toList(),
                                ),
                                const SizedBox(height: 8),
                              ],
                              if (m.attachmentNames.isNotEmpty) ...[
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: m.attachmentNames
                                      .map(
                                        (n) => Chip(
                                          visualDensity: VisualDensity.compact,
                                          label: Text(
                                            n,
                                            style: const TextStyle(fontSize: 11),
                                          ),
                                          avatar: const Icon(Icons.attach_file, size: 14),
                                        ),
                                      )
                                      .toList(),
                                ),
                                const SizedBox(height: 6),
                              ],
                              Text(
                                m.text,
                                style: TextStyle(
                                  color: AppTheme.foreground,
                                  height: 1.4,
                                ),
                              ),
                              if (m.citations.isNotEmpty) ...[
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: m.citations
                                      .map(
                                        (c) => Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 8,
                                            vertical: 4,
                                          ),
                                          decoration: BoxDecoration(
                                            color: AppTheme.background,
                                            borderRadius:
                                                BorderRadius.circular(999),
                                            border: Border.all(
                                              color: AppTheme.cardBorder,
                                            ),
                                          ),
                                          child: Text(
                                            c,
                                            style: TextStyle(
                                              fontSize: 11,
                                              color: AppTheme.muted,
                                            ),
                                          ),
                                        ),
                                      )
                                      .toList(),
                                ),
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
          if (_pending.isNotEmpty)
            SizedBox(
              height: 78,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                itemCount: _pending.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, i) {
                  final a = _pending[i];
                  return Stack(
                    children: [
                      Container(
                        width: 70,
                        decoration: BoxDecoration(
                          color: AppTheme.card,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppTheme.cardBorder),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: a.isImage
                            ? Image.memory(a.bytes, fit: BoxFit.cover)
                            : Padding(
                                padding: const EdgeInsets.all(8),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Icon(Icons.insert_drive_file_outlined, size: 22),
                                    const SizedBox(height: 4),
                                    Text(
                                      a.fileName,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(fontSize: 9),
                                    ),
                                  ],
                                ),
                              ),
                      ),
                      Positioned(
                        top: 2,
                        right: 2,
                        child: InkWell(
                          onTap: () => setState(() => _pending.removeAt(i)),
                          child: Container(
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.55),
                              shape: BoxShape.circle,
                            ),
                            padding: const EdgeInsets.all(2),
                            child: const Icon(Icons.close, size: 14, color: Colors.white),
                          ),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    tooltip: l10n.t('mobile.ai.attachPhoto'),
                    onPressed: _sending ? null : () => _pick(imagesOnly: true),
                    icon: const Icon(Icons.photo_outlined),
                  ),
                  IconButton(
                    tooltip: l10n.t('mobile.ai.attachFile'),
                    onPressed: _sending ? null : () => _pick(imagesOnly: false),
                    icon: const Icon(Icons.attach_file_rounded),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        hintText: l10n.t('mobile.ai.placeholder'),
                        filled: true,
                        fillColor: AppTheme.card,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(18),
                          borderSide: BorderSide(color: AppTheme.cardBorder),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(18),
                          borderSide: BorderSide(color: AppTheme.cardBorder),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    style: IconButton.styleFrom(
                      backgroundColor: AppTheme.accent,
                      foregroundColor: Colors.black,
                    ),
                    icon: const Icon(Icons.arrow_upward_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatBubble {
  _ChatBubble({
    required this.role,
    required this.text,
    this.citations = const [],
    this.attachmentNames = const [],
    this.previewImages = const [],
  });

  final String role;
  final String text;
  final List<String> citations;
  final List<String> attachmentNames;
  final List<Uint8List> previewImages;
}
