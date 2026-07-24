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
    required this.packageRelPath,
    required this.pdfRelPaths,
    required this.savedAt,
    this.courseTitle,
    this.durationSec,
    this.whiteboardId,
    this.sizeBytes,
  });

  final String lessonId;
  final String courseId;
  final String title;
  final String? courseTitle;
  /// Path relative to the offline root (survives app container path changes).
  final String packageRelPath;
  final Map<String, String> pdfRelPaths;
  final DateTime savedAt;
  final int? durationSec;
  final String? whiteboardId;
  final int? sizeBytes;

  Map<String, dynamic> toJson() => {
        'lessonId': lessonId,
        'courseId': courseId,
        'title': title,
        if (courseTitle != null) 'courseTitle': courseTitle,
        'packageRelPath': packageRelPath,
        'pdfRelPaths': pdfRelPaths,
        'savedAt': savedAt.toIso8601String(),
        if (durationSec != null) 'durationSec': durationSec,
        if (whiteboardId != null) 'whiteboardId': whiteboardId,
        if (sizeBytes != null) 'sizeBytes': sizeBytes,
      };

  factory WhiteboardOfflineLesson.fromJson(Map<String, dynamic> j) {
    final lessonId = j['lessonId']?.toString() ?? '';
    // Prefer relative paths; fall back to legacy absolute packagePath.
    var packageRel = j['packageRelPath']?.toString();
    if (packageRel == null || packageRel.isEmpty) {
      final legacyPkg = j['packagePath']?.toString();
      packageRel = legacyPkg != null && legacyPkg.isNotEmpty
          ? p.join(lessonId, 'lesson.ubrd')
          : '';
    }

    Map<String, String> pdfRels = {};
    if (j['pdfRelPaths'] is Map) {
      pdfRels = Map<String, String>.from(
        (j['pdfRelPaths'] as Map).map((k, v) => MapEntry(k.toString(), v.toString())),
      );
    } else if (j['pdfPaths'] is Map) {
      pdfRels = Map<String, String>.from(
        (j['pdfPaths'] as Map).map((k, v) {
          final name = p.basename(v.toString());
          return MapEntry(k.toString(), p.join(lessonId, 'pdfs', name));
        }),
      );
    }

    return WhiteboardOfflineLesson(
      lessonId: lessonId,
      courseId: j['courseId'] as String? ?? '',
      title: j['title'] as String? ?? 'Whiteboard',
      courseTitle: j['courseTitle']?.toString(),
      packageRelPath: packageRel,
      pdfRelPaths: pdfRels,
      savedAt: DateTime.tryParse(j['savedAt']?.toString() ?? '') ?? DateTime.now(),
      durationSec: (j['durationSec'] as num?)?.toInt(),
      whiteboardId: j['whiteboardId']?.toString(),
      sizeBytes: (j['sizeBytes'] as num?)?.toInt(),
    );
  }
}

/// A course that has at least one offline board lesson.
class WhiteboardOfflineCourse {
  WhiteboardOfflineCourse({
    required this.courseId,
    required this.title,
    required this.lessons,
  });

  final String courseId;
  final String title;
  final List<WhiteboardOfflineLesson> lessons;
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

