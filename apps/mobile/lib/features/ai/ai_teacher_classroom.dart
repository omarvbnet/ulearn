import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';

/// Live AI Teacher classroom: animated board + captions + interrupt/resume.
class AiTeacherClassroom extends StatefulWidget {
  const AiTeacherClassroom({
    super.key,
    required this.lesson,
    this.onAskTeacher,
  });

  final Map<String, dynamic> lesson;
  final Future<String> Function(String question, int pausedIndex)? onAskTeacher;

  @override
  State<AiTeacherClassroom> createState() => _AiTeacherClassroomState();
}

class _AiTeacherClassroomState extends State<AiTeacherClassroom> {
  static const _boardW = 1920.0;
  static const _boardH = 1080.0;

  var _modeVoice = true;
  var _phase = _Phase.idle;
  var _speechIndex = 0;
  var _caption = '';
  var _askOpen = false;
  var _asking = false;
  final _askCtrl = TextEditingController();
  String? _teacherReply;
  final _quizReveal = <int, bool>{};

  final _items = <_BoardItem>[];
  var _boardApplied = 0;
  var _paused = false;
  var _cancelled = false;
  var _runId = 0;

  List<Map<String, dynamic>> get _speech {
    final raw = widget.lesson['speech'];
    if (raw is! List) return const [];
    return [
      for (final s in raw)
        if (s is Map) Map<String, dynamic>.from(s),
    ];
  }

  List<Map<String, dynamic>> get _whiteboard {
    final raw = widget.lesson['whiteboard'];
    if (raw is! List) return const [];
    final list = [
      for (final a in raw)
        if (a is Map) Map<String, dynamic>.from(a),
    ];
    list.sort((a, b) => ((_num(a['time'])).compareTo(_num(b['time']))));
    return list;
  }

