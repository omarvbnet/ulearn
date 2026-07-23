import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/features/whiteboard/domain/package.dart';
import 'package:ulearn/features/whiteboard/ui/pdf_underlay.dart';

/// Metadata for a whiteboard lesson saved for offline playback.
class WhiteboardOfflineLesson {
  WhiteboardOfflineLesson({
    required this.lessonId,
    required this.courseId,
    required this.title,
    required this.packagePath,
    required this.pdfPaths,
    required this.savedAt,
    this.durationSec,
    this.whiteboardId,
    this.sizeBytes,
  });

  final String lessonId;
  final String courseId;
  final String title;
  final String packagePath;
  final Map<String, String> pdfPaths;
  final DateTime savedAt;
  final int? durationSec;
  final String? whiteboardId;
  final int? sizeBytes;

  Map<String, dynamic> toJson() => {
        'lessonId': lessonId,
        'courseId': courseId,
        'title': title,
        'packagePath': packagePath,
        'pdfPaths': pdfPaths,
        'savedAt': savedAt.toIso8601String(),
        if (durationSec != null) 'durationSec': durationSec,
        if (whiteboardId != null) 'whiteboardId': whiteboardId,
        if (sizeBytes != null) 'sizeBytes': sizeBytes,
      };

  factory WhiteboardOfflineLesson.fromJson(Map<String, dynamic> j) =>
      WhiteboardOfflineLesson(
        lessonId: j['lessonId'] as String,
        courseId: j['courseId'] as String? ?? '',
        title: j['title'] as String? ?? 'Whiteboard',
        packagePath: j['packagePath'] as String,
        pdfPaths: Map<String, String>.from(
          (j['pdfPaths'] as Map?)?.map((k, v) => MapEntry(k.toString(), v.toString())) ?? {},
        ),
        savedAt: DateTime.tryParse(j['savedAt']?.toString() ?? '') ?? DateTime.now(),
        durationSec: (j['durationSec'] as num?)?.toInt(),
        whiteboardId: j['whiteboardId']?.toString(),
        sizeBytes: (j['sizeBytes'] as num?)?.toInt(),
      );
}

typedef WhiteboardOfflineProgress = void Function(double progress, String label);

/// Persists `.ubrd` packages + referenced PDFs under app documents for offline play.
class WhiteboardOfflineStore {
  WhiteboardOfflineStore._();

  static Future<Directory> _root() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory(p.join(docs.path, 'wb_offline'));
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  static Future<File> _indexFile() async {
    final root = await _root();
    return File(p.join(root.path, 'index.json'));
  }

  static Future<List<WhiteboardOfflineLesson>> list() async {
    final file = await _indexFile();
    if (!await file.exists()) return [];
    try {
      final raw = jsonDecode(await file.readAsString());
      if (raw is! List) return [];
      return raw
          .whereType<Map>()
          .map((e) => WhiteboardOfflineLesson.fromJson(Map<String, dynamic>.from(e)))
          .toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> _writeIndex(List<WhiteboardOfflineLesson> items) async {
    final file = await _indexFile();
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(items.map((e) => e.toJson()).toList()),
    );
  }

  static Future<bool> isSaved(String lessonId) async {
    final items = await list();
    return items.any((e) => e.lessonId == lessonId);
  }

  static Future<WhiteboardOfflineLesson?> get(String lessonId) async {
    final items = await list();
    for (final item in items) {
      if (item.lessonId != lessonId) continue;
      if (!await File(item.packagePath).exists()) return null;
      return item;
    }
    return null;
  }

  /// Download package + PDFs and register for offline playback.
  static Future<WhiteboardOfflineLesson> saveLesson({
    required ApiClient api,
    required String lessonId,
    required String courseId,
    required String title,
    String? packageUrl,
    String? whiteboardId,
    int? durationSec,
    WhiteboardOfflineProgress? onProgress,
  }) async {
    onProgress?.call(0.02, 'Resolving package…');
    var url = packageUrl;
    if ((url == null || url.isEmpty) && whiteboardId != null && whiteboardId.isNotEmpty) {
      final res = await api.get('/api/whiteboards/$whiteboardId');
      url = (res['playback'] as Map?)?['packageUrl'] as String?;
    }
    if (url == null || url.isEmpty) throw StateError('NO_PACKAGE_URL');

    onProgress?.call(0.08, 'Downloading board…');
    final pkgRes = await http.get(Uri.parse(ApiClient.absoluteUrl(url)));
    if (pkgRes.statusCode < 200 || pkgRes.statusCode >= 300) {
      throw StateError('PACKAGE_DOWNLOAD_${pkgRes.statusCode}');
    }
    final packageBytes = Uint8List.fromList(pkgRes.bodyBytes);
    final parsed = parseUbrdPackage(packageBytes);

    final root = await _root();
    final lessonDir = Directory(p.join(root.path, lessonId));
    if (await lessonDir.exists()) {
      await lessonDir.delete(recursive: true);
    }
    await lessonDir.create(recursive: true);
    final pdfDir = Directory(p.join(lessonDir.path, 'pdfs'));
    await pdfDir.create(recursive: true);

    final packagePath = p.join(lessonDir.path, 'lesson.ubrd');
    await File(packagePath).writeAsBytes(packageBytes, flush: true);

    final pdfPaths = <String, String>{};
    final pdfs = parsed.pdfs;
    for (var i = 0; i < pdfs.length; i++) {
      final asset = pdfs[i];
      onProgress?.call(
        0.2 + (0.7 * ((i + 1) / (pdfs.length + 1))),
        'Saving PDF ${i + 1}/${pdfs.length}…',
      );
      final pdfUrl = resolveUbrdPdfUrl(asset);
      if (pdfUrl == null) continue;
      final pdfRes = await http.get(Uri.parse(pdfUrl));
      if (pdfRes.statusCode < 200 || pdfRes.statusCode >= 300) continue;
      final safeName = asset.assetId.replaceAll(RegExp(r'[^\w.-]'), '_');
      final pdfPath = p.join(pdfDir.path, '$safeName.pdf');
      await File(pdfPath).writeAsBytes(pdfRes.bodyBytes, flush: true);
      pdfPaths[asset.assetId] = pdfPath;
    }

    onProgress?.call(0.95, 'Finalizing…');
    var sizeBytes = packageBytes.length;
    for (final path in pdfPaths.values) {
      sizeBytes += await File(path).length();
    }

    final lesson = WhiteboardOfflineLesson(
      lessonId: lessonId,
      courseId: courseId,
      title: title,
      packagePath: packagePath,
      pdfPaths: pdfPaths,
      savedAt: DateTime.now().toUtc(),
      durationSec: durationSec ?? (parsed.manifest.durationMs / 1000).round(),
      whiteboardId: whiteboardId,
      sizeBytes: sizeBytes,
    );

    final items = await list();
    items.removeWhere((e) => e.lessonId == lessonId);
    items.insert(0, lesson);
    await _writeIndex(items);
    onProgress?.call(1, 'Saved offline');
    return lesson;
  }

  static Future<void> remove(String lessonId) async {
    final root = await _root();
    final lessonDir = Directory(p.join(root.path, lessonId));
    if (await lessonDir.exists()) {
      await lessonDir.delete(recursive: true);
    }
    final items = await list();
    items.removeWhere((e) => e.lessonId == lessonId);
    await _writeIndex(items);
  }
}
