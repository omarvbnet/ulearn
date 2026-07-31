import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:speech_to_text/speech_recognition_result.dart'
    show SpeechRecognitionResult;
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';

/// Full-screen live AI Teacher classroom (beat session loop).
class LiveClassroomScreen extends StatefulWidget {
  const LiveClassroomScreen({
    super.key,
    required this.documentIds,
    this.question = '',
  });

  final List<String> documentIds;
  final String question;

  @override
  State<LiveClassroomScreen> createState() => _LiveClassroomScreenState();
}

enum _Presence { thinking, speaking, listening, waiting, idle }

class _LiveClassroomScreenState extends State<LiveClassroomScreen> {
  static const _boardW = 1920.0;
  static const _boardH = 1080.0;
  // Classroom session/beat/turn calls generate a fresh lesson beat with the
  // LLM and can legitimately take longer than a plain CRUD request — the
  // default 30s API timeout was surfacing "Request timed out" mid-lesson.
  static const _llmTimeout = Duration(seconds: 55);

  final _audio = AudioPlayer();
  final _speechStt = stt.SpeechToText();
  final _items = <_BoardItem>[];
  final _hzBars = List<double>.filled(28, 0.08);

  var _presence = _Presence.thinking;
  var _caption = '';
  var _title = 'Classroom';
  String? _error;
  String? _ttsError;
  List<String>? _sttLocales;
  var _ended = false;
  var _clockMs = 0.0;
  var _soundLevel = 0.0;
  String? _sessionId;
  String? _speechLocale;
  String? _selectedLanguage;

  var _cancelled = false;
  var _voiceBusy = false;
  var _handlingTurn = false;
  var _loopActive = false;
  var _sttReady = false;
  var _listenStarting = false;
  var _listenGen = 0;
  DateTime? _lastListenStart;
  DateTime? _speechActivityAt;
  var _askWaitMs = 0;
  var _boardCursorY = 160.0;
  var _diagramCursorY = 220.0;
  var _turnStarted = false;
  String? _pendingAsk;
  // Stays true across the whole ask→wait→answer cycle (unlike _pendingAsk,
  // which the loop clears early to enter the wait state). Ensures the
  // student's reply is always bridged with "let me check" first.
  bool _awaitingCheck = false;
  String? _countryCode;
  String? _provinceName;
  String? _accent;
  var _bridgeVariant = 0;
  String _finalBuffer = '';
  Timer? _finalDebounce;
  Timer? _paintTimer;
  Timer? _hzTimer;
  ApiClient? _api;

  String get _lang {
    final raw = (_selectedLanguage ?? context.localeCode).toLowerCase();
    if (raw.startsWith('ar') || raw.startsWith('ku')) return 'ar';
    if (raw.startsWith('tr')) return 'tr';
    return 'en';
  }

  bool get _rtl => _lang == 'ar';

  String get _sttLocaleId {
    final wanted = (_speechLocale ?? '').replaceAll('-', '_');
    final fallback = _lang == 'ar'
        ? 'ar_SA'
        : _lang == 'tr'
            ? 'tr_TR'
            : 'en_US';
    final preferred = wanted.length >= 2 ? wanted : fallback;
    final available = _sttLocales;
    if (available == null || available.isEmpty) return preferred;
    // Exact match first, then any locale in the same language, else default.
    final exact = available.firstWhere(
      (id) => id.toLowerCase() == preferred.toLowerCase(),
      orElse: () => '',
    );
    if (exact.isNotEmpty) return exact;
    final langPrefix = preferred.split('_').first.toLowerCase();
    final sameLang = available.firstWhere(
      (id) => id.toLowerCase().startsWith('${langPrefix}_') ||
          id.toLowerCase() == langPrefix,
      orElse: () => '',
    );
    if (sameLang.isNotEmpty) return sameLang;
    final fbLang = fallback.split('_').first.toLowerCase();
    final fbMatch = available.firstWhere(
      (id) => id.toLowerCase().startsWith('${fbLang}_'),
      orElse: () => '',
    );
    return fbMatch.isNotEmpty ? fbMatch : preferred;
  }

  String _presenceLabel(_Presence p) {
    switch (_lang) {
      case 'ar':
        return switch (p) {
          _Presence.thinking => 'يفكّر…',
          _Presence.speaking => 'يشرح…',
          _Presence.listening => 'يستمع إليك',
          _Presence.waiting => 'دورك',
          _Presence.idle => 'جاهز',
        };
      case 'tr':
        return switch (p) {
          _Presence.thinking => 'Düşünüyor…',
          _Presence.speaking => 'Anlatıyor…',
          _Presence.listening => 'Seni dinliyor',
          _Presence.waiting => 'Sıra sende',
          _Presence.idle => 'Hazır',
        };
      default:
        return switch (p) {
          _Presence.thinking => 'Thinking…',
          _Presence.speaking => 'Teaching…',
          _Presence.listening => 'Listening to you',
          _Presence.waiting => 'Your turn',
          _Presence.idle => 'Ready',
        };
    }
  }

  @override
  void initState() {
    super.initState();
    _paintTimer = Timer.periodic(const Duration(milliseconds: 33), (_) {
      if (!mounted) return;
      setState(() {
        _clockMs = DateTime.now().millisecondsSinceEpoch.toDouble();
      });
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _selectedLanguage = context.localeCode.toLowerCase();
      unawaited(_startSession());
    });
  }

  @override
  void dispose() {
    _cancelled = true;
    _listenGen++;
    _paintTimer?.cancel();
    _hzTimer?.cancel();
    _finalDebounce?.cancel();
    unawaited(_speechStt.stop());
    unawaited(_audio.dispose());
    final id = _sessionId;
    final api = _api;
    _sessionId = null;
    if (id != null && api != null) {
      unawaited(api.post('/api/ai/classroom/session/$id/end', {}));
    }
    super.dispose();
  }

  bool _isTransientError(Object e) {
    return e is SocketException ||
        e is TimeoutException ||
        (e is ApiException && (e.statusCode == 408 || e.statusCode == 0));
  }

