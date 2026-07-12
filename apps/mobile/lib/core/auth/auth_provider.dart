import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:ulearn/core/api/api_client.dart';
import 'package:ulearn/core/l10n/locale_provider.dart';

class StageModel {
  final String id;
  final String nameEn;
  final String nameAr;
  final String nameKu;
  final String nameTr;

  StageModel({
    required this.id,
    required this.nameEn,
    required this.nameAr,
    required this.nameKu,
    required this.nameTr,
  });

  factory StageModel.fromJson(Map<String, dynamic> json) => StageModel(
        id: json['id'] as String,
        nameEn: json['nameEn'] as String? ?? '',
        nameAr: json['nameAr'] as String? ?? '',
        nameKu: json['nameKu'] as String? ?? '',
        nameTr: json['nameTr'] as String? ?? '',
      );

  /// Best display name for the given app locale, falling back to English.
  String nameFor(String locale) {
    final name = switch (locale) {
      'AR' => nameAr,
      'KU' => nameKu,
      'TR' => nameTr,
      _ => nameEn,
    };
    return name.isNotEmpty ? name : nameEn;
  }
}

class InterestModel {
  final String id;
  final String nameEn;
  final String nameAr;
  final String nameKu;
  final String nameTr;
  final String? stageId;

  InterestModel({
    required this.id,
    required this.nameEn,
    required this.nameAr,
    required this.nameKu,
    required this.nameTr,
    this.stageId,
  });

  factory InterestModel.fromJson(Map<String, dynamic> json) => InterestModel(
        id: json['id'] as String,
        nameEn: json['nameEn'] as String? ?? '',
        nameAr: json['nameAr'] as String? ?? '',
        nameKu: json['nameKu'] as String? ?? '',
        nameTr: json['nameTr'] as String? ?? '',
        stageId: json['stageId'] as String?,
      );

  String nameFor(String locale) {
    final name = switch (locale) {
      'AR' => nameAr,
      'KU' => nameKu,
      'TR' => nameTr,
      _ => nameEn,
    };
    return name.isNotEmpty ? name : nameEn;
  }
}

class UserModel {
  final String id;
  final String phone;
  final String? fullLegalName;
  final String? nationalId;
  final String? profilePhotoUrl;
  final int? profileCoverPreset;
  final String role;
  final String status;
  final String locale;
  final StageModel? stage;
  final List<InterestModel> interestSubjects;
  final StageModel? certificateStage;

  UserModel({
    required this.id,
    required this.phone,
    this.fullLegalName,
    this.nationalId,
    this.profilePhotoUrl,
    this.profileCoverPreset,
    required this.role,
    required this.status,
    required this.locale,
    this.stage,
    this.interestSubjects = const [],
    this.certificateStage,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final profile = json['studentProfile'] as Map<String, dynamic>?;
    final stageJson = profile?['educationalStage'] as Map<String, dynamic>?;
    final cert = json['certificateProfile'] as Map<String, dynamic>?;
    final interestRows = ((cert?['interests'] as List<dynamic>?) ?? []);
    final interests = <InterestModel>[];
    StageModel? certStage;
    for (final row in interestRows) {
      final map = row as Map<String, dynamic>;
      final subject = map['subject'] as Map<String, dynamic>?;
      if (subject == null) continue;
      interests.add(InterestModel.fromJson(subject));
      final stageMap = subject['stage'] as Map<String, dynamic>?;
      if (certStage == null && stageMap != null) {
        certStage = StageModel.fromJson(stageMap);
      }
    }
    return UserModel(
      id: json['id'] as String,
      phone: json['phone'] as String,
      fullLegalName: json['fullLegalName'] as String?,
      nationalId: json['nationalId'] as String?,
      profilePhotoUrl: json['profilePhotoUrl'] as String?,
      profileCoverPreset: (json['profileCoverPreset'] as num?)?.toInt(),
      role: json['role'] as String,
      status: json['status'] as String,
      locale: json['locale'] as String? ?? 'AR',
      stage: stageJson != null ? StageModel.fromJson(stageJson) : null,
      interestSubjects: interests,
      certificateStage: certStage,
    );
  }
}

class AuthProvider extends ChangeNotifier {
  AuthProvider(this._api);

  final ApiClient _api;
  LocaleProvider? _locale;
  UserModel? user;
  bool loading = true;
  String? pendingPhone;

  bool get isAuthenticated => user != null;

  void attachLocale(LocaleProvider locale) {
    _locale = locale;
  }

  Future<void> bootstrap() async {
    await _api.loadToken();
    try {
      final data = await _api.get('/api/auth/me');
      user = UserModel.fromJson(data['user'] as Map<String, dynamic>);
      await _locale?.syncFromUser(user?.locale);
    } catch (_) {
      user = null;
    }
    loading = false;
    notifyListeners();
  }

  Future<void> sendOtp(String phone) async {
    await _api.post('/api/auth/otp/send', {'phone': phone});
    pendingPhone = phone;
    notifyListeners();
  }

  /// Stable per-install device identifier used for device-limit enforcement.
  Future<String?> _deviceId() async {
    try {
      final plugin = DeviceInfoPlugin();
      if (Platform.isIOS) {
        return (await plugin.iosInfo).identifierForVendor;
      }
      if (Platform.isAndroid) {
        return (await plugin.androidInfo).id;
      }
    } catch (_) {}
    return null;
  }

  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async {
    final deviceId = await _deviceId();
    final data = await _api.post('/api/auth/otp/verify', {
      'phone': phone,
      'code': code,
      'deviceId': ?deviceId,
    });

    if (data['token'] != null) {
      await _api.setToken(data['token'] as String);
    }

    if (data['isNewUser'] == true) {
      pendingPhone = phone;
      return data;
    }

    if (data['user'] != null) {
      user = UserModel.fromJson(data['user'] as Map<String, dynamic>);
      await _locale?.syncFromUser(user?.locale);
    }
    notifyListeners();
    return data;
  }

  Future<void> logout() async {
    try {
      await _api.post('/api/auth/logout', {});
    } catch (_) {}
    await _api.setToken(null);
    user = null;
    notifyListeners();
  }

  void applyUser(Map<String, dynamic> json) {
    user = UserModel.fromJson(json);
    _locale?.syncFromUser(user?.locale);
    notifyListeners();
  }

  Future<void> refreshUser() async {
    try {
      final data = await _api.get('/api/auth/me');
      applyUser(data['user'] as Map<String, dynamic>);
    } catch (_) {}
  }
}
