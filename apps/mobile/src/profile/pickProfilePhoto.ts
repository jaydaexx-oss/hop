import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { AVATAR_MAX_BYTES, AVATAR_PIXEL_SIZE } from './profilePhoto';

export async function prepareSquareJpeg(uri: string): Promise<string> {
  let quality = 0.72;
  let result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: AVATAR_PIXEL_SIZE, height: AVATAR_PIXEL_SIZE } }],
    { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
  );
  let info = await FileSystem.getInfoAsync(result.uri);
  while (info.exists && typeof info.size === 'number' && info.size > AVATAR_MAX_BYTES && quality > 0.35) {
    quality -= 0.14;
    result = await ImageManipulator.manipulateAsync(
      result.uri,
      [],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
    );
    info = await FileSystem.getInfoAsync(result.uri);
  }
  if (info.exists && typeof info.size === 'number' && info.size > AVATAR_MAX_BYTES) {
    throw new Error('Photo is still too large after compression. Try another image.');
  }
  return result.uri;
}

export async function pickPreparedProfilePhoto(source: 'library' | 'camera'): Promise<string | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Camera permission is required to take a profile photo.');
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Photos permission is required to choose a profile photo.');
    }
  }
  const launch = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const picked = await launch({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (picked.canceled || !picked.assets[0]?.uri) return null;
  return prepareSquareJpeg(picked.assets[0].uri);
}
