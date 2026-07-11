import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/auth/auth_provider.dart';
import 'package:ulearn/core/l10n/l10n_extension.dart';
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
          SnackBar(content: Text(context.l10n.registerIdUploadFailed('$e'))),
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingId = false);
    }
  }

  String _localizedName(Map<String, dynamic> item, String fallback) {
    final locale = context.localeCode;
    final name = switch (locale) {
      'AR' => item['nameAr']?.toString(),
      'KU' => item['nameKu']?.toString(),
      'TR' => item['nameTr']?.toString(),
      _ => item['nameEn']?.toString(),
    };
    if (name != null && name.isNotEmpty) return name;
    return item['nameEn']?.toString() ?? fallback;
  }

  Future<void> _submit() async {
    final l10n = context.l10n;
    if (_countryId == null || _provinceId == null) {
      setState(() => _error = l10n.t('mobile.register.selectCountryProvince'));
      return;
    }
    if (_nationalIdImageUrl == null) {
      setState(() => _error = l10n.t('mobile.register.attachNationalId'));
      return;
    }
    if (_type == 'STUDENT' && (_stageId == null || _stageId!.isEmpty)) {
      setState(() => _error = l10n.t('mobile.register.selectStage'));
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
        'locale': context.localeCode,
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
    final l10n = context.l10n;
    final emailOptionalLabel = '${l10n.authEmail} (${l10n.t('student.optional')})';

    return Scaffold(
      appBar: AppBar(title: Text(l10n.authRegister)),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            l10n.registerPhoneLabel(widget.phone),
            style: TextStyle(color: AppTheme.muted),
            textDirection: TextDirection.ltr,
          ),
          const SizedBox(height: 16),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'STUDENT', label: Text(l10n.authStudent)),
              ButtonSegment(value: 'CERTIFICATE', label: Text(l10n.authCertificate)),
            ],
            selected: {_type},
            onSelectionChanged: (s) => setState(() => _type = s.first),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            decoration: InputDecoration(labelText: l10n.authFullName),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _gender,
            items: [
              DropdownMenuItem(value: 'MALE', child: Text(l10n.authMale)),
              DropdownMenuItem(value: 'FEMALE', child: Text(l10n.authFemale)),
            ],
            onChanged: (v) => setState(() => _gender = v ?? 'MALE'),
            decoration: InputDecoration(labelText: l10n.authGender),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _nationalId,
            decoration: InputDecoration(labelText: l10n.authNationalId),
          ),
          const SizedBox(height: 12),
          if (_countries.isNotEmpty)
            DropdownButtonFormField<String>(
              initialValue: _countryId,
              items: _countries
                  .map((c) => DropdownMenuItem(
                        value: c['id']?.toString(),
                        child: Text(_localizedName(c, l10n.authCountry)),
                      ))
                  .toList(),
              onChanged: (v) => _onCountryChanged(v, reloadStages: true),
              decoration: InputDecoration(labelText: l10n.authCountry),
            ),
          const SizedBox(height: 12),
          if (_provinces.isNotEmpty)
            DropdownButtonFormField<String>(
              initialValue: _provinceId,
              items: _provinces
                  .map((p) => DropdownMenuItem(
                        value: p['id']?.toString(),
                        child: Text(_localizedName(p, l10n.authProvince)),
                      ))
                  .toList(),
              onChanged: (v) => setState(() => _provinceId = v),
              decoration: InputDecoration(labelText: l10n.authProvince),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            decoration: InputDecoration(labelText: emailOptionalLabel),
          ),
          const SizedBox(height: 16),
          Text(
            l10n.registerIdPhoto,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
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
            label: Text(_idFileName ?? l10n.t('mobile.register.attachId')),
          ),
          if (_nationalIdImageUrl != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.greenAccent, size: 16),
                const SizedBox(width: 6),
                Text(
                  l10n.registerIdUploaded,
                  style: const TextStyle(color: Colors.greenAccent, fontSize: 12),
                ),
              ],
            ),
          ],
          if (_type == 'STUDENT') ...[
            const SizedBox(height: 16),
            TextField(
              controller: _parentPhone,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: l10n.authParentPhone),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _parentEmail,
              keyboardType: TextInputType.emailAddress,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(
                labelText: l10n.t('mobile.register.parentEmail'),
                hintText: l10n.t('student.optional'),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _stageId,
              items: _stages
                  .map((s) => DropdownMenuItem(
                        value: s['id'].toString(),
                        child: Text(_localizedName(s, l10n.authStage)),
                      ))
                  .toList(),
              onChanged: (v) => setState(() => _stageId = v),
              decoration: InputDecoration(labelText: '${l10n.authStage} *'),
            ),
          ],
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _loading ? null : _submit,
            child: Text(_loading ? l10n.t('quiz.submitting') : l10n.authSubmit),
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
