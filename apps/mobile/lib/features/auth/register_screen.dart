import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
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
  final _parentEmail = TextEditingController();
  final _email = TextEditingController();
  String _gender = 'MALE';
  List<Map<String, dynamic>> _countries = [];
  List<Map<String, dynamic>> _provinces = [];
  List<Map<String, dynamic>> _stages = [];
  String? _countryId;
  String? _provinceId;
  String? _stageId;
  String? _nationalIdImageUrl;
  String? _idFileName;
  bool _loading = false;
  bool _uploadingId = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCountries();
  }

  Future<void> _loadCountries() async {
    try {
      final data = await context.read<ApiClient>().get('/api/countries');
      if (!mounted) return;
      final countries =
          ((data['countries'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
      setState(() {
        _countries = countries;
        _countryId ??= countries.isNotEmpty ? countries.first['id']?.toString() : null;
        _onCountryChanged(_countryId, reloadStages: true);
      });
    } catch (_) {}
  }

  void _onCountryChanged(String? countryId, {bool reloadStages = false}) {
    final country = _countries.cast<Map<String, dynamic>?>().firstWhere(
          (c) => c?['id']?.toString() == countryId,
          orElse: () => null,
        );
    final provinces =
        ((country?['provinces'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
    setState(() {
      _countryId = countryId;
      _provinces = provinces;
      _provinceId = provinces.isNotEmpty ? provinces.first['id']?.toString() : null;
    });
    if (reloadStages && countryId != null) _loadStages(countryId);
  }

  Future<void> _loadStages(String countryId) async {
    try {
      final data = await context.read<ApiClient>().get('/api/stages?countryId=$countryId');
      if (!mounted) return;
      setState(() {
        _stages =
            ((data['stages'] as List<dynamic>?) ?? []).cast<Map<String, dynamic>>();
        _stageId = null;
      });
    } catch (_) {}
  }

  Future<void> _pickIdImage() async {
    final pick = await FilePicker.pickFiles(
      type: FileType.image,
      withData: true,
    );
    if (pick == null || pick.files.isEmpty) return;

    final file = pick.files.first;
    Uint8List? bytes = file.bytes;
    if (bytes == null && file.path != null) {
      bytes = await File(file.path!).readAsBytes();
    }
    if (bytes == null) return;

    setState(() {
      _uploadingId = true;
      _idFileName = file.name;
    });

    try {
      final api = context.read<ApiClient>();
      final ext = file.extension?.toLowerCase() ?? 'jpg';
      final contentType = ext == 'png'
          ? 'image/png'
          : ext == 'webp'
              ? 'image/webp'
              : 'image/jpeg';

      final presign = await api.post('/api/auth/register/upload', {
        'phone': widget.phone,
        'filename': file.name,
        'contentType': contentType,
        'size': bytes.length,
      });

      final uploadUrl = presign['uploadUrl']?.toString();
      final publicUrl = presign['publicUrl']?.toString();
      if (uploadUrl == null) throw Exception('Upload setup failed');

      await api.putBytes(uploadUrl, bytes, contentType);
      if (!mounted) return;
      setState(() => _nationalIdImageUrl = publicUrl ?? uploadUrl);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not upload ID: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingId = false);
    }
  }

  String _stageLabel(Map<String, dynamic> s) {
    final ar = s['nameAr']?.toString();
    if (ar != null && ar.isNotEmpty) return ar;
    return s['nameEn']?.toString() ?? 'Stage';
  }

  String _provinceLabel(Map<String, dynamic> p) {
    final ar = p['nameAr']?.toString();
    if (ar != null && ar.isNotEmpty) return ar;
    return p['nameEn']?.toString() ?? 'Province';
  }

  Future<void> _submit() async {
    if (_countryId == null || _provinceId == null) {
      setState(() => _error = 'Please select country and province');
      return;
    }
    if (_nationalIdImageUrl == null) {
      setState(() => _error = 'Please attach your national ID image');
      return;
    }
    if (_type == 'STUDENT' && (_stageId == null || _stageId!.isEmpty)) {
      setState(() => _error = 'Please select your educational stage');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final payload = <String, dynamic>{
        'type': _type,
        'phone': widget.phone,
        'fullLegalName': _name.text.trim(),
        'gender': _gender,
        'countryId': _countryId,
        'provinceId': _provinceId,
        'nationalId': _nationalId.text.trim(),
        'nationalIdImage': _nationalIdImageUrl,
        'email': _email.text.trim().isEmpty ? null : _email.text.trim(),
        'locale': 'AR',
      };

      if (_type == 'STUDENT') {
        payload['parentPhone'] = _parentPhone.text.trim();
        if (_parentEmail.text.trim().isNotEmpty) {
          payload['parentEmail'] = _parentEmail.text.trim();
        }
        payload['educationalStageId'] = _stageId;
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
  void dispose() {
    _name.dispose();
    _nationalId.dispose();
    _parentPhone.dispose();
    _parentEmail.dispose();
    _email.dispose();
    super.dispose();
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
          if (_countries.isNotEmpty)
            DropdownButtonFormField<String>(
              initialValue: _countryId,
              items: _countries
                  .map((c) => DropdownMenuItem(
                        value: c['id']?.toString(),
                        child: Text(c['nameAr']?.toString() ?? c['nameEn']?.toString() ?? 'Country'),
                      ))
                  .toList(),
              onChanged: (v) => _onCountryChanged(v, reloadStages: true),
              decoration: const InputDecoration(labelText: 'Country'),
            ),
          const SizedBox(height: 12),
          if (_provinces.isNotEmpty)
            DropdownButtonFormField<String>(
              initialValue: _provinceId,
              items: _provinces
                  .map((p) => DropdownMenuItem(
                        value: p['id']?.toString(),
                        child: Text(_provinceLabel(p)),
                      ))
                  .toList(),
              onChanged: (v) => setState(() => _provinceId = v),
              decoration: const InputDecoration(labelText: 'Province'),
            ),
          const SizedBox(height: 12),
          TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email (optional)')),
          const SizedBox(height: 16),
          const Text('National ID photo', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _uploadingId ? null : _pickIdImage,
            icon: _uploadingId
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.badge_outlined),
            label: Text(_idFileName ?? 'Attach ID image'),
          ),
          if (_nationalIdImageUrl != null) ...[
            const SizedBox(height: 6),
            const Row(
              children: [
                Icon(Icons.check_circle, color: Colors.greenAccent, size: 16),
                SizedBox(width: 6),
                Text('ID uploaded', style: TextStyle(color: Colors.greenAccent, fontSize: 12)),
              ],
            ),
          ],
          if (_type == 'STUDENT') ...[
            const SizedBox(height: 16),
            TextField(
              controller: _parentPhone,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              decoration: const InputDecoration(labelText: 'Parent Phone'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _parentEmail,
              keyboardType: TextInputType.emailAddress,
              textDirection: TextDirection.ltr,
              decoration: const InputDecoration(
                labelText: 'Parent Email (for quiz results)',
                hintText: 'optional',
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _stageId,
              items: _stages
                  .map((s) => DropdownMenuItem(
                        value: s['id'].toString(),
                        child: Text(_stageLabel(s)),
                      ))
                  .toList(),
              onChanged: (v) => setState(() => _stageId = v),
              decoration: const InputDecoration(labelText: 'Educational Stage *'),
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
