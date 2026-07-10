import 'package:flutter_cache_manager/flutter_cache_manager.dart';

/// Dedicated image disk cache (covers, thumbs, ads) under the shared 2.5 GB budget.
class UlearnImageCache {
  UlearnImageCache._();

  static final CacheManager manager = CacheManager(
    Config(
      'ulearn_images',
      stalePeriod: const Duration(days: 14),
      maxNrOfCacheObjects: 120,
    ),
  );

  static Future<void> emptyCache() => manager.emptyCache();
}
