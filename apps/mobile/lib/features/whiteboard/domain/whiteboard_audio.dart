import 'dart:io';
import 'dart:typed_data';

import 'package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart';
import 'package:ffmpeg_kit_flutter_new/return_code.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Writes whiteboard package audio to a stable cache file for local playback.
///
/// Android course-detail playback must not use [video_player]/fvp for
/// audio-only packages — use [just_audio] with this file instead.
Future<File> writeWhiteboardAudioFile({
  required String lessonId,
  required String audioFileName,
  required Uint8List audioBytes,
}) async {
  final dir = await getTemporaryDirectory();
  final safeLesson = lessonId.replaceAll(RegExp(r'[^\w.-]'), '_');
  var name = p.basename(audioFileName).trim();
  if (name.isEmpty) name = 'audio.m4a';
  // Keep a recognizable extension so ExoPlayer/AVPlayer sniff correctly.
  final lower = name.toLowerCase();
  if (!lower.endsWith('.m4a') &&
      !lower.endsWith('.mp4') &&
      !lower.endsWith('.aac') &&
      !lower.endsWith('.mp3') &&
      !lower.endsWith('.webm') &&
      !lower.endsWith('.opus') &&
      !lower.endsWith('.wav') &&
      !lower.endsWith('.ogg')) {
    name = '$name.m4a';
  }
  final file = File(p.join(dir.path, 'wb_play_${safeLesson}_$name'));
  await file.writeAsBytes(audioBytes, flush: true);
  return file;
}

bool whiteboardAudioLikelyNeedsTranscode(String fileName, {String? codec}) {
  final lower = fileName.toLowerCase();
  final c = (codec ?? '').toLowerCase();
  return lower.endsWith('.webm') ||
      lower.endsWith('.opus') ||
      lower.endsWith('.ogg') ||
      c.contains('opus') ||
      c.contains('vorbis') ||
      c.contains('webm');
}

/// Converts WebM/Opus (typical web-studio boards) to AAC/M4A for Android.
Future<File> transcodeWhiteboardAudioToAac(File input) async {
  final out = File(
    p.join(
      p.dirname(input.path),
      '${p.basenameWithoutExtension(input.path)}_aac.m4a',
    ),
  );
  if (await out.exists()) {
    try {
      await out.delete();
    } catch (_) {}
  }
  // Escape paths for the shell-style FFmpegKit.execute command.
  final inPath = input.path.replaceAll("'", r"'\''");
  final outPath = out.path.replaceAll("'", r"'\''");
  final session = await FFmpegKit.execute(
    "-y -i '$inPath' -vn -c:a aac -b:a 128k '$outPath'",
  );
  final code = await session.getReturnCode();
  if (!ReturnCode.isSuccess(code) || !await out.exists()) {
    final fail = await session.getFailStackTrace();
    throw StateError('AUDIO_TRANSCODE_FAILED: $fail');
  }
  return out;
}
