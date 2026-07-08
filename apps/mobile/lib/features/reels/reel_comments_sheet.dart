import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/skeleton.dart';
import 'package:ulearn/features/profile/profile_avatar.dart';

/// Bottom sheet for reel comments with live posting.
class ReelCommentsSheet extends StatefulWidget {
  const ReelCommentsSheet({
    super.key,
    required this.videoId,
    required this.videoTitle,
    required this.initialCount,
    required this.onCountChanged,
  });

  final String videoId;
  final String videoTitle;
  final int initialCount;
  final ValueChanged<int> onCountChanged;

  @override
  State<ReelCommentsSheet> createState() => _ReelCommentsSheetState();
}

class _ReelCommentsSheetState extends State<ReelCommentsSheet> {
  final _inputCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  List<Map<String, dynamic>> _comments = [];
  bool _loading = true;
  bool _posting = false;
  late int _count;

  @override
  void initState() {
    super.initState();
    _count = widget.initialCount;
    _load();
  }

  @override
  void dispose() {
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await context
          .read<ApiClient>()
          .get('/api/store/short-videos/${widget.videoId}/comments');
      if (!mounted) return;
      setState(() {
        _comments = ((data['comments'] as List<dynamic>?) ?? [])
            .cast<Map<String, dynamic>>()
            .reversed
            .toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _post() async {
    final body = _inputCtrl.text.trim();
    if (body.isEmpty || _posting) return;
    setState(() => _posting = true);
    try {
      final data = await context.read<ApiClient>().post(
            '/api/store/short-videos/${widget.videoId}/comments',
            {'body': body},
          );
      if (!mounted) return;
      final comment = data['comment'] as Map<String, dynamic>;
      _inputCtrl.clear();
      setState(() {
        _comments.add(comment);
        _count = (data['commentCount'] as num?)?.toInt() ?? _count + 1;
        _posting = false;
      });
      widget.onCountChanged(_count);
      Future.delayed(const Duration(milliseconds: 100), () {
        if (_scrollCtrl.hasClients) {
          _scrollCtrl.animateTo(
            _scrollCtrl.position.maxScrollExtent,
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeOut,
          );
        }
      });
    } catch (_) {
      if (mounted) setState(() => _posting = false);
    }
  }

  String _timeAgo(String? iso) {
    if (iso == null) return '';
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '';
    final diff = DateTime.now().difference(dt);
    if (diff.inDays > 0) return '${diff.inDays}d';
    if (diff.inHours > 0) return '${diff.inHours}h';
    if (diff.inMinutes > 0) return '${diff.inMinutes}m';
    return 'now';
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;

    return DraggableScrollableSheet(
      initialChildSize: 0.62,
      minChildSize: 0.38,
      maxChildSize: 0.92,
      builder: (context, dragCtrl) {
        return Container(
          decoration: const BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
            border: Border(top: BorderSide(color: AppTheme.cardBorder)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppTheme.muted.withValues(alpha: 0.35),
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Comments',
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                          ),
                          Text(
                            widget.videoTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppTheme.primary.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        '$_count',
                        style: const TextStyle(color: AppTheme.accent, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1, color: AppTheme.cardBorder),
              Expanded(
                child: _loading
                    ? const Padding(
                        padding: EdgeInsets.all(20),
                        child: SkeletonList(
                          count: 4,
                          itemBuilder: _commentSkeleton,
                        ),
                      )
                    : _comments.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.chat_bubble_outline,
                                    size: 40, color: AppTheme.muted.withValues(alpha: 0.45)),
                                const SizedBox(height: 10),
                                const Text('Be the first to comment',
                                    style: TextStyle(color: AppTheme.muted)),
                              ],
                            ),
                          )
                        : ListView.builder(
                            controller: dragCtrl,
                            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                            itemCount: _comments.length,
                            itemBuilder: (context, i) => _CommentTile(
                              comment: _comments[i],
                              timeAgo: _timeAgo(_comments[i]['createdAt']?.toString()),
                            ),
                          ),
              ),
              Container(
                padding: EdgeInsets.fromLTRB(14, 10, 14, 12 + bottom),
                decoration: const BoxDecoration(
                  color: AppTheme.background,
                  border: Border(top: BorderSide(color: AppTheme.cardBorder)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _inputCtrl,
                        maxLines: 3,
                        minLines: 1,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _post(),
                        decoration: InputDecoration(
                          hintText: 'Add a comment…',
                          filled: true,
                          fillColor: AppTheme.card,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide.none,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Material(
                      color: AppTheme.primary,
                      shape: const CircleBorder(),
                      child: InkWell(
                        customBorder: const CircleBorder(),
                        onTap: _posting ? null : _post,
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: _posting
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const Icon(Icons.send_rounded, color: Colors.white, size: 20),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

Widget _commentSkeleton(int _) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: const [
        SkeletonCircle(size: 36),
        SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SkeletonLine(width: 100),
              SizedBox(height: 6),
              SkeletonLine(width: double.infinity),
            ],
          ),
        ),
      ],
    ),
  );
}

class _CommentTile extends StatelessWidget {
  const _CommentTile({required this.comment, required this.timeAgo});

  final Map<String, dynamic> comment;
  final String timeAgo;

  @override
  Widget build(BuildContext context) {
    final user = comment['user'] as Map<String, dynamic>? ?? {};
    final name = user['fullLegalName']?.toString() ?? 'User';
    final body = comment['body']?.toString() ?? '';
    final photoUrl = user['profilePhotoUrl']?.toString();

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ProfileAvatar(name: name, photoUrl: photoUrl, size: 36),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    const SizedBox(width: 8),
                    Text(timeAgo, style: TextStyle(color: AppTheme.muted.withValues(alpha: 0.8), fontSize: 11)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(height: 1.4, fontSize: 14)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