  String get _title =>
      widget.lesson['lesson_title']?.toString() ?? 'Lesson';
  String get _objective => widget.lesson['objective']?.toString() ?? '';
  String get _lang =>
      (widget.lesson['language']?.toString() ?? 'en').toLowerCase();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _runLesson(0);
    });
  }

  @override
  void dispose() {
    _cancelled = true;
    _runId++;
    _askCtrl.dispose();
    super.dispose();
  }

  Future<void> _waitWhilePaused() async {
    while (_paused && !_cancelled) {
      await Future<void>.delayed(const Duration(milliseconds: 120));
    }
  }

  void _applyBoardUntil(num untilMs) {
    final board = _whiteboard;
    var next = _boardApplied;
    while (next < board.length && _num(board[next]['time']) <= untilMs) {
      next++;
    }
    if (next == _boardApplied) return;
    final rebuilt = <_BoardItem>[];
    for (var i = 0; i < next; i++) {
      _applyCue(rebuilt, board[i], i);
    }
    _boardApplied = next;
    _items
      ..clear()
      ..addAll(rebuilt);
    if (mounted) setState(() {});
  }

  void _resetBoard() {
    _boardApplied = 0;
    _items.clear();
  }

  Future<void> _runLesson(int fromIndex) async {
    final runId = ++_runId;
    _cancelled = false;
    _paused = false;
    if (!mounted) return;
    setState(() {
      _phase = _Phase.teaching;
      _teacherReply = null;
    });

    final speech = _speech;
    if (fromIndex == 0) {
      _resetBoard();
      _applyBoardUntil(speech.isEmpty ? 0 : _num(speech.first['time']));
    }

    for (var i = fromIndex; i < speech.length; i++) {
      if (runId != _runId || _cancelled) return;
      await _waitWhilePaused();
      if (runId != _runId || _cancelled) return;

      final cue = speech[i];
      final text = cue['text']?.toString() ?? '';
      final tMs = _num(cue['time']);
      final nextTime = i + 1 < speech.length
          ? _num(speech[i + 1]['time'])
          : double.infinity;

      if (mounted) {
        setState(() {
          _speechIndex = i;
          _caption = text;
        });
      }
      _applyBoardUntil(tMs);

      final duration = _estimateMs(text);
      final start = DateTime.now();
      while (DateTime.now().difference(start).inMilliseconds < duration) {
        if (runId != _runId || _cancelled) return;
        await _waitWhilePaused();
        if (_paused) continue;
        final elapsed = DateTime.now().difference(start).inMilliseconds;
        _applyBoardUntil(tMs + elapsed);
        await Future<void>.delayed(const Duration(milliseconds: 80));
      }
      _applyBoardUntil(nextTime.isFinite ? nextTime : tMs + 60000);
    }

    if (runId != _runId || _cancelled) return;
    _applyBoardUntil(double.infinity);
    if (!mounted) return;
    final done = context.l10n.t('mobile.ai.aiTeacherCompleted');
    setState(() {
      _phase = _Phase.completed;
      _caption = done == 'mobile.ai.aiTeacherCompleted'
          ? (_lang == 'ar'
              ? 'أحسنت! انتهينا من هذا الجزء.'
              : 'Well done! This part is complete.')
          : done;
    });
  }

  void _pause() {
    _paused = true;
    if (mounted) setState(() => _phase = _Phase.paused);
  }

  void _resume() {
    _askOpen = false;
    _teacherReply = null;
    _paused = false;
    if (mounted) setState(() => _phase = _Phase.teaching);
    _runLesson(_speechIndex);
  }

  Future<void> _submitAsk() async {
    final q = _askCtrl.text.trim();
    if (q.isEmpty || _asking) return;
    _pause();
    setState(() {
      _asking = true;
      _phase = _Phase.answering;
    });
    try {
      var reply = _lang == 'ar'
          ? 'سؤال ممتاز. دعنا نوضح ثم نكمل من حيث توقفنا.'
          : 'Excellent question. Let’s clarify, then continue.';
      if (widget.onAskTeacher != null) {
        reply = await widget.onAskTeacher!(q, _speechIndex);
      }
      if (!mounted) return;
      setState(() {
        _teacherReply = reply;
        _askCtrl.clear();
        _phase = _Phase.paused;
      });
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final summary = (widget.lesson['summary'] as List?) ?? const [];
    final quiz = (widget.lesson['quiz'] as List?) ?? const [];

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFF0B1220),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'U Learn · ${l10n.t('mobile.ai.aiTeacherClassroom')}',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF6EE7B7),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
                if (_objective.isNotEmpty)
                  Text(
                    _objective,
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.white.withValues(alpha: 0.65),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _chip(
                  selected: _modeVoice,
                  label: l10n.t('mobile.ai.aiTeacherVoice'),
                  onTap: () => setState(() => _modeVoice = true),
                ),
                _chip(
                  selected: !_modeVoice,
                  label: l10n.t('mobile.ai.aiTeacherText'),
                  onTap: () => setState(() => _modeVoice = false),
                ),
                if (_phase == _Phase.teaching)
                  _actionChip(
                    l10n.t('mobile.ai.aiTeacherPause'),
                    onTap: _pause,
                  ),
                if (_phase == _Phase.paused || _phase == _Phase.answering)
                  _actionChip(
                    l10n.t('mobile.ai.aiTeacherResume'),
                    onTap: _resume,
                    filled: true,
                  ),
                if (_phase == _Phase.idle || _phase == _Phase.completed)
                  _actionChip(
                    l10n.t('mobile.ai.aiTeacherStart'),
                    onTap: () => _runLesson(0),
                    filled: true,
                  ),
                _actionChip(
                  l10n.t('mobile.ai.aiTeacherAsk'),
                  onTap: () {
                    _pause();
                    setState(() => _askOpen = true);
                  },
                  accent: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          AspectRatio(
            aspectRatio: 16 / 10,
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: const Color(0xFFF4F7FB),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white24),
              ),
              child: CustomPaint(
                painter: _ClassroomBoardPainter(items: List.of(_items)),
                child: const SizedBox.expand(),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _speech.isEmpty
                        ? ''
                        : '${math.min(_speechIndex + 1, _speech.length)}/${_speech.length}',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: Colors.white.withValues(alpha: 0.55),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _caption.isEmpty ? '…' : _caption,
                    style: const TextStyle(
                      fontSize: 14,
                      height: 1.35,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_askOpen)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
              child: Column(
                children: [
                  TextField(
                    controller: _askCtrl,
                    minLines: 2,
                    maxLines: 3,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: InputDecoration(
                      hintText: l10n.t('mobile.ai.aiTeacherAskHint'),
                      hintStyle: TextStyle(
                        color: Colors.white.withValues(alpha: 0.4),
                      ),
                      filled: true,
                      fillColor: Colors.black26,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: FilledButton(
                      onPressed: _asking ? null : _submitAsk,
                      child: Text(
                        _asking ? '…' : l10n.t('mobile.ai.aiTeacherSend'),
                      ),
                    ),
                  ),
                  if (_teacherReply != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.t('mobile.ai.aiTeacherReply'),
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              color: Color(0xFF6EE7B7),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _teacherReply!,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                            ),
                          ),
                          TextButton(
                            onPressed: _resume,
                            child: Text(l10n.t('mobile.ai.aiTeacherResume')),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          if (_phase == _Phase.completed && summary.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.t('mobile.ai.aiTeacherSummary'),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: Colors.white.withValues(alpha: 0.7),
                    ),
                  ),
                  ...summary.map(
                    (s) => Text(
                      '• ${s.toString()}',
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
          if (_phase == _Phase.completed && quiz.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.t('mobile.ai.aiTeacherQuiz'),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: Colors.white.withValues(alpha: 0.7),
                    ),
                  ),
                  ...List.generate(quiz.length.clamp(0, 5), (qi) {
                    final q = quiz[qi];
                    if (q is! Map) return const SizedBox.shrink();
                    final map = Map<String, dynamic>.from(q);
                    final reveal = _quizReveal[qi] == true;
                    return Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.05),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${qi + 1}. ${map['question'] ?? ''}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            TextButton(
                              onPressed: () => setState(
                                () => _quizReveal[qi] = !reveal,
                              ),
                              child: Text(
                                reveal
                                    ? l10n.t('mobile.ai.aiTeacherHideAnswer')
                                    : l10n.t('mobile.ai.aiTeacherShowAnswer'),
                              ),
                            ),
                            if (reveal)
                              Text(
                                '${map['answer'] ?? ''}',
                                style: const TextStyle(
                                  color: Color(0xFF6EE7B7),
                                  fontSize: 13,
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ),
          const SizedBox(height: 4),
        ],
      ),
    );
  }

  Widget _chip({
    required bool selected,
    required String label,
    required VoidCallback onTap,
  }) {
    return ChoiceChip(
      selected: selected,
      label: Text(label, style: const TextStyle(fontSize: 12)),
      onSelected: (_) => onTap(),
      selectedColor: const Color(0xFF10B981).withValues(alpha: 0.35),
      labelStyle: TextStyle(
        color: selected ? Colors.white : Colors.white70,
        fontWeight: FontWeight.w700,
      ),
      backgroundColor: Colors.white10,
    );
  }

  Widget _actionChip(
    String label, {
    required VoidCallback onTap,
    bool filled = false,
    bool accent = false,
  }) {
    return ActionChip(
      onPressed: onTap,
      label: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: filled ? const Color(0xFF064E3B) : Colors.white,
        ),
      ),
      backgroundColor: filled
          ? const Color(0xFF34D399)
          : accent
              ? const Color(0xFFFBBF24).withValues(alpha: 0.18)
              : Colors.white10,
    );
  }
}

