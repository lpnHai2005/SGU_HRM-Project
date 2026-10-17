import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { request } from './attendance';

const MAX_UPLOAD_BYTES = 500 * 1024;

export async function uploadAttendancePhoto(asset: { uri: string; width: number; height: number }, token: string) {
  let file: File | undefined;
  try {
    // Preserve the existing capture/upload flow; normalize only the image before upload.
    // The first pass uses the agreed profile. Smaller profiles are fallback only
    // when needed to enforce the hard 500 KB upload limit.
    const profiles = [
      { edge: 1280, quality: .82 },
      { edge: 1152, quality: .72 },
      { edge: 1024, quality: .62 },
      { edge: 960, quality: .5 },
    ];
    let uri: string | undefined;
    let webBlob: Blob | undefined;
    let finalFile: File | undefined;
    let outputBytes = 0;

    for (const profile of profiles) {
      const context = ImageManipulator.manipulate(asset.uri);
      const longestEdge = Math.max(asset.width, asset.height);
      if (longestEdge > profile.edge) {
        context.resize(asset.width >= asset.height ? { width: profile.edge } : { height: profile.edge });
      }
      let candidateUri: string;
      try {
        const image = await context.renderAsync();
        try {
          candidateUri = (await image.saveAsync({
            format: SaveFormat.JPEG,
            compress: profile.quality,
          })).uri;
        } finally {
          image.release();
        }
      } finally {
        context.release();
      }

      if (Platform.OS === 'web') {
        const response = await fetch(candidateUri);
        if (!response.ok) throw new Error('Không đọc được ảnh vừa chụp. Vui lòng chụp lại.');
        const candidateBlob = await response.blob();
        outputBytes = candidateBlob.size;
        if (outputBytes > 0 && outputBytes <= MAX_UPLOAD_BYTES) {
          uri = candidateUri;
          webBlob = candidateBlob;
          break;
        }
      } else {
        const candidateFile = new File(candidateUri);
        outputBytes = candidateFile.size || 0;
        if (candidateFile.exists && outputBytes > 0 && outputBytes <= MAX_UPLOAD_BYTES) {
          uri = candidateUri;
          finalFile = candidateFile;
          break;
        }
        try {
          if (candidateFile.exists) candidateFile.delete();
        } catch {
          // Cache cleanup must not prevent the smaller retry.
        }
      }
    }

    if (!uri || outputBytes <= 0 || outputBytes > MAX_UPLOAD_BYTES) {
      throw new Error('Không thể nén ảnh chấm công xuống tối đa 500 KB. Vui lòng chụp lại.');
    }

    const form = new FormData();
    if (Platform.OS === 'web') {
      if (!webBlob || webBlob.size > MAX_UPLOAD_BYTES) {
        throw new Error('Ảnh không hợp lệ hoặc vượt quá 500 KB. Vui lòng chụp lại.');
      }
      form.append('file', webBlob, 'selfie.jpg');
    } else {
      file = finalFile || new File(uri);
      if (!file.exists || !file.size || file.size > MAX_UPLOAD_BYTES) {
        throw new Error('Ảnh không đọc được hoặc vượt quá 500 KB. Vui lòng chụp lại.');
      }
      // Expo 57 fetch serializes File.bytes(); the legacy {uri,name,type} object fails.
      form.append('file', file);
    }
    return await request<{ photo_token: string }>('/mobile-attendance/photo', token, undefined, form);
  } finally {
    try {
      if (file?.exists) file.delete();
    } catch {
      // Cache cleanup must not mask upload outcome.
    }
  }
}
