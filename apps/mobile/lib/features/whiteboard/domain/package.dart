import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:ulearn/features/whiteboard/domain/event_engine.dart';
import 'package:ulearn/features/whiteboard/domain/types.dart';

class UbrdPdfAsset {
  UbrdPdfAsset({
    required this.assetId,
    required this.title,
    this.materialId,
    this.fileKey,
    this.pageCount,
  });
  final String assetId;
  final String title;
  final String? materialId;
  final String? fileKey;
  final int? pageCount;

  Map<String, dynamic> toJson() => {
        'assetId': assetId,
        'title': title,
        if (materialId != null) 'materialId': materialId,
        if (fileKey != null) 'fileKey': fileKey,
        if (pageCount != null) 'pageCount': pageCount,
      };

  factory UbrdPdfAsset.fromJson(Map<String, dynamic> j) => UbrdPdfAsset(
        assetId: j['assetId'] as String,
        title: j['title'] as String? ?? 'PDF',
        materialId: j['materialId'] as String?,
        fileKey: j['fileKey'] as String?,
        pageCount: (j['pageCount'] as num?)?.toInt(),
      );
}

class ParsedUbrdPackage {
  ParsedUbrdPackage({
    required this.manifest,
    required this.events,
    required this.timeline,
    required this.pdfs,
    required this.audioBytes,
    required this.audioFileName,
  });
  final UbrdManifest manifest;
  final List<UbrdEvent> events;
  final Map<String, dynamic> timeline;
  final List<UbrdPdfAsset> pdfs;
  final Uint8List audioBytes;
  final String audioFileName;
}

Future<Uint8List> buildUbrdPackage({
  required EventEngine engine,
  required Uint8List audioBytes,
  required WhiteboardThemeId theme,
  required int pageCount,
  required int durationMs,
  String audioFileName = 'audio.m4a',
  String audioCodec = 'aac',
  List<UbrdPdfAsset> pdfs = const [],
  double boardWidth = kLogicalBoardWidth,
  double boardHeight = kLogicalBoardHeight,
}) async {
  final manifest = UbrdManifest(
    schemaVersion: kUbrdSchemaVersion,
    durationMs: durationMs,
    theme: theme,
    pageCount: pageCount,
    boardWidth: boardWidth,
    boardHeight: boardHeight,
    audioFile: audioFileName,
    audioCodec: audioCodec,
    createdAt: DateTime.now().toUtc().toIso8601String(),
  );

  final archive = Archive();
  void addFile(String name, List<int> data) {
    archive.addFile(ArchiveFile(name, data.length, data));
  }

  addFile('manifest.json', utf8.encode(const JsonEncoder.withIndent('  ').convert(manifest.toJson())));
  addFile('board.events', utf8.encode(engine.toNdjson()));
  addFile('timeline.json', utf8.encode(jsonEncode(engine.buildTimeline())));
  addFile(
    'assets.json',
    utf8.encode(const JsonEncoder.withIndent('  ').convert({
      'pdfs': pdfs.map((p) => p.toJson()).toList(),
    })),
  );
  addFile(audioFileName, audioBytes);

  final encoded = ZipEncoder().encode(archive);
  return Uint8List.fromList(encoded);
}

ParsedUbrdPackage parseUbrdPackage(Uint8List bytes) {
  final archive = ZipDecoder().decodeBytes(bytes);
  ArchiveFile? find(String name) {
    for (final f in archive.files) {
      if (f.name == name || f.name.endsWith('/$name')) return f;
    }
    return null;
  }

  final manifestFile = find('manifest.json');
  if (manifestFile == null) throw StateError('INVALID_PACKAGE_MANIFEST');
  final manifest = UbrdManifest.fromJson(
    jsonDecode(utf8.decode(manifestFile.content as List<int>)) as Map<String, dynamic>,
  );

  final eventsFile = find('board.events');
  final events = EventEngine.parseNdjson(
    eventsFile == null ? '' : utf8.decode(eventsFile.content as List<int>),
  );

  final timelineFile = find('timeline.json');
  final timeline = timelineFile == null
      ? <String, dynamic>{'cues': [], 'intervalMs': 5000}
      : jsonDecode(utf8.decode(timelineFile.content as List<int>)) as Map<String, dynamic>;

  final assetsFile = find('assets.json');
  final assetsJson = assetsFile == null
      ? <String, dynamic>{'pdfs': []}
      : jsonDecode(utf8.decode(assetsFile.content as List<int>)) as Map<String, dynamic>;
  final pdfs = ((assetsJson['pdfs'] as List?) ?? [])
      .map((e) => UbrdPdfAsset.fromJson(Map<String, dynamic>.from(e as Map)))
      .toList();

  ArchiveFile? audio = find(manifest.audioFile);
  audio ??= find('audio.m4a') ?? find('audio.webm') ?? find('audio.opus');
  if (audio == null) throw StateError('INVALID_PACKAGE_AUDIO');

  return ParsedUbrdPackage(
    manifest: manifest,
    events: events,
    timeline: timeline,
    pdfs: pdfs,
    audioBytes: Uint8List.fromList(audio.content as List<int>),
    audioFileName: audio.name.split('/').last,
  );
}
