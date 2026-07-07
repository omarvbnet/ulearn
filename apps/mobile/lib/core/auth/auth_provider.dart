import 'package:flutter/foundation.dart';
import 'package:ulearn/core/api/api_client.dart';

class UserModel {
  final String id;
  final String phone;
  final String? fullLegalName;
  final String role;
  final String status;
  final String locale;

  UserModel({
    required this.id,
    required this.phone,
    this.fullLegalName,
    required this.role,
    required this.status,
    required this.locale,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) => UserModel(
        id: json['id'] as String,
        phone: json['phone'] as String,
        fullLegalName: json['fullLegalName'] as String?,
        role: json['role'] as String,
        status: json['status'] as String,
        locale: json['locale'] as String? ?? 'AR',
      );
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

  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async {
    final data = await _api.post('/api/auth/otp/verify', {
      'phone': phone,
      'code': code,
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
