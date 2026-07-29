import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:just_audio/just_audio.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';

/// Live AI Teacher classroom: animated board + captions + voice + interrupt/resume.
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
  final _tts = FlutterTts();
  final _audio = AudioPlayer();
  var _ttsReady = false;
  var _clockMs = 0.0;
  Timer? _paintTimer;

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
  String get _lang {
    final raw = (widget.lesson['language']?.toString() ?? 'en').toLowerCase();
    if (raw.startsWith('ar') || raw.startsWith('ku')) return 'ar';
    if (raw.startsWith('tr')) return 'tr';
    return 'en';
  }

  bool get _rtl => _lang == 'ar';

  @override
  void initState() {
    super.initState();
    _initTts();
    _paintTimer = Timer.periodic(const Duration(milliseconds: 33), (_) {
      if (!mounted || _phase != _Phase.teaching) return;
      setState(() {
        _clockMs = DateTime.now().millisecondsSinceEpoch.toDouble();
      });
    });
  }

  Future<void> _initTts() async {
    try {
      await _tts.setSpeechRate(0.48);
      await _tts.setVolume(1.0);
      await _tts.setPitch(1.0);
      await _tts.awaitSpeakCompletion(true);
      final code = _lang == 'ar'
          ? 'ar-SA'
          : _lang == 'tr'
              ? 'tr-TR'
              : 'en-US';
      await _tts.setLanguage(code);
      _ttsReady = true;
    } catch (_) {
      _ttsReady = false;
    }
  }

  @override
  void dispose() {
    _cancelled = true;
    _runId++;
    _paintTimer?.cancel();
    unawaited(_tts.stop());
    unawaited(_audio.stop());
    unawaited(_audio.dispose());
    _askCtrl.dispose();
    super.dispose();
  }

  Future<void> _speak(String text) async {
    if (!_modeVoice) return;
    final clean = _cleanBoardText(text) ?? text.trim();
    if (clean.isEmpty) return;
    try {
      await _tts.stop();
      await _audio.stop();
    } catch (_) {}

    final cloudOk = await _speakCloud(clean);
    if (cloudOk) return;

    if (!_ttsReady) return;
    try {
      await _tts.setLanguage(
        _lang == 'ar' ? 'ar-SA' : _lang == 'tr' ? 'tr-TR' : 'en-US',
      );
      await _tts.speak(clean);
    } catch (_) {
      /* captions still work */
    }
  }

  Future<bool> _speakCloud(String text) async {
    if (!mounted) return false;
    try {
      final api = context.read<ApiClient>();
      final data = await api.post('/api/ai/tts', {
        'text': text,
        'language': _lang,
      });
      final b64 = data['dataBase64']?.toString();
      final mime = data['mimeType']?.toString() ?? 'audio/mpeg';
      if (b64 == null || b64.isEmpty) return false;
      final bytes = Uint8List.fromList(base64Decode(b64));
      await _audio.setAudioSource(
        AudioSource.uri(Uri.dataFromBytes(bytes, mimeType: mime)),
      );
      await _audio.play();
      await _audio.playerStateStream.firstWhere(
        (s) => s.processingState == ProcessingState.completed,
      );
      return true;
    } catch (_) {
      return false;
    }
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
    final born = DateTime.now().millisecondsSinceEpoch.toDouble();
    for (var i = 0; i < next; i++) {
      _applyCue(rebuilt, board[i], i, born + i * 55, _rtl);
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
      final text = _cleanBoardText(cue['text']) ?? cue['text']?.toString() ?? '';
      if (text.isEmpty) continue;
      final tMs = _num(cue['time']);
      final nextTime = i + 1 < speech.length
          ? _num(speech[i + 1]['time'])
          : tMs + _estimateMs(text);

      if (mounted) {
        setState(() {
          _speechIndex = i;
          _caption = text;
        });
      }
      _applyBoardUntil(tMs + 200);

      final speakFuture = _speak(text);
      final duration = _estimateMs(text);
      final start = DateTime.now();
      while (DateTime.now().difference(start).inMilliseconds < duration + 800) {
        if (runId != _runId || _cancelled) {
          await _tts.stop();
          await _audio.stop();
          return;
        }
        await _waitWhilePaused();
        if (_paused) continue;
        final elapsed = DateTime.now().difference(start).inMilliseconds;
        final span = math.max(900, (nextTime - tMs).toInt());
        _applyBoardUntil(tMs + math.min(span, elapsed + 400));
        await Future<void>.delayed(const Duration(milliseconds: 50));
        if (!_modeVoice) {
          if (elapsed >= math.min(span, duration)) break;
        }
      }
      await speakFuture;
      _applyBoardUntil(nextTime);
    }

    if (runId != _runId || _cancelled) return;
    _applyBoardUntil(double.infinity);
    if (!mounted) return;
    final done = context.l10n.t('mobile.ai.aiTeacherCompleted');
    setState(() {
      _phase = _Phase.completed;
      _caption = done;
    });
    await _speak(done);
  }

  void _pause() {
    _paused = true;
    unawaited(_tts.stop());
    unawaited(_audio.stop());
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
      var reply = context.l10n.t('mobile.ai.aiTeacherCompleted');
      if (widget.onAskTeacher != null) {
        reply = await widget.onAskTeacher!(q, _speechIndex);
      }
      if (!mounted) return;
      setState(() {
        _teacherReply = reply;
        _askCtrl.clear();
        _phase = _Phase.paused;
      });
      await _speak(reply);
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }


  String _phaseLabel(dynamic l10n) {
    switch (_phase) {
      case _Phase.teaching:
        return l10n.t('mobile.ai.aiTeacherPhaseTeaching');
      case _Phase.paused:
        return l10n.t('mobile.ai.aiTeacherPhasePaused');
      case _Phase.answering:
        return l10n.t('mobile.ai.aiTeacherPhaseAnswering');
      case _Phase.completed:
        return l10n.t('mobile.ai.aiTeacherPhaseCompleted');
      case _Phase.idle:
        return l10n.t('mobile.ai.aiTeacherPhaseReady');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final summary = (widget.lesson['summary'] as List?) ?? const [];
    final quiz = (widget.lesson['quiz'] as List?) ?? const [];
    final progress = _speech.isEmpty
        ? 0.0
        : (math.min(_speechIndex + 1, _speech.length) / _speech.length);

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0B1220), Color(0xFF111827), Color(0xFF0A1628)],
        ),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: 40,
            offset: const Offset(0, 18),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'U Learn · ${l10n.t('mobile.ai.aiTeacherClassroom')}',
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.2,
                          color: Color(0xFF7DD3FC),
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.06),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                      ),
                      child: Text(
                        _phaseLabel(l10n),
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  _title,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    height: 1.2,
                  ),
                ),
                if (_objective.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    '${l10n.t('mobile.ai.aiTeacherObjective')}: $_objective',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.white.withValues(alpha: 0.62),
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                Row(
                  children: [
                    Text(
                      l10n.t('mobile.ai.aiTeacherProgress'),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: Colors.white.withValues(alpha: 0.5),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      _speech.isEmpty
                          ? '0/0'
                          : '${math.min(_speechIndex + 1, _speech.length)}/${_speech.length}',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: Colors.white.withValues(alpha: 0.55),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: progress,
                    minHeight: 6,
                    backgroundColor: Colors.white.withValues(alpha: 0.1),
                    valueColor: const AlwaysStoppedAnimation(Color(0xFF38BDF8)),
                  ),
                ),
              ],
            ),
          ),
          AspectRatio(
            aspectRatio: 16 / 10,
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: const Color(0xFFF7FAFC),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.28),
                    blurRadius: 24,
                    offset: const Offset(0, 12),
                  ),
                ],
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  CustomPaint(
                    painter: _ClassroomBoardPainter(
                      items: List.of(_items),
                      clockMs: _clockMs,
                      rtl: _rtl,
                    ),
                    child: const SizedBox.expand(),
                  ),
                  if (_phase == _Phase.idle)
                    Material(
                      color: Colors.black.withValues(alpha: 0.42),
                      child: InkWell(
                        onTap: () => _runLesson(0),
                        child: Center(
                          child: Container(
                            margin: const EdgeInsets.all(20),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 24,
                              vertical: 22,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFF0B1220).withValues(alpha: 0.94),
                              borderRadius: BorderRadius.circular(28),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.14),
                              ),
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Container(
                                  width: 68,
                                  height: 68,
                                  decoration: const BoxDecoration(
                                    gradient: LinearGradient(
                                      colors: [Color(0xFF38BDF8), Color(0xFF34D399)],
                                    ),
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(
                                    Icons.play_arrow_rounded,
                                    size: 38,
                                    color: Color(0xFF0B1220),
                                  ),
                                ),
                                const SizedBox(height: 14),
                                Text(
                                  l10n.t('mobile.ai.aiTeacherTapToBegin'),
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 17,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  l10n.t('mobile.ai.aiTeacherTapHint'),
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.7),
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  l10n.t('mobile.ai.aiTeacherInterruptHint'),
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.45),
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  if (_phase == _Phase.answering)
                    Container(
                      color: Colors.black.withValues(alpha: 0.28),
                      alignment: Alignment.center,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0B1220).withValues(alpha: 0.92),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: Colors.white24),
                        ),
                        child: Text(
                          l10n.t('mobile.ai.aiTeacherReply'),
                          style: const TextStyle(
                            color: Color(0xFFBAE6FD),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Container(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        _modeVoice
                            ? l10n.t('mobile.ai.aiTeacherVoice')
                            : l10n.t('mobile.ai.aiTeacherText'),
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.1,
                          color: Color(0xFF7DD3FC),
                        ),
                      ),
                      if (_modeVoice) ...[
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF10B981).withValues(alpha: 0.16),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            l10n.t('mobile.ai.aiTeacherLiveVoice'),
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF6EE7B7),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _caption.isEmpty ? '…' : _caption,
                    style: const TextStyle(
                      fontSize: 15,
                      height: 1.4,
                      color: Colors.white,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
              ),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
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
                      _teacherReply != null
                          ? l10n.t('mobile.ai.aiTeacherContinue')
                          : l10n.t('mobile.ai.aiTeacherResume'),
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
          ),
          if (_askOpen)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      const Color(0xFFFBBF24).withValues(alpha: 0.12),
                      const Color(0xFF0B1220).withValues(alpha: 0.9),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(
                    color: const Color(0xFFFBBF24).withValues(alpha: 0.28),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            l10n.t('mobile.ai.aiTeacherAsk'),
                            style: const TextStyle(
                              color: Color(0xFFFEF3C7),
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: () => setState(() => _askOpen = false),
                          child: Text(l10n.t('mobile.ai.aiTeacherClose')),
                        ),
                      ],
                    ),
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
                        fillColor: Colors.black.withValues(alpha: 0.28),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                          borderSide: BorderSide(
                            color: Colors.white.withValues(alpha: 0.12),
                          ),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                          borderSide: BorderSide(
                            color: Colors.white.withValues(alpha: 0.12),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF38BDF8),
                          foregroundColor: const Color(0xFF0B1220),
                        ),
                        onPressed: _asking ? null : _submitAsk,
                        child: Text(
                          _asking ? '…' : l10n.t('mobile.ai.aiTeacherSend'),
                        ),
                      ),
                    ),
                    if (_teacherReply != null) ...[
                      const SizedBox(height: 10),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF38BDF8).withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: const Color(0xFF38BDF8).withValues(alpha: 0.25),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              l10n.t('mobile.ai.aiTeacherReply'),
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: Color(0xFF7DD3FC),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              _teacherReply!,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                height: 1.35,
                              ),
                            ),
                            TextButton(
                              onPressed: _resume,
                              child: Text(l10n.t('mobile.ai.aiTeacherContinue')),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          if (_phase == _Phase.completed && summary.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.04),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.t('mobile.ai.aiTeacherSummary'),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: Colors.white.withValues(alpha: 0.7),
                      ),
                    ),
                    const SizedBox(height: 6),
                    ...summary.map(
                      (s) => Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(
                          '• ${s.toString()}',
                          style: const TextStyle(color: Colors.white, fontSize: 13),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (_phase == _Phase.completed && quiz.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.04),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.t('mobile.ai.aiTeacherQuiz'),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
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
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.22),
                            borderRadius: BorderRadius.circular(14),
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
            ),
        ],
      ),
    );
  }

  Widget _chip({
    required bool selected,
    required String label,
    required VoidCallback onTap,
  }) {
    return Material(
      color: selected
          ? Colors.white.withValues(alpha: 0.16)
          : Colors.transparent,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : Colors.white70,
            ),
          ),
        ),
      ),
    );
  }

  Widget _actionChip(
    String label, {
    required VoidCallback onTap,
    bool filled = false,
    bool accent = false,
  }) {
    return Material(
      color: filled
          ? const Color(0xFF38BDF8)
          : accent
              ? const Color(0xFFFBBF24).withValues(alpha: 0.16)
              : Colors.white.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: filled ? const Color(0xFF0B1220) : Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}


enum _Phase { idle, teaching, paused, answering, completed }

String? _cleanBoardText(dynamic raw) {
  if (raw == null) return '';
  if (raw is Map) {
    for (final key in ['text', 'content', 'label', 'title', 'latex', 'value']) {
      final v = raw[key];
      if (v is String && v.trim().isNotEmpty) return _cleanBoardText(v);
    }
    return '';
  }
  var s = raw.toString().trim();
  if (s.isEmpty ||
      s == '[object Object]' ||
      s == 'null' ||
      s == 'undefined') {
    return '';
  }
  if ((s.startsWith('{') && s.endsWith('}')) ||
      (s.startsWith('[') && s.endsWith(']'))) {
    try {
      final textMatch = RegExp(r'"text"\s*:\s*"([^"]+)"').firstMatch(s);
      if (textMatch != null) return _cleanBoardText(textMatch.group(1));
    } catch (_) {}
    return '';
  }
  if (RegExp(
    r'''^["']?(text|x|y|color|size|action|parameters)''',
    caseSensitive: false,
  ).hasMatch(s)) {
    return '';
  }
  if (s.contains('"x":') && s.contains('"y":')) return '';
  if (s.contains('"parameters"') || s.contains('"action"')) return '';
  if (s.length > 180) s = s.substring(0, 180);
  return s;
}

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

double _handJitter(int seed, int i, [double amp = 4.5]) {
  final x = math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return (x - x.floor()) * 2 * amp - amp;
}

int _writeMsForText(String text) {
  final n = text.length;
  return math.max(700, math.min(4800, n * 48));
}

void _applyCue(
  List<_BoardItem> items,
  Map<String, dynamic> cue,
  int idx,
  double bornAt,
  bool rtl,
) {
  final p = cue['parameters'] is Map
      ? Map<String, dynamic>.from(cue['parameters'] as Map)
      : <String, dynamic>{};
  final action =
      (cue['action']?.toString() ?? '').toLowerCase().replaceAll(' ', '_');
  final id = '${cue['time']}-$action-$idx';
  final seed = idx * 97 + _num(cue['time']).toInt();

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
    final text = _cleanBoardText(p['text'] ?? p['latex'] ?? p['content'] ?? p['title']);
    if (text == null || text.isEmpty) return;
    final defaultX = rtl ? 1780.0 : 120.0;
    final alignRight = rtl || p['align']?.toString() == 'right';
    items.add(
      _BoardItem.text(
        id: id,
        text: text,
        x: _num(p['x'], defaultX).toDouble(),
        y: _num(p['y'], 120).toDouble() + _handJitter(seed, 3, 2.2),
        color: _color(p['color'], const Color(0xFF1E3A8A)),
        size: _num(p['size'], 28).toDouble().clamp(18, 56),
        bornAt: bornAt,
        writeMs: _writeMsForText(text).toDouble(),
        seed: seed,
        alignRight: alignRight,
      ),
    );
    return;
  }
  if (action == 'draw_line' || action == 'underline') {
    items.add(
      _BoardItem.line(
        id: id,
        x1: _num(p['x1']).toDouble() + _handJitter(seed, 1, 2),
        y1: _num(p['y1']).toDouble() + _handJitter(seed, 2, 2),
        x2: _num(p['x2']).toDouble() + _handJitter(seed, 3, 2),
        y2: _num(p['y2']).toDouble() + _handJitter(seed, 4, 2),
        color: _color(p['color']),
        width: _num(p['width'], 3.2).toDouble(),
        arrow: false,
        bornAt: bornAt,
        writeMs: 900,
        seed: seed,
      ),
    );
    return;
  }
  if (action == 'draw_arrow') {
    items.add(
      _BoardItem.line(
        id: id,
        x1: _num(p['x1']).toDouble() + _handJitter(seed, 1, 2),
        y1: _num(p['y1']).toDouble() + _handJitter(seed, 2, 2),
        x2: _num(p['x2']).toDouble() + _handJitter(seed, 3, 2),
        y2: _num(p['y2']).toDouble() + _handJitter(seed, 4, 2),
        color: _color(p['color'], const Color(0xFFCA8A04)),
        width: _num(p['width'], 3.2).toDouble(),
        arrow: true,
        bornAt: bornAt,
        writeMs: 1100,
        seed: seed,
      ),
    );
    return;
  }
  if (action == 'draw_circle' || action == 'circle') {
    if (p['cx'] != null || p['r'] != null) {
      items.add(
        _BoardItem.circle(
          id: id,
          cx: _num(p['cx'], 200).toDouble() + _handJitter(seed, 1, 3),
          cy: _num(p['cy'], 200).toDouble() + _handJitter(seed, 2, 3),
          r: _num(p['r'], 40).toDouble(),
          color: _color(p['color'], const Color(0xFFDC2626)),
          width: _num(p['width'], 3.2).toDouble(),
          bornAt: bornAt,
          writeMs: 1300,
          seed: seed,
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
        x: math.min(x1, x2) + _handJitter(seed, 1, 2),
        y: math.min(y1, y2) + _handJitter(seed, 2, 2),
        w: (x2 - x1).abs().clamp(8, 2000),
        h: (y2 - y1).abs().clamp(8, 2000),
        color: _color(p['color'], const Color(0xFF92400E)),
        width: _num(p['width'], 3.2).toDouble(),
        bornAt: bornAt,
        writeMs: 1200,
        seed: seed,
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
        bornAt: bornAt,
        writeMs: 420,
        seed: seed,
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
    required this.bornAt,
    required this.writeMs,
    required this.seed,
    required this.alignRight,
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
    required this.bornAt,
    required this.writeMs,
    required this.seed,
  }) : kind = _Kind.line;

  _BoardItem.circle({
    required this.id,
    required this.cx,
    required this.cy,
    required this.r,
    required this.color,
    required this.width,
    required this.bornAt,
    required this.writeMs,
    required this.seed,
  }) : kind = _Kind.circle;

  _BoardItem.rect({
    required this.id,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.color,
    required this.width,
    required this.bornAt,
    required this.writeMs,
    required this.seed,
  }) : kind = _Kind.rect;

  _BoardItem.highlight({
    required this.id,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.color,
    required this.bornAt,
    required this.writeMs,
    required this.seed,
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
  bool alignRight = false;
  double bornAt = 0;
  double writeMs = 600;
  int seed = 1;
  Color color = const Color(0xFF1E293B);

  double progress(double clockMs) {
    final p = (clockMs - bornAt) / math.max(1, writeMs);
    return p.clamp(0.0, 1.0);
  }
}

enum _Kind { text, line, circle, rect, highlight }

class _ClassroomBoardPainter extends CustomPainter {
  _ClassroomBoardPainter({
    required this.items,
    required this.clockMs,
    required this.rtl,
  });

  final List<_BoardItem> items;
  final double clockMs;
  final bool rtl;

  double _ease(double t) => 1 - math.pow(1 - t, 2.4).toDouble();

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
      final p = _ease(item.progress(clockMs <= 0 ? item.bornAt + item.writeMs : clockMs));
      if (p <= 0) continue;
      switch (item.kind) {
        case _Kind.highlight:
          canvas.drawRect(
            Rect.fromLTWH(item.x, item.y, item.w * p, item.h),
            Paint()..color = item.color.withValues(alpha: 0.35 * p),
          );
        case _Kind.text:
          final chars = math.max(1, (item.text.length * p).floor());
          final shown = item.text.substring(0, chars);
          final dir = item.alignRight || rtl
              ? TextDirection.rtl
              : TextDirection.ltr;
          final tp = TextPainter(
            text: TextSpan(
              text: shown,
              style: TextStyle(
                color: item.color.withValues(alpha: 0.4 + 0.6 * p),
                fontSize: item.size,
                fontWeight: FontWeight.w600,
              ),
            ),
            textDirection: dir,
            textAlign: dir == TextDirection.rtl ? TextAlign.right : TextAlign.left,
          )..layout(maxWidth: 1600);
          final paintX = dir == TextDirection.rtl ? item.x - tp.width : item.x;
          tp.paint(canvas, Offset(paintX, item.y - item.size));
        case _Kind.circle:
          final paint = Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = item.width
            ..strokeCap = StrokeCap.round
            ..color = item.color;
          final rect = Rect.fromCircle(center: Offset(item.cx, item.cy), radius: item.r);
          canvas.drawArc(rect, -math.pi / 2, 2 * math.pi * p, false, paint);
        case _Kind.rect:
          final peri = 2 * (item.w + item.h);
          final path = Path()
            ..addRect(Rect.fromLTWH(item.x, item.y, item.w, item.h));
          for (final metric in path.computeMetrics()) {
            final extract = metric.extractPath(0, metric.length * p);
            canvas.drawPath(
              extract,
              Paint()
                ..style = PaintingStyle.stroke
                ..strokeWidth = item.width
                ..strokeCap = StrokeCap.round
                ..strokeJoin = StrokeJoin.round
                ..color = item.color,
            );
          }
          // silence unused
          assert(peri >= 0);
        case _Kind.line:
          final x2 = item.x1 + (item.x2 - item.x1) * p;
          final y2 = item.y1 + (item.y2 - item.y1) * p;
          final mx = (item.x1 + x2) / 2 + _handJitter(item.seed, 1, 10);
          final my = (item.y1 + y2) / 2 + _handJitter(item.seed, 2, 10);
          final path = Path()
            ..moveTo(item.x1, item.y1)
            ..quadraticBezierTo(mx, my, x2, y2);
          final paint = Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = item.width
            ..strokeCap = StrokeCap.round
            ..color = item.color;
          canvas.drawPath(path, paint);
          if (item.arrow && p > 0.85) {
            final angle = math.atan2(y2 - item.y1, x2 - item.x1);
            const size = 16.0;
            final head = Path()
              ..moveTo(x2, y2)
              ..lineTo(
                x2 - size * math.cos(angle - 0.4),
                y2 - size * math.sin(angle - 0.4),
              )
              ..lineTo(
                x2 - size * math.cos(angle + 0.4),
                y2 - size * math.sin(angle + 0.4),
              )
              ..close();
            canvas.drawPath(
              head,
              Paint()
                ..color = item.color.withValues(alpha: ((p - 0.85) / 0.15).clamp(0.0, 1.0)),
            );
          }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _ClassroomBoardPainter oldDelegate) =>
      oldDelegate.clockMs != clockMs ||
      oldDelegate.rtl != rtl ||
      oldDelegate.items != items;
}
