import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

typedef UploadProgressCallback = void Function(int sent, int total);

class ApiClient {
  /// Production API. For local development override with:
  /// flutter run --dart-define=API_BASE_URL=http://[your-mac-ip]:3000
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://ulearn.usmart-iot.com',
  );

  /// Regular JSON requests must never hang forever — a stalled connection
  /// (weak signal, dropped socket, backend hiccup) used to freeze the whole
  /// AI classroom because nothing timed out and the loop just waited.
  static const Duration _requestTimeout = Duration(seconds: 30);

  Never _throwTimeout() => throw ApiException(
        'Request timed out. Please check your connection and try again.',
        408,
      );

  final _storage = const FlutterSecureStorage();
  String? _token;

  Future<void> loadToken() async {
    _token = await _storage.read(key: 'session_token');
  }

  Future<void> setToken(String? token) async {
    _token = token;
    if (token == null) {
      await _storage.delete(key: 'session_token');
    } else {
      await _storage.write(key: 'session_token', value: token);
    }
  }

  /// Server-relative URLs (e.g. `/uploads/...`) need the API origin prefixed.
  static String absoluteUrl(String url) {
    final u = url.trim();
    if (u.isEmpty) return u;
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    if (u.startsWith('//')) return 'https:$u';
    if (u.startsWith('/')) return '$baseUrl$u';
    return '$baseUrl/$u';
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
        if (_token != null) 'Cookie': 'ulearn_session=$_token',
      };

  Map<String, dynamic> _decodeBody(String body, int statusCode) {
    final trimmed = body.trim();
    if (trimmed.isEmpty) {
      throw ApiException(
        statusCode == 413
            ? 'File too large for upload'
            : 'Empty response ($statusCode)',
        statusCode,
      );
    }
    try {
      final decoded = jsonDecode(trimmed);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } catch (_) {
      // Non-JSON (e.g. nginx "Request Entity Too Large")
    }
    final message = trimmed.length > 180 ? '${trimmed.substring(0, 180)}…' : trimmed;
    throw ApiException(
      statusCode == 413 || message.toLowerCase().contains('too large')
          ? 'Files are too large to send directly. Try fewer or smaller PDFs.'
          : message,
      statusCode >= 400 ? statusCode : 500,
    );
  }

  /// [timeout] overrides the default 30s ceiling — LLM-backed endpoints
  /// (classroom session start/beat/turn) can legitimately take longer than
  /// a plain CRUD call and pass a longer budget explicitly.
  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> body, {
    Duration? timeout,
  }) async {
    final res = await http
        .post(
          Uri.parse('$baseUrl$path'),
          headers: _headers,
          body: jsonEncode(body),
        )
        .timeout(timeout ?? _requestTimeout, onTimeout: _throwTimeout);
    final data = _decodeBody(res.body, res.statusCode);
    if (res.statusCode >= 400) {
      throw ApiException(data['error']?.toString() ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  /// Stream a classroom SSE endpoint. Invokes [onEvent] for each parsed
  /// event (`status` / `session` / `speak` / `board` / `complete` / …).
  /// Falls back to a single synthetic `complete` event when the server
  /// returns plain JSON (older deployments that ignore `stream: true`).
  Future<void> postSse(
    String path,
    Map<String, dynamic> body, {
    required void Function(String type, Map<String, dynamic> data) onEvent,
    Duration? timeout,
  }) async {
    final req = http.Request('POST', Uri.parse('$baseUrl$path'));
    req.headers.addAll({
      ..._headers,
      'Accept': 'text/event-stream',
    });
    final payload = Map<String, dynamic>.from(body)..['stream'] = true;
    req.body = jsonEncode(payload);
    final client = http.Client();
    try {
      final streamed = await client
          .send(req)
          .timeout(timeout ?? _requestTimeout, onTimeout: _throwTimeout);
      if (streamed.statusCode >= 400) {
        final errBody = await streamed.stream.bytesToString();
        final data = _decodeBody(errBody, streamed.statusCode);
        throw ApiException(
          data['error']?.toString() ?? 'Request failed',
          streamed.statusCode,
        );
      }
      final ctype = streamed.headers['content-type'] ?? '';
      if (!ctype.contains('text/event-stream')) {
        final raw = await streamed.stream.bytesToString();
        final data = _decodeBody(raw, streamed.statusCode);
        if (data['needsMaterialSelection'] == true) {
          onEvent('needs_materials', data);
          return;
        }
        onEvent('complete', {
          'type': 'complete',
          'beat': data['beat'],
          'session': data['session'],
        });
        return;
      }
      final lines = streamed.stream
          .transform(utf8.decoder)
          .transform(const LineSplitter());
      var eventName = 'message';
      final dataBuf = StringBuffer();
      await for (final line in lines.timeout(
        timeout ?? _requestTimeout,
        onTimeout: (sink) {
          sink.close();
          _throwTimeout();
        },
      )) {
        if (line.isEmpty) {
          if (dataBuf.isNotEmpty) {
            try {
              final decoded = jsonDecode(dataBuf.toString());
              if (decoded is Map) {
                final map = Map<String, dynamic>.from(decoded);
                final type = (map['type'] ?? eventName).toString();
                onEvent(type, map);
              }
            } catch (_) {
              /* ignore malformed SSE frame */
            }
          }
          eventName = 'message';
          dataBuf.clear();
          continue;
        }
        if (line.startsWith('event:')) {
          eventName = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          if (dataBuf.isNotEmpty) dataBuf.write('\n');
          dataBuf.write(line.substring(5).trim());
        }
      }
    } finally {
      client.close();
    }
  }

  Future<Map<String, dynamic>> get(String path) async {
    final res = await http
        .get(Uri.parse('$baseUrl$path'), headers: _headers)
        .timeout(_requestTimeout, onTimeout: _throwTimeout);
    final data = _decodeBody(res.body, res.statusCode);
    if (res.statusCode >= 400) {
      throw ApiException(data['error']?.toString() ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) async {
    final res = await http
        .patch(
          Uri.parse('$baseUrl$path'),
          headers: _headers,
          body: jsonEncode(body),
        )
        .timeout(_requestTimeout, onTimeout: _throwTimeout);
    final data = _decodeBody(res.body, res.statusCode);
    if (res.statusCode >= 400) {
      throw ApiException(data['error']?.toString() ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  Future<Map<String, dynamic>> delete(String path, [Map<String, dynamic>? body]) async {
    final res = await http
        .delete(
          Uri.parse('$baseUrl$path'),
          headers: _headers,
          body: body != null ? jsonEncode(body) : null,
        )
        .timeout(_requestTimeout, onTimeout: _throwTimeout);
    final data = _decodeBody(res.body, res.statusCode);
    if (res.statusCode >= 400) {
      throw ApiException(data['error']?.toString() ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  /// Authenticated binary GET (e.g. creative job download).
  Future<Uint8List> getBytes(String path) async {
    final res = await http.get(
      Uri.parse(absoluteUrl(path)),
      headers: {
        if (_token != null) 'Authorization': 'Bearer $_token',
        if (_token != null) 'Cookie': 'ulearn_session=$_token',
      },
    );
    if (res.statusCode >= 400) {
      _decodeBody(res.body, res.statusCode);
      throw ApiException('Download failed', res.statusCode);
    }
    return res.bodyBytes;
  }

  /// Raw binary PUT used for presigned/direct file uploads (small payloads).
  /// Bytes are streamed in chunks so [onProgress] reports real percentages.
  Future<void> putBytes(
    String url,
    Uint8List bytes,
    String contentType, {
    UploadProgressCallback? onProgress,
  }) async {
    await _putWithRetry(
      url: url,
      contentType: contentType,
      contentLength: bytes.length,
      openBody: () => _chunkedBytes(bytes),
      onProgress: onProgress,
    );
  }

  /// Yields [bytes] in ~64KB pieces so upload progress can update smoothly.
  Stream<List<int>> _chunkedBytes(Uint8List bytes, {int chunkSize = 64 * 1024}) async* {
    if (bytes.isEmpty) {
      yield bytes;
      return;
    }
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      final end = math.min(offset + chunkSize, bytes.length);
      yield bytes.sublist(offset, end);
    }
  }

  /// Stream a file to a presigned/direct upload URL (videos & large files).
  /// Progress callbacks fire while bytes are sent over the network.
  Future<void> putFile(
    String url,
    File file,
    String contentType, {
    UploadProgressCallback? onProgress,
    Duration? timeout,
  }) async {
    final length = await file.length();
    await _putWithRetry(
      url: url,
      contentType: contentType,
      contentLength: length,
      openBody: () => file.openRead(),
      onProgress: onProgress,
      timeout: timeout ?? _uploadTimeoutFor(length),
    );
  }

  Duration _uploadTimeoutFor(int bytes) {
    final extraMinutes = ((bytes / (50 * 1024 * 1024)) * 3).ceil();
    return Duration(minutes: 15 + extraMinutes);
  }

  http.Client _uploadClient() {
    final io = HttpClient()
      ..connectionTimeout = const Duration(minutes: 2)
      ..idleTimeout = const Duration(minutes: 30);
    return IOClient(io);
  }

  Future<void> _putWithRetry({
    required String url,
    required String contentType,
    required int contentLength,
    required Stream<List<int>> Function() openBody,
    UploadProgressCallback? onProgress,
    Duration? timeout,
    int maxAttempts = 3,
  }) async {
    final target = Uri.parse(absoluteUrl(url));
    final needsAuth = !url.startsWith('http');
    final effectiveTimeout = timeout ?? _uploadTimeoutFor(contentLength);
    Object? lastError;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      final client = _uploadClient();
      try {
        await _streamPut(
          client: client,
          target: target,
          contentType: contentType,
          contentLength: contentLength,
          needsAuth: needsAuth,
          openBody: openBody,
          onProgress: onProgress,
          timeout: effectiveTimeout,
        );
        return;
      } on ApiException {
        rethrow;
      } on TimeoutException catch (e) {
        lastError = e;
      } on SocketException catch (e) {
        lastError = e;
      } on http.ClientException catch (e) {
        lastError = e;
      } finally {
        client.close();
      }

      if (attempt < maxAttempts) {
        await Future<void>.delayed(Duration(seconds: attempt * 3));
      }
    }

    throw lastError ?? ApiException('Upload failed', 0);
  }

  /// Starts the HTTP request first, then pipes the body with backpressure so
  /// [onProgress] tracks bytes accepted by the network stack (not a memory buffer).
  Future<void> _streamPut({
    required http.Client client,
    required Uri target,
    required String contentType,
    required int contentLength,
    required bool needsAuth,
    required Stream<List<int>> Function() openBody,
    UploadProgressCallback? onProgress,
    required Duration timeout,
  }) async {
    final request = http.StreamedRequest('PUT', target);
    request.contentLength = contentLength;
    request.headers['Content-Type'] = contentType;
    if (needsAuth && _token != null) {
      request.headers['Authorization'] = 'Bearer $_token';
      request.headers['Cookie'] = 'ulearn_session=$_token';
    }

    onProgress?.call(0, contentLength);

    // Start sending immediately; body streams as chunks are accepted.
    final responseFuture = client.send(request);

    var sent = 0;
    var lastReported = 0;
    final reportEvery = math.max(64 * 1024, contentLength ~/ 200); // ~0.5% or 64KB

    void report(int value, {bool force = false}) {
      if (onProgress == null) return;
      if (!force && value < contentLength && value - lastReported < reportEvery) {
        return;
      }
      lastReported = value;
      onProgress(value.clamp(0, contentLength), contentLength);
    }

    try {
      await request.sink.addStream(
        openBody().map((chunk) {
          sent += chunk.length;
          report(sent);
          return chunk;
        }),
      );
      await request.sink.close();
    } catch (e) {
      try {
        await request.sink.close();
      } catch (_) {}
      rethrow;
    }

    // Bytes are on the wire; wait for R2/S3 to acknowledge the object.
    report(sent.clamp(0, contentLength), force: true);
    final response = await responseFuture.timeout(timeout);
    if (response.statusCode >= 400) {
      throw ApiException('Upload failed', response.statusCode);
    }
    await response.stream.drain();
    onProgress?.call(contentLength, contentLength);
  }
}

class ApiException implements Exception {
  final String message;
  final int statusCode;
  ApiException(this.message, this.statusCode);

  @override
  String toString() => message;
}
