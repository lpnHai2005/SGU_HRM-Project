import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

// expo-notifications warns as soon as its entry module is loaded in Expo Go.
// Keep the in-app notification center available there; load native push only
// in a development/production build where Android remote push is supported.
function loadNativeNotifications(): typeof ExpoNotifications {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- guarded runtime load avoids Expo Go's import-time warning
  return require('expo-notifications');
}

export const nativeNotifications: typeof ExpoNotifications | null =
  Platform.OS === 'web' || isRunningInExpoGo() ? null : loadNativeNotifications();
