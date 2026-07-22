import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
import 'package:ulearn/core/theme/app_theme.dart';
import 'package:ulearn/features/home/home_feed.dart';

class SubscriptionsScreen extends StatefulWidget {
  const SubscriptionsScreen({super.key});

  @override
  State<SubscriptionsScreen> createState() => _SubscriptionsScreenState();
}

class _SubscriptionsScreenState extends State<SubscriptionsScreen> {
  List<dynamic> _packages = [];
  final _codeCtrl = TextEditingController();
  String? _message;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _codeCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<ApiClient>().get('/api/subscriptions');
      setState(() => _packages = data['packages'] as List<dynamic>? ?? []);
    } catch (_) {}
  }

  Future<void> _request(String packageId) async {
    try {
      await context.read<ApiClient>().post('/api/subscriptions', {
        'packageId': packageId,
      });
      setState(() => _message = context.l10n.studentRequestSubmitted);
    } catch (e) {
      setState(() => _message = e.toString());
    }
  }

  Future<void> _activate() async {
    try {
      await context.read<ApiClient>().post('/api/subscriptions/activate', {
        'code': _codeCtrl.text.trim(),
      });
      setState(() => _message = context.l10n.studentActivated);
    } catch (e) {
      setState(() => _message = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locale = context.localeCode;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l10n.studentActivateCode, style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                TextField(
                  controller: _codeCtrl,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(hintText: l10n.t('mobile.subscriptions.codeHint')),
                ),
                const SizedBox(height: 12),
                ElevatedButton(onPressed: _activate, child: Text(l10n.t('common.activate'))),
              ],
            ),
          ),
        ),
        if (_message != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(_message!, style: const TextStyle(color: AppTheme.accent)),
          ),
        const SizedBox(height: 8),
        ..._packages.map((p) {
          final pkg = p as Map<String, dynamic>;
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    localizedText(pkg, locale, prefix: 'name'),
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 8),
                  Text(
                    '${pkg['price']} · ${pkg['deviceLimit']} ${l10n.t('student.devices')}',
                    style: TextStyle(color: AppTheme.muted),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () => _request(pkg['id'] as String),
                      child: Text(l10n.studentRequestActivation),
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }
}
