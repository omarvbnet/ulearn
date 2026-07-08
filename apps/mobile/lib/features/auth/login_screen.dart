import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/particle_field.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/auth/register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen>
    with SingleTickerProviderStateMixin {
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  final _otpFocus = FocusNode();
  bool _otpStep = false;
  bool _loading = false;
  String? _error;
  Timer? _resendTimer;
  int _resendIn = 0;

  late final AnimationController _shake;

  @override
  void initState() {
    super.initState();
    _shake = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    _otpCtrl.addListener(() {
      setState(() {});
      if (_otpCtrl.text.length == 6 && !_loading) _verify();
    });
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    _shake.dispose();
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    _otpFocus.dispose();
    super.dispose();
  }

  void _startResendCountdown() {
    _resendTimer?.cancel();
    setState(() => _resendIn = 45);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn = _resendIn > 0 ? _resendIn - 1 : 0);
      if (_resendIn == 0) t.cancel();
    });
  }

  void _showError(String message) {
    setState(() => _error = message);
    _shake.forward(from: 0);
  }

  Future<void> _sendOtp() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length < 8) {
      _showError('Please enter a valid phone number');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await context.read<AuthProvider>().sendOtp(phone);
      if (!mounted) return;
      setState(() {
        _otpStep = true;
        _otpCtrl.clear();
      });
      _startResendCountdown();
      _otpFocus.requestFocus();
    } catch (e) {
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await context.read<AuthProvider>().verifyOtp(
            _phoneCtrl.text.trim(),
            _otpCtrl.text.trim(),
          );
      if (!mounted) return;
      if (result['isNewUser'] == true) {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => RegisterScreen(phone: _phoneCtrl.text.trim()),
          ),
        );
      }
    } catch (e) {
      _otpCtrl.clear();
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: Stack(
        fit: StackFit.expand,
        children: [
          const ParticleField(),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                child: Column(
                  children: [
                    const PulsingULearnLogo(size: 132),
                    const SizedBox(height: 18),
                    ShaderMask(
                      shaderCallback: (bounds) =>
                          AppTheme.gradient.createShader(bounds),
                      child: const Text(
                        'U Learn',
                        style: TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                          letterSpacing: 1,
                        ),
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Learn without limits',
                      style: TextStyle(
                        color: AppTheme.muted,
                        fontSize: 13,
                        letterSpacing: 2,
                      ),
                    ),
                    const SizedBox(height: 32),
                    // Glass card holding the auth flow.
                    AnimatedBuilder(
                      animation: _shake,
                      builder: (context, child) {
                        final dx = 8 *
                            (1 - _shake.value) *
                            (_shake.value == 0
                                ? 0
                                : (_shake.value * 6).floor().isEven ? 1 : -1);
                        return Transform.translate(
                            offset: Offset(dx, 0), child: child);
                      },
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(24),
                        child: BackdropFilter(
                          filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                          child: Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(24),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.04),
                              borderRadius: BorderRadius.circular(24),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.08),
                              ),
                            ),
                            child: AnimatedSize(
                              duration: const Duration(milliseconds: 300),
                              curve: Curves.easeOutCubic,
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 350),
                                switchInCurve: Curves.easeOutCubic,
                                transitionBuilder: (child, anim) =>
                                    FadeTransition(
                                  opacity: anim,
                                  child: SlideTransition(
                                    position: Tween<Offset>(
                                      begin: const Offset(0.08, 0),
                                      end: Offset.zero,
                                    ).animate(anim),
                                    child: child,
                                  ),
                                ),
                                child: _otpStep
                                    ? _buildOtpStep()
                                    : _buildPhoneStep(),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      TweenAnimationBuilder<double>(
                        tween: Tween(begin: 0, end: 1),
                        duration: const Duration(milliseconds: 250),
                        builder: (context, t, child) =>
                            Opacity(opacity: t, child: child),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.error_outline,
                                size: 16, color: Colors.redAccent),
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                _error!,
                                style:
                                    const TextStyle(color: Colors.redAccent),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPhoneStep() {
    return Column(
      key: const ValueKey('phone'),
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text(
          'Welcome 👋',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 6),
        const Text(
          'Sign in with your phone number — we\'ll send a code to your WhatsApp.',
          style: TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.5),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: _phoneCtrl,
          keyboardType: TextInputType.phone,
          textDirection: TextDirection.ltr,
          style: const TextStyle(fontSize: 16, letterSpacing: 0.5),
          onSubmitted: (_) => _sendOtp(),
          decoration: const InputDecoration(
            labelText: 'Mobile Number',
            hintText: '+964 7XX XXX XXXX',
            prefixIcon: Icon(Icons.phone_iphone, color: AppTheme.muted),
          ),
        ),
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          height: 52,
          child: FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.primary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            onPressed: _loading ? null : _sendOtp,
            icon: _loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.send_rounded, size: 19),
            label: Text(
              _loading ? 'Sending…' : 'Send code via WhatsApp',
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildOtpStep() {
    final code = _otpCtrl.text;
    return Column(
      key: const ValueKey('otp'),
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text(
          'Enter the code',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 6),
        Text.rich(
          TextSpan(
            style: const TextStyle(
                color: AppTheme.muted, fontSize: 13, height: 1.5),
            children: [
              const TextSpan(text: 'We sent a 6-digit code to '),
              TextSpan(
                text: _phoneCtrl.text.trim(),
                style: const TextStyle(
                  color: AppTheme.foreground,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const TextSpan(text: ' on WhatsApp.'),
            ],
          ),
        ),
        const SizedBox(height: 20),
        // Hidden input driving 6 visible digit boxes.
        Stack(
          children: [
            Opacity(
              opacity: 0,
              child: TextField(
                controller: _otpCtrl,
                focusNode: _otpFocus,
                keyboardType: TextInputType.number,
                maxLength: 6,
                autofocus: true,
                enableSuggestions: false,
              ),
            ),
            GestureDetector(
              onTap: () => _otpFocus.requestFocus(),
              child: Directionality(
                textDirection: TextDirection.ltr,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: List.generate(6, (i) {
                    final filled = i < code.length;
                    final isCurrent = i == code.length;
                    return AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      curve: Curves.easeOut,
                      width: 44,
                      height: 54,
                      decoration: BoxDecoration(
                        color: const Color(0xFF0A0A16),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isCurrent && _otpFocus.hasFocus
                              ? AppTheme.accent
                              : filled
                                  ? AppTheme.primary.withValues(alpha: 0.7)
                                  : AppTheme.cardBorder,
                          width: isCurrent && _otpFocus.hasFocus ? 1.8 : 1,
                        ),
                        boxShadow: isCurrent && _otpFocus.hasFocus
                            ? [
                                BoxShadow(
                                  color:
                                      AppTheme.accent.withValues(alpha: 0.25),
                                  blurRadius: 10,
                                ),
                              ]
                            : null,
                      ),
                      child: Center(
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 150),
                          transitionBuilder: (child, anim) => ScaleTransition(
                            scale: anim,
                            child: child,
                          ),
                          child: Text(
                            filled ? code[i] : '',
                            key: ValueKey(filled ? code[i] : 'empty$i'),
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.foreground,
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          height: 52,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.primary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            onPressed: _loading || code.length < 6 ? null : _verify,
            child: Text(
              _loading ? 'Verifying…' : 'Verify & Continue',
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton(
              onPressed: () => setState(() {
                _otpStep = false;
                _error = null;
              }),
              child: const Text(
                'Change number',
                style: TextStyle(color: AppTheme.muted),
              ),
            ),
            TextButton(
              onPressed: _resendIn > 0 || _loading ? null : _sendOtp,
              child: Text(
                _resendIn > 0 ? 'Resend in ${_resendIn}s' : 'Resend code',
                style: TextStyle(
                  color: _resendIn > 0 ? AppTheme.muted : AppTheme.accent,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
