class WhiteboardEditRange {
  WhiteboardEditRange({
    required this.id,
    required this.startMs,
    required this.endMs,
    this.kind = 'redraw',
    this.removedMs,
  });

  final String id;
  final int startMs;
  final int endMs;
  final String kind;
  final int? removedMs;

  Map<String, dynamic> toJson() => {
        'id': id,
        'startMs': startMs,
        'endMs': endMs,
        'kind': kind,
        if (removedMs != null) 'removedMs': removedMs,
      };
}

List<WhiteboardEditRange> markDirtyRange(
  List<WhiteboardEditRange> existing,
  int startMs,
  int endMs, {
  String kind = 'redraw',
  int bufferMs = 1500,
}) {
  final lo = (startMs < endMs ? startMs : endMs) - bufferMs;
  final hi = (startMs < endMs ? endMs : startMs) + bufferMs;
  final next = [
    ...existing,
    WhiteboardEditRange(
      id: 'r_${DateTime.now().millisecondsSinceEpoch}',
      startMs: lo < 0 ? 0 : lo,
      endMs: hi < 0 ? 0 : hi,
      kind: kind,
    ),
  ];
  return mergeEditRanges(next);
}

List<WhiteboardEditRange> mergeEditRanges(List<WhiteboardEditRange> ranges) {
  if (ranges.length <= 1) return List.of(ranges);
  final sorted = List.of(ranges)
    ..sort((a, b) {
      final c = a.startMs.compareTo(b.startMs);
      return c != 0 ? c : a.endMs.compareTo(b.endMs);
    });
  final out = <WhiteboardEditRange>[];
  for (final r in sorted) {
    if (out.isEmpty || r.startMs > out.last.endMs + 500) {
      out.add(r);
      continue;
    }
    final last = out.removeLast();
    out.add(WhiteboardEditRange(
      id: last.id,
      startMs: last.startMs,
      endMs: r.endMs > last.endMs ? r.endMs : last.endMs,
      kind: r.kind == 'trim' || last.kind == 'trim'
          ? 'trim'
          : (r.kind == 'audio' || last.kind == 'audio' ? 'audio' : last.kind),
      removedMs: (last.removedMs ?? 0) + (r.removedMs ?? 0) > 0
          ? (last.removedMs ?? 0) + (r.removedMs ?? 0)
          : null,
    ));
  }
  return out;
}
