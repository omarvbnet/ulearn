import 'dart:convert';
import 'dart:math';

import 'package:ulearn/features/whiteboard/domain/types.dart';

class EventEngine {
  final List<UbrdEvent> _events = [];
  DateTime? _startedAt;
  final _rand = Random();

  bool get isRecording => _startedAt != null;
  int get length => _events.length;
  List<UbrdEvent> get all => List.unmodifiable(_events);

  void start([DateTime? now]) {
    _events.clear();
    _startedAt = now ?? DateTime.now();
  }

  int now([DateTime? wall]) {
    if (_startedAt == null) return 0;
    final w = wall ?? DateTime.now();
    return w.difference(_startedAt!).inMilliseconds.clamp(0, 1 << 31);
  }

  UbrdEvent push(String type, Map<String, dynamic> payload, {String? id}) {
    final ev = UbrdEvent(
      id: id ?? 'e_${_rand.nextInt(1 << 32).toRadixString(16)}_${now()}',
      t: now(),
      type: type,
      payload: payload,
    );
    _events.add(ev);
    return ev;
  }

  void load(List<UbrdEvent> events) {
    _startedAt = null;
    _events
      ..clear()
      ..addAll(events)
      ..sort((a, b) {
        final c = a.t.compareTo(b.t);
        return c != 0 ? c : a.id.compareTo(b.id);
      });
  }

  int stop({int? durationMs}) {
    final t = durationMs ?? now();
    push('session_end', {'durationMs': t});
    _startedAt = null;
    return t;
  }

  List<UbrdEvent> eventsUpTo(int t) {
    final out = <UbrdEvent>[];
    for (final e in _events) {
      if (e.t > t) break;
      out.add(e);
    }
    return out;
  }

  int indexAfter(int t) {
    var lo = 0;
    var hi = _events.length;
    while (lo < hi) {
      final mid = (lo + hi) >> 1;
      if (_events[mid].t <= t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  Map<String, dynamic> buildTimeline({int intervalMs = 5000, int? maxDurationMs}) {
    final cues = <Map<String, dynamic>>[
      {'t': 0, 'eventOffset': 0, 'snapshot': null},
    ];
    if (_events.isEmpty) return {'cues': cues, 'intervalMs': intervalMs};
    final lastT = _events.last.t;
    final maxT = [
      maxDurationMs ?? lastT,
      lastT,
      24 * 60 * 60 * 1000,
    ].reduce((a, b) => a < b ? a : b);
    for (var t = intervalMs; t <= maxT; t += intervalMs) {
      cues.add({'t': t, 'eventOffset': indexAfter(t - 1), 'snapshot': null});
    }
    return {'cues': cues, 'intervalMs': intervalMs};
  }

  String toNdjson() {
    if (_events.isEmpty) return '';
    return '${_events.map((e) => jsonEncode(e.toJson())).join('\n')}\n';
  }

  static List<UbrdEvent> parseNdjson(String text) {
    return text
        .split('\n')
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty)
        .map((l) => UbrdEvent.fromJson(jsonDecode(l) as Map<String, dynamic>))
        .toList();
  }
}
