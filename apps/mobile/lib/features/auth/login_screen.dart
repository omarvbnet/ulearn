import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/auth/register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  bool _otpStep = false;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    super.dispose();
  }

  Future<void> _sendOtp() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await context.read<AuthProvider>().sendOtp(_phoneCtrl.text.trim());
      setState(() => _otpStep = true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
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
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Image.asset('assets/images/logo.png', width: 120, height: 120),
                const SizedBox(height: 16),
                ShaderMask(
                  shaderCallback: (bounds) => AppTheme.gradient.createShader(bounds),
                  child: const Text(
                    'U Learn',
                    style: TextStyle(
                      fontSize: 32,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'WhatsApp OTP Authentication',
                  style: TextStyle(color: AppTheme.muted),
                ),
                const SizedBox(height: 32),
                if (!_otpStep) ...[
                  TextField(
                    controller: _phoneCtrl,
                    keyboardType: TextInputType.phone,
                    textDirection: TextDirection.ltr,
                    decoration: const InputDecoration(
                      labelText: 'Mobile Number',
                      hintText: '+964 7XX XXX XXXX',
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _loading ? null : _sendOtp,
                      child: Text(_loading ? 'Sending...' : 'Send OTP via WhatsApp'),
                    ),
                  ),
                ] else ...[
                  Text(
                    'Code sent to ${_phoneCtrl.text}',
                    style: const TextStyle(color: AppTheme.muted),
                    textDirection: TextDirection.ltr,
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _otpCtrl,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    maxLength: 6,
                    style: const TextStyle(fontSize: 24, letterSpacing: 12),
                    decoration: const InputDecoration(
                      labelText: 'Verification Code',
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _loading ? null : _verify,
                      child: Text(_loading ? 'Verifying...' : 'Verify'),
                    ),
                  ),
                  TextButton(
                    onPressed: () => setState(() => _otpStep = false),
                    child: const Text('Change number'),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.redAccent)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
