import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:ulearn/core/api/api_client.dart';

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

class UserModel {
  final String id;
  final String phone;
  final String? fullLegalName;
  final String role;
  final String status;
  final String locale;
  final StageModel? stage;

  UserModel({
    required this.id,
    required this.phone,
    this.fullLegalName,
    required this.role,
    required this.status,
    required this.locale,
    this.stage,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final profile = json['studentProfile'] as Map<String, dynamic>?;
    final stageJson = profile?['educationalStage'] as Map<String, dynamic>?;
    return UserModel(
      id: json['id'] as String,
      phone: json['phone'] as String,
      fullLegalName: json['fullLegalName'] as String?,
      role: json['role'] as String,
      status: json['status'] as String,
      locale: json['locale'] as String? ?? 'AR',
      stage: stageJson != null ? StageModel.fromJson(stageJson) : null,
    );
  }
}

class AuthProvider extends ChangeNotifier {
  AuthProvider(this._api);

  final ApiClient _api;
  UserModel? user;
  bool loading = true;
  String? pendingPhone;

  bool get isAuthenticated => user != null;

  Future<void> bootstrap() async {
    await _api.loadToken();
    try {
      final data = await _api.get('/api/auth/me');
      user = UserModel.fromJson(data['user'] as Map<String, dynamic>);
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
}