  /// POST with one automatic retry (short backoff) on a transient failure —
  /// a single dropped socket or slow LLM response must not strand the
  /// student on a dead-end error when a second attempt would likely succeed.
  Future<Map<String, dynamic>> _postWithRetry(
    String path,
    Map<String, dynamic> body, {
    Duration? timeout,
    int maxAttempts = 2,
  }) async {
    final api = _api;
    if (api == null) throw ApiException('Not connected', 0);
    Object? lastError;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await api.post(path, body, timeout: timeout);
      } catch (e) {
        lastError = e;
        if (!_isTransientError(e) || attempt == maxAttempts) rethrow;
        await Future<void>.delayed(Duration(seconds: attempt * 2));
      }
    }
    throw lastError ?? ApiException('Request failed', 0);
  }

  Future<void> _startSession() async {
    if (!mounted) return;
    setState(() {
      _presence = _Presence.thinking;
      _error = null;
      _caption = _lang == 'ar'
          ? 'جارٍ تجهيز الفصل…'
          : _lang == 'tr'
              ? 'Sınıf hazırlanıyor…'
              : 'Preparing classroom…';
    });
    try {
      final api = context.read<ApiClient>();
      _api = api;
      final locale = context.localeCode.toLowerCase();
      _selectedLanguage = locale;
      await _consumeAndPlayStream(
        '/api/ai/classroom/session',
        {
          'language': locale,
          'question': widget.question,
          'documentIds': widget.documentIds,
        },
      );
      if (!mounted || _cancelled) return;
      if (_sessionId == null) return;
      unawaited(_runLoop());
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException
            ? e.message
            : (_lang == 'ar'
                ? 'تعذر بدء الفصل'
                : 'Could not start classroom');
      });
    }
  }

  Future<bool> _waitForStudentWindow(int baseMs) async {
    _speechActivityAt = null;
    _turnStarted = false;
    _finalBuffer = '';
    if (mounted) setState(() => _presence = _Presence.waiting);
    await _startListen();
    final started = DateTime.now();
    while (!_cancelled && !_ended && !_handlingTurn && mounted) {
      final active = _speechActivityAt != null &&
          DateTime.now().difference(_speechActivityAt!).inMilliseconds < 2200;
      final elapsed = DateTime.now().difference(started).inMilliseconds;
      final deadline = active ? math.max(baseMs, elapsed + 2000) : baseMs;
      if (elapsed >= deadline && !active) break;
      await Future<void>.delayed(const Duration(milliseconds: 120));
    }
    if (!_handlingTurn) {
      _finalDebounce?.cancel();
      await _stopListeningQuietly();
      // Don't lose an answer captured just before the window closed.
      final leftover = _finalBuffer.trim();
      if (leftover.isNotEmpty) {
        _turnStarted = true;
        await _submitTurn(leftover);
      }
    }
    return _turnStarted || _handlingTurn;
  }

  Future<void> _submitSilence() async {
    if (_sessionId == null || _handlingTurn || _cancelled) return;
    _handlingTurn = true;
    _turnStarted = true;
    if (mounted) setState(() => _presence = _Presence.speaking);
    try {
      if (_api == null) return;
      await _consumeAndPlayStream(
        '/api/ai/classroom/session/$_sessionId/turn',
        {'noAnswer': true},
        bridgeKind: 'think',
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'Turn failed';
      });
    } finally {
      _handlingTurn = false;
    }
  }

  /// Wait for answer; if delayed, repeat the question by voice; if still silent, notify server.
  Future<void> _runStudentCheck(
    String question,
    int waitMs,
    String pace,
  ) async {
    for (var attempt = 0; attempt < 2; attempt++) {
      if (_cancelled || _ended) return;
      final answered = await _waitForStudentWindow(waitMs);
      if (answered || _handlingTurn) {
        while (_handlingTurn && !_cancelled) {
          await Future<void>.delayed(const Duration(milliseconds: 120));
        }
        return;
      }
      // Student delayed — repeat the question by voice.
      if (mounted) {
        setState(() {
          _presence = _Presence.speaking;
          _caption = question;
        });
      }
      await _speakCloud(question, pace: 'slow', emotion: 'patient');
      await Future<void>.delayed(const Duration(milliseconds: 350));
    }
    if (_cancelled || _ended || _handlingTurn) return;
    await _submitSilence();
  }

  Future<void> _runLoop() async {
    if (_loopActive || _sessionId == null) return;
    _loopActive = true;
    try {
      while (!_cancelled && !_ended && _sessionId != null && mounted) {
        if (_handlingTurn) {
          await Future<void>.delayed(const Duration(milliseconds: 200));
          continue;
        }

        if (_pendingAsk != null) {
          final q = _pendingAsk!;
          final waitMs = _askWaitMs > 0 ? _askWaitMs : 5500;
          _pendingAsk = null;
          await _runStudentCheck(q, waitMs, 'normal');
          continue;
        }

        // Beats without a check question are pure explanation — give the
        // student a real window to jump in with a question before moving on.
        final answered = await _waitForStudentWindow(4200);
        if (_cancelled || _ended) break;
        if (answered || _handlingTurn) {
          while (_handlingTurn && !_cancelled) {
            await Future<void>.delayed(const Duration(milliseconds: 150));
          }
          continue;
        }

        if (mounted) {
          setState(() {
            _presence = _Presence.thinking;
            _caption = _lang == 'ar'
                ? 'المعلم يفكر…'
                : _lang == 'tr'
                    ? 'Öğretmen düşünüyor…'
                    : 'Teacher is thinking…';
          });
        }
        if (_api == null) break;
        final beat = await _consumeAndPlayStream(
          '/api/ai/classroom/session/$_sessionId/beat',
          {},
          bridgeKind: 'think',
        );
        if (!mounted || _cancelled) break;
        if (beat != null && beat['sessionComplete'] == true) {
          if (mounted) setState(() => _ended = true);
          break;
        }
      }
    } catch (e) {
      if (!mounted) return;
      // A stalled connection (timeout/socket drop) must not freeze the
      // class forever — briefly show a status and auto-resume instead of
      // dying silently or requiring the student to reopen the screen.
      final transient =
          e is SocketException ||
          e is TimeoutException ||
          (e is ApiException && (e.statusCode == 408 || e.statusCode == 0));
      if (transient && !_cancelled && !_ended) {
        setState(() {
          _error = _lang == 'ar'
              ? 'انقطع الاتصال، جارٍ إعادة المحاولة…'
              : _lang == 'tr'
                  ? 'Bağlantı kesildi, yeniden deneniyor…'
                  : 'Connection hiccup — reconnecting…';
        });
        Future<void>.delayed(const Duration(seconds: 2), () {
          if (!mounted || _cancelled || _ended) return;
          setState(() => _error = null);
          _runLoop();
        });
      } else {
        setState(() {
          _error = e is ApiException ? e.message : 'Classroom failed';
        });
      }
    } finally {
      _loopActive = false;
    }
  }

  void _bindSession(Map<String, dynamic> sessionMap) {
    final id = sessionMap['id']?.toString();
    if (id != null && id.isNotEmpty) _sessionId = id;
    final speechLocale = sessionMap['speechLocale']?.toString();
    if (speechLocale != null && speechLocale.isNotEmpty) {
      _speechLocale = speechLocale;
    }
    final country = sessionMap['countryCode']?.toString();
    if (country != null && country.isNotEmpty) _countryCode = country;
    final province = sessionMap['provinceName']?.toString();
    if (province != null && province.isNotEmpty) _provinceName = province;
    final accent = sessionMap['accent']?.toString();
    if (accent != null && accent.isNotEmpty) _accent = accent;
    final names = sessionMap['materialNames'];
    final state = sessionMap['state'];
    final lessonName =
        state is Map ? state['currentLessonName']?.toString() : null;
    if (!mounted) return;
    setState(() {
      if (lessonName != null && lessonName.isNotEmpty) {
        _title = lessonName;
      } else if (names is List && names.isNotEmpty && _title == 'Classroom') {
        _title = names.first.toString();
      }
    });
  }

  void _applyBoardLive(List board) {
    if (_cancelled || !mounted || board.isEmpty) return;
    var penAt = DateTime.now().millisecondsSinceEpoch.toDouble();
    var shapeSlot = 0;
    for (var i = 0; i < board.length; i++) {
      final row = board[i];
      if (row is! Map) continue;
      final cue = Map<String, dynamic>.from(row);
      final action =
          (cue['action']?.toString() ?? '').toLowerCase().replaceAll(' ', '_');
      if (action == 'clear_board' || action == 'open_new_board') {
        _items.clear();
        _boardCursorY = 160;
        _diagramCursorY = 220;
        shapeSlot = 0;
        penAt = DateTime.now().millisecondsSinceEpoch.toDouble();
        continue;
      }
      final before = _items.length;
      shapeSlot = _applyCue(
        _items,
        cue,
        i,
        penAt,
        _rtl,
        () => _boardCursorY,
        (y) => _boardCursorY = y,
        () => _diagramCursorY,
        (y) => _diagramCursorY = y,
        shapeSlot,
      );
      if (_items.length > before) {
        penAt += _items.last.writeMs + 160;
      }
    }
    if (shapeSlot > 0) _diagramCursorY += 60;
    if (mounted) setState(() {});
  }

  /// End-to-end streamed beat: status → progressive speak/board → complete.
  /// First sentence starts TTS as soon as the server emits it.
  Future<Map<String, dynamic>?> _consumeAndPlayStream(
    String path,
    Map<String, dynamic> body, {
    String? bridgeKind,
    bool wasCheck = false,
  }) async {
    final api = _api;
    if (api == null) throw ApiException('Not connected', 0);
    await _stopListeningQuietly();
    if (mounted) setState(() => _presence = _Presence.thinking);

    final spoken = <int>{};
    final speakQueue = <Map<String, dynamic>>[];
    var drainRunning = false;
    var streamDone = false;
    Map<String, dynamic>? finalBeat;
    var firstSpeak = true;
    var bridgeAbort = false;
    var boardAppliedLive = false;

    Future<File?>? nextPreload;
    Future<void> drainSpeak() async {
      if (drainRunning) return;
      drainRunning = true;
      _voiceBusy = true;
      try {
        while (!_cancelled) {
          if (speakQueue.isEmpty) {
            if (streamDone) break;
            await Future<void>.delayed(const Duration(milliseconds: 40));
            continue;
          }
          final next = speakQueue.removeAt(0);
          final index = (next['index'] as num?)?.toInt() ?? 0;
          if (spoken.contains(index)) continue;
          spoken.add(index);
          final text = next['text']?.toString() ?? '';
          if (text.isEmpty) continue;
          final pace = next['pace']?.toString() ?? 'normal';
          final emotion = next['emotion']?.toString() ?? 'calm';
          if (mounted) {
            setState(() {
              _presence = _Presence.speaking;
              _caption = text;
            });
          }
          final preloaded =
              nextPreload != null ? await nextPreload : null;
          nextPreload = speakQueue.isNotEmpty
              ? _fetchTtsFile(
                  speakQueue.first['text']?.toString() ?? '',
                  pace: speakQueue.first['pace']?.toString() ?? 'normal',
                  emotion:
                      speakQueue.first['emotion']?.toString() ?? 'calm',
                )
              : null;
          await _speakCloud(
            text,
            pace: pace,
            emotion: emotion,
            preloaded: preloaded,
          );
          await Future<void>.delayed(const Duration(milliseconds: 180));
        }
      } finally {
        drainRunning = false;
        _voiceBusy = false;
      }
    }

    if (bridgeKind != null) {
      unawaited((() async {
        try {
          if (bridgeAbort || _cancelled) return;
          await _speakBridge(bridgeKind);
        } catch (_) {}
      })());
    }

    try {
      await api.postSse(
        path,
        body,
        timeout: _llmTimeout,
        onEvent: (type, data) {
          if (_cancelled) return;
          switch (type) {
          case 'status':
            if (_voiceBusy) return;
            final message = data['message']?.toString();
            if (mounted) {
              setState(() {
                _presence = _Presence.thinking;
                if (message != null && message.isNotEmpty) _caption = message;
              });
            }
            break;
          case 'session':
            final session = data['session'];
            if (session is Map) {
              _bindSession(Map<String, dynamic>.from(session));
            }
            break;
          case 'board':
            final actions = data['actions'];
            if (actions is List) {
              if (!_voiceBusy && mounted) {
                setState(() {
                  _caption = _lang == 'ar'
                      ? 'جارٍ الرسم على السبورة…'
                      : _lang == 'tr'
                          ? 'Tahta hazırlanıyor…'
                          : 'Drawing on the board…';
                });
              }
              boardAppliedLive = true;
              _applyBoardLive(actions);
            }
            break;
          case 'speak':
            final text = _cleanText(data['text']) ?? data['text']?.toString() ?? '';
            if (text.isEmpty) return;
            if (firstSpeak) {
              firstSpeak = false;
              bridgeAbort = true;
              try {
                _audio.stop();
              } catch (_) {}
            }
            speakQueue.add({
              'index': (data['index'] as num?)?.toInt() ?? spoken.length,
              'text': text,
              'emotion': data['emotion']?.toString() ?? 'calm',
              'pace': data['pace']?.toString() ?? 'normal',
            });
            unawaited(drainSpeak());
            break;
          case 'complete':
            final beat = data['beat'];
            if (beat is Map) {
              finalBeat = Map<String, dynamic>.from(beat);
            }
            final session = data['session'];
            if (session is Map) {
              _bindSession(Map<String, dynamic>.from(session));
            }
            break;
          case 'needs_materials':
            if (mounted) {
              setState(() {
                _error = _lang == 'ar'
                    ? 'اختر المادة أولاً'
                    : 'Select materials first';
              });
            }
            break;
          case 'error':
            throw ApiException(
              data['message']?.toString() ?? 'Stream failed',
              500,
            );
          }
        },
      );
    } catch (e) {
      // Proxies / older builds that break SSE — fall back to the
      // full-JSON path so the classroom still teaches instead of dying.
      if (finalBeat == null && spoken.isEmpty) {
        final data = await _postWithRetry(path, body, timeout: _llmTimeout);
        if (data['needsMaterialSelection'] == true) {
          if (mounted) {
            setState(() {
              _error = _lang == 'ar'
                  ? 'اختر المادة أولاً'
                  : 'Select materials first';
            });
          }
          return null;
        }
        final session = data['session'];
        if (session is Map) {
          _bindSession(Map<String, dynamic>.from(session));
        }
        final beat = data['beat'];
        if (beat is Map) {
          final map = Map<String, dynamic>.from(beat);
          if (wasCheck) {
            if (map['answerCorrect'] == true) {
              await _speakBridge('excellent');
            } else if (map['answerCorrect'] == false) {
              await _speakBridge('reexplain');
            }
          }
          await _playBeat(map);
          return map;
        }
        return null;
      }
      rethrow;
    }

    streamDone = true;
    await drainSpeak();
    if (!mounted || _cancelled) return finalBeat;
    if (_error != null) setState(() => _error = null);

    final completed = finalBeat;
    if (completed == null) return null;

    if (wasCheck) {
      if (completed['answerCorrect'] == true) {
        await _speakBridge('excellent');
      } else if (completed['answerCorrect'] == false) {
        await _speakBridge('reexplain');
      }
    }

    final completedBoard = completed['board'] is List
        ? List<dynamic>.from(completed['board'] as List)
        : <dynamic>[];
    if (!boardAppliedLive && completedBoard.isNotEmpty) {
      _applyBoardLive(completedBoard);
      boardAppliedLive = true;
    }

    final speakRaw = completed['speak'];
    final leftover = <String>[];
    if (speakRaw is List) {
      for (var i = 0; i < speakRaw.length; i++) {
        if (spoken.contains(i)) continue;
        final t = _cleanText(speakRaw[i]);
        if (t != null && t.isNotEmpty) leftover.add(t);
      }
    }
    if (leftover.isNotEmpty) {
      await _playBeat({
        ...completed,
        'speak': leftover,
        'board': boardAppliedLive ? <dynamic>[] : completedBoard,
      });
    } else {
      final ask = completed['askStudent']?.toString().trim();
      if (ask != null && ask.isNotEmpty) {
        _askWaitMs =
            ((completed['waitForStudentMs'] as num?)?.toInt() ?? 5500)
                .clamp(5000, 8000);
        _pendingAsk = ask;
        _awaitingCheck = true;
        if (mounted) setState(() => _caption = _cleanText(ask) ?? ask);
      } else {
        _askWaitMs = 0;
        _pendingAsk = null;
        _awaitingCheck = false;
      }
      final lessonName = completed['lessonName']?.toString();
      if (lessonName != null && lessonName.isNotEmpty && mounted) {
        setState(() => _title = lessonName);
      }
      if (completed['sessionComplete'] == true && mounted) {
        setState(() => _ended = true);
      }
    }
    return completed;
  }

  Future<void> _playBeat(Map<String, dynamic> beat) async {
    if (_cancelled || !mounted) return;
    final board = beat['board'];
    if (board is List) {
      var penAt = DateTime.now().millisecondsSinceEpoch.toDouble();
      // Consecutive counting-style shapes (circles/rectangles) drawn within
      // THIS beat line up left-to-right in one row like real objects; the
      // row itself advances via _diagramCursorY so the next beat's drawing
      // never overlaps what this one already drew on the board.
      var shapeSlot = 0;
      for (var i = 0; i < board.length; i++) {
        final row = board[i];
        if (row is! Map) continue;
        final cue = Map<String, dynamic>.from(row);
        final action =
            (cue['action']?.toString() ?? '').toLowerCase().replaceAll(' ', '_');
        if (action == 'clear_board' || action == 'open_new_board') {
          _items.clear();
          _boardCursorY = 160;
          _diagramCursorY = 220;
          shapeSlot = 0;
          penAt = DateTime.now().millisecondsSinceEpoch.toDouble();
          continue;
        }
        final before = _items.length;
        shapeSlot = _applyCue(
          _items,
          cue,
          i,
          penAt,
          _rtl,
          () => _boardCursorY,
          (y) => _boardCursorY = y,
          () => _diagramCursorY,
          (y) => _diagramCursorY = y,
          shapeSlot,
        );
        if (_items.length > before) {
          penAt += _items.last.writeMs + 160;
        }
      }
      if (shapeSlot > 0) _diagramCursorY += 60;
      if (mounted) setState(() {});
    }

    _voiceBusy = true;
    if (mounted) setState(() => _presence = _Presence.speaking);
    final speakRaw = beat['speak'];
    final lines = <String>[];
    if (speakRaw is List) {
      for (final s in speakRaw) {
        final t = _cleanText(s);
        if (t != null && t.isNotEmpty) lines.add(t);
      }
    } else if (speakRaw is String) {
      final t = _cleanText(speakRaw);
      if (t != null && t.isNotEmpty) lines.add(t);
    }

    final pace = beat['pace']?.toString() ?? 'normal';
    final emotion = beat['emotion']?.toString() ?? 'calm';
    final ask = beat['askStudent']?.toString().trim();
    // Ensure check questions are spoken even if model forgot.
    if (ask != null &&
        ask.isNotEmpty &&
        !lines.any((l) => l.contains(ask.substring(0, math.min(10, ask.length))))) {
      lines.add(ask);
    }
    // Pipeline TTS: start fetching line N+1's audio bytes as soon as line N
    // begins its (mic-settle + playback) sequence instead of only starting
    // that network call after line N finishes — removes the fetch-latency
    // gap between spoken sentences within a beat. The delicate audio-session
    // stop/settle/play sequencing below is left completely untouched; only
    // the network round trip is overlapped.
    Future<File?>? nextAudio =
        lines.isNotEmpty ? _fetchTtsFile(lines[0], pace: pace, emotion: emotion) : null;
    for (var i = 0; i < lines.length; i++) {
      if (_cancelled) break;
      final line = lines[i];
      if (mounted) setState(() => _caption = line);
      final preloaded = await nextAudio;
      nextAudio = i + 1 < lines.length
          ? _fetchTtsFile(lines[i + 1], pace: pace, emotion: emotion)
          : null;
      await _speakCloud(line, pace: pace, emotion: emotion, preloaded: preloaded);
      await Future<void>.delayed(const Duration(milliseconds: 220));
    }
    _voiceBusy = false;
    await Future<void>.delayed(const Duration(milliseconds: 400));
    final lessonName = beat['lessonName']?.toString();
    if (lessonName != null && lessonName.isNotEmpty && mounted) {
      setState(() => _title = lessonName);
    }
    if (ask != null && ask.isNotEmpty) {
      _askWaitMs =
          ((beat['waitForStudentMs'] as num?)?.toInt() ?? 5500).clamp(5000, 8000);
      _pendingAsk = ask;
      _awaitingCheck = true;
      if (mounted) setState(() => _caption = _cleanText(ask) ?? ask);
    } else {
      _askWaitMs = 0;
      _pendingAsk = null;
      _awaitingCheck = false;
    }
    if (beat['sessionComplete'] == true && mounted) {
      setState(() => _ended = true);
    }
  }

  Future<void> _speakBridge(String kind) async {
    final phrase = _classroomBridgePhrase(
      lang: _lang,
      countryCode: _countryCode,
      accent: _accent,
      kind: kind,
      variant: _bridgeVariant++,
    );
    if (phrase.isEmpty || !mounted) return;
    if (mounted) {
      setState(() {
        _presence = _Presence.speaking;
        _caption = phrase;
      });
    }
    await _speakCloud(phrase, pace: 'normal', emotion: _bridgeKindToEmotion(kind));
  }

  Future<void> _submitTurn(String transcript) async {
    final q = (_cleanText(transcript) ?? transcript).trim();
    if (q.isEmpty || _sessionId == null || _handlingTurn) return;
    _handlingTurn = true;
    _turnStarted = true;
    _finalBuffer = '';
    _finalDebounce?.cancel();
    await _stopListeningQuietly();
    try {
      await _audio.stop();
    } catch (_) {}
    if (mounted) {
      setState(() {
        _presence = _Presence.listening;
        _caption = q;
      });
    }
    await Future<void>.delayed(const Duration(milliseconds: 100));
    try {
      if (_api == null) return;
      final wasCheck = _awaitingCheck;
      _awaitingCheck = false;
      final kind = wasCheck ? 'check' : 'explain';
      await _consumeAndPlayStream(
        '/api/ai/classroom/session/$_sessionId/turn',
        {'transcript': q},
        bridgeKind: kind,
        wasCheck: wasCheck,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'Turn failed';
      });
    } finally {
      _handlingTurn = false;
    }
  }

  Future<void> _speakCloud(
    String text, {
    String pace = 'normal',
    String emotion = 'calm',
    File? preloaded,
  }) async {
    if (!mounted) return;
    await _stopListeningQuietly();
    // Settle the audio session after mic release — iOS needs this or
    // playback can fail silently and the teacher "stops speaking".
    await Future<void>.delayed(const Duration(milliseconds: 220));
    _voiceBusy = true;
    _hzTimer?.cancel();
    _hzTimer = Timer.periodic(const Duration(milliseconds: 55), (_) {
      if (!mounted || !_voiceBusy) return;
      setState(() => _driveTeacherWave(active: true));
    });
    try {
      var ok = await _speakCloudOnce(
        text,
        pace: pace,
        emotion: emotion,
        preloaded: preloaded,
      );
      if (!ok && mounted && !_cancelled) {
        // One retry — a single failed TTS request must not silence the class.
        await Future<void>.delayed(const Duration(milliseconds: 500));
        ok = await _speakCloudOnce(text, pace: pace, emotion: emotion);
      }
      if (mounted) {
        setState(() => _ttsError = ok ? null : 'voice');
      }
    } finally {
      _voiceBusy = false;
      _hzTimer?.cancel();
      _hzTimer = null;
      if (mounted) setState(() => _driveTeacherWave(active: false));
      await Future<void>.delayed(const Duration(milliseconds: 350));
    }
  }

  /// Fetches synthesized speech bytes and writes them to a temp file WITHOUT
  /// touching the shared audio player — lets the caller prefetch line N+1's
  /// audio while line N is still mic-settling/playing so there is no network
  /// round trip sitting between two spoken sentences of the same beat.
  Future<File?> _fetchTtsFile(
    String text, {
    String pace = 'normal',
    String emotion = 'calm',
  }) async {
    try {
      final api = _api;
      if (api == null) return null;
      final payload = <String, dynamic>{
        'text': text,
        'language': _selectedLanguage ?? _lang,
        'pace': pace,
        'emotion': emotion,
      };
      if (_countryCode != null && _countryCode!.isNotEmpty) {
        payload['country'] = _countryCode;
      }
      if (_provinceName != null && _provinceName!.isNotEmpty) {
        payload['province'] = _provinceName;
      }
      final data = await api.post('/api/ai/tts', payload);
      final nested = data['data'];
      final nestedMap =
          nested is Map ? Map<String, dynamic>.from(nested) : null;
      final speechLocale =
          (data['speechLocale'] ?? nestedMap?['speechLocale'])?.toString();
      if (speechLocale != null && speechLocale.isNotEmpty) {
        _speechLocale = speechLocale;
      }
      final b64 =
          (data['dataBase64'] ?? nestedMap?['dataBase64'])?.toString();
      final mime = (data['mimeType'] ?? nestedMap?['mimeType'])?.toString() ??
          'audio/mpeg';
      if (b64 == null || b64.isEmpty) return null;
      final bytes = Uint8List.fromList(base64Decode(b64));
      final dir = await getTemporaryDirectory();
      final ext = mime.contains('wav') ? 'wav' : 'mp3';
      final tmp = File(
        '${dir.path}/ulearn_live_tts_${DateTime.now().microsecondsSinceEpoch}.$ext',
      );
      await tmp.writeAsBytes(bytes, flush: true);
      return tmp;
    } catch (_) {
      return null;
    }
  }

  Future<bool> _speakCloudOnce(
    String text, {
    String pace = 'normal',
    String emotion = 'calm',
    File? preloaded,
  }) async {
    File? tmp = preloaded;
    try {
      try {
        await _audio.stop();
      } catch (_) {}
      if (tmp == null) {
        tmp = await _fetchTtsFile(text, pace: pace, emotion: emotion);
        if (tmp == null) return false;
      }
      if (!mounted) return false;
      await _audio.setVolume(1.0);
      await _audio.setFilePath(tmp.path);
      await _audio.play();
      await _audio.playerStateStream
          .firstWhere(
            (s) =>
                s.processingState == ProcessingState.completed ||
                (s.processingState == ProcessingState.idle && !s.playing),
          )
          .timeout(Duration(milliseconds: _estimateMs(text) + 12000));
      try {
        await _audio.stop();
      } catch (_) {}
      return true;
    } catch (_) {
      try {
        await _audio.stop();
      } catch (_) {}
      return false;
    } finally {
      final doomed = tmp;
      if (doomed != null) {
        Future<void>.delayed(const Duration(milliseconds: 400), () async {
          try {
            await doomed.delete();
          } catch (_) {}
        });
      }
    }
  }

  Future<void> _stopListeningQuietly() async {
    _listenGen++;
    try {
      await _speechStt.stop();
    } catch (_) {}
    _listenStarting = false;
  }

  /// Some engines (mainly Android) return several candidate transcripts per
  /// result with a confidence score each. Picking the most confident one
  /// (instead of always the engine's default #0) noticeably improves
  /// accuracy on noisy audio or accented speech.
  String _bestAlternateWords(SpeechRecognitionResult result) {
    if (result.alternates.isEmpty) return result.recognizedWords;
    var best = result.alternates.first;
    for (final alt in result.alternates.skip(1)) {
      if (alt.recognizedWords.trim().isNotEmpty &&
          alt.confidence > best.confidence) {
        best = alt;
      }
    }
    return best.recognizedWords.trim().isNotEmpty
        ? best.recognizedWords
        : result.recognizedWords;
  }

  Future<void> _startListen() async {
    if (_voiceBusy || _handlingTurn || _ended || _cancelled) return;
    if (_listenStarting) return;
    if (_audio.playing) return;
    final now = DateTime.now();
    if (_lastListenStart != null &&
        now.difference(_lastListenStart!).inMilliseconds < 700) {
      return;
    }

    _listenStarting = true;
    final gen = ++_listenGen;
    try {
      if (!_sttReady) {
        _sttReady = await _speechStt.initialize(
          onError: (_) {
            if (!mounted) return;
            _hzTimer?.cancel();
          },
          onStatus: (status) {
            if (!mounted) return;
            if ((status == 'done' || status == 'notListening') &&
                !_voiceBusy &&
                !_handlingTurn &&
                !_ended &&
                !_listenStarting) {
              Future<void>.delayed(
                const Duration(milliseconds: 800),
                _startListen,
              );
            }
          },
        );
      }
      if (!_sttReady || !mounted || gen != _listenGen) return;
      if (_voiceBusy || _handlingTurn || _ended) return;
      if (_speechStt.isListening) return;
      if (_sttLocales == null) {
        try {
          final locales = await _speechStt.locales();
          _sttLocales = locales.map((l) => l.localeId).toList();
        } catch (_) {
          _sttLocales = const [];
        }
        if (!mounted || gen != _listenGen || _voiceBusy || _handlingTurn) {
          return;
        }
      }

      _lastListenStart = DateTime.now();
      if (mounted) setState(() => _presence = _Presence.listening);
      _hzTimer?.cancel();
      _hzTimer = Timer.periodic(const Duration(milliseconds: 70), (_) {
        if (!mounted || _voiceBusy) return;
        setState(() => _updateHzFromLevel(_soundLevel));
      });

      final minWords = _pendingAsk != null
          ? (_rtl ? 1 : 1)
          : (_rtl ? 1 : 2);
      await _speechStt.listen(
        listenOptions: stt.SpeechListenOptions(
          localeId: _sttLocaleId,
          listenFor: const Duration(seconds: 60),
          pauseFor: const Duration(milliseconds: 2400),
          partialResults: true,
          cancelOnError: false,
          listenMode: stt.ListenMode.dictation,
          autoPunctuation: true,
        ),
        onSoundLevelChange: (level) {
          if (!mounted || _voiceBusy || gen != _listenGen) return;
          final n = (level.clamp(-50, 10) + 50) / 60.0;
          _soundLevel = n.clamp(0.0, 1.0);
        },
        onResult: (result) async {
          if (_voiceBusy || _handlingTurn || gen != _listenGen) return;
          final words = _bestAlternateWords(result).trim();
          final count =
              words.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
          if (count >= 1 && mounted) {
            _speechActivityAt = DateTime.now();
            setState(() {
              _presence = _Presence.listening;
              _caption = words;
            });
          }
          // recognizedWords is the FULL utterance so far — assign, never append
          // (appending duplicated the student's words and corrupted answers).
          if (words.isNotEmpty) _finalBuffer = words;
          if (!result.finalResult) return;
          if (count < minWords) return;
          _finalDebounce?.cancel();
          _finalDebounce = Timer(
            Duration(milliseconds: _rtl ? 900 : 700),
            () async {
              if (_voiceBusy || _handlingTurn) return;
              final ready = _finalBuffer.trim();
              if (ready.isEmpty) return;
              _turnStarted = true;
              try {
                await _audio.stop();
              } catch (_) {}
              await _submitTurn(ready);
            },
          );
        },
      );
    } finally {
      _listenStarting = false;
    }
  }

  void _driveTeacherWave({required bool active}) {
    final t = DateTime.now().millisecondsSinceEpoch / 100.0;
    for (var i = 0; i < _hzBars.length; i++) {
      _hzBars[i] = active
          ? 0.12 + (math.sin(t + i * 0.45) * 0.5 + 0.5) * 0.75
          : 0.08;
    }
  }

  void _updateHzFromLevel(double level) {
    final base = 0.1 + level * 0.85;
    for (var i = 0; i < _hzBars.length; i++) {
      final wobble = 0.08 * math.sin(DateTime.now().millisecondsSinceEpoch / 90 + i);
      _hzBars[i] = (base + wobble).clamp(0.06, 1.0);
    }
  }

  Color get _voiceLineColor {
    if (_presence == _Presence.listening) return const Color(0xFFFBBF24);
    if (_presence == _Presence.speaking) return const Color(0xFF34D399);
    return const Color(0xFF38BDF8);
  }

  Future<void> _close() async {
    _cancelled = true;
    await _stopListeningQuietly();
    try {
      await _audio.stop();
    } catch (_) {}
    final id = _sessionId;
    _sessionId = null;
    final api = _api;
    if (id != null && api != null) {
      try {
        await api.post('/api/ai/classroom/session/$id/end', {});
      } catch (_) {}
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final caption = _caption.isEmpty ? '…' : (_cleanText(_caption) ?? _caption);

    return Scaffold(
      backgroundColor: const Color(0xFF07111F),
      body: SafeArea(
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF07111F), Color(0xFF0F172A), Color(0xFF0A1628)],
            ),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'U Learn · Classroom',
                            style: TextStyle(
                              color: Color(0xFF7DD3FC),
                              fontWeight: FontWeight.w800,
                              fontSize: 11,
                              letterSpacing: 1.1,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                              fontSize: 17,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      margin: const EdgeInsets.only(right: 6),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.14),
                        ),
                      ),
                      child: Text(
                        _presenceLabel(_presence),
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 10,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: _close,
                      child: Text(
                        _lang == 'ar'
                            ? 'إغلاق'
                            : _lang == 'tr'
                                ? 'Kapat'
                                : 'Close',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                  child: Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFFF7F4EE),
                      borderRadius: BorderRadius.circular(22),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.12),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.45),
                          blurRadius: 36,
                          offset: const Offset(0, 16),
                        ),
                      ],
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        InteractiveViewer(
                          minScale: 1.0,
                          maxScale: 3.5,
                          boundaryMargin: const EdgeInsets.all(120),
                          child: Center(
                            child: AspectRatio(
                              aspectRatio: _boardW / _boardH,
                              child: CustomPaint(
                                painter: _BoardPainter(
                                  items: List.of(_items),
                                  clockMs: _clockMs,
                                  rtl: _rtl,
                                  boardW: _boardW,
                                  boardH: _boardH,
                                ),
                                child: const SizedBox.expand(),
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          left: 12,
                          right: 12,
                          bottom: 12,
                          child: Container(
                            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                            decoration: BoxDecoration(
                              color: const Color(0xFF0B1220)
                                  .withValues(alpha: 0.85),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.14),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _presenceLabel(_presence),
                                  style: const TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                    color: Color(0xFF6EE7B7),
                                    letterSpacing: 0.4,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  caption,
                                  maxLines: 3,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 15,
                                    height: 1.3,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                child: Container(
                  height: 36,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.05),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.1),
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: CustomPaint(
                          painter: _VoiceWavePainter(
                            levels: List.of(_hzBars),
                            color: _voiceLineColor,
                            active: _presence == _Presence.speaking ||
                                _presence == _Presence.listening,
                          ),
                          child: const SizedBox.expand(),
                        ),
                      ),
                      const SizedBox(width: 10),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 120),
                        child: Text(
                          _presenceLabel(_presence),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.55),
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: GestureDetector(
                    // The session-start call can fail outright (no loop ever
                    // starts to self-heal) — let the student tap the banner
                    // to try again instead of being stuck on a dead screen.
                    onTap: _sessionId == null && !_cancelled
                        ? () {
                            setState(() => _error = null);
                            _startSession();
                          }
                        : null,
                    child: Column(
                      children: [
                        Text(
                          _error!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Color(0xFFFCA5A5),
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                        ),
                        if (_sessionId == null)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text(
                              _lang == 'ar'
                                  ? 'اضغط لإعادة المحاولة'
                                  : _lang == 'tr'
                                      ? 'Tekrar denemek için dokunun'
                                      : 'Tap to retry',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Color(0xFFFCA5A5),
                                fontWeight: FontWeight.w600,
                                fontSize: 11,
                                decoration: TextDecoration.underline,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              if (_ttsError != null && _error == null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Text(
                    _lang == 'ar'
                        ? 'تعذّر تشغيل الصوت مؤقتاً، جاري المتابعة…'
                        : _lang == 'tr'
                            ? 'Ses geçici olarak çalınamadı, devam ediliyor…'
                            : 'Voice playback hiccup, continuing…',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFFFDE68A),
                      fontWeight: FontWeight.w600,
                      fontSize: 11,
                    ),
                  ),
                ),
              if (_ended)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                  child: Text(
                    _lang == 'ar'
                        ? 'انتهى هذا الجزء من الفصل.'
                        : _lang == 'tr'
                            ? 'Bu sınıf bölümü tamamlandı.'
                            : 'This classroom segment is complete.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFFA7F3D0),
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Maps a short spoken bridge to the emotion its delivery should carry —
/// mirrors bridgeKindToEmotion in voice-accent.ts.
String _bridgeKindToEmotion(String kind) {
  switch (kind) {
    case 'excellent':
      return 'encouraging';
    case 'reexplain':
      return 'patient';
    case 'check':
    case 'listen':
      return 'curious';
    default:
      return 'calm';
  }
}

String _classroomBridgePhrase({
  required String lang,
  String? countryCode,
  String? accent,
  required String kind,
  int variant = 0,
}) {
  final i = variant.abs() % 3;
  final acc = (accent ?? '').toLowerCase();
  final country = (countryCode ?? '').toUpperCase();
  final iraqi = acc.contains('iraqi') || country == 'IQ';
  final gulf = acc == 'gulf' ||
      ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'].contains(country);
  final lev = acc == 'levantine' ||
      ['SY', 'JO', 'LB', 'PS'].contains(country);
  final egy = acc == 'egyptian' || country == 'EG';

  if (lang == 'ar') {
    if (kind == 'listen') {
      if (iraqi) return ['إي، سامعك', 'تفضّل، أنا أسمعك', 'زين، كمّل'][i];
      if (gulf) return ['تفضّل، أسمعك', 'إي، كمّل', 'حاضر، سامعك'][i];
      if (lev) return ['تفضّل، عم اسمعك', 'إي كمّل', 'حاضر'][i];
      if (egy) return ['اتفضل، سامعك', 'كمّل يا بطل', 'إي أنا سامعك'][i];
      return ['تفضل، أنا أستمع إليك', 'حسنًا، أكمل', 'أنا معك، تفضّل'][i];
    }
    if (kind == 'check') {
      if (iraqi) {
        return ['خلّيني أتأكد', 'لحظة خلّيني أشيك الجواب', 'زين، خلّيني أراجع جوابك'][i];
      }
      if (gulf) return ['خلني أتأكد', 'لحظة أشيك الجواب', 'خلني أراجع جوابك'][i];
      if (lev) return ['خليني تأكد', 'لحظة خليني شيّك الجواب', 'خليني راجع جوابك'][i];
      if (egy) return ['سيبني أتأكد', 'لحظة أشيك الإجابة', 'سيبني أراجع جوابك'][i];
      return ['دعني أتأكد', 'لحظة لأراجع الجواب', 'دعني أتحقق من إجابتك'][i];
    }
    if (kind == 'excellent') {
      if (iraqi) return ['ممتاز!', 'زين جداً، أحسنت!', 'جوابك صحيح، ممتاز!'][i];
      if (gulf) return ['ممتاز!', 'أحسنت، زين!', 'صحيح، ممتاز!'][i];
      if (lev) return ['ممتاز!', 'يسلموا، أحسنت!', 'صح، ممتاز!'][i];
      if (egy) return ['ممتاز!', 'برافو عليك!', 'صح، ممتاز يا بطل!'][i];
      return ['ممتاز!', 'أحسنت!', 'إجابة صحيحة، ممتاز!'][i];
    }
    if (kind == 'reexplain') {
      if (iraqi) {
        return ['خلّيني أشرح مرة ثانية', 'زين، خلّيني أوضحها من جديد', 'خلّيني نعيد الشرح بهدوء'][i];
      }
      if (gulf) {
        return ['خلني أشرح مرة ثانية', 'خلني أوضحها من جديد', 'خلنا نعيد الشرح بهدوء'][i];
      }
      if (lev) {
        return ['خليني اشرح مرة تانية', 'خليني وضّحها من جديد', 'خليني نعيد الشرح بهدوء'][i];
      }
      if (egy) {
        return ['سيبني أشرح تاني', 'سيبني أوضحها من الأول', 'تعالى نعيد الشرح بهدوء'][i];
      }
      return ['دعني أشرح مرة أخرى', 'دعني أوضحها من جديد', 'لنُعِد الشرح بهدوء'][i];
    }
    if (kind == 'explain') {
      if (iraqi) {
        return ['خلّيني أوضح لك', 'زين، خلّيني أشرحها بهدوء', 'خلّيني أشرحلك الفكرة'][i];
      }
      if (gulf) {
        return ['خلني أوضح لك', 'خلني أشرحها بهدوء', 'خلنا نوضحها مع بعض'][i];
      }
      if (lev) {
        return ['خليني وضّحلك', 'خليني اشرحلك بهدوء', 'خليني بيّنلك الفكرة'][i];
      }
      if (egy) {
        return ['سيبني أوضحلك', 'سيبني أشرحلك بهدوء', 'تعالى نشرحها سوا'][i];
      }
      return ['دعني أوضح لك', 'دعني أشرح بهدوء', 'لنوضّح الفكرة معًا'][i];
    }
    if (iraqi) {
      return ['خلّيني أفكر شوية', 'لحظة خلّيني أرتّب الفكرة', 'خلّيني أشوفها وياك'][i];
    }
    if (gulf) {
      return ['خلني أفكر شوي', 'لحظة أرتب الفكرة', 'خلني أشوفها معك'][i];
    }
    if (lev) {
      return ['خليني فكر شوي', 'لحظة خليني رتّب الفكرة', 'خليني شوفها معك'][i];
    }
    if (egy) {
      return ['سيبني أفكر شوية', 'لحظة أرتب الفكرة', 'سيبني أشوفها معاك'][i];
    }
    return ['دعني أفكر قليلاً', 'لحظة حتى أرتّب الفكرة', 'دعني أتأمل السؤال'][i];
  }
  if (lang == 'tr') {
    if (kind == 'listen') {
      return ['Dinliyorum, buyur', 'Seni dinliyorum', 'Devam et lütfen'][i];
    }
    if (kind == 'check') {
      return ['Kontrol edeyim', 'Cevabını bir bakayım', 'Bir kontrol edeyim'][i];
    }
    if (kind == 'excellent') {
      return ['Mükemmel!', 'Harika, aferin!', 'Doğru cevap, mükemmel!'][i];
    }
    if (kind == 'reexplain') {
      return ['Tekrar açıklayayım', 'Baştan anlatayım', 'Bir daha açıklayayım'][i];
    }
    if (kind == 'explain') {
      return ['Açıklayayım', 'Sakin sakin anlatayım', 'Birlikte netleştirelim'][i];
    }
    return ['Bir düşüneyim', 'Bir saniye düşüneyim', 'Cevabı bir toparlayayım'][i];
  }
  if (kind == 'listen') {
    return ["I'm listening — go ahead", "Yes, I'm with you", "Go on, I'm listening"][i];
  }
  if (kind == 'check') {
    return ['Let me check', 'Let me check your answer', 'One moment — let me check'][i];
  }
  if (kind == 'excellent') {
    return ['Excellent!', 'Excellent — well done!', "That's correct — excellent!"][i];
  }
  if (kind == 'reexplain') {
    return ['Let me explain again', 'Let me explain that again', 'Okay — let me explain again'][i];
  }
  if (kind == 'explain') {
    return ['Let me explain', 'Let me walk you through it', 'Let me make this clear'][i];
  }
  return [
    'Let me think for a moment',
    'One moment while I gather that',
    'Give me a second to think',
  ][i];
}

String? _cleanText(dynamic raw) {
  if (raw == null) return '';
  var s = raw.toString().trim();
  if (s.isEmpty) return '';
  if (RegExp(
    r'language|lesson_title|objective|parameters|action\s*:',
    caseSensitive: false,
  ).hasMatch(s)) {
    return '';
  }
  s = s.replaceAll(RegExp(r'\s+'), ' ');
  if (s.length > 90) s = s.substring(0, 90);
  return s;
}

num _num(dynamic v, [num fallback = 0]) {
  if (v is num) return v;
  return num.tryParse(v?.toString() ?? '') ?? fallback;
}

int _estimateMs(String text) {
  final words =
      text.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
  return math.max(2200, math.min(14000, words * 420));
}

Color _color(dynamic raw, [Color fallback = const Color(0xFF1E293B)]) {
  final c = (raw?.toString() ?? '').trim().toLowerCase();
  const map = {
    'blue': Color(0xFF2563EB),
    'red': Color(0xFFDC2626),
    'green': Color(0xFF16A34A),
    'orange': Color(0xFFEA580C),
    'black': Color(0xFF0F172A),
    'yellow': Color(0xFFCA8A04),
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

int _applyCue(
  List<_BoardItem> items,
  Map<String, dynamic> cue,
  int idx,
  double bornAt,
  bool rtl,
  double Function() getCursorY,
  void Function(double y) setCursorY,
  double Function() getDiagramY,
  void Function(double y) setDiagramY,
  int shapeSlot,
) {
  final p = cue['parameters'] is Map
      ? Map<String, dynamic>.from(cue['parameters'] as Map)
      : <String, dynamic>{};
  final action =
      (cue['action']?.toString() ?? '').toLowerCase().replaceAll(' ', '_');
  final id = '${DateTime.now().microsecondsSinceEpoch}-$action-$idx';
  final seed = idx * 97 + _num(cue['time']).toInt();
  final textX = rtl ? 1720.0 : 120.0;
  final diagramX = rtl ? 380.0 : 1320.0;

  if (action == 'write_text' ||
      action == 'draw_formula' ||
      action == 'draw_equation') {
    final text = _cleanText(p['text'] ?? p['latex'] ?? p['content']);
    if (text == null || text.isEmpty) return shapeSlot;
    var y = getCursorY();
    if (y > 900) {
      items.clear();
      y = 160;
      setCursorY(160);
    }
    final size =
        _num(p['size'], text.length < 12 ? 60 : 52).toDouble().clamp(48.0, 64.0);
    items.add(
      _BoardItem.text(
        id: id,
        text: text.length > 26 ? '${text.substring(0, 25)}…' : text,
        x: textX + _handJitter(seed, 1, 1.5),
        y: y + _handJitter(seed, 2, 1.2),
        color: _color(p['color'], const Color(0xFF1E3A8A)),
        size: size.toDouble(),
        bornAt: bornAt,
        writeMs: math.max(900, math.min(4200, text.length * 70)).toDouble(),
        alignRight: rtl,
        seed: seed,
      ),
    );
    setCursorY(y + math.max(120.0, size + 68));
    return shapeSlot;
  }
  if (action == 'highlight' || action == 'underline' || action == 'draw_line') {
    // Soft underline only — never opaque blobs over text.
    final uy = math.max(150.0, getCursorY() - 72);
    items.add(
      _BoardItem.line(
        id: id,
        x1: textX + _handJitter(seed, 1, 1.5),
        y1: uy,
        x2: textX + (rtl ? -520 : 520) + _handJitter(seed, 3, 1.5),
        y2: uy,
        color: _color(p['color'], const Color(0xFFEA580C)),
        width: 4.2,
        bornAt: bornAt,
        writeMs: 700,
        seed: seed,
      ),
    );
    return shapeSlot;
  }
  if (action == 'circle_highlight' || action == 'circle_text') {
    // Circle a word/phrase already on the board — wrap an ellipse around the
    // last text item's actual bounds instead of drawing a brand-new shape.
    _BoardItem? target;
    for (var j = items.length - 1; j >= 0; j--) {
      if (items[j].kind == _Kind.text) {
        target = items[j];
        break;
      }
    }
    if (target != null) {
      final approxW = math.max(90.0, target.text.length * target.size * 0.52);
      final cx = target.alignRight
          ? target.x - approxW / 2
          : target.x + approxW / 2;
      final cy = target.y - target.size * 0.38;
      items.add(
        _BoardItem.circleHighlight(
          id: id,
          cx: cx,
          cy: cy,
          rx: approxW / 2 + 26,
          ry: target.size * 0.75,
          color: _color(p['color'], const Color(0xFFDC2626)),
          width: 3.4,
          bornAt: bornAt,
          writeMs: 700,
          seed: seed,
        ),
      );
    }
    return shapeSlot;
  }
  if (action == 'point_at' || action == 'point') {
    // A brief pointer near existing content — never adds permanent ink.
    _BoardItem? target;
    for (var j = items.length - 1; j >= 0; j--) {
      if (items[j].kind == _Kind.text) {
        target = items[j];
        break;
      }
    }
    final px = target != null
        ? (target.alignRight ? target.x - 16 : target.x + 16)
        : diagramX;
    final py = target != null ? target.y - target.size * 0.7 : getDiagramY();
    items.add(
      _BoardItem.pointer(
        id: id,
        x: px,
        y: py,
        color: _color(p['color'], const Color(0xFF2563EB)),
        bornAt: bornAt,
        writeMs: 260,
        holdMs: 1200,
        fadeMs: 650,
        seed: seed,
      ),
    );
    return shapeSlot;
  }
  if (action == 'draw_arrow') {
    final ay = math.min(860.0, getDiagramY());
    items.add(
      _BoardItem.line(
        id: id,
        x1: diagramX - 40,
        y1: ay + 70,
        x2: diagramX + 140,
        y2: ay,
        color: _color(p['color'], const Color(0xFF059669)),
        width: 3.2,
        bornAt: bornAt,
        writeMs: 1000,
        arrow: true,
        seed: seed,
      ),
    );
    setDiagramY(getDiagramY() + 140);
    return 0;
  }
  if (action == 'draw_circle' || action == 'circle') {
    final r = _num(p['r'], 42).toDouble().clamp(32.0, 48.0);
    final slotGap = r * 2 + 34;
    var slot = shapeSlot;
    if (slot >= 3) {
      setDiagramY(getDiagramY() + r * 2 + 46);
      slot = 0;
    }
    final cx = diagramX + 40 + slot * (rtl ? -slotGap : slotGap);
    final cy = math.min(860.0, getDiagramY() + r);
    items.add(
      _BoardItem.circle(
        id: id,
        cx: cx,
        cy: cy,
        r: r,
        color: _color(p['color'], const Color(0xFFDC2626)),
        width: 3.0,
        bornAt: bornAt,
        writeMs: 900,
        seed: seed,
      ),
    );
    return slot + 1;
  }
  if (action == 'draw_rectangle' || action == 'draw_rect') {
    const w = 130.0;
    const h = 84.0;
    final slotGap = w + 36;
    var slot = shapeSlot;
    if (slot >= 3) {
      setDiagramY(getDiagramY() + h + 46);
      slot = 0;
    }
    final rx = diagramX - w / 2 + slot * (rtl ? -slotGap : slotGap);
    final ry = math.min(860.0, getDiagramY());
    items.add(
      _BoardItem.rect(
        id: id,
        x: rx,
        y: ry,
        w: w,
        h: h,
        color: _color(p['color'], const Color(0xFF92400E)),
        width: 3.0,
        bornAt: bornAt,
        writeMs: 850,
        seed: seed,
      ),
    );
    return slot + 1;
  }
  return shapeSlot;
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
    required this.alignRight,
    required this.seed,
  }) : kind = _Kind.text;

  _BoardItem.line({
    required this.id,
    required this.x1,
    required this.y1,
    required this.x2,
    required this.y2,
    required this.color,
    required this.width,
    required this.bornAt,
    required this.writeMs,
    required this.seed,
    this.arrow = false,
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

  _BoardItem.circleHighlight({
    required this.id,
    required this.cx,
    required this.cy,
    required this.rx,
    required this.ry,
    required this.color,
    required this.width,
    required this.bornAt,
    required this.writeMs,
    required this.seed,
  }) : kind = _Kind.circleHighlight;

  _BoardItem.pointer({
    required this.id,
    required this.x,
    required this.y,
    required this.color,
    required this.bornAt,
    required this.writeMs,
    required this.holdMs,
    required this.fadeMs,
    required this.seed,
  }) : kind = _Kind.pointer;

  final String id;
  final _Kind kind;
  String text = '';
  double x = 0, y = 0, w = 0, h = 0;
  double x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  double cx = 0, cy = 0, r = 0, rx = 0, ry = 0;
  double size = 28;
  double width = 3;
  bool arrow = false;
  bool alignRight = false;
  double bornAt = 0;
  double writeMs = 600;
  double holdMs = 0;
  double fadeMs = 0;
  int seed = 1;
  Color color = const Color(0xFF1E293B);

  double progress(double clockMs) {
    final raw = (clockMs - bornAt) / math.max(1, writeMs);
    final t = raw.clamp(0.0, 1.0);
    return 1 - math.pow(1 - t, 2.4).toDouble();
  }

  /// Grow-hold-fade opacity for transient pointer indicators — unlike
  /// [progress], this returns to 0 once the pointer has faded out.
  double pointerAlpha(double clockMs) {
    final t = clockMs - bornAt;
    if (t < 0) return 0;
    if (t < writeMs) return 1 - math.pow(1 - (t / writeMs), 2.4).toDouble();
    if (t < writeMs + holdMs) return 1;
    if (t < writeMs + holdMs + fadeMs) {
      return 1 - (t - writeMs - holdMs) / fadeMs;
    }
    return 0;
  }
}

enum _Kind { text, line, circle, rect, circleHighlight, pointer }

class _VoiceWavePainter extends CustomPainter {
  _VoiceWavePainter({
    required this.levels,
    required this.color,
    required this.active,
  });

  final List<double> levels;
  final Color color;
  final bool active;

  @override
  void paint(Canvas canvas, Size size) {
    if (levels.isEmpty || size.width <= 0 || size.height <= 0) return;
    final n = levels.length;
    final barW = math.max(1.4, size.width / (n * 2.8));
    final paint = Paint()
      ..color = color.withValues(alpha: active ? 0.92 : 0.35)
      ..style = PaintingStyle.fill;
    final midY = size.height * 0.5;
    final maxH = size.height * 0.72;
    for (var i = 0; i < n; i++) {
      final h = (2.0 + levels[i] * maxH).clamp(2.0, maxH);
      final x = (i + 0.5) * (size.width / n) - barW / 2;
      final y = midY - h / 2;
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(x, y, barW, h),
          const Radius.circular(1.5),
        ),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _VoiceWavePainter oldDelegate) => true;
}

class _BoardPainter extends CustomPainter {
  _BoardPainter({
    required this.items,
    required this.clockMs,
    required this.rtl,
    required this.boardW,
    required this.boardH,
  });

  final List<_BoardItem> items;
  final double clockMs;
  final bool rtl;
  final double boardW;
  final double boardH;

  @override
  void paint(Canvas canvas, Size size) {
    // Uniform scale — never crush width/height independently.
    final scale = math.min(size.width / boardW, size.height / boardH);
    final dx = (size.width - boardW * scale) / 2;
    final dy = (size.height - boardH * scale) / 2;
    canvas.translate(dx, dy);
    canvas.scale(scale);

    canvas.drawRect(
      Rect.fromLTWH(0, 0, boardW, boardH),
      Paint()..color = const Color(0xFFF7F4EE),
    );

    final grid = Paint()
      ..color = const Color(0xFFE7E0D4)
      ..strokeWidth = 1;
    for (var i = 1; i < 19; i++) {
      canvas.drawLine(Offset(i * 100.0, 0), Offset(i * 100.0, boardH), grid);
    }
    for (var i = 1; i < 10; i++) {
      canvas.drawLine(Offset(0, i * 100.0), Offset(boardW, i * 100.0), grid);
    }

    for (final item in items) {
      if (item.kind == _Kind.pointer) {
        final alpha = item.pointerAlpha(clockMs);
        if (alpha <= 0.01) continue;
        final t = clockMs - item.bornAt;
        final double pulse =
            12.0 + 6.0 * math.min(1.0, t / math.max(1.0, item.writeMs));
        canvas.drawCircle(
          Offset(item.x, item.y),
          pulse + 8,
          Paint()..color = item.color.withValues(alpha: 0.16 * alpha),
        );
        canvas.drawCircle(
          Offset(item.x, item.y),
          pulse,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 3
            ..color = item.color.withValues(alpha: alpha),
        );
        canvas.drawCircle(
          Offset(item.x, item.y),
          4,
          Paint()..color = item.color.withValues(alpha: alpha),
        );
        continue;
      }
      final p = item.progress(clockMs);
      if (p <= 0) continue;
      switch (item.kind) {
        case _Kind.circleHighlight:
          final jx = _handJitter(item.seed, 3, 1.6);
          final jy = _handJitter(item.seed, 4, 1.6);
          final center = Offset(item.cx + jx, item.cy + jy);
          canvas.drawOval(
            Rect.fromCenter(
              center: center,
              width: item.rx * 2,
              height: item.ry * 2,
            ),
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = item.width + 2
              ..color = item.color.withValues(alpha: 0.16 * p),
          );
          canvas.drawOval(
            Rect.fromCenter(
              center: center,
              width: item.rx * 2 * math.max(0.3, p),
              height: item.ry * 2 * math.max(0.3, p),
            ),
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = item.width
              ..color = item.color.withValues(alpha: 0.55 + 0.45 * p),
          );
        case _Kind.text:
          final chars = p >= 0.995
              ? item.text.length
              : math.max(1, (item.text.length * p).ceil());
          final shown = item.text.substring(0, chars.clamp(0, item.text.length));
          final dir =
              item.alignRight || rtl ? TextDirection.rtl : TextDirection.ltr;
          final jx = _handJitter(item.seed, 5, 1.2);
          final shadow = TextPainter(
            text: TextSpan(
              text: shown,
              style: TextStyle(
                color: item.color.withValues(alpha: 0.18),
                fontSize: item.size,
                fontWeight: FontWeight.w600,
                fontFamily: 'Georgia',
              ),
            ),
            textDirection: dir,
            textAlign:
                dir == TextDirection.rtl ? TextAlign.right : TextAlign.left,
          )..layout(maxWidth: 1600);
          final tp = TextPainter(
            text: TextSpan(
              text: shown,
              style: TextStyle(
                color: item.color.withValues(alpha: 0.42 + 0.58 * p),
                fontSize: item.size,
                fontWeight: FontWeight.w600,
                fontFamily: 'Georgia',
              ),
            ),
            textDirection: dir,
            textAlign:
                dir == TextDirection.rtl ? TextAlign.right : TextAlign.left,
          )..layout(maxWidth: 1600);
          final paintX =
              dir == TextDirection.rtl ? item.x - tp.width : item.x;
          shadow.paint(canvas, Offset(paintX + jx + 1.4, item.y - item.size + 1.6));
          tp.paint(canvas, Offset(paintX + jx, item.y - item.size));
        case _Kind.circle:
          final jcx = item.cx + _handJitter(item.seed, 3, 1.4);
          final jcy = item.cy + _handJitter(item.seed, 4, 1.4);
          canvas.drawArc(
            Rect.fromCircle(center: Offset(jcx, jcy), radius: item.r),
            -math.pi / 2,
            2 * math.pi * p,
            false,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = item.width + 2
              ..strokeCap = StrokeCap.round
              ..color = item.color.withValues(alpha: 0.14 * p),
          );
          canvas.drawArc(
            Rect.fromCircle(center: Offset(jcx, jcy), radius: item.r),
            -math.pi / 2,
            2 * math.pi * p,
            false,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = item.width
              ..strokeCap = StrokeCap.round
              ..color = item.color.withValues(alpha: 0.5 + 0.5 * p),
          );
        case _Kind.rect:
          final jx = _handJitter(item.seed, 3, 1.2);
          final jy = _handJitter(item.seed, 4, 1.2);
          final rrect = RRect.fromRectAndRadius(
            Rect.fromLTWH(item.x, item.y, item.w, item.h),
            const Radius.circular(8),
          );
          final shadowPath = Path()
            ..addRRect(rrect.shift(Offset(jx, jy)));
          for (final metric in shadowPath.computeMetrics()) {
            canvas.drawPath(
              metric.extractPath(0, metric.length * p),
              Paint()
                ..style = PaintingStyle.stroke
                ..strokeWidth = item.width + 2
                ..strokeCap = StrokeCap.round
                ..strokeJoin = StrokeJoin.round
                ..color = item.color.withValues(alpha: 0.14 * p),
            );
          }
          final path = Path()..addRRect(rrect);
          for (final metric in path.computeMetrics()) {
            canvas.drawPath(
              metric.extractPath(0, metric.length * p),
              Paint()
                ..style = PaintingStyle.stroke
                ..strokeWidth = item.width
                ..strokeCap = StrokeCap.round
                ..strokeJoin = StrokeJoin.round
                ..color = item.color.withValues(alpha: 0.45 + 0.55 * p),
            );
          }
        case _Kind.line:
          final x2 = item.x1 + (item.x2 - item.x1) * p;
          final y2 = item.y1 + (item.y2 - item.y1) * p;
          final mx = (item.x1 + x2) / 2 + _handJitter(item.seed, 1, 12);
          final my = (item.y1 + y2) / 2 + _handJitter(item.seed, 2, 10);
          final path = Path()
            ..moveTo(item.x1, item.y1)
            ..quadraticBezierTo(mx, my, x2, y2);
          canvas.drawPath(
            path,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = item.width + 1.8
              ..strokeCap = StrokeCap.round
              ..color = item.color.withValues(alpha: 0.16),
          );
          canvas.drawPath(
            path,
            Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = item.width
              ..strokeCap = StrokeCap.round
              ..color = item.color.withValues(alpha: 0.5 + 0.5 * p),
          );
          if (item.arrow && p > 0.82) {
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
                ..color = item.color.withValues(
                  alpha: ((p - 0.82) / 0.18).clamp(0.0, 1.0),
                ),
            );
          }
        case _Kind.pointer:
          // Handled above via pointerAlpha before entering this switch.
          break;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _BoardPainter oldDelegate) =>
      oldDelegate.clockMs != clockMs || oldDelegate.items != items;
}
