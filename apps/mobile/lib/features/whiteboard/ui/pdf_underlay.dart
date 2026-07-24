import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:pdfx/pdfx.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/features/whiteboard/domain/package.dart';

/// Resolves a course PDF URL from package asset metadata.
String? resolveUbrdPdfUrl(UbrdPdfAsset asset) {
  final fileUrl = asset.fileUrl?.trim();
  if (fileUrl != null && fileUrl.isNotEmpty) {
    return ApiClient.absoluteUrl(fileUrl);
  }
  final key = asset.fileKey?.trim();
  if (key != null && key.isNotEmpty) {
    final encoded = key.split('/').map(Uri.encodeComponent).join('/');
    return ApiClient.absoluteUrl('/api/media/$encoded');
  }
  return null;
}

/// Loads PDF bytes and renders pages to [ui.Image] for board underlays.
///
/// Android [PdfRenderer] only allows one open page at a time and often throws
/// opaque `PlatformException(d, … Unknown error)` in release (R8-obfuscated
/// pdfx). All public methods are best-effort and never throw to callers.
class PdfUnderlayCache {
  final Map<String, Uint8List> _bytesByAsset = {};
  final Map<String, PdfDocument> _docs = {};
  final Map<String, ui.Image> _images = {};
  final Map<String, int> _pageCounts = {};
  final Map<String, String> _filePaths = {};

  /// Serialize native PDF access — concurrent getPage/render crashes Android.
  Future<void> _gate = Future<void>.value();

  Future<T?> _withGate<T>(Future<T?> Function() action) {
    final done = Completer<T?>();
    _gate = _gate.then((_) async {
      try {
        done.complete(await action());
      } catch (e, st) {
        debugPrint('PdfUnderlayCache: $e\n$st');
        done.complete(null);
      }
    });
    return done.future;
  }

  int? pageCount(String assetId) => _pageCounts[assetId];

  Future<void> preload(UbrdPdfAsset asset, {String? localFilePath}) async {
    await _withGate(() async {
      if (_docs.containsKey(asset.assetId)) return null;
      if (localFilePath != null && localFilePath.isNotEmpty) {
        final file = File(localFilePath);
        if (await file.exists()) {
          await _openFromFile(asset.assetId, file);
          return null;
        }
      }
      final url = resolveUbrdPdfUrl(asset);
      if (url == null) return null;
      final res = await http.get(Uri.parse(url));
      if (res.statusCode < 200 || res.statusCode >= 300) {
        debugPrint('PdfUnderlayCache: PDF_HTTP_${res.statusCode}');
        return null;
      }
      await _openFromBytes(asset.assetId, Uint8List.fromList(res.bodyBytes));
      return null;
    });
  }

  Future<void> preloadBytes(String assetId, Uint8List bytes) async {
    await _withGate(() async {
      if (_docs.containsKey(assetId)) return null;
      await _openFromBytes(assetId, bytes);
      return null;
    });
  }

  Future<void> _openFromBytes(String assetId, Uint8List bytes) async {
    if (bytes.isEmpty) {
      debugPrint('PdfUnderlayCache: empty PDF bytes for $assetId');
      return;
    }
    final dir = await getTemporaryDirectory();
    final safe = assetId.replaceAll(RegExp(r'[^\w.-]'), '_');
    final file = File(p.join(dir.path, 'wb_pdf_$safe.pdf'));
    await file.writeAsBytes(bytes, flush: true);
    await _openFromFile(assetId, file);
    _bytesByAsset[assetId] = bytes;
  }

  Future<void> _openFromFile(String assetId, File file) async {
    // Prefer openFile over openData — Android PdfRenderer is more reliable
    // with a real path, and avoids pdfx's temp-file race on openData.
    final doc = await PdfDocument.openFile(file.path);
    _docs[assetId] = doc;
    _pageCounts[assetId] = doc.pagesCount;
    _filePaths[assetId] = file.path;
  }

  Future<ui.Image?> imageFor(String assetId, int page) {
    return _withGate(() async {
      final doc = _docs[assetId];
      if (doc == null || doc.isClosed) return null;
      final total = doc.pagesCount;
      if (total <= 0) return null;
      final pageNum = page.clamp(1, total);
      final cacheKey = '$assetId@$pageNum';
      final cached = _images[cacheKey];
      if (cached != null) return cached;

      final pdfPage = await doc.getPage(pageNum);
      try {
        // Cap bitmap size — huge renders throw opaque Android PdfRenderer errors.
        final maxEdge = 2048.0;
        final rawW = pdfPage.width;
        final rawH = pdfPage.height;
        final scale = (maxEdge / rawW).clamp(0.0, 2.0);
        final scaleH = maxEdge / rawH;
        final s = scale < scaleH ? scale : scaleH;
        final w = (rawW * s).clamp(1.0, maxEdge);
        final h = (rawH * s).clamp(1.0, maxEdge);

        final rendered = await pdfPage.render(
          width: w,
          height: h,
          format: PdfPageImageFormat.jpeg,
          backgroundColor: '#FFFFFF',
        );
        final bytes = rendered?.bytes;
        if (bytes == null || bytes.isEmpty) return null;
        final codec = await ui.instantiateImageCodec(bytes);
        final frame = await codec.getNextFrame();
        _images[cacheKey] = frame.image;
        return frame.image;
      } finally {
        try {
          await pdfPage.close();
        } catch (_) {}
      }
    });
  }

  Future<void> dispose() async {
    await _withGate(() async {
      for (final img in _images.values) {
        img.dispose();
      }
      _images.clear();
      for (final doc in _docs.values) {
        try {
          await doc.close();
        } catch (_) {}
      }
      _docs.clear();
      _bytesByAsset.clear();
      _pageCounts.clear();
      _filePaths.clear();
      return null;
    });
  }
}

/// Fits [image] into [dst] (contain) and draws it.
void paintPdfContain(Canvas canvas, ui.Image image, Rect dst) {
  final iw = image.width.toDouble();
  final ih = image.height.toDouble();
  if (iw <= 0 || ih <= 0) return;
  final scale = (dst.width / iw).clamp(0.0, 100.0);
  final scaleY = dst.height / ih;
  final s = scale < scaleY ? scale : scaleY;
  final w = iw * s;
  final h = ih * s;
  final left = dst.left + (dst.width - w) / 2;
  final top = dst.top + (dst.height - h) / 2;
  paintImage(
    canvas: canvas,
    rect: Rect.fromLTWH(left, top, w, h),
    image: image,
    fit: BoxFit.fill,
    filterQuality: FilterQuality.medium,
  );
}
