import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/particle_field.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';

/// Animated launch screen: the circuit "U" draws itself in over a field of
/// drifting particles, then the wordmark and tagline slide up.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with TickerProviderStateMixin {
  late final AnimationController _draw;
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _draw = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..forward();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _draw.dispose();
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<LocaleProvider>();
    final brand = locale.ready ? locale.l10n.brand : 'U Learn';
    final tagline = locale.ready ? locale.l10n.learnWithoutLimits : 'Learn without limits';

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          const ParticleField(),
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedBuilder(
                  animation: Listenable.merge([_draw, _pulse]),
                  builder: (context, _) => ULearnLogo(
                    size: 150,
                    progress: _draw.value,
                    glow: _draw.isCompleted ? 0.4 + 0.5 * _pulse.value : 0.5,
                  ),
                ),
                const SizedBox(height: 26),
                AnimatedBuilder(
                  animation: _draw,
                  builder: (context, child) {
                    final t = Curves.easeOutCubic
                        .transform(((_draw.value - 0.55) / 0.45).clamp(0.0, 1.0));
                    return Opacity(
                      opacity: t,
                      child: Transform.translate(
                        offset: Offset(0, 18 * (1 - t)),
                        child: child,
                      ),
                    );
                  },
                  child: Column(
                    children: [
                      ShaderMask(
                        shaderCallback: (bounds) =>
                            AppTheme.gradient.createShader(bounds),
                        child: Text(
                          brand,
                          style: const TextStyle(
                            fontSize: 38,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                            letterSpacing: 1.2,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        tagline,
                        style: const TextStyle(
                          color: AppTheme.muted,
                          fontSize: 14,
                          letterSpacing: 2.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // Subtle loading shimmer at the bottom.
          Positioned(
            left: 0,
            right: 0,
            bottom: 56,
            child: AnimatedBuilder(
              animation: _pulse,
              builder: (context, _) => Center(
                child: Container(
                  width: 120,
                  height: 3,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(2),
                    color: AppTheme.cardBorder,
                  ),
                  child: Align(
                    alignment: Alignment(-1 + 2 * _pulse.value, 0),
                    child: Container(
                      width: 42,
                      height: 3,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(2),
                        gradient: AppTheme.gradient,
                        boxShadow: [
                          BoxShadow(
                            color: AppTheme.accent.withValues(alpha: 0.6),
                            blurRadius: 8,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

