import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { request } from './attendance';

export async function uploadAttendancePhoto(asset: { uri: string; width: number; height: number }, token: string) {
  let file: File | undefined;
  const context = ImageManipulator.manipulate(asset.uri);
  try {
    if (Math.max(asset.width, asset.height) > 1600) {
      context.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
    }
    const image = await context.renderAsync();
    let uri: string;
    try { uri = (await image.saveAsync({ format: SaveFormat.JPEG, compress: .75 })).uri; }
    finally { image.release(); }
    const form = new FormData();
    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      if (!response.ok) throw new Error('Không đọc được ảnh vừa chụp. Vui lòng chụp lại.');
      const blob = await response.blob();
      if (!blob.size || blob.size > 5 * 1024 * 1024) throw new Error('Ảnh không hợp lệ hoặc vượt quá 5 MB. Vui lòng chụp lại.');
      form.append('file', blob, 'selfie.jpg');
    } else {
      file = new File(uri);
      if (!file.exists || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Ảnh không đọc được hoặc vượt quá 5 MB. Vui lòng chụp lại.');
      // Expo 57 fetch serializes File.bytes(); the legacy {uri,name,type} object fails.
      form.append('file', file);
    }
    return await request<{ photo_token: string }>('/mobile-attendance/photo', token, undefined, form);
  } finally {
    context.release();
    try { if (file?.exists) file.delete(); } catch { /* Cache cleanup must not mask upload outcome. */ }
  }
}