enum _Phase { idle, teaching, paused, answering, completed }

num _num(dynamic v, [num fallback = 0]) {
  if (v is num) return v;
  return num.tryParse(v?.toString() ?? '') ?? fallback;
}

int _estimateMs(String text) {
  final words = text.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
  return math.max(2200, math.min(14000, words * 420));
}

Color _color(dynamic raw, [Color fallback = const Color(0xFF1E293B)]) {
  final c = (raw?.toString() ?? '').trim().toLowerCase();
  const map = {
    'blue': Color(0xFF2563EB),
    'red': Color(0xFFDC2626),
    'green': Color(0xFF16A34A),
    'yellow': Color(0xFFCA8A04),
    'purple': Color(0xFF7C3AED),
    'orange': Color(0xFFEA580C),
    'brown': Color(0xFF92400E),
    'gray': Color(0xFF64748B),
    'grey': Color(0xFF64748B),
    'black': Color(0xFF0F172A),
    'white': Color(0xFFF8FAFC),
  };
  if (map.containsKey(c)) return map[c]!;
  if (c.startsWith('#') && (c.length == 7 || c.length == 4)) {
    try {
      final hex = c.length == 4
          ? '#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}'
          : c;
      return Color(int.parse(hex.replaceFirst('#', 'FF'), radix: 16));
    } catch (_) {}
  }
  return fallback;
}

