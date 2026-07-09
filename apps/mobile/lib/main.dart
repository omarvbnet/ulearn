import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/auth/login_screen.dart';
import 'package:ulearn/features/home/home_screen.dart';
import 'package:ulearn/features/auth/pending_screen.dart';
import 'package:ulearn/features/splash/splash_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ),
  );
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
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<LocaleProvider>();

    if (!locale.ready) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark,
        home: const SplashScreen(),
      );
    }

    return MaterialApp(
      title: locale.l10n.brand,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      locale: locale.flutterLocale,
      supportedLocales: const [
        Locale('ar'),
        Locale('ku'),
        Locale('tr'),
        Locale('en'),
      ],
      localeResolutionCallback: (deviceLocale, supported) {
        if (deviceLocale == null) return locale.flutterLocale;
        for (final s in supported) {
          if (s.languageCode == deviceLocale.languageCode) return s;
        }
        return locale.flutterLocale;
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
    } else if (!auth.isAuthenticated) {
      child = const LoginScreen();
    } else if (auth.user?.status == 'PENDING') {
      child = const PendingScreen();
    } else {
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
