import 'package:file_picker/file_picker.dart';
import 'package:ulearn/core/api/api_client.dart';

/// Upload a profile photo and persist it on the user record.
class ProfilePhotoService {
  static String _contentType(String? ext) {
    return switch (ext?.toLowerCase()) {
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      _ => 'image/jpeg',
    };
  }

  static Future<Map<String, dynamic>> uploadAndSave(ApiClient api) async {
    final pick = await FilePicker.pickFiles(
      type: FileType.image,
      withData: true,
    );
    if (pick == null || pick.files.isEmpty || pick.files.first.bytes == null) {
      throw ProfilePhotoException('cancelled');
    }

    final file = pick.files.first;
    final bytes = file.bytes!;
    final contentType = _contentType(file.extension);

    final presign = await api.post('/api/profile/photo', {
      'filename': file.name,
      'contentType': contentType,
      'size': bytes.length,
    });

    final uploadUrl = presign['uploadUrl']?.toString();
    final key = presign['key']?.toString();
    final publicUrl = presign['publicUrl']?.toString();
    if (uploadUrl == null || key == null) {
      throw ProfilePhotoException('Upload setup failed');
    }

    await api.putBytes(uploadUrl, bytes, contentType);

    return api.patch('/api/profile/photo', {
      'profilePhotoKey': key,
      'profilePhotoUrl': ?publicUrl,
    });
  }

  static Future<Map<String, dynamic>> remove(ApiClient api) {
    return api.delete('/api/profile/photo');
  }
}

class ProfilePhotoException implements Exception {
  ProfilePhotoException(this.message);
  final String message;

  @override
  String toString() => message;
}
