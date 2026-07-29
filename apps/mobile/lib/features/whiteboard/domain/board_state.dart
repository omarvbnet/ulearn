import 'package:ulearn/features/whiteboard/domain/smoothing.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';

class BoardStroke {
  BoardStroke({
    required this.id,
    required this.pageId,
    required this.tool,
    required this.color,
    required this.opacity,
    required this.width,
    required this.points,
  });
  final String id;
  final String pageId;
  final WhiteboardTool tool;
  String color;
  double opacity;
  double width;
  List<StrokePoint> points;
}

class BoardText {
  BoardText({
    required this.id,
    required this.pageId,
    required this.x,
    required this.y,
    required this.text,
    required this.color,
    required this.fontSize,
  });
  final String id;
  final String pageId;
  double x;
  double y;
  String text;
  String color;
  double fontSize;
}

class BoardShape {
  BoardShape({
    required this.id,
    required this.pageId,
    required this.kind,
    required this.x1,
    required this.y1,
    required this.x2,
    required this.y2,
    required this.color,
    required this.width,
  });
  final String id;
  final String pageId;
  String kind;
  double x1, y1, x2, y2;
  String color;
  double width;
}

class BoardPage {
  BoardPage({
    required this.id,
    this.kind = 'blank',
    this.pdfAssetId,
    this.pdfPage,
    this.pdfZoom = 1,
  });
  final String id;
  String kind;
  String? pdfAssetId;
  int? pdfPage;
  /// PDF underlay zoom (1 = fit). Applied during studio + playback.
  double pdfZoom;
  final List<BoardStroke> strokes = [];
  final List<BoardText> texts = [];
  final List<BoardShape> shapes = [];
}

class BoardLaser {
  BoardLaser({required this.pageId, required this.x, required this.y, this.visible = true});
  String pageId;
  double x;
  double y;
  bool visible;
}

class BoardState {
  WhiteboardThemeId theme = WhiteboardThemeId.white;
  final List<BoardPage> pages = [];
  String? currentPageId;
  WhiteboardTool tool = WhiteboardTool.pen;
  String color = '#111827';
  double opacity = 1;
  BoardLaser? laser;
  final Map<String, BoardStroke> openStrokes = {};
  /// Bumps on every applied event — drives efficient painter invalidation.
  int revision = 0;

  BoardState() {
    addBlankPage('page_0');
  }

  BoardPage? get currentPage {
    for (final p in pages) {
      if (p.id == currentPageId) return p;
    }
    return pages.isEmpty ? null : pages.first;
  }

  /// If replay ends on an empty/invalid page id, switch to the latest useful page.
  void normalizeCurrentPageForDisplay() {
    if (pages.isEmpty) {
      addBlankPage('page_0');
      return;
    }
    final hasCurrent =
        currentPageId != null && pages.any((p) => p.id == currentPageId);
    if (hasCurrent) {
      final cp = currentPage;
      final useful = cp != null &&
          (cp.kind == 'pdf' ||
              cp.strokes.isNotEmpty ||
              cp.texts.isNotEmpty ||
              cp.shapes.isNotEmpty);
      if (useful) return;
    }
    for (final p in pages.reversed) {
      if (p.kind == 'pdf' ||
          p.strokes.isNotEmpty ||
          p.texts.isNotEmpty ||
          p.shapes.isNotEmpty) {
        currentPageId = p.id;
        return;
      }
    }
    currentPageId = pages.first.id;
  }

  BoardPage? _pageById(Object? id) {
    if (id == null) return currentPage;
    final sid = id.toString();
    for (final p in pages) {
      if (p.id == sid) return p;
    }
    return currentPage;
  }

  void reset() {
    theme = WhiteboardThemeId.white;
    pages.clear();
    currentPageId = null;
    tool = WhiteboardTool.pen;
    color = '#111827';
    opacity = 1;
    laser = null;
    openStrokes.clear();
    revision = 0;
    addBlankPage('page_0');
  }

  BoardPage addBlankPage(String id, {int? index}) {
    final page = BoardPage(id: id);
    if (index == null || index >= pages.length) {
      pages.add(page);
    } else {
      pages.insert(index, page);
    }
    currentPageId = id;
    return page;
  }

  void applyEvents(List<UbrdEvent> events) {
    for (final e in events) {
      apply(e);
    }
  }

