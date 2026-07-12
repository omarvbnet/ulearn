import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/ai/ai_exam_panel.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';

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
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  String? _conversationId;
  bool _sending = false;
  final List<_ChatBubble> _messages = [];
  final List<_PendingAttachment> _pending = [];
  List<Map<String, dynamic>> _conversations = [];
  bool _loadingHistory = false;

  static const _maxBytes = 40 * 1024 * 1024;
  static const _maxInlineBytes = 300 * 1024;
  static const _maxFiles = 8;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadConversations());
  }

  @override
  void dispose() {
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Map<String, dynamic> _stagePayload(AuthProvider auth) {
    if (auth.user?.role == 'CERTIFICATE_USER') {
      return {
        if (auth.user?.certificateStage?.id != null)
          'stageId': auth.user!.certificateStage!.id,
        if (auth.user!.interestSubjects.isNotEmpty)
          'subjectIds': auth.user!.interestSubjects.map((s) => s.id).toList(),
      };
    }
    if (auth.user?.stage?.id != null) {
      return {'stageId': auth.user!.stage!.id};
    }
    return {};
  }

  Future<void> _loadConversations() async {
    setState(() => _loadingHistory = true);
    try {
      final api = context.read<ApiClient>();
      final data = await api.get('/api/ai/conversations');
      if (!mounted) return;
      setState(() {
        _conversations =
            ((data['conversations'] as List?) ?? []).cast<Map<String, dynamic>>();
      });
    } catch (_) {
      // History is optional if offline.
    } finally {
      if (mounted) setState(() => _loadingHistory = false);
    }
  }

  Future<void> _openConversation(String id) async {
    Navigator.of(context).maybePop();
    setState(() {
      _sending = true;
      _messages.clear();
      _conversationId = id;
    });
    try {
      final api = context.read<ApiClient>();
      final data = await api.get('/api/ai/conversations/$id');
      if (!mounted) return;
      final msgs = ((data['conversation']?['messages'] as List?) ??
              (data['messages'] as List?) ??
              [])
          .cast<Map<String, dynamic>>();
      final bubbles = <_ChatBubble>[];
      for (final m in msgs) {
        final role = (m['role']?.toString() ?? 'ASSISTANT').toLowerCase();
        final citationsRaw = m['citations'];
        Map<String, dynamic>? citationsMap;
        if (citationsRaw is Map) {
          citationsMap = Map<String, dynamic>.from(citationsRaw);
        }
        final practice = citationsMap?['practiceQuiz'] as Map?;
        AiPracticeExamData? exam;
        Map<String, dynamic>? examResult;
        if (citationsMap?['examAttemptId'] != null &&
            citationsMap?['review'] is List) {
          examResult = {
            'percentage': citationsMap!['percentage'],
            'passed': citationsMap['passed'],
            'score': citationsMap['score'],
            'maxScore': citationsMap['maxScore'],
            'analysis': citationsMap['analysis'] ?? m['content']?.toString(),
            'review': citationsMap['review'],
          };
        } else if (practice is Map) {
          exam = AiPracticeExamData.fromJson(Map<String, dynamic>.from(practice));
        }
        final suggestionsRaw = citationsMap?['courseSuggestions'];
        final suggestions = <Map<String, dynamic>>[];
        if (suggestionsRaw is List) {
          for (final s in suggestionsRaw) {
            if (s is Map) suggestions.add(Map<String, dynamic>.from(s));
          }
        }
        bubbles.add(
          _ChatBubble(
            role: role == 'user' ? 'user' : 'assistant',
            text: m['content']?.toString() ?? '',
            exam: exam != null && exam.examAttemptId.isNotEmpty ? exam : null,
            examCompleted: exam != null,
            examResult: examResult,
            courseSuggestions: suggestions,
          ),
        );
      }
      setState(() {
        _messages
          ..clear()
          ..addAll(bubbles);
      });
      _scrollToEnd();
    } catch (e) {
      if (!mounted) return;
      _toast(e is ApiException ? e.message : context.l10n.t('mobile.ai.errorGeneric'));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _newChat() {
    setState(() {
      _conversationId = null;
      _messages.clear();
      _pending.clear();
      _controller.clear();
    });
    Navigator.of(context).maybePop();
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
      next.add(
        _PendingAttachment(
          fileName: f.name,
          mimeType: _mimeFor(f.extension, image: imagesOnly),
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

  /// Large PDFs / files go through R2 so chat JSON stays small (avoids 413).
  Future<Map<String, dynamic>> _attachmentPayload(
    ApiClient api,
    _PendingAttachment a,
  ) async {
    final isPdf = a.mimeType.contains('pdf') ||
        a.fileName.toLowerCase().endsWith('.pdf');
    final useUpload = isPdf || a.bytes.length > _maxInlineBytes;
    if (!useUpload) {
      return {
        'fileName': a.fileName,
        'mimeType': a.mimeType,
        'dataBase64': base64Encode(a.bytes),
      };
    }
    final category = a.isImage ? 'image' : 'document';
    final presign = await api.post('/api/uploads', {
      'filename': a.fileName,
      'contentType': a.mimeType,
      'size': a.bytes.length,
      'category': category,
      'folder': 'ai-creative',
    });
    final uploadUrl = presign['uploadUrl']?.toString();
    if (uploadUrl == null) throw ApiException('Upload setup failed', 500);
    await api.putBytes(uploadUrl, a.bytes, a.mimeType);
    return {
      'fileName': a.fileName,
      'mimeType': a.mimeType,
      'fileKey': presign['key'],
      if (presign['publicUrl'] != null) 'fileUrl': presign['publicUrl'],
    };
  }

  Future<void> _downloadEdited(_ChatBubble m) async {
    final name = m.editedFileName ?? 'download.bin';
    try {
      late final Uint8List bytes;
      if (m.editedContentBase64 != null && m.editedContentBase64!.isNotEmpty) {
        bytes = base64Decode(m.editedContentBase64!);
      } else if (m.editedDownloadUrl != null && m.editedDownloadUrl!.isNotEmpty) {
        bytes = await context.read<ApiClient>().getBytes(m.editedDownloadUrl!);
      } else {
        return;
      }
      final path = await FilePicker.saveFile(fileName: name, bytes: bytes);
      if (!mounted) return;
      _toast(
        path != null
            ? context.l10n.t('mobile.ai.creative.saved')
            : context.l10n.t('mobile.ai.creative.saveCancelled'),
      );
    } catch (e) {
      if (!mounted) return;
      _toast(e.toString());
    }
  }

  Future<void> _send() async {
    final q = _controller.text.trim();
    if ((q.isEmpty && _pending.isEmpty) || _sending) return;

    final attachments = List<_PendingAttachment>.from(_pending);
    final displayText =
        q.isEmpty ? context.l10n.t('mobile.ai.askAboutAttachments') : q;

    setState(() {
      _sending = true;
      _messages.add(
        _ChatBubble(
          role: 'user',
          text: displayText,
          attachmentNames: attachments.map((a) => a.fileName).toList(),
          previewImages:
              attachments.where((a) => a.isImage).map((a) => a.bytes).toList(),
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

      final payload = <String, dynamic>{
        'question': q,
        'language': locale,
        if (_conversationId != null) 'conversationId': _conversationId,
        ..._stagePayload(auth),
        if (attachments.isNotEmpty)
          'attachments': await Future.wait(
            attachments.map((a) => _attachmentPayload(api, a)),
          ),
      };

      final data = await api.post('/api/ai/chat', payload);
      if (!mounted) return;
      final answer = data['answer']?.toString() ?? unavailable;
      final citations = (data['citations'] as List?) ?? const [];
      final edited = data['editedFile'] as Map<String, dynamic>?;
      final suggestionsRaw = data['courseSuggestions'];
      final suggestions = <Map<String, dynamic>>[];
      if (suggestionsRaw is List) {
        for (final s in suggestionsRaw) {
          if (s is Map) suggestions.add(Map<String, dynamic>.from(s));
        }
      }
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
            editedFileName: edited?['fileName']?.toString(),
            editedContentBase64: edited?['contentBase64']?.toString(),
            editedDownloadUrl: edited?['downloadUrl']?.toString(),
            editedMimeType: edited?['mimeType']?.toString(),
            courseSuggestions: suggestions,
          ),
        );
      });
      _loadConversations();
    } catch (e) {
      if (!mounted) return;
      final msg = e is ApiException ? e.message : e.toString();
      final text = msg.trim().isNotEmpty &&
              msg != 'Request failed' &&
              !msg.contains('SocketException')
          ? msg
          : context.l10n.t('mobile.ai.errorGeneric');
      setState(() {
        _messages.add(_ChatBubble(role: 'assistant', text: text));
      });
    } finally {
      if (mounted) setState(() => _sending = false);
      _scrollToEnd();
    }
  }

  Future<void> _startExamFlow() async {
    if (_sending) return;
    final api = context.read<ApiClient>();
    final l10n = context.l10n;
    final errGeneric = l10n.t('mobile.ai.errorGeneric');
    List<Map<String, dynamic>> docs = [];
    Map<String, dynamic>? meta;
    try {
      final data = await api.get('/api/ai/kb-documents');
      docs = ((data['documents'] as List?) ?? []).cast<Map<String, dynamic>>();
      meta = data['meta'] is Map
          ? Map<String, dynamic>.from(data['meta'] as Map)
          : null;
    } catch (e) {
      _toast(e is ApiException ? e.message : errGeneric);
      return;
    }
    if (!mounted) return;
    if (docs.isEmpty) {
      final pending = (meta?['pendingForStage'] as num?)?.toInt() ?? 0;
      final failed = (meta?['failedCount'] as num?)?.toInt() ?? 0;
      final insights = meta?['scope']?.toString() == 'insights';
      final reason = meta?['emptyReason']?.toString();
      final String msg;
      if (reason == 'failed' || (pending == 0 && failed > 0)) {
        msg = l10n.t(
          insights
              ? 'mobile.ai.materialsFailedInsights'
              : 'mobile.ai.materialsFailedStage',
        );
      } else if (reason == 'processing' || pending > 0) {
        msg = l10n.t(
          insights
              ? 'mobile.ai.materialsProcessingInsights'
              : 'mobile.ai.materialsProcessingStage',
        );
      } else {
        msg = l10n.t(
          insights
              ? 'mobile.ai.noMaterialsInsights'
              : 'mobile.ai.noMaterialsStage',
        );
      }
      _toast(msg);
      return;
    }

    final selected = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (ctx) => _MaterialPickerSheet(documents: docs),
    );
    if (selected == null || !mounted) return;
    final ids = ((selected['documentIds'] as List?) ?? [])
        .map((e) => e.toString())
        .where((e) => e.isNotEmpty)
        .toList();
    final count = (selected['count'] as num?)?.toInt() ?? 5;
    if (ids.isEmpty) return;
    await _generateExam(ids, count);
  }

  Future<void> _generateExam(List<String> documentIds, int count) async {
    final q = context.l10n.t('mobile.ai.generateExamPrompt');
    setState(() {
      _sending = true;
      _messages.add(_ChatBubble(role: 'user', text: q));
    });
    _scrollToEnd();
    try {
      final api = context.read<ApiClient>();
      final auth = context.read<AuthProvider>();
      final locale = context.read<LocaleProvider>().code.toLowerCase();
      final payload = <String, dynamic>{
        'question': q,
        'language': locale,
        'mode': 'practice_quiz',
        'documentIds': documentIds,
        'count': count == 10 || count == 20 ? count : 5,
        if (_conversationId != null) 'conversationId': _conversationId,
        ..._stagePayload(auth),
      };
      final data = await api.post('/api/ai/chat', payload);
      if (!mounted) return;
      final practice = data['practiceQuiz'] as Map<String, dynamic>?;
      AiPracticeExamData? exam;
      if (practice != null) {
        exam = AiPracticeExamData.fromJson({
          ...practice,
          'examAttemptId':
              practice['examAttemptId'] ?? data['examAttemptId'],
          'timeLimitSec': practice['timeLimitSec'],
        });
      }
      setState(() {
        _conversationId = data['conversationId']?.toString() ?? _conversationId;
        _messages.add(
          _ChatBubble(
            role: 'assistant',
            text: data['answer']?.toString() ?? '',
            exam: exam != null && exam.examAttemptId.isNotEmpty ? exam : null,
          ),
        );
      });
      _loadConversations();
    } catch (e) {
      if (!mounted) return;
      final msg = e is ApiException ? e.message : e.toString();
      setState(() {
        _messages.add(
          _ChatBubble(
            role: 'assistant',
            text: msg.trim().isNotEmpty
                ? msg
                : context.l10n.t('mobile.ai.errorGeneric'),
          ),
        );
      });
    } finally {
      if (mounted) setState(() => _sending = false);
      _scrollToEnd();
    }
  }

  Future<void> _submitExam(
    int bubbleIndex,
    AiPracticeExamData exam,
    Map<String, String> answers,
    int elapsedSec,
    bool expired,
  ) async {
    try {
      final api = context.read<ApiClient>();
      final locale = context.read<LocaleProvider>().code.toLowerCase();
      final result = await api.post('/api/ai/exams/submit', {
        'examAttemptId': exam.examAttemptId,
        'answers': answers,
        'elapsedSec': elapsedSec,
        'expired': expired,
        'language': locale,
      });
      if (!mounted) return;
      setState(() {
        if (bubbleIndex >= 0 && bubbleIndex < _messages.length) {
          final old = _messages[bubbleIndex];
          _messages[bubbleIndex] = _ChatBubble(
            role: old.role,
            text: old.text,
            citations: old.citations,
            exam: old.exam,
            examCompleted: true,
          );
        }
        _messages.add(
          _ChatBubble(
            role: 'assistant',
            text: '',
            examResult: Map<String, dynamic>.from(result),
          ),
        );
      });
      _scrollToEnd();
    } catch (e) {
      if (!mounted) return;
      _toast(e is ApiException ? e.message : context.l10n.t('mobile.ai.errorGeneric'));
      setState(() {
        if (bubbleIndex >= 0 && bubbleIndex < _messages.length) {
          final old = _messages[bubbleIndex];
          _messages[bubbleIndex] = _ChatBubble(
            role: old.role,
            text: old.text,
            citations: old.citations,
            exam: old.exam,
            examCompleted: false,
          );
        }
      });
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent + 160,
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
    final stageName = auth.user?.role == 'CERTIFICATE_USER'
        ? (auth.user?.certificateStage?.nameFor(locale) ??
            (auth.user!.interestSubjects.isNotEmpty
                ? auth.user!.interestSubjects
                    .map((s) => s.nameFor(locale))
                    .join(', ')
                : null))
        : auth.user?.stage?.nameFor(locale);

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: AppTheme.background,
      drawer: _HistoryDrawer(
        loading: _loadingHistory,
        conversations: _conversations,
        activeId: _conversationId,
        onRefresh: _loadConversations,
        onNew: _newChat,
        onOpen: _openConversation,
      ),
      appBar: GlassAppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ULearnLogo(size: 26, glow: 0.7),
            const SizedBox(width: 8),
            Text(
              l10n.t('mobile.ai.title'),
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
        ),
        leading: IconButton(
          icon: const Icon(Icons.history_rounded),
          tooltip: l10n.t('mobile.ai.history'),
          onPressed: () {
            _loadConversations();
            _scaffoldKey.currentState?.openDrawer();
          },
        ),
        actions: [
          IconButton(
            tooltip: l10n.t('mobile.ai.newChat'),
            onPressed: _newChat,
            icon: const Icon(Icons.edit_square),
          ),
        ],
      ),
      body: Column(
        children: [
          if (name != null || stageName != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  gradient: LinearGradient(
                    colors: [
                      AppTheme.primary.withValues(alpha: 0.12),
                      AppTheme.accent.withValues(alpha: 0.06),
                    ],
                  ),
                  border: Border.all(color: AppTheme.cardBorder),
                ),
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
                ? _EmptyState(
                    onAsk: (prompt) {
                      _controller.text = prompt;
                      _send();
                    },
                    onExam: _startExamFlow,
                  )
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                    itemCount: _messages.length + (_sending ? 1 : 0),
                    itemBuilder: (context, i) {
                      if (_sending && i == _messages.length) {
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Row(
                            children: [
                              SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppTheme.accent,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Text(
                                l10n.t('mobile.ai.thinking'),
                                style: TextStyle(color: AppTheme.muted),
                              ),
                            ],
                          ),
                        );
                      }
                      final m = _messages[i];
                      final isUser = m.role == 'user';
                      return Align(
                        alignment: isUser
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        child: Container(
                          constraints: BoxConstraints(
                            maxWidth: MediaQuery.sizeOf(context).width * 0.92,
                          ),
                          margin: const EdgeInsets.only(bottom: 12),
                          child: Column(
                            crossAxisAlignment: isUser
                                ? CrossAxisAlignment.end
                                : CrossAxisAlignment.start,
                            children: [
                              if (m.text.isNotEmpty ||
                                  m.previewImages.isNotEmpty ||
                                  m.attachmentNames.isNotEmpty)
                                GestureDetector(
                                  onLongPress: m.text.isEmpty
                                      ? null
                                      : () async {
                                          await Clipboard.setData(
                                            ClipboardData(text: m.text),
                                          );
                                          if (mounted) {
                                            _toast(l10n.t('mobile.ai.copied'));
                                          }
                                        },
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 14,
                                      vertical: 11,
                                    ),
                                    decoration: BoxDecoration(
                                      color: isUser
                                          ? AppTheme.accent
                                              .withValues(alpha: 0.18)
                                          : AppTheme.card,
                                      borderRadius: BorderRadius.only(
                                        topLeft: const Radius.circular(18),
                                        topRight: const Radius.circular(18),
                                        bottomLeft: Radius.circular(
                                          isUser ? 18 : 6,
                                        ),
                                        bottomRight: Radius.circular(
                                          isUser ? 6 : 18,
                                        ),
                                      ),
                                      border: Border.all(
                                        color: AppTheme.cardBorder,
                                      ),
                                    ),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        if (m.previewImages.isNotEmpty) ...[
                                          Wrap(
                                            spacing: 6,
                                            runSpacing: 6,
                                            children: m.previewImages
                                                .map(
                                                  (b) => ClipRRect(
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                            10),
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
                                                    visualDensity:
                                                        VisualDensity.compact,
                                                    label: Text(
                                                      n,
                                                      style: const TextStyle(
                                                          fontSize: 11),
                                                    ),
                                                    avatar: const Icon(
                                                      Icons.attach_file,
                                                      size: 14,
                                                    ),
                                                  ),
                                                )
                                                .toList(),
                                          ),
                                          const SizedBox(height: 6),
                                        ],
                                        if (m.text.isNotEmpty)
                                          Text(
                                            m.text,
                                            style: TextStyle(
                                              color: AppTheme.foreground,
                                              height: 1.45,
                                            ),
                                          ),
                                        if (m.editedFileName != null) ...[
                                          const SizedBox(height: 10),
                                          OutlinedButton.icon(
                                            onPressed: () => _downloadEdited(m),
                                            icon: const Icon(
                                              Icons.download_rounded,
                                              size: 18,
                                            ),
                                            label: Text(
                                              context.l10n.t(
                                                'mobile.ai.downloadFile',
                                                {'name': m.editedFileName!},
                                              ),
                                            ),
                                          ),
                                        ],
                                        if (m.citations.isNotEmpty) ...[
                                          const SizedBox(height: 8),
                                          Wrap(
                                            spacing: 6,
                                            runSpacing: 6,
                                            children: m.citations
                                                .map(
                                                  (c) => Container(
                                                    padding:
                                                        const EdgeInsets
                                                            .symmetric(
                                                      horizontal: 8,
                                                      vertical: 4,
                                                    ),
                                                    decoration: BoxDecoration(
                                                      color:
                                                          AppTheme.background,
                                                      borderRadius:
                                                          BorderRadius.circular(
                                                              999),
                                                      border: Border.all(
                                                        color: AppTheme
                                                            .cardBorder,
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
                                ),
                              if (m.exam != null) ...[
                                const SizedBox(height: 8),
                                AiExamPanel(
                                  key: ValueKey(m.exam!.examAttemptId),
                                  exam: m.exam!,
                                  disabled: m.examCompleted,
                                  onSubmit: (answers, elapsed, expired) =>
                                      _submitExam(
                                    i,
                                    m.exam!,
                                    answers,
                                    elapsed,
                                    expired,
                                  ),
                                ),
                              ],
                              if (m.examResult != null) ...[
                                const SizedBox(height: 8),
                                AiExamResultPanel(result: m.examResult!),
                              ],
                              if (m.courseSuggestions.isNotEmpty) ...[
                                const SizedBox(height: 10),
                                _CourseSuggestionsStrip(
                                  courses: m.courseSuggestions,
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
                                    const Icon(
                                      Icons.insert_drive_file_outlined,
                                      size: 22,
                                    ),
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
                            child: const Icon(
                              Icons.close,
                              size: 14,
                              color: Colors.white,
                            ),
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
            child: Container(
              margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
              padding: const EdgeInsets.fromLTRB(4, 6, 6, 6),
              decoration: BoxDecoration(
                color: AppTheme.card,
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: AppTheme.cardBorder),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.18),
                    blurRadius: 18,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
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
                    onPressed:
                        _sending ? null : () => _pick(imagesOnly: false),
                    icon: const Icon(Icons.attach_file_rounded),
                  ),
              IconButton(
                    tooltip: l10n.t('mobile.ai.generateExam'),
                    onPressed: _sending ? null : _startExamFlow,
                    icon: const ULearnLogo(size: 22, glow: 0.55),
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
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        filled: false,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 10,
                        ),
                      ),
                    ),
                  ),
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

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onAsk, required this.onExam});

  final void Function(String prompt) onAsk;
  final VoidCallback onExam;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final prompts = [
      l10n.t('mobile.ai.promptExplain'),
      l10n.t('mobile.ai.promptPractice'),
      l10n.t('mobile.ai.promptWeak'),
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
      children: [
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: LinearGradient(
              colors: [
                AppTheme.primary.withValues(alpha: 0.22),
                AppTheme.accent.withValues(alpha: 0.12),
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            border: Border.all(color: AppTheme.cardBorder),
          ),
          child: Column(
            children: [
              const ULearnLogo(size: 44, glow: 0.8),
              const SizedBox(height: 12),
              Text(
                l10n.t('mobile.ai.emptyTitle'),
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppTheme.foreground,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.4,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                l10n.t('mobile.ai.emptyHint'),
                textAlign: TextAlign.center,
                style: TextStyle(color: AppTheme.muted, height: 1.45),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: onExam,
                style: FilledButton.styleFrom(
                  backgroundColor: AppTheme.accent,
                  foregroundColor: Colors.black,
                ),
                icon: const ULearnLogo(size: 18, glow: 0.4),
                label: Text(l10n.t('mobile.ai.generateExam')),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        ...prompts.map(
          (p) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              onPressed: () => onAsk(p),
              style: OutlinedButton.styleFrom(
                alignment: Alignment.centerLeft,
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                side: BorderSide(color: AppTheme.cardBorder),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: Text(
                p,
                style: TextStyle(color: AppTheme.foreground),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _HistoryDrawer extends StatelessWidget {
  const _HistoryDrawer({
    required this.loading,
    required this.conversations,
    required this.activeId,
    required this.onRefresh,
    required this.onNew,
    required this.onOpen,
  });

  final bool loading;
  final List<Map<String, dynamic>> conversations;
  final String? activeId;
  final VoidCallback onRefresh;
  final VoidCallback onNew;
  final void Function(String id) onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Drawer(
      backgroundColor: AppTheme.background,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.t('mobile.ai.history'),
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 18,
                        color: AppTheme.foreground,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: onRefresh,
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: FilledButton.tonalIcon(
                onPressed: onNew,
                icon: const Icon(Icons.add_comment_outlined),
                label: Text(l10n.t('mobile.ai.newChat')),
              ),
            ),
            const SizedBox(height: 8),
            if (loading) const LinearProgressIndicator(minHeight: 2),
            Expanded(
              child: conversations.isEmpty && !loading
                  ? Center(
                      child: Text(
                        l10n.t('mobile.ai.historyEmpty'),
                        style: TextStyle(color: AppTheme.muted),
                      ),
                    )
                  : ListView.builder(
                      itemCount: conversations.length,
                      itemBuilder: (context, i) {
                        final c = conversations[i];
                        final id = c['id']?.toString() ?? '';
                        final title = (c['title']?.toString() ?? '').trim().isNotEmpty
                            ? c['title'].toString()
                            : l10n.t('mobile.ai.untitledChat');
                        final active = id == activeId;
                        return ListTile(
                          selected: active,
                          selectedTileColor:
                              AppTheme.accent.withValues(alpha: 0.12),
                          leading: Icon(
                            Icons.chat_bubble_outline,
                            color: active ? AppTheme.accent : AppTheme.muted,
                          ),
                          title: Text(
                            title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: AppTheme.foreground,
                              fontWeight: active
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                            ),
                          ),
                          onTap: id.isEmpty ? null : () => onOpen(id),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MaterialPickerSheet extends StatefulWidget {
  const _MaterialPickerSheet({required this.documents});

  final List<Map<String, dynamic>> documents;

  @override
  State<_MaterialPickerSheet> createState() => _MaterialPickerSheetState();
}

class _MaterialPickerSheetState extends State<_MaterialPickerSheet> {
  final Set<String> _selected = {};
  int _count = 5;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.78,
      minChildSize: 0.45,
      maxChildSize: 0.94,
      builder: (context, scroll) {
        return Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.muted.withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.t('mobile.ai.pickMaterials'),
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 17,
                      color: AppTheme.foreground,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    l10n.t('mobile.ai.pickMaterialsHint'),
                    style: TextStyle(color: AppTheme.muted, fontSize: 13),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    l10n.t('mobile.ai.examDifficulty'),
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                      color: AppTheme.foreground,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _DifficultyChip(
                        label: l10n.t('mobile.ai.examBasic'),
                        subtitle: '5',
                        selected: _count == 5,
                        onTap: () => setState(() => _count = 5),
                      ),
                      _DifficultyChip(
                        label: l10n.t('mobile.ai.examIntermediate'),
                        subtitle: '10',
                        selected: _count == 10,
                        onTap: () => setState(() => _count = 10),
                      ),
                      _DifficultyChip(
                        label: l10n.t('mobile.ai.examAdvanced'),
                        subtitle: '20',
                        selected: _count == 20,
                        onTap: () => setState(() => _count = 20),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                controller: scroll,
                itemCount: widget.documents.length,
                itemBuilder: (context, i) {
                  final d = widget.documents[i];
                  final id = d['id']?.toString() ?? '';
                  final name = d['fileName']?.toString() ?? 'Document';
                  final checked = _selected.contains(id);
                  return CheckboxListTile(
                    value: checked,
                    onChanged: id.isEmpty
                        ? null
                        : (v) {
                            setState(() {
                              if (v == true) {
                                _selected.add(id);
                              } else {
                                _selected.remove(id);
                              }
                            });
                          },
                    title: Text(
                      name,
                      style: TextStyle(color: AppTheme.foreground),
                    ),
                    activeColor: AppTheme.accent,
                  );
                },
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                child: FilledButton(
                  onPressed: _selected.isEmpty
                      ? null
                      : () => Navigator.pop(context, {
                            'documentIds': _selected.toList(),
                            'count': _count,
                          }),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppTheme.accent,
                    foregroundColor: Colors.black,
                    minimumSize: const Size.fromHeight(48),
                  ),
                  child: Text(
                    l10n.t('mobile.ai.generateExam'),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _DifficultyChip extends StatelessWidget {
  const _DifficultyChip({
    required this.label,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? AppTheme.accent.withValues(alpha: 0.2)
          : AppTheme.card,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? AppTheme.accent : AppTheme.cardBorder,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                  color: AppTheme.foreground,
                ),
              ),
              Text(
                '$subtitle Q',
                style: TextStyle(
                  fontSize: 11,
                  color: selected ? AppTheme.accent : AppTheme.muted,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
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
    this.editedFileName,
    this.editedContentBase64,
    this.editedDownloadUrl,
    this.editedMimeType,
    this.exam,
    this.examCompleted = false,
    this.examResult,
    this.courseSuggestions = const [],
  });

  final String role;
  final String text;
  final List<String> citations;
  final List<String> attachmentNames;
  final List<Uint8List> previewImages;
  final String? editedFileName;
  final String? editedContentBase64;
  final String? editedDownloadUrl;
  final String? editedMimeType;
  final AiPracticeExamData? exam;
  final bool examCompleted;
  final Map<String, dynamic>? examResult;
  final List<Map<String, dynamic>> courseSuggestions;
}

class _CourseSuggestionsStrip extends StatelessWidget {
  const _CourseSuggestionsStrip({required this.courses});

  final List<Map<String, dynamic>> courses;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.t('mobile.ai.suggestedCourses'),
          style: TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 13,
            color: AppTheme.foreground,
          ),
        ),
        const SizedBox(height: 8),
        ...courses.map((c) {
          final id = c['id']?.toString() ?? '';
          if (id.isEmpty) return const SizedBox.shrink();
          final title = c['title']?.toString() ?? '';
          final teacher = c['teacherName']?.toString();
          final likes = (c['likes'] as num?)?.toInt() ?? 0;
          final views = (c['viewCount'] as num?)?.toInt() ?? 0;
          final rating = (c['courseRating'] as num?)?.toDouble() ?? 0;
          final price = (c['price'] as num?)?.toDouble();
          final currency = c['currency']?.toString() ?? '';
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Material(
              color: AppTheme.card,
              borderRadius: BorderRadius.circular(14),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => CourseDetailScreen(
                        courseId: id,
                        summary: c,
                      ),
                    ),
                  );
                },
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: AppTheme.accent.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          Icons.menu_book_rounded,
                          color: AppTheme.accent,
                          size: 22,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                              ),
                            ),
                            if (teacher != null && teacher.isNotEmpty)
                              Text(
                                teacher,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 11,
                                  color: AppTheme.muted,
                                ),
                              ),
                            const SizedBox(height: 4),
                            Text(
                              '★ ${rating.toStringAsFixed(1)} · ♥ $likes · 👁 $views'
                              '${price != null ? ' · ${price.toStringAsFixed(0)} $currency' : ''}',
                              style: TextStyle(
                                fontSize: 11,
                                color: AppTheme.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Icon(Icons.chevron_right, color: AppTheme.muted),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      ],
    );
  }
}
