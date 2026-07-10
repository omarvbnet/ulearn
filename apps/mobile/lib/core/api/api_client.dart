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

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final res = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw ApiException(data['error']?.toString() ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  Future<Map<String, dynamic>> get(String path) async {
    final res = await http.get(Uri.parse('$baseUrl$path'), headers: _headers);
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw ApiException(data['error']?.toString() ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) async {
    final res = await http.patch(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw ApiException(data['error']?.toString() ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  Future<Map<String, dynamic>> delete(String path, [Map<String, dynamic>? body]) async {
    final res = await http.delete(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
      body: body != null ? jsonEncode(body) : null,
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw ApiException(data['error']?.toString() ?? 'Request failed', res.statusCode);
    }
    return data;
  }

  /// Raw binary PUT used for presigned/direct file uploads (small payloads).
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
      openBody: () => Stream.value(bytes),
      onProgress: onProgress,
    );
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