void _applyCue(List<_BoardItem> items, Map<String, dynamic> cue, int idx) {
  final p = cue['parameters'] is Map
      ? Map<String, dynamic>.from(cue['parameters'] as Map)
      : <String, dynamic>{};
  final action =
      (cue['action']?.toString() ?? '').toLowerCase().replaceAll(' ', '_');
  final id = '${cue['time']}-$action-$idx';

  if (action == 'clear_board' || action == 'open_new_board') {
    items.clear();
    return;
  }
  if (action == 'wait' ||
      action == 'change_color' ||
      action == 'change_pen_size') {
    return;
  }
  if (action == 'write_text' ||
      action == 'draw_formula' ||
      action == 'draw_equation') {
    final text = (p['text'] ?? p['latex'] ?? '').toString().trim();
    if (text.isEmpty) return;
    items.add(
      _BoardItem.text(
        id: id,
        text: text,
        x: _num(p['x']).toDouble(),
        y: _num(p['y']).toDouble(),
        color: _color(p['color'], const Color(0xFF1E3A8A)),
        size: _num(p['size'], 28).toDouble(),
      ),
    );
    return;
  }
  if (action == 'draw_line' || action == 'underline') {
    items.add(
      _BoardItem.line(
        id: id,
        x1: _num(p['x1']).toDouble(),
        y1: _num(p['y1']).toDouble(),
        x2: _num(p['x2']).toDouble(),
        y2: _num(p['y2']).toDouble(),
        color: _color(p['color']),
        width: _num(p['width'], 3).toDouble(),
        arrow: false,
      ),
    );
    return;
  }
  if (action == 'draw_arrow') {
    items.add(
      _BoardItem.line(
        id: id,
        x1: _num(p['x1']).toDouble(),
        y1: _num(p['y1']).toDouble(),
        x2: _num(p['x2']).toDouble(),
        y2: _num(p['y2']).toDouble(),
        color: _color(p['color'], const Color(0xFFCA8A04)),
        width: _num(p['width'], 3).toDouble(),
        arrow: true,
      ),
    );
    return;
  }
  if (action == 'draw_circle' || action == 'circle') {
    if (p['cx'] != null || p['r'] != null) {
      items.add(
        _BoardItem.circle(
          id: id,
          cx: _num(p['cx'], 200).toDouble(),
          cy: _num(p['cy'], 200).toDouble(),
          r: _num(p['r'], 40).toDouble(),
          color: _color(p['color'], const Color(0xFFDC2626)),
          width: _num(p['width'], 3).toDouble(),
        ),
      );
    }
    return;
  }
  if (action == 'draw_rectangle' || action == 'draw_rect') {
    final x1 = _num(p['x1'] ?? p['x']).toDouble();
    final y1 = _num(p['y1'] ?? p['y']).toDouble();
    final x2 = _num(p['x2'], x1 + 120).toDouble();
    final y2 = _num(p['y2'], y1 + 80).toDouble();
    items.add(
      _BoardItem.rect(
        id: id,
        x: math.min(x1, x2),
        y: math.min(y1, y2),
        w: (x2 - x1).abs().clamp(8, 2000),
        h: (y2 - y1).abs().clamp(8, 2000),
        color: _color(p['color'], const Color(0xFF92400E)),
        width: _num(p['width'], 3).toDouble(),
      ),
    );
    return;
  }
  if (action == 'highlight') {
    final x1 = _num(p['x1']).toDouble();
    final y1 = _num(p['y1']).toDouble();
    final x2 = _num(p['x2'], x1 + 120).toDouble();
    final y2 = _num(p['y2'], y1 + 40).toDouble();
    items.add(
      _BoardItem.highlight(
        id: id,
        x: math.min(x1, x2),
        y: math.min(y1, y2),
        w: (x2 - x1).abs().clamp(8, 2000),
        h: (y2 - y1).abs().clamp(8, 2000),
        color: _color(p['color'], const Color(0xFFFDE047)),
      ),
    );
  }
}

