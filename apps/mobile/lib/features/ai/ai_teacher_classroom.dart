import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'dart:io';
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
  /// Returns `{answer: String, board: List<Map>?}` for smart board replies.
  final Future<Map<String, dynamic>> Function(String question, int pausedIndex)?
      onAskTeacher;

  @override
  State<AiTeacherClassroom> createState() => _AiTeacherClassroomState();
}

class _AiTeacherClassroomState extends State<AiTeacherClassroom>
    with TickerProviderStateMixin {
  static const _boardW = 1920.0;
  static const _boardH = 1080.0;

  var _phase = _Phase.idle;
  var _speechIndex = 0;
  var _caption = '';
  var _asking = false;
  var _listeningAsk = false;
  String? _teacherReply;
  final _quizReveal = <int, bool>{};

  final _items = <_BoardItem>[];
  var _boardApplied = 0;
  var _paused = false;
  var _cancelled = false;
  var _runId = 0;
  final _audio = AudioPlayer();
  final _speechStt = stt.SpeechToText();
  var _clockMs = 0.0;
  Timer? _paintTimer;
  late final AnimationController _micPulse;
  var _soundLevel = 0.0;
  String? _ttsError;
  var _voiceBusy = false;
  var _handsFree = true;
  var _handlingInterrupt = false;
  final _hzBars = List<double>.filled(18, 0.12);
  Timer? _hzTimer;
  String? _speechLocale;
  String? _selectedLanguage;

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

  String get _title {
    final raw = widget.lesson['lesson_title']?.toString() ?? 'Lesson';
    return _cleanBoardText(raw) ?? raw;
  }
  String get _lang {
    final raw = (widget.lesson['language']?.toString() ?? 'en').toLowerCase();
    if (raw.startsWith('ar') || raw.startsWith('ku')) return 'ar';
    if (raw.startsWith('tr')) return 'tr';
    return 'en';
  }

  String get _ttsLanguage {
    final selected = (_selectedLanguage ?? context.localeCode).toLowerCase();
    if (selected.startsWith('ku')) return 'ku';
    if (selected.startsWith('ar')) return 'ar';
    if (selected.startsWith('tr')) return 'tr';
    return _lang;
  }

  String get _sttLocaleId {
    final tag = (_speechLocale ?? '').replaceAll('-', '_');
    if (tag.length >= 2) return tag;
    if (_lang == 'ar') return 'ar_SA';
    if (_lang == 'tr') return 'tr_TR';
    return 'en_US';
  }

  bool get _rtl => _lang == 'ar';

  @override
  void initState() {
    super.initState();
    _micPulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _paintTimer = Timer.periodic(const Duration(milliseconds: 33), (_) {
      if (!mounted) return;
      if (_phase == _Phase.teaching || _items.any((i) => i.progress(_clockMs) < 1)) {
        setState(() {
          _clockMs = DateTime.now().millisecondsSinceEpoch.toDouble();
        });
      }
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_loadVoiceProfile());
    });
  }

  Future<void> _loadVoiceProfile() async {
    if (!mounted) return;
    try {
      final api = context.read<ApiClient>();
      final locale = context.localeCode.toLowerCase();
      _selectedLanguage = locale;
      final data = await api.get(
        '/api/ai/voice-profile?language=${Uri.encodeQueryComponent(locale)}',
      );
      final nested = data['data'];
      final nestedMap = nested is Map ? Map<String, dynamic>.from(nested) : null;
      final speechLocale =
          (data['speechLocale'] ?? nestedMap?['speechLocale'])?.toString();
      if (!mounted || speechLocale == null || speechLocale.isEmpty) return;
      setState(() => _speechLocale = speechLocale);
    } catch (_) {
      /* TTS route still resolves country server-side */
    }
  }

  @override
  void dispose() {
    _cancelled = true;
    _runId++;
    _paintTimer?.cancel();
    _hzTimer?.cancel();
    _micPulse.dispose();
    unawaited(_speechStt.stop());
    unawaited(_audio.stop());
    unawaited(_audio.dispose());
    super.dispose();
  }

  Future<void> _speak(String text) async {
    final clean = _cleanBoardText(text) ?? text.trim();
    if (clean.isEmpty) return;
    _voiceBusy = true;
    try {
      try {
        await _audio.stop();
      } catch (_) {}
      final ok = await _speakCloud(clean);
      if (!ok && mounted) {
        setState(() => _ttsError = 'voice');
      } else if (mounted && _ttsError != null) {
        setState(() => _ttsError = null);
      }
    } finally {
      _voiceBusy = false;
    }
  }

  Future<bool> _speakCloud(String text) async {
    if (!mounted) return false;
    File? tmp;
    try {
      final api = context.read<ApiClient>();
      final data = await api.post('/api/ai/tts', {
        'text': text,
        'language': _ttsLanguage,
      });
      final nested = data['data'];
      final nestedMap = nested is Map ? Map<String, dynamic>.from(nested) : null;
      final speechLocale =
          (data['speechLocale'] ?? nestedMap?['speechLocale'])?.toString();
      if (speechLocale != null &&
          speechLocale.isNotEmpty &&
          speechLocale != _speechLocale) {
        _speechLocale = speechLocale;
      }
      final b64 =
          (data['dataBase64'] ?? nestedMap?['dataBase64'])?.toString();
      final mime =
          (data['mimeType'] ?? nestedMap?['mimeType'])?.toString() ??
              'audio/mpeg';
      if (b64 == null || b64.isEmpty) return false;
      final bytes = Uint8List.fromList(base64Decode(b64));
      // iOS/Android: data-URI sources are unreliable for large MP3 — use a temp file.
      final dir = await getTemporaryDirectory();
      final ext = mime.contains('wav') ? 'wav' : 'mp3';
      tmp = File('${dir.path}/ulearn_tts_${DateTime.now().microsecondsSinceEpoch}.$ext');
      await tmp.writeAsBytes(bytes, flush: true);
      await _audio.setVolume(1.0);
      await _audio.setFilePath(tmp.path);
      await _audio.play();
      // Wait until playback really finishes (not idle-before-play).
      await _audio.processingStateStream.firstWhere(
        (s) => s == ProcessingState.completed,
      );
      return true;
    } catch (_) {
      return false;
    } finally {
      try {
        await tmp?.delete();
      } catch (_) {}
    }
  }

  void _updateHzFromLevel(double level) {
    final t = DateTime.now().millisecondsSinceEpoch / 120.0;
    for (var i = 0; i < _hzBars.length; i++) {
      final wave = (math.sin(t + i * 0.55) * 0.5 + 0.5);
      _hzBars[i] = (0.1 + level * (0.35 + wave * 0.65)).clamp(0.08, 1.0);
    }
  }

  Future<void> _startAlwaysListen() async {
    if (!_handsFree || _handlingInterrupt || _asking || _voiceBusy) return;
    if (_phase != _Phase.teaching &&
        _phase != _Phase.paused &&
        _phase != _Phase.answering) {
      return;
    }
    final available = await _speechStt.initialize(
      onError: (_) {
        if (!mounted) return;
        _hzTimer?.cancel();
        Future<void>.delayed(const Duration(milliseconds: 800), _startAlwaysListen);
      },
      onStatus: (status) {
        if (!mounted) return;
        if (status == 'done' || status == 'notListening') {
          if (_handsFree && !_handlingInterrupt && !_asking) {
            Future<void>.delayed(const Duration(milliseconds: 350), _startAlwaysListen);
          }
        }
      },
    );
    if (!available || !mounted) return;
    setState(() {
      _listeningAsk = true;
    });
    if (!_micPulse.isAnimating) {
      unawaited(_micPulse.repeat(reverse: true));
    }
    _hzTimer?.cancel();
    _hzTimer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      if (!mounted) return;
      setState(() => _updateHzFromLevel(_soundLevel));
    });
    await _speechStt.listen(
      onSoundLevelChange: (level) {
        if (!mounted) return;
        final n = (level.clamp(-50, 10) + 50) / 60.0;
        setState(() {
          _soundLevel = n.clamp(0.0, 1.0);
          _updateHzFromLevel(_soundLevel);
        });
        // Barge-in: student talking while teacher explains
        if (_phase == _Phase.teaching && _soundLevel > 0.35 && !_handlingInterrupt) {
          _pause();
          setState(() => _phase = _Phase.answering);
        }
      },
      onResult: (result) async {
        final words = result.recognizedWords.trim();
        if (words.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length < 2) {
          return;
        }
        if (!result.finalResult) {
          if (_phase == _Phase.teaching) {
            _pause();
            if (mounted) setState(() => _phase = _Phase.answering);
          }
          return;
        }
        final q = (_cleanBoardText(words) ?? words).trim();
        await _speechStt.stop();
        if (!mounted || q.isEmpty) return;
        await _submitAsk(q);
      },
      listenOptions: stt.SpeechListenOptions(
        listenFor: const Duration(seconds: 30),
        pauseFor: const Duration(seconds: 2),
        partialResults: true,
        localeId: _sttLocaleId,
      ),
    );
  }

  Future<void> _listenAsk() async {
    _handsFree = true;
    await _startAlwaysListen();
  }

  Future<void> _waitWhilePaused() async {
    while (_paused && !_cancelled) {
      await Future<void>.delayed(const Duration(milliseconds: 120));
    }
  }

  void _applyBoardUntil(num untilMs) {
    final board = _whiteboard;
    var next = _boardApplied;
    if (next >= board.length) return;
    final now = DateTime.now().millisecondsSinceEpoch.toDouble();
    var penAt = now;
    for (final item in _items) {
      if (item.kind == _Kind.text) {
        penAt = math.max(penAt, item.bornAt + item.writeMs + 320);
      }
    }
    var added = false;
    while (next < board.length && _num(board[next]['time']) <= untilMs) {
      final cue = board[next];
      final action =
          (cue['action']?.toString() ?? '').toLowerCase().replaceAll(' ', '_');
      final isText = action == 'write_text' ||
          action == 'draw_formula' ||
          action == 'draw_equation';
      final start = isText ? penAt : now + (next - _boardApplied) * 50.0;
      final before = _items.length;
      // open_new_board / clear clears the list inside _applyCue
      _applyCue(_items, cue, next, start, _rtl);
      if (action == 'clear_board' || action == 'open_new_board') {
        penAt = DateTime.now().millisecondsSinceEpoch.toDouble();
      } else if (isText && _items.length > before) {
        final last = _items.last;
        penAt = last.bornAt + last.writeMs + 320;
      }
      next++;
      added = true;
    }
    if (!added) return;
    _boardApplied = next;
    if (mounted) {
      setState(() {
        _clockMs = DateTime.now().millisecondsSinceEpoch.toDouble();
      });
    }
  }

  Future<void> _waitBoardCatchUp() async {
    // Let handwriting / strokes finish so lines never cut off mid-word.
    for (var i = 0; i < 120; i++) {
      if (_cancelled) return;
      final now = DateTime.now().millisecondsSinceEpoch.toDouble();
      final pending = _items.any((it) => it.progress(now) < 0.995);
      if (!pending) return;
      if (mounted) setState(() => _clockMs = now);
      await Future<void>.delayed(const Duration(milliseconds: 40));
    }
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
      _handsFree = true;
    });
    unawaited(_startAlwaysListen());

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
      final text = _cleanBoardText(cue['text']) ?? '';
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
      // Reveal this beat's writing/drawing, then speak like a real teacher.
      _applyBoardUntil(tMs + 900);
      final speakFuture = _speak(text);
      final start = DateTime.now();
      final maxWait = _estimateMs(text) + 6000;
      while (DateTime.now().difference(start).inMilliseconds < maxWait) {
        if (runId != _runId || _cancelled) {
          await _audio.stop();
          return;
        }
        await _waitWhilePaused();
        if (_paused) continue;
        final elapsed = DateTime.now().difference(start).inMilliseconds;
        final span = math.max(1200, (nextTime - tMs).toInt());
        _applyBoardUntil(tMs + math.min(span, elapsed + 600));
        final playing = _voiceBusy || _audio.playing;
        if (!playing && elapsed > 1500) {
          // Speech finished (or failed) — finish remaining board for this beat.
          break;
        }
        await Future<void>.delayed(const Duration(milliseconds: 40));
      }
      await speakFuture;
      _applyBoardUntil(nextTime);
      await _waitBoardCatchUp();
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
    unawaited(_speechStt.stop());
    unawaited(_audio.stop());
    _micPulse.stop();
    _micPulse.value = 0;
    if (mounted) {
      setState(() {
        _phase = _Phase.paused;
        _listeningAsk = false;
        _soundLevel = 0;
      });
    }
  }

  void _resume() {
    _teacherReply = null;
    _paused = false;
    if (mounted) setState(() => _phase = _Phase.teaching);
    _runLesson(_speechIndex);
    unawaited(_startAlwaysListen());
  }

  Future<void> _submitAsk(String question) async {
    final q = (_cleanBoardText(question) ?? question).trim();
    if (q.isEmpty || _asking || _handlingInterrupt) return;
    _handlingInterrupt = true;
    _pause();
    setState(() {
      _asking = true;
      _phase = _Phase.answering;
      _listeningAsk = true;
    });
    try {
      var reply = context.l10n.t('mobile.ai.aiTeacherCompleted');
      List<dynamic> board = const [];
      if (widget.onAskTeacher != null) {
        final raw = await widget.onAskTeacher!(q, _speechIndex);
        reply = raw['answer']?.toString() ?? reply;
        final b = raw['board'];
        if (b is List) board = b;
      }
      if (!mounted) return;
      final cleanReply = _cleanBoardText(reply) ?? reply;
      _appendInterruptBoard(board);
      setState(() {
        _teacherReply = cleanReply;
        _caption = cleanReply;
        _phase = _Phase.paused;
      });
      await _speak(cleanReply);
      await _waitBoardCatchUp();
    } finally {
      _handlingInterrupt = false;
      if (mounted) {
        setState(() => _asking = false);
        // Auto-continue like a live teacher
        Future<void>.delayed(const Duration(milliseconds: 600), () {
          if (!mounted || _cancelled) return;
          _resume();
        });
      }
    }
  }

  void _appendInterruptBoard(List<dynamic> cues) {
    if (cues.isEmpty) return;
    final now = DateTime.now().millisecondsSinceEpoch.toDouble();
    var penAt = now;
    for (final item in _items) {
      if (item.kind == _Kind.text) {
        penAt = math.max(penAt, item.bornAt + item.writeMs + 200);
      }
    }
    for (var i = 0; i < cues.length && i < 5; i++) {
      final raw = cues[i];
      if (raw is! Map) continue;
      final cue = Map<String, dynamic>.from(raw);
      final action =
          (cue['action']?.toString() ?? '').toLowerCase().replaceAll(' ', '_');
      if (action.isEmpty ||
          action == 'open_new_board' ||
          action == 'clear_board') {
        continue;
      }
      final isText = action == 'write_text' ||
          action == 'draw_formula' ||
          action == 'draw_equation';
      final start = isText ? penAt : now + i * 80;
      final before = _items.length;
      _applyCue(_items, cue, _boardApplied + i + 1, start, _rtl);
      if (isText && _items.length > before) {
        final last = _items.last;
        penAt = last.bornAt + last.writeMs + 220;
      }
    }
    _boardApplied += cues.length;
    if (mounted) {
      setState(() {
        _clockMs = DateTime.now().millisecondsSinceEpoch.toDouble();
      });
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
    final caption = _caption.isEmpty
        ? '…'
        : (_cleanBoardText(_caption) ?? _caption);

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF070B14), Color(0xFF0F172A), Color(0xFF0A1628)],
        ),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.4),
            blurRadius: 40,
            offset: const Offset(0, 18),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'U Learn · ${l10n.t('mobile.ai.aiTeacherClassroom')}',
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.1,
                          color: Color(0xFF7DD3FC),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.07),
                    borderRadius: BorderRadius.circular(999),
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
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                minHeight: 4,
                value: progress.clamp(0.0, 1.0),
                backgroundColor: Colors.white.withValues(alpha: 0.08),
                valueColor: const AlwaysStoppedAnimation(Color(0xFF38BDF8)),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(18),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF38BDF8).withValues(alpha: 0.18),
                        blurRadius: 28,
                        offset: const Offset(0, 10),
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
                      Positioned(
                        left: 10,
                        right: 10,
                        bottom: 10,
                        child: AnimatedOpacity(
                          opacity: _phase == _Phase.idle ? 0 : 1,
                          duration: const Duration(milliseconds: 250),
                          child: Container(
                            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                            decoration: BoxDecoration(
                              color: const Color(0xFF0B1220).withValues(alpha: 0.82),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.12),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Row(
                                  children: [
                                    Container(
                                      width: 7,
                                      height: 7,
                                      decoration: const BoxDecoration(
                                        color: Color(0xFF34D399),
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      l10n.t('mobile.ai.aiTeacherLiveVoice'),
                                      style: const TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.w700,
                                        color: Color(0xFF6EE7B7),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  caption,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 14,
                                    height: 1.3,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                if (_teacherReply != null) ...[
                                  const SizedBox(height: 6),
                                  Text(
                                    _teacherReply!,
                                    maxLines: 3,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Color(0xFFBAE6FD),
                                      fontSize: 12,
                                      height: 1.3,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                      if (_phase == _Phase.idle)
                        Material(
                          color: Colors.black.withValues(alpha: 0.45),
                          child: InkWell(
                            onTap: () => _runLesson(0),
                            child: Center(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 78,
                                    height: 78,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      gradient: const LinearGradient(
                                        colors: [Color(0xFF38BDF8), Color(0xFF34D399)],
                                      ),
                                      boxShadow: [
                                        BoxShadow(
                                          color: const Color(0xFF38BDF8)
                                              .withValues(alpha: 0.45),
                                          blurRadius: 24,
                                        ),
                                      ],
                                    ),
                                    child: const Icon(
                                      Icons.play_arrow_rounded,
                                      size: 44,
                                      color: Color(0xFF0B1220),
                                    ),
                                  ),
                                  const SizedBox(height: 14),
                                  Text(
                                    l10n.t('mobile.ai.aiTeacherTapToBegin'),
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 17,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 28),
                                    child: Text(
                                      l10n.t('mobile.ai.aiTeacherInterruptHint'),
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: Colors.white.withValues(alpha: 0.65),
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      if (_listeningAsk || _phase == _Phase.answering)
                        Container(
                          color: Colors.black.withValues(alpha: 0.35),
                          alignment: Alignment.center,
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 88,
                                height: 88,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: _listeningAsk
                                      ? const Color(0xFFFBBF24)
                                      : const Color(0xFF38BDF8),
                                  boxShadow: [
                                    BoxShadow(
                                      color: (_listeningAsk
                                              ? const Color(0xFFFBBF24)
                                              : const Color(0xFF38BDF8))
                                          .withValues(alpha: 0.45),
                                      blurRadius: 28,
                                    ),
                                  ],
                                ),
                                child: Icon(
                                  _listeningAsk ? Icons.mic_rounded : Icons.auto_awesome,
                                  size: 40,
                                  color: const Color(0xFF0B1220),
                                ),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                _listeningAsk
                                    ? l10n.t('mobile.ai.aiTeacherListening')
                                    : l10n.t('mobile.ai.aiTeacherReply'),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 15,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
            child: Row(
              children: [
                if (_phase == _Phase.teaching)
                  _roundIcon(
                    icon: Icons.pause_rounded,
                    label: l10n.t('mobile.ai.aiTeacherPause'),
                    onTap: _pause,
                  )
                else if (_phase == _Phase.paused || _phase == _Phase.answering)
                  _roundIcon(
                    icon: Icons.play_arrow_rounded,
                    label: _teacherReply != null
                        ? l10n.t('mobile.ai.aiTeacherContinue')
                        : l10n.t('mobile.ai.aiTeacherResume'),
                    onTap: _resume,
                    filled: true,
                  )
                else if (_phase == _Phase.idle || _phase == _Phase.completed)
                  _roundIcon(
                    icon: Icons.play_arrow_rounded,
                    label: l10n.t('mobile.ai.aiTeacherStart'),
                    onTap: () => _runLesson(0),
                    filled: true,
                  )
                else
                  const SizedBox(width: 56),
                const Spacer(),
                GestureDetector(
                  onTap: () {
                    if (_handsFree) {
                      setState(() {
                        _handsFree = false;
                        _listeningAsk = false;
                      });
                      unawaited(_speechStt.stop());
                      _micPulse.stop();
                      _hzTimer?.cancel();
                    } else {
                      unawaited(_listenAsk());
                    }
                  },
                  child: Column(
                    children: [
                      SizedBox(
                        height: 36,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            for (var i = 0; i < _hzBars.length; i++)
                              Container(
                                width: 3,
                                height: 6 + _hzBars[i] * 28,
                                margin: const EdgeInsets.symmetric(horizontal: 1),
                                decoration: BoxDecoration(
                                  color: _listeningAsk || _soundLevel > 0.2
                                      ? const Color(0xFFFBBF24)
                                      : const Color(0xFF34D399),
                                  borderRadius: BorderRadius.circular(2),
                                ),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 6),
                      AnimatedBuilder(
                        animation: _micPulse,
                        builder: (context, child) {
                          final pulse = _listeningAsk
                              ? 1.0 + (_micPulse.value * 0.18) + (_soundLevel * 0.35)
                              : 1.0;
                          final ring = _listeningAsk
                              ? 0.35 + _micPulse.value * 0.45 + _soundLevel * 0.4
                              : 0.0;
                          return SizedBox(
                            width: 92,
                            height: 92,
                            child: Stack(
                              alignment: Alignment.center,
                              children: [
                                if (_listeningAsk) ...[
                                  Transform.scale(
                                    scale: 1.15 + _micPulse.value * 0.35 + _soundLevel * 0.5,
                                    child: Container(
                                      width: 88,
                                      height: 88,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: const Color(0xFFFBBF24)
                                              .withValues(alpha: ring.clamp(0.15, 0.85)),
                                          width: 3,
                                        ),
                                      ),
                                    ),
                                  ),
                                  Transform.scale(
                                    scale: 1.4 + _micPulse.value * 0.45 + _soundLevel * 0.6,
                                    child: Container(
                                      width: 88,
                                      height: 88,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: const Color(0xFFF59E0B)
                                              .withValues(alpha: (ring * 0.55).clamp(0.08, 0.5)),
                                          width: 2,
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                                Transform.scale(
                                  scale: pulse,
                                  child: child,
                                ),
                              ],
                            ),
                          );
                        },
                        child: Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: LinearGradient(
                              colors: _listeningAsk
                                  ? const [Color(0xFFFBBF24), Color(0xFFF59E0B)]
                                  : const [Color(0xFF38BDF8), Color(0xFF34D399)],
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: (_listeningAsk
                                        ? const Color(0xFFFBBF24)
                                        : const Color(0xFF38BDF8))
                                    .withValues(alpha: 0.45),
                                blurRadius: _listeningAsk ? 28 : 18,
                                offset: const Offset(0, 8),
                              ),
                            ],
                          ),
                          child: Icon(
                            _listeningAsk ? Icons.mic_rounded : Icons.mic_none_rounded,
                            size: 34,
                            color: const Color(0xFF0B1220),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _listeningAsk
                            ? l10n.t('mobile.ai.aiTeacherListening')
                            : l10n.t('mobile.ai.aiTeacherAsk'),
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                const SizedBox(width: 56),
              ],
            ),
          ),
          if (_ttsError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                l10n.t('mobile.ai.aiTeacherVoiceMissing'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFFFCA5A5),
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          if (_phase == _Phase.completed && summary.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.04),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.t('mobile.ai.aiTeacherSummary'),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: Colors.white.withValues(alpha: 0.65),
                      ),
                    ),
                    const SizedBox(height: 6),
                    ...summary.take(3).map(
                      (s) => Padding(
                        padding: const EdgeInsets.only(bottom: 3),
                        child: Text(
                          '• ${_cleanBoardText(s) ?? s.toString()}',
                          style: const TextStyle(color: Colors.white, fontSize: 12),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (_phase == _Phase.completed && quiz.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.04),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.t('mobile.ai.aiTeacherQuiz'),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: Colors.white.withValues(alpha: 0.65),
                      ),
                    ),
                    ...List.generate(quiz.length.clamp(0, 2), (qi) {
                      final q = quiz[qi];
                      if (q is! Map) return const SizedBox.shrink();
                      final map = Map<String, dynamic>.from(q);
                      final reveal = _quizReveal[qi] == true;
                      return Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${qi + 1}. ${map['question'] ?? ''}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
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
                                  fontSize: 12,
                                ),
                              ),
                          ],
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

  Widget _roundIcon({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    bool filled = false,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: filled
                  ? const Color(0xFF38BDF8)
                  : Colors.white.withValues(alpha: 0.1),
              border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
            ),
            child: Icon(
              icon,
              color: filled ? const Color(0xFF0B1220) : Colors.white,
            ),
          ),
          const SizedBox(height: 4),
          SizedBox(
            width: 64,
            child: Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white60,
                fontSize: 10,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
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
    r'\b(language|lesson_title|objective|whiteboard|speech|quiz|summary|parameters|action)\s*:',
    caseSensitive: false,
  ).hasMatch(s)) {
    return '';
  }
  s = s
      .replaceAll(RegExp(r',?\s*text\s*:\s*', caseSensitive: false), ' ')
      .replaceAll(RegExp(r',?\s*time\s*:\s*\d+', caseSensitive: false), ' ')
      .trim();
  if (RegExp(
    r'''^["']?(text|x|y|color|size|action|parameters|time)''',
    caseSensitive: false,
  ).hasMatch(s)) {
    return '';
  }
  if (s.contains('"x":') && s.contains('"y":')) return '';
  if (s.contains('"parameters"') || s.contains('"action"')) return '';
  final firstLine = s.split('\n').first;
  final sentence = firstLine.split(RegExp(r'(?<=[.!?؟])\s+')).first;
  s = sentence.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (s.length < 2) return '';
  if (s.length > 90) s = s.substring(0, 90);
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
  // Slower, teacher-like handwriting so every character finishes on the board.
  return math.max(1100, math.min(6500, n * 72));
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
          final chars = p >= 0.995
              ? item.text.length
              : math.max(1, (item.text.length * p).ceil());
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
