import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Native iOS AirPlay player with viewer watermark on the TV via contentOverlayView.
class NativeAirPlayPlayer extends StatelessWidget {
  const NativeAirPlayPlayer({
    super.key,
    required this.url,
    required this.watermark,
  });

  final String url;
  final String watermark;

  @override
  Widget build(BuildContext context) {
    if (!Platform.isIOS) return const SizedBox.shrink();

    return UiKitView(
      viewType: 'ulearn/airplay_cast',
      layoutDirection: TextDirection.ltr,
      creationParams: {
        'url': url,
        'watermark': watermark,
      },
      creationParamsCodec: const StandardMessageCodec(),
    );
  }
}