class _BoardItem {
  _BoardItem.text({
    required this.id,
    required this.text,
    required this.x,
    required this.y,
    required this.color,
    required this.size,
  }) : kind = _Kind.text;

  _BoardItem.line({
    required this.id,
    required this.x1,
    required this.y1,
    required this.x2,
    required this.y2,
    required this.color,
    required this.width,
    required this.arrow,
  }) : kind = _Kind.line;

  _BoardItem.circle({
    required this.id,
    required this.cx,
    required this.cy,
    required this.r,
    required this.color,
    required this.width,
  }) : kind = _Kind.circle;

  _BoardItem.rect({
    required this.id,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.color,
    required this.width,
  }) : kind = _Kind.rect;

  _BoardItem.highlight({
    required this.id,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.color,
  }) : kind = _Kind.highlight,
       width = 0;

  final String id;
  final _Kind kind;
  String text = '';
  double x = 0, y = 0, w = 0, h = 0;
  double x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  double cx = 0, cy = 0, r = 0;
  double size = 28;
  double width = 3;
  bool arrow = false;
  Color color = const Color(0xFF1E293B);
}

enum _Kind { text, line, circle, rect, highlight }

class _ClassroomBoardPainter extends CustomPainter {
  _ClassroomBoardPainter({required this.items});

  final List<_BoardItem> items;

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / _AiTeacherClassroomState._boardW;
    final sy = size.height / _AiTeacherClassroomState._boardH;
    canvas.scale(sx, sy);

    final grid = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..strokeWidth = 1;
    for (var i = 1; i < 19; i++) {
      canvas.drawLine(
        Offset(i * 100.0, 0),
        Offset(i * 100.0, _AiTeacherClassroomState._boardH),
        grid,
      );
    }
    for (var i = 1; i < 10; i++) {
      canvas.drawLine(
        Offset(0, i * 100.0),
        Offset(_AiTeacherClassroomState._boardW, i * 100.0),
        grid,
      );
    }

    for (final item in items) {
      switch (item.kind) {
        case _Kind.highlight:
          canvas.drawRect(
            Rect.fromLTWH(item.x, item.y, item.w, item.h),
            Paint()..color = item.color.withValues(alpha: 0.45),
          );
        case _Kind.text:
          final tp = TextPainter(
            text: TextSpan(
              text: item.text,
              style: TextStyle(
                color: item.color,
                fontSize: item.size,
                fontWeight: FontWeight.w600,
              ),
            ),
            textDirection: TextDirection.rtl,
          )..layout(maxWidth: 1600);
          tp.paint(canvas, Offset(item.x, item.y - item.size));
        case _Kind.circle:
          canvas.drawCircle(
            Offset(item.cx, item.cy),
            item.r,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = item.width
              ..color = item.color,
          );
        case _Kind.rect:
          canvas.drawRect(
            Rect.fromLTWH(item.x, item.y, item.w, item.h),
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = item.width
              ..color = item.color,
          );
        case _Kind.line:
          final paint = Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = item.width
            ..strokeCap = StrokeCap.round
            ..color = item.color;
          canvas.drawLine(Offset(item.x1, item.y1), Offset(item.x2, item.y2), paint);
          if (item.arrow) {
            final angle = math.atan2(item.y2 - item.y1, item.x2 - item.x1);
            const size = 16.0;
            final path = Path()
              ..moveTo(item.x2, item.y2)
              ..lineTo(
                item.x2 - size * math.cos(angle - 0.4),
                item.y2 - size * math.sin(angle - 0.4),
              )
              ..lineTo(
                item.x2 - size * math.cos(angle + 0.4),
                item.y2 - size * math.sin(angle + 0.4),
              )
              ..close();
            canvas.drawPath(path, Paint()..color = item.color);
          }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _ClassroomBoardPainter oldDelegate) => true;
}
