/// Shared UBRD domain types — keep in sync with apps/web/src/lib/whiteboard/types.ts
library;

const int kUbrdSchemaVersion = 1;
const double kLogicalBoardWidth = 1920;
const double kLogicalBoardHeight = 1080;

enum WhiteboardThemeId { white, black, green }

extension WhiteboardThemeIdX on WhiteboardThemeId {
  String get wire => switch (this) {
        WhiteboardThemeId.white => 'WHITE',
        WhiteboardThemeId.black => 'BLACK',
        WhiteboardThemeId.green => 'GREEN',
      };

  static WhiteboardThemeId parse(String? v) {
    switch ((v ?? '').toUpperCase()) {
      case 'BLACK':
        return WhiteboardThemeId.black;
      case 'GREEN':
      case 'CHALK':
      case 'CHALKBOARD':
        return WhiteboardThemeId.green;
      default:
        return WhiteboardThemeId.white;
    }
  }

  WhiteboardThemeId get next => switch (this) {
        WhiteboardThemeId.white => WhiteboardThemeId.green,
        WhiteboardThemeId.green => WhiteboardThemeId.black,
        WhiteboardThemeId.black => WhiteboardThemeId.white,
      };
}

enum WhiteboardTool {
  pen,
  pencil,
  highlighter,
  eraser,
  text,
  laser,
  rect,
  circle,
  line,
  arrow,
  select,
}

extension WhiteboardToolX on WhiteboardTool {
  String get wire => name;
  static WhiteboardTool parse(String? v) {
    return WhiteboardTool.values.firstWhere(
      (e) => e.name == v,
      orElse: () => WhiteboardTool.pen,
    );
  }
}

class StrokePoint {
  StrokePoint({required this.x, required this.y, this.p, this.t});
  final double x;
  final double y;
  final double? p;
  final double? t;

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        if (p != null) 'p': p,
        if (t != null) 't': t,
      };

  factory StrokePoint.fromJson(Map<String, dynamic> j) => StrokePoint(
        x: (j['x'] as num).toDouble(),
        y: (j['y'] as num).toDouble(),
        p: (j['p'] as num?)?.toDouble(),
        t: (j['t'] as num?)?.toDouble(),
      );
}

class UbrdEvent {
  UbrdEvent({
    required this.id,
    required this.t,
    required this.type,
    required this.payload,
  });

  final String id;
  final int t;
  final String type;
  final Map<String, dynamic> payload;

  Map<String, dynamic> toJson() => {
        'id': id,
        't': t,
        'type': type,
        'payload': payload,
      };

  factory UbrdEvent.fromJson(Map<String, dynamic> j) => UbrdEvent(
        id: j['id'] as String,
        t: (j['t'] as num).toInt(),
        type: j['type'] as String,
        payload: Map<String, dynamic>.from(j['payload'] as Map? ?? {}),
      );
}

class UbrdManifest {
  UbrdManifest({
    required this.schemaVersion,
    required this.durationMs,
    required this.theme,
    required this.pageCount,
    required this.boardWidth,
    required this.boardHeight,
    required this.audioFile,
    required this.audioCodec,
    required this.createdAt,
  });

  final int schemaVersion;
  final int durationMs;
  final WhiteboardThemeId theme;
  final int pageCount;
  final double boardWidth;
  final double boardHeight;
  final String audioFile;
  final String audioCodec;
  final String createdAt;

  Map<String, dynamic> toJson() => {
        'schemaVersion': schemaVersion,
        'format': 'ubrd',
        'durationMs': durationMs,
        'theme': theme.wire,
        'pageCount': pageCount,
        'boardWidth': boardWidth,
        'boardHeight': boardHeight,
        'audioFile': audioFile,
        'audioCodec': audioCodec,
        'createdAt': createdAt,
        'app': 'ulearn-whiteboard',
        'appVersion': '1',
      };

  factory UbrdManifest.fromJson(Map<String, dynamic> j) => UbrdManifest(
        schemaVersion: (j['schemaVersion'] as num?)?.toInt() ?? 1,
        durationMs: (j['durationMs'] as num).toInt(),
        theme: WhiteboardThemeIdX.parse(j['theme'] as String?),
        pageCount: (j['pageCount'] as num?)?.toInt() ?? 1,
        boardWidth: (j['boardWidth'] as num?)?.toDouble() ?? kLogicalBoardWidth,
        boardHeight: (j['boardHeight'] as num?)?.toDouble() ?? kLogicalBoardHeight,
        audioFile: j['audioFile'] as String? ?? 'audio.webm',
        audioCodec: j['audioCodec'] as String? ?? 'opus',
        createdAt: j['createdAt'] as String? ?? '',
      );
}
