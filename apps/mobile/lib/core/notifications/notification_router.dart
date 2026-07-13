import 'package:flutter/material.dart';
import 'package:ulearn/features/ads/ads_offers_screen.dart';
import 'package:ulearn/features/reels/reels_screen.dart';
import 'package:ulearn/features/store/course_detail_screen.dart';
import 'package:ulearn/core/widgets/glass.dart';

/// Routes notification payloads to the correct screen.
class NotificationRouter {
  static void open(BuildContext context, Map<String, dynamic> data) {
    final type = (data['type'] ?? data['screen'] ?? '').toString().toLowerCase();
    final courseId = data['courseId']?.toString();
    final shortVideoId = data['shortVideoId']?.toString();
    final adId = data['adId']?.toString();

    if (type == 'course' ||
        type == 'question' ||
        type == 'answer' ||
        (courseId != null && courseId.isNotEmpty)) {
      if (courseId != null && courseId.isNotEmpty) {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CourseDetailScreen(courseId: courseId),
          ),
        );
        return;
      }
    }

    if (type == 'comment' || type == 'reel' || type == 'reels') {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => Scaffold(
              appBar: GlassAppBar(
                title: const Text('Reels'),
              ),
              body: ReelsScreen(
                initialVideoId: shortVideoId,
                openCommentsOnStart: type == 'comment',
              ),
            ),
          ),
        );
      return;
    }

    if (type == 'admin' ||
        type == 'ads' ||
        type == 'advertisement' ||
        type == 'offer' ||
        type == 'offers') {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => AdsOffersScreen(highlightAdId: adId),
        ),
      );
      return;
    }

    // Default: admin offers / notifications board
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const AdsOffersScreen(),
      ),
    );
  }
}
