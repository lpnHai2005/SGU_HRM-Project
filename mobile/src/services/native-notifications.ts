import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

function loadNativeNotifications(): typeof ExpoNotifications | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch (err) {
    if (__DEV__) {
      console.warn('[Notifications] Failed to load expo-notifications:', err);
    }
    return null;
  }
}

export const nativeNotifications: typeof ExpoNotifications | null = loadNativeNotifications();
