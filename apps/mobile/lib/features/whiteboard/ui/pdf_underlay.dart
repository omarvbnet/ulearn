import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
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
class PdfUnderlayCache {
  final Map<String, Uint8List> _bytesByAsset = {};
  final Map<String, PdfDocument> _docs = {};
  final Map<String, ui.Image> _images = {};
  final Map<String, int> _pageCounts = {};

  int? pageCount(String assetId) => _pageCounts[assetId];

  Future<void> preload(UbrdPdfAsset asset, {String? localFilePath}) async {
    if (_docs.containsKey(asset.assetId)) return;
    if (localFilePath != null && localFilePath.isNotEmpty) {
      final file = File(localFilePath);
      if (await file.exists()) {
        await preloadBytes(asset.assetId, await file.readAsBytes());
        return;
      }
    }
    final url = resolveUbrdPdfUrl(asset);
    if (url == null) return;
    final res = await http.get(Uri.parse(url));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw StateError('PDF_HTTP_${res.statusCode}');
    }
    await preloadBytes(asset.assetId, Uint8List.fromList(res.bodyBytes));
  }

  Future<void> preloadBytes(String assetId, Uint8List bytes) async {
    if (_docs.containsKey(assetId)) return;
    if (bytes.isEmpty) throw StateError('PDF_EMPTY');
    final doc = await PdfDocument.openData(bytes);
    _bytesByAsset[assetId] = bytes;
    _docs[assetId] = doc;
    _pageCounts[assetId] = doc.pagesCount;
  }

  Future<ui.Image?> imageFor(String assetId, int page) async {
    final doc = _docs[assetId];
    if (doc == null) return null;
    final pageNum = page.clamp(1, doc.pagesCount);
    final cacheKey = '$assetId@$pageNum';
    final cached = _images[cacheKey];
    if (cached != null) return cached;

    final pdfPage = await doc.getPage(pageNum);
    try {
      final rendered = await pdfPage.render(
        width: pdfPage.width * 2,
        height: pdfPage.height * 2,
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
      await pdfPage.close();
    }
  }

  Future<void> dispose() async {
    for (final img in _images.values) {
      img.dispose();
    }
    _images.clear();
    for (final doc in _docs.values) {
      await doc.close();
    }
    _docs.clear();
    _bytesByAsset.clear();
    _pageCounts.clear();
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
