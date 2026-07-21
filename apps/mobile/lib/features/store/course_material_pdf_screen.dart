import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:pdfx/pdfx.dart';
import 'package:printing/printing.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/glass.dart';

/// In-app PDF viewer for course documents with print support.
class CourseMaterialPdfScreen extends StatefulWidget {
  const CourseMaterialPdfScreen({
    super.key,
    this.url,
    this.bytes,
    required this.title,
  }) : assert(url != null || bytes != null, 'url or bytes required');

  final String? url;
  final Uint8List? bytes;
  final String title;

  @override
  State<CourseMaterialPdfScreen> createState() => _CourseMaterialPdfScreenState();
}

class _CourseMaterialPdfScreenState extends State<CourseMaterialPdfScreen> {
  PdfControllerPinch? _controller;
  Uint8List? _bytes;
  bool _loading = true;
  String? _error;
  int _page = 1;
  int _pages = 1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      late final Uint8List bytes;
      if (widget.bytes != null) {
        bytes = widget.bytes!;
      } else {
        final uri = Uri.parse(ApiClient.absoluteUrl(widget.url!));
        final res = await http.get(uri);
        if (res.statusCode >= 400) {
          throw Exception('HTTP ${res.statusCode}');
        }
        bytes = res.bodyBytes;
      }
      if (bytes.isEmpty) throw Exception('Empty file');

      final doc = await PdfDocument.openData(bytes);
      if (!mounted) return;
      setState(() {
        _bytes = bytes;
        _pages = doc.pagesCount;
        _controller = PdfControllerPinch(
          document: Future.value(doc),
        );
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = context.l10n.t('mobile.store.pdfOpenFailed');
      });
    }
  }

  Future<void> _printPdf() async {
    final bytes = _bytes;
    if (bytes == null) return;
    await Printing.layoutPdf(
      onLayout: (_) async => bytes,
      name: widget.title,
    );
  }

  Future<void> _sharePdf() async {
    final bytes = _bytes;
    if (bytes == null) return;
    final safeName = widget.title.replaceAll(RegExp(r'[^\w\s.-]'), '_').trim();
    await Printing.sharePdf(
      bytes: bytes,
      filename: safeName.endsWith('.pdf') ? safeName : '$safeName.pdf',
    );
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: const Color(0xFF12121C),
      appBar: GlassAppBar(
        title: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          if (_bytes != null) ...[
            IconButton(
              tooltip: l10n.t('mobile.store.printPdf'),
              icon: const Icon(Icons.print_rounded),
              onPressed: _printPdf,
            ),
            IconButton(
              tooltip: l10n.t('mobile.store.sharePdf'),
              icon: const Icon(Icons.ios_share_rounded),
              onPressed: _sharePdf,
            ),
          ],
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppTheme.accent))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.error_outline, color: AppTheme.muted, size: 48),
                        const SizedBox(height: 12),
                        Text(
                          _error!,
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppTheme.muted),
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: () {
                            setState(() {
                              _loading = true;
                              _error = null;
                            });
                            _load();
                          },
                          child: Text(l10n.t('common.retry')),
                        ),
                      ],
                    ),
                  ),
                )
              : Column(
                  children: [
                    Expanded(
                      child: PdfViewPinch(
                        controller: _controller!,
                        onPageChanged: (page) {
                          setState(() => _page = page);
                        },
                        builders: PdfViewPinchBuilders<DefaultBuilderOptions>(
                          options: const DefaultBuilderOptions(),
                          documentLoaderBuilder: (_) => const Center(
                            child: CircularProgressIndicator(color: AppTheme.accent),
                          ),
                          pageLoaderBuilder: (_) => const Center(
                            child: CircularProgressIndicator(color: AppTheme.accent),
                          ),
                          errorBuilder: (_, error) => Center(
                            child: Text(
                              error.toString(),
                              style: TextStyle(color: AppTheme.muted),
                            ),
                          ),
                        ),
                      ),
                    ),
                    Container(
                      padding: EdgeInsets.fromLTRB(
                        16,
                        10,
                        16,
                        10 + MediaQuery.paddingOf(context).bottom,
                      ),
                      decoration: BoxDecoration(
                        color: Color(0xFF08081A),
                        border: Border(top: BorderSide(color: AppTheme.cardBorder)),
                      ),
                      child: Row(
                        children: [
                          IconButton(
                            tooltip: l10n.t('mobile.store.pdfPrevPage'),
                            onPressed: _page > 1
                                ? () => _controller!.previousPage(
                                      duration: const Duration(milliseconds: 200),
                                      curve: Curves.easeOut,
                                    )
                                : null,
                            icon: const Icon(Icons.chevron_left_rounded, color: Colors.white),
                          ),
                          Expanded(
                            child: Text(
                              l10n.t('mobile.store.pdfPageOf', {
                                'page': '$_page',
                                'total': '$_pages',
                              }),
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: l10n.t('mobile.store.pdfNextPage'),
                            onPressed: _page < _pages
                                ? () => _controller!.nextPage(
                                      duration: const Duration(milliseconds: 200),
                                      curve: Curves.easeOut,
                                    )
                                : null,
                            icon: const Icon(Icons.chevron_right_rounded, color: Colors.white),
                          ),
                          const SizedBox(width: 4),
                          FilledButton.icon(
                            onPressed: _printPdf,
                            icon: const Icon(Icons.print_rounded, size: 18),
                            label: Text(l10n.t('mobile.store.printPdf')),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}