  static Future<String> absolutePath(String relativeOrAbsolute) async {
    if (p.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
    final root = await _root();
    return p.join(root.path, relativeOrAbsolute);
  }

  static Future<List<WhiteboardOfflineLesson>> list() async {
    final file = await _indexFile();
    if (!await file.exists()) return [];
    try {
      final raw = jsonDecode(await file.readAsString());
      if (raw is! List) return [];
      final items = raw
          .whereType<Map>()
          .map((e) => WhiteboardOfflineLesson.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      // Drop entries whose package file is gone.
      final alive = <WhiteboardOfflineLesson>[];
      var migrated = false;
      for (final item in items) {
        final abs = await absolutePath(item.packageRelPath);
        if (await File(abs).exists()) {
          alive.add(item);
        } else {
          migrated = true;
        }
        // Rewrite legacy absolute index entries to relative on next save.
        if (item.packageRelPath.contains(Platform.pathSeparator) &&
            p.isAbsolute(item.packageRelPath)) {
          migrated = true;
        }
      }
      if (migrated || alive.length != items.length) {
        // Normalize any remaining absolute paths to relative form.
        final normalized = <WhiteboardOfflineLesson>[];
        for (final item in alive) {
          normalized.add(await _normalizeLesson(item));
        }
        await _writeIndex(normalized);
        return normalized;
      }
      return alive;
    } catch (_) {
      return [];
    }
  }

  static Future<WhiteboardOfflineLesson> _normalizeLesson(WhiteboardOfflineLesson item) async {
    final root = await _root();
    var pkgRel = item.packageRelPath;
    if (p.isAbsolute(pkgRel)) {
      pkgRel = p.join(item.lessonId, 'lesson.ubrd');
      final expected = p.join(root.path, pkgRel);
      if (!await File(expected).exists() && await File(item.packageRelPath).exists()) {
        // Best effort: keep working with absolute until file is re-saved.
        pkgRel = item.packageRelPath;
      }
    }
    final pdfRels = <String, String>{};
    for (final e in item.pdfRelPaths.entries) {
      var rel = e.value;
      if (p.isAbsolute(rel)) {
        rel = p.join(item.lessonId, 'pdfs', p.basename(rel));
      }
      pdfRels[e.key] = rel;
    }
    return WhiteboardOfflineLesson(
      lessonId: item.lessonId,
      courseId: item.courseId,
      title: item.title,
      courseTitle: item.courseTitle,
      packageRelPath: pkgRel,
      pdfRelPaths: pdfRels,
      savedAt: item.savedAt,
      durationSec: item.durationSec,
      whiteboardId: item.whiteboardId,
      sizeBytes: item.sizeBytes,
    );
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
      final abs = await absolutePath(item.packageRelPath);
      if (!await File(abs).exists()) return null;
      return item;
    }
    return null;
  }

  static Future<Map<String, String>> resolvedPdfPaths(WhiteboardOfflineLesson lesson) async {
    final out = <String, String>{};
    for (final e in lesson.pdfRelPaths.entries) {
      out[e.key] = await absolutePath(e.value);
    }
    return out;
  }

  static Future<String> resolvedPackagePath(WhiteboardOfflineLesson lesson) async {
    return absolutePath(lesson.packageRelPath);
  }

  /// Courses that have offline board lessons (for My Courses / cold-start offline).
  static Future<List<WhiteboardOfflineCourse>> listCourses() async {
    final lessons = await list();
    final byCourse = <String, List<WhiteboardOfflineLesson>>{};
    for (final l in lessons) {
      byCourse.putIfAbsent(l.courseId, () => []).add(l);
    }
    final courses = <WhiteboardOfflineCourse>[];
    for (final e in byCourse.entries) {
      final title = e.value
              .map((l) => l.courseTitle)
              .firstWhere((t) => t != null && t.trim().isNotEmpty, orElse: () => null)
              ?.trim() ??
          'Offline course';
      courses.add(WhiteboardOfflineCourse(
        courseId: e.key,
        title: title,
        lessons: e.value,
      ));
    }
    courses.sort((a, b) {
      final aAt = a.lessons.map((l) => l.savedAt).fold<DateTime>(
            DateTime.fromMillisecondsSinceEpoch(0),
            (p, c) => c.isAfter(p) ? c : p,
          );
      final bAt = b.lessons.map((l) => l.savedAt).fold<DateTime>(
            DateTime.fromMillisecondsSinceEpoch(0),
            (p, c) => c.isAfter(p) ? c : p,
          );
      return bAt.compareTo(aAt);
    });
    return courses;
  }

  /// Cards shaped like `/api/my-courses` store entries for offline UI.
  static Future<List<Map<String, dynamic>>> libraryCourseCards() async {
    final courses = await listCourses();
    return [
      for (final c in courses)
        {
          'id': c.courseId,
          'type': 'store',
          'title': c.title,
          'titleEn': c.title,
          'lessonType': 'WHITEBOARD',
          'offlineOnly': true,
          'progressPct': 0,
          'lessonCount': c.lessons.length,
          'completedLessons': 0,
        },
    ];
  }

  /// Download package + PDFs and register for offline playback.
  static Future<WhiteboardOfflineLesson> saveLesson({
    required ApiClient api,
    required String lessonId,
    required String courseId,
    required String title,
    String? courseTitle,
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

    final packageRel = p.join(lessonId, 'lesson.ubrd');
    final packageAbs = p.join(root.path, packageRel);
    await File(packageAbs).writeAsBytes(packageBytes, flush: true);

    final pdfRelPaths = <String, String>{};
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
      final pdfRel = p.join(lessonId, 'pdfs', '$safeName.pdf');
      await File(p.join(root.path, pdfRel)).writeAsBytes(pdfRes.bodyBytes, flush: true);
      pdfRelPaths[asset.assetId] = pdfRel;
    }

    onProgress?.call(0.95, 'Finalizing…');
    var sizeBytes = packageBytes.length;
    for (final rel in pdfRelPaths.values) {
      sizeBytes += await File(p.join(root.path, rel)).length();
    }

    // Keep a previously known course title if caller omitted it.
    String? resolvedCourseTitle = courseTitle?.trim();
    if (resolvedCourseTitle == null || resolvedCourseTitle.isEmpty) {
      final existing = await list();
      for (final e in existing) {
        if (e.courseId == courseId &&
            e.courseTitle != null &&
            e.courseTitle!.trim().isNotEmpty) {
          resolvedCourseTitle = e.courseTitle;
          break;
        }
      }
    }

    final lesson = WhiteboardOfflineLesson(
      lessonId: lessonId,
      courseId: courseId,
      title: title,
      courseTitle: resolvedCourseTitle,
      packageRelPath: packageRel,
      pdfRelPaths: pdfRelPaths,
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

  /// Backfill course titles on existing offline lessons (e.g. after online course load).
  static Future<void> touchCourseTitle(String courseId, String title) async {
    final trimmed = title.trim();
    if (courseId.isEmpty || trimmed.isEmpty) return;
    final items = await list();
    var changed = false;
    final updated = <WhiteboardOfflineLesson>[];
    for (final item in items) {
      if (item.courseId == courseId &&
          (item.courseTitle == null || item.courseTitle!.trim().isEmpty)) {
        changed = true;
        updated.add(WhiteboardOfflineLesson(
          lessonId: item.lessonId,
          courseId: item.courseId,
          title: item.title,
          courseTitle: trimmed,
          packageRelPath: item.packageRelPath,
          pdfRelPaths: item.pdfRelPaths,
          savedAt: item.savedAt,
          durationSec: item.durationSec,
          whiteboardId: item.whiteboardId,
          sizeBytes: item.sizeBytes,
        ));
      } else {
        updated.add(item);
      }
    }
    if (changed) await _writeIndex(updated);
  }
}
