import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';

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

  @override
  void dispose() {
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final q = _controller.text.trim();
    if (q.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _messages.add(_ChatBubble(role: 'user', text: q));
      _controller.clear();
    });
    _scrollToEnd();

    try {
      final api = context.read<ApiClient>();
      final unavailable = context.l10n.t('mobile.ai.unavailable');
      final data = await api.post('/api/ai/chat', {
        'question': q,
        if (_conversationId != null) 'conversationId': _conversationId,
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
        _scroll.position.maxScrollExtent + 80,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: GlassAppBar(title: Text(l10n.t('mobile.ai.title'))),
      body: Column(
        children: [
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
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Row(
                children: [
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
                  const SizedBox(width: 8),
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
  });

  final String role;
  final String text;
  final List<String> citations;
}