  void apply(UbrdEvent e) {
    revision++;
    final p = e.payload;
    switch (e.type) {
      case 'session_start':
      case 'theme_change':
        if (p['theme'] is String) {
          theme = WhiteboardThemeIdX.parse(p['theme'] as String);
        }
        break;
      case 'tool_change':
        if (p['tool'] is String) tool = WhiteboardToolX.parse(p['tool'] as String);
        break;
      case 'color_change':
        if (p['color'] is String) color = p['color'] as String;
        if (p['opacity'] is num) opacity = (p['opacity'] as num).toDouble();
        break;
      case 'page_add':
        final pageId = p['pageId'].toString();
        final existing = pages.where((pg) => pg.id == pageId).firstOrNull;
        final page = existing ??
            addBlankPage(
              pageId,
              index: p['index'] is num ? (p['index'] as num).toInt() : null,
            );
        if (p['kind'] == 'pdf') {
          page.kind = 'pdf';
          page.pdfAssetId = p['pdfAssetId'] as String?;
          page.pdfPage = p['pdfPage'] is num ? (p['pdfPage'] as num).toInt() : 1;
        }
        currentPageId = page.id;
        break;
      case 'page_select':
        currentPageId = p['pageId']?.toString();
        break;
      case 'page_delete':
        pages.removeWhere((pg) => pg.id == p['pageId']);
        if (currentPageId == p['pageId']) {
          currentPageId = pages.isEmpty ? null : pages.first.id;
        }
        break;
      case 'page_clear':
        final clearPage = _pageById(p['pageId']);
        if (clearPage != null) {
          clearPage.strokes.clear();
          clearPage.texts.clear();
          clearPage.shapes.clear();
        }
        break;
      case 'page_duplicate':
        BoardPage? src;
        for (final pg in pages) {
          if (pg.id == p['pageId']) {
            src = pg;
            break;
          }
        }
        if (src == null) break;
        final clone = BoardPage(
          id: p['newPageId'].toString(),
          kind: src.kind,
          pdfAssetId: src.pdfAssetId,
          pdfPage: src.pdfPage,
        );
        for (final s in src.strokes) {
          clone.strokes.add(BoardStroke(
            id: '${s.id}_c',
            pageId: clone.id,
            tool: s.tool,
            color: s.color,
            opacity: s.opacity,
            width: s.width,
            points: s.points.map((pt) => StrokePoint(x: pt.x, y: pt.y, p: pt.p, t: pt.t)).toList(),
          ));
        }
        final idx = p['index'] is num ? (p['index'] as num).toInt() : pages.length;
        pages.insert(idx.clamp(0, pages.length), clone);
        currentPageId = clone.id;
        break;
      case 'stroke_begin':
        openStrokes[p['strokeId'].toString()] = BoardStroke(
          id: p['strokeId'].toString(),
          pageId: p['pageId'].toString(),
          tool: WhiteboardToolX.parse(p['tool'] as String?),
          color: (p['color'] as String?) ?? color,
          opacity: p['opacity'] is num ? (p['opacity'] as num).toDouble() : opacity,
          width: p['width'] is num ? (p['width'] as num).toDouble() : 3.5,
          points: [],
        );
        break;
      case 'stroke_point':
        final stroke = openStrokes[p['strokeId'].toString()];
        if (stroke == null) break;
        stroke.points.add(StrokePoint(
          x: (p['x'] as num).toDouble(),
          y: (p['y'] as num).toDouble(),
          p: (p['p'] as num?)?.toDouble(),
          t: (p['t'] as num?)?.toDouble(),
        ));
        break;
      case 'stroke_end':
        final id = p['strokeId'].toString();
        var stroke = openStrokes[id];
        if (p['points'] is List) {
          final pts = (p['points'] as List)
              .map((e) => StrokePoint.fromJson(Map<String, dynamic>.from(e as Map)))
              .toList();
          stroke ??= BoardStroke(
            id: id,
            pageId: (p['pageId'] ?? currentPageId).toString(),
            tool: WhiteboardToolX.parse(p['tool'] as String?),
            color: (p['color'] as String?) ?? color,
            opacity: p['opacity'] is num ? (p['opacity'] as num).toDouble() : opacity,
            width: p['width'] is num ? (p['width'] as num).toDouble() : 3.5,
            points: pts,
          );
          stroke.points = pts;
        }
        if (stroke == null) break;
        stroke.points = smoothStrokePoints(stroke.points);
        _pageById(stroke.pageId)?.strokes.add(stroke);
        openStrokes.remove(id);
        break;
      case 'erase':
        final erasePage = _pageById(p['pageId']);
        if (erasePage == null) break;
        final ids = ((p['strokeIds'] as List?) ?? []).map((e) => e.toString()).toSet();
        if (ids.isNotEmpty) {
          erasePage.strokes.removeWhere((s) => ids.contains(s.id));
        }
        break;
      case 'text_insert':
        final textPage = _pageById(p['pageId']);
        if (textPage == null) break;
        textPage.texts.add(BoardText(
          id: p['textId'].toString(),
          pageId: textPage.id,
          x: (p['x'] as num).toDouble(),
          y: (p['y'] as num).toDouble(),
          text: p['text']?.toString() ?? '',
          color: (p['color'] as String?) ?? color,
          fontSize: p['fontSize'] is num ? (p['fontSize'] as num).toDouble() : 28,
        ));
        break;
      case 'text_update':
        for (final page in pages) {
          for (final t in page.texts) {
            if (t.id != p['textId']) continue;
            if (p['text'] is String) t.text = p['text'] as String;
            if (p['x'] is num) t.x = (p['x'] as num).toDouble();
            if (p['y'] is num) t.y = (p['y'] as num).toDouble();
          }
        }
        break;
      case 'text_delete':
        for (final page in pages) {
          page.texts.removeWhere((t) => t.id == p['textId']);
        }
        break;
      case 'shape_add':
        final shapePage = _pageById(p['pageId']);
        if (shapePage == null) break;
        final existing = shapePage.shapes.where((s) => s.id == p['shapeId']).toList();
        if (existing.isNotEmpty) {
          final shape = existing.first;
          shape.kind = p['kind']?.toString() ?? shape.kind;
          if (p['x1'] is num) shape.x1 = (p['x1'] as num).toDouble();
          if (p['y1'] is num) shape.y1 = (p['y1'] as num).toDouble();
          if (p['x2'] is num) shape.x2 = (p['x2'] as num).toDouble();
          if (p['y2'] is num) shape.y2 = (p['y2'] as num).toDouble();
          if (p['color'] is String) shape.color = p['color'] as String;
          if (p['width'] is num) shape.width = (p['width'] as num).toDouble();
        } else {
          shapePage.shapes.add(BoardShape(
            id: p['shapeId'].toString(),
            pageId: shapePage.id,
            kind: p['kind']?.toString() ?? 'rect',
            x1: (p['x1'] as num).toDouble(),
            y1: (p['y1'] as num).toDouble(),
            x2: (p['x2'] as num).toDouble(),
            y2: (p['y2'] as num).toDouble(),
            color: (p['color'] as String?) ?? color,
            width: p['width'] is num ? (p['width'] as num).toDouble() : 2,
          ));
        }
        break;
      case 'shape_update':
        for (final page in pages) {
          for (final shape in page.shapes) {
            if (shape.id != p['shapeId']) continue;
            if (p['x1'] is num) shape.x1 = (p['x1'] as num).toDouble();
            if (p['y1'] is num) shape.y1 = (p['y1'] as num).toDouble();
            if (p['x2'] is num) shape.x2 = (p['x2'] as num).toDouble();
            if (p['y2'] is num) shape.y2 = (p['y2'] as num).toDouble();
            if (p['color'] is String) shape.color = p['color'] as String;
            if (p['kind'] is String) shape.kind = p['kind'] as String;
            if (p['width'] is num) shape.width = (p['width'] as num).toDouble();
          }
        }
        break;
      case 'shape_delete':
        for (final page in pages) {
          page.shapes.removeWhere((s) => s.id == p['shapeId']);
        }
        break;
      case 'laser_move':
        laser = BoardLaser(
          pageId: (p['pageId'] ?? currentPageId).toString(),
          x: (p['x'] as num).toDouble(),
          y: (p['y'] as num).toDouble(),
          visible: p['visible'] != false,
        );
        break;
      case 'pdf_open':
      case 'pdf_close':
      case 'pdf_switch':
      case 'pdf_rotate':
        break;
      case 'pdf_zoom':
        final zoomAsset = p['assetId']?.toString();
        final zoom = p['zoom'] is num ? (p['zoom'] as num).toDouble() : null;
        if (zoom == null) break;
        for (final page in pages) {
          if (zoomAsset == null || page.pdfAssetId == zoomAsset) {
            page.pdfZoom = zoom.clamp(0.5, 5.0);
          }
        }
        break;
      case 'pdf_page':
        final assetId = p['assetId']?.toString();
        final pageNum = p['page'] is num ? (p['page'] as num).toInt() : null;
        if (assetId == null || pageNum == null) break;
        for (final page in pages) {
          if (page.pdfAssetId == assetId) {
            page.pdfPage = pageNum;
          }
        }
        break;
      default:
        break;
    }
  }
}
