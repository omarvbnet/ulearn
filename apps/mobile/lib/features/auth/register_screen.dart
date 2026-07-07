import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/theme/app_theme.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, required this.phone});

  final String phone;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  String _type = 'STUDENT';
  final _name = TextEditingController();
  final _nationalId = TextEditingController();
  final _parentPhone = TextEditingController();
  final _email = TextEditingController();
  String _gender = 'MALE';
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _nationalId.dispose();
    _parentPhone.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final countries = await api.get('/api/countries');
      final list = countries['countries'] as List<dynamic>;
      if (list.isEmpty) throw Exception('No countries configured');
      final country = list.first as Map<String, dynamic>;
      final provinces = country['provinces'] as List<dynamic>;
      if (provinces.isEmpty) throw Exception('No provinces configured');

      final payload = <String, dynamic>{
        'type': _type,
        'phone': widget.phone,
        'fullLegalName': _name.text.trim(),
        'gender': _gender,
        'countryId': country['id'],
        'provinceId': (provinces.first as Map)['id'],
        'nationalId': _nationalId.text.trim(),
        'email': _email.text.trim().isEmpty ? null : _email.text.trim(),
        'locale': 'AR',
      };

      if (_type == 'STUDENT') {
        payload['parentPhone'] = _parentPhone.text.trim();
      }

      final data = await api.post('/api/auth/register', payload);
      if (data['token'] != null) {
        await api.setToken(data['token'] as String);
      }
      if (!mounted) return;
      await context.read<AuthProvider>().bootstrap();
      if (!mounted) return;
      Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create Account')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text('Phone: ${widget.phone}',
              style: const TextStyle(color: AppTheme.muted),
              textDirection: TextDirection.ltr),
          const SizedBox(height: 16),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'STUDENT', label: Text('Student')),
              ButtonSegment(value: 'CERTIFICATE', label: Text('Certificate')),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          const SizedBox(height: 16),
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full Legal Name')),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _gender,
            items: const [
              DropdownMenuItem(value: 'MALE', child: Text('Male')),
              DropdownMenuItem(value: 'FEMALE', child: Text('Female')),
            ],
            onChanged: (v) => setState(() => _gender = v ?? 'MALE'),
            decoration: const InputDecoration(labelText: 'Gender'),
          ),
          const SizedBox(height: 12),
          TextField(controller: _nationalId, decoration: const InputDecoration(labelText: 'National ID')),
          const SizedBox(height: 12),
          TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email')),
          if (_type == 'STUDENT') ...[
            const SizedBox(height: 12),
            TextField(
              controller: _parentPhone,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              decoration: const InputDecoration(labelText: 'Parent Phone'),
            ),
          ],
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _loading ? null : _submit,
            child: Text(_loading ? 'Submitting...' : 'Submit Registration'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          ],
        ],
      ),
    );
  }
}
