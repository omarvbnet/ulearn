import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/phone/phone_countries.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/core/widgets/particle_field.dart';
import 'package:ulearn/core/widgets/ulearn_logo.dart';
import 'package:ulearn/features/auth/register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.startAsRegister = false});

  /// When opened from guest "Register", show a register-oriented welcome line.
  final bool startAsRegister;

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
  late PhoneCountry _country;
  late final List<PhoneCountry> _countries;
  String _fullPhone = '';

  late final AnimationController _shake;

  @override
  void initState() {
    super.initState();
    _countries = phoneCountriesIraqFirst();
    _country = getDefaultPhoneCountry();
    _shake = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    _otpCtrl.addListener(_onOtpChanged);
    _otpFocus.addListener(() {
      if (mounted) setState(() {});
    });
  }

  void _onOtpChanged() {
    final raw = _otpCtrl.text;
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    final clipped = digits.length > 6 ? digits.substring(0, 6) : digits;
    if (clipped != raw) {
      _otpCtrl.value = TextEditingValue(
        text: clipped,
        selection: TextSelection.collapsed(offset: clipped.length),
      );
      return;
    }
    setState(() {});
    if (clipped.length == 6 && !_loading) _verify();
  }

  Future<void> _pasteOtp() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final pasted = data?.text?.replaceAll(RegExp(r'\D'), '') ?? '';
    if (pasted.isEmpty || !mounted) return;
    final code = pasted.length > 6 ? pasted.substring(0, 6) : pasted;
    _otpCtrl.value = TextEditingValue(
      text: code,
      selection: TextSelection.collapsed(offset: code.length),
    );
    _otpFocus.requestFocus();
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
    final phone = buildInternationalPhone(_country.dial, _phoneCtrl.text.trim());
    if (phone.replaceAll(RegExp(r'\D'), '').length < 10) {
      _showError(context.l10n.loginValidPhone);
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
        _fullPhone = phone;
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
            _fullPhone.isNotEmpty
                ? _fullPhone
                : buildInternationalPhone(_country.dial, _phoneCtrl.text.trim()),
            _otpCtrl.text.trim(),
          );
      if (!mounted) return;
      if (result['isNewUser'] == true) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => RegisterScreen(
              phone: _fullPhone.isNotEmpty
                  ? _fullPhone
                  : buildInternationalPhone(
                      _country.dial, _phoneCtrl.text.trim()),
            ),
          ),
        );
        if (!mounted) return;
      }
      // Guest flow: close login sheet/route after successful auth.
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
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
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: AppTheme.background,
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
                      child: Text(
                        context.l10n.brand,
                        style: const TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                          letterSpacing: 1,
                        ),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      context.l10n.learnWithoutLimits,
                      style: TextStyle(
                        color: AppTheme.muted,
                        fontSize: 13,
                        letterSpacing: 2,
                      ),
                    ),
                    const SizedBox(height: 32),
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
                              color: isDark
                                  ? Colors.white.withValues(alpha: 0.04)
                                  : AppTheme.card.withValues(alpha: 0.92),
                              borderRadius: BorderRadius.circular(24),
                              border: Border.all(
                                color: isDark
                                    ? Colors.white.withValues(alpha: 0.08)
                                    : AppTheme.cardBorder,
                              ),
                              boxShadow: isDark
                                  ? null
                                  : [
                                      BoxShadow(
                                        color: AppTheme.primary
                                            .withValues(alpha: 0.08),
                                        blurRadius: 24,
                                        offset: const Offset(0, 8),
                                      ),
                                    ],
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
    final l10n = context.l10n;
    return Column(
      key: const ValueKey('phone'),
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          widget.startAsRegister
              ? l10n.t('mobile.auth.registerWelcome')
              : l10n.loginWelcome,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: AppTheme.foreground,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          widget.startAsRegister
              ? l10n.t('mobile.auth.registerHint')
              : l10n.loginSignInHint,
          style: TextStyle(color: AppTheme.muted, fontSize: 13, height: 1.5),
        ),
        const SizedBox(height: 20),
        // Keep country code on the left and national number on the right
        // even when the app locale is RTL (Arabic / Kurdish).
        Directionality(
          textDirection: TextDirection.ltr,
          child: Row(
            children: [
              SizedBox(
                width: 118,
                child: InputDecorator(
                  decoration: const InputDecoration(
                    contentPadding:
                        EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<PhoneCountry>(
                      value: _country,
                      isExpanded: true,
                      items: _countries
                          .map(
                            (c) => DropdownMenuItem(
                              value: c,
                              child: Text(
                                '${c.flag} +${c.dial}',
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 13),
                              ),
                            ),
                          )
                          .toList(),
                      selectedItemBuilder: (context) => _countries
                          .map(
                            (c) => Align(
                              alignment: Alignment.centerLeft,
                              child: Text(
                                '${c.flag} +${c.dial}',
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 13),
                              ),
                            ),
                          )
                          .toList(),
                      onChanged: (c) {
                        if (c == null) return;
                        setState(() => _country = c);
                      },
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(fontSize: 16, letterSpacing: 0.5),
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _sendOtp(),
                  decoration: InputDecoration(
                    labelText: l10n.authPhone,
                    hintText: _country.iso == 'IQ'
                        ? '7XX XXX XXXX'
                        : l10n.authPhonePlaceholder,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text(
          buildInternationalPhone(_country.dial, _phoneCtrl.text.trim().isEmpty ? '…' : _phoneCtrl.text.trim()),
          textDirection: TextDirection.ltr,
          style: TextStyle(color: AppTheme.muted, fontSize: 12),
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
              _loading ? l10n.authSending : l10n.loginSendCodeWhatsApp,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildOtpStep() {
    final l10n = context.l10n;
    final code = _otpCtrl.text;
    return Column(
      key: const ValueKey('otp'),
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          l10n.loginEnterCode,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
            color: AppTheme.foreground,
          ),
        ),
        const SizedBox(height: 6),
        Text.rich(
          TextSpan(
            style: TextStyle(
                color: AppTheme.muted, fontSize: 13, height: 1.5),
            children: [
              TextSpan(text: l10n.loginCodeSentPrefix),
              TextSpan(
                text: _fullPhone.isNotEmpty ? _fullPhone : _phoneCtrl.text.trim(),
                style: TextStyle(
                  color: AppTheme.foreground,
                  fontWeight: FontWeight.w600,
                ),
              ),
              TextSpan(text: l10n.loginCodeSentSuffix),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Directionality(
          textDirection: TextDirection.ltr,
          child: Stack(
            children: [
              Row(
                children: List.generate(6, (i) {
                  final filled = i < code.length;
                  final isCurrent = i == code.length && _otpFocus.hasFocus;
                  return Expanded(
                    child: Padding(
                      padding: EdgeInsetsDirectional.only(
                        end: i == 5 ? 0 : 8,
                      ),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        curve: Curves.easeOut,
                        height: 52,
                        decoration: BoxDecoration(
                          color: AppTheme.isDark
                              ? Colors.white.withValues(alpha: 0.04)
                              : AppTheme.background,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: isCurrent
                                ? AppTheme.accent
                                : filled
                                    ? AppTheme.primary.withValues(alpha: 0.75)
                                    : AppTheme.cardBorder,
                            width: isCurrent ? 1.8 : 1,
                          ),
                          boxShadow: isCurrent
                              ? [
                                  BoxShadow(
                                    color: AppTheme.accent
                                        .withValues(alpha: 0.22),
                                    blurRadius: 10,
                                  ),
                                ]
                              : null,
                        ),
                        child: Center(
                          child: Text(
                            filled ? code[i] : '',
                            style: TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w700,
                              height: 1,
                              color: AppTheme.foreground,
                              fontFeatures: const [
                                FontFeature.tabularFigures()
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                }),
              ),
              // Invisible input — filled:false so theme never paints a black box.
              Positioned.fill(
                child: Theme(
                  data: Theme.of(context).copyWith(
                    inputDecorationTheme: const InputDecorationTheme(
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: EdgeInsets.zero,
                      isDense: true,
                    ),
                    textSelectionTheme: const TextSelectionThemeData(
                      cursorColor: Colors.transparent,
                      selectionColor: Colors.transparent,
                      selectionHandleColor: Colors.transparent,
                    ),
                  ),
                  child: AutofillGroup(
                    child: TextField(
                      controller: _otpCtrl,
                      focusNode: _otpFocus,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      autofocus: true,
                      enableSuggestions: false,
                      autocorrect: false,
                      showCursor: false,
                      cursorWidth: 0,
                      maxLength: 6,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(6),
                      ],
                      style: const TextStyle(
                        color: Colors.transparent,
                        fontSize: 1,
                        height: 0.01,
                      ),
                      decoration: const InputDecoration(
                        counterText: '',
                        filled: false,
                        fillColor: Colors.transparent,
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        contentPadding: EdgeInsets.zero,
                        isCollapsed: true,
                      ),
                      onTap: () => _otpFocus.requestFocus(),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: TextButton.icon(
            style: TextButton.styleFrom(
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.symmetric(horizontal: 8),
            ),
            onPressed: _loading ? null : _pasteOtp,
            icon: Icon(Icons.content_paste_rounded,
                size: 15, color: AppTheme.accent),
            label: Text(
              l10n.t('mobile.login.pasteCode'),
              style: TextStyle(color: AppTheme.accent, fontSize: 13),
            ),
          ),
        ),
        const SizedBox(height: 8),
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
              _loading ? l10n.authVerifying : l10n.loginVerifyContinue,
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
              child: Text(
                l10n.authChangeNumber,
                style: TextStyle(color: AppTheme.muted),
              ),
            ),
            TextButton(
              onPressed: _resendIn > 0 || _loading ? null : _sendOtp,
              child: Text(
                _resendIn > 0 ? l10n.loginResendIn(_resendIn) : l10n.authResend,
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
