import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:fvp/fvp.dart' as fvp;
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/iap/store_iap.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/notifications/push_notification_service.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/theme/theme_mode_provider.dart';
import 'package:ulearn/core/video/media_cache_budget.dart';
import 'package:ulearn/features/auth/pending_screen.dart';
import 'package:ulearn/features/home/home_screen.dart';
import 'package:ulearn/features/splash/splash_screen.dart';

final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // StoreKit listener must start before any purchase UI (App Review / Sandbox).
  if (!kIsWeb && (Platform.isIOS || Platform.isAndroid)) {
    unawaited(StoreIap.ensureInitialized());
  }
  // Must be registered before runApp so background isolates can handle FCM.
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  await PushNotificationService.instance.ensureFirebaseReady();
  // Hardware-accelerated video (libmdk) for smooth course + shorts playback.
  fvp.registerWith(options: {
    'platforms': ['ios', 'android'],
    'lowLatency': 1, // VOD: faster first frame / lower buffer delay
    'fastSeek': true, // snappy scrub on reels
    'tunnel': true, // Android MediaCodec → Surface (lower GPU cost)
  });
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ),
  );
  // Trim disk cache if a previous session left us over the 2.5 GB budget.
  unawaited(MediaCacheBudget.enforce(force: true));
  runApp(const ULearnApp());
}

class ULearnApp extends StatelessWidget {
  const ULearnApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider(create: (_) => ApiClient()),
        ChangeNotifierProvider(create: (_) => LocaleProvider()..init()),
        ChangeNotifierProvider(create: (_) => ThemeModeProvider()..init()),
        ChangeNotifierProxyProvider<LocaleProvider, AuthProvider>(
          create: (ctx) => AuthProvider(ctx.read<ApiClient>()),
          update: (_, locale, auth) => auth!..attachLocale(locale),
          lazy: false,
        ),
      ],
      child: const _LocalizedApp(),
    );
  }
}

class _LocalizedApp extends StatefulWidget {
  const _LocalizedApp();

  @override
  State<_LocalizedApp> createState() => _LocalizedAppState();
}

class _LocalizedAppState extends State<_LocalizedApp> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  Future<void> _bootstrap() async {
    final locale = context.read<LocaleProvider>();
    while (!locale.ready) {
      await Future<void>.delayed(const Duration(milliseconds: 16));
      if (!mounted) return;
    }
    final auth = context.read<AuthProvider>();
    await auth.bootstrap();
    if (!mounted) return;
    if (auth.user?.locale != null) {
      await locale.syncFromUser(auth.user!.locale);
    }

    final api = context.read<ApiClient>();
    await PushNotificationService.instance.init(
      api: api,
      navigatorKey: appNavigatorKey,
    );
    if (auth.isAuthenticated) {
      await PushNotificationService.instance.onUserLoggedIn();
    }
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<LocaleProvider>();
    final themeMode = context.watch<ThemeModeProvider>();

    if (!locale.ready || !themeMode.ready) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        navigatorKey: appNavigatorKey,
        theme: AppTheme.light,
        darkTheme: AppTheme.dark,
        themeMode: themeMode.ready ? themeMode.mode : ThemeMode.system,
        home: const SplashScreen(),
      );
    }

    return MaterialApp(
      title: locale.l10n.brand,
      debugShowCheckedModeBanner: false,
      navigatorKey: appNavigatorKey,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: themeMode.mode,
      // Must be a locale GlobalMaterialLocalizations supports (not bare `ku`).
      locale: locale.materialLocale,
      supportedLocales: const [
        Locale('ar'),
        Locale('tr'),
        Locale('en'),
      ],
      localeResolutionCallback: (deviceLocale, supported) {
        // Always honor the in-app language choice for Material delegates.
        return locale.materialLocale;
      },
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => Directionality(
        textDirection: locale.textDirection,
        child: child ?? const SizedBox.shrink(),
      ),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  static const _minSplash = Duration(milliseconds: 2600);
  bool _splashDone = false;

  @override
  void initState() {
    super.initState();
    Future.delayed(_minSplash, () {
      if (mounted) setState(() => _splashDone = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    final Widget child;
    if (auth.loading || !_splashDone) {
      child = const SplashScreen();
    } else if (
      auth.isAuthenticated &&
      auth.user?.status == 'PENDING' &&
      auth.user?.role == 'TEACHER'
    ) {
      // Waiting-for-approval is only for teacher registration.
      child = const PendingScreen();
    } else {
      // Guests and approved users can browse the app.
      child = const HomeScreen();
    }

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 600),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (widget, animation) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(
          scale: Tween(begin: 1.02, end: 1.0).animate(animation),
          child: widget,
        ),
      ),
      child: KeyedSubtree(key: ValueKey(child.runtimeType), child: child),
    );
  }
}
