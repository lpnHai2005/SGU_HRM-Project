import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

export type AppNotificationType =
  | 'leave_approval'
  | 'leave_status'
  | 'attendance_reminder'
  | 'attendance_alert'
  | 'payroll'
  | 'system';

export interface AppNotificationItem {
  id: string;
  type: AppNotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  timestamp: number;
  read: boolean;
  actionUrl?: string;
}

export interface NotificationPreferences {
  enabled: boolean;
  attendanceReminders: boolean;
  leaveApprovals: boolean;
  leaveStatusUpdates: boolean;
  payrollAlerts: boolean;
}

export const defaultNotificationPrefs: NotificationPreferences = {
  enabled: true,
  attendanceReminders: true,
  leaveApprovals: true,
  leaveStatusUpdates: true,
  payrollAlerts: true,
};

const STORAGE_NOTIFS_KEY = 'techzone.notifications.list';
const STORAGE_PREFS_KEY = 'techzone.notifications.prefs';
const MAX_STORED_NOTIFICATIONS = 50;

function getStorageKey(baseKey: string, userKey?: string | null): string {
  const cleanUser = userKey ? userKey.replace(/[^a-zA-Z0-9_-]/g, '_') : 'guest';
  return `${baseKey}.${cleanUser}`;
}

// Setup global notification handler for foreground display
if (Platform.OS !== 'web') {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (err) {
    console.warn('[Notifications] setNotificationHandler error:', err);
  }
}

/**
 * Configure Android notification channels and request permission
 */
export async function setupPushNotificationsAsync(): Promise<{
  granted: boolean;
  pushToken: string | null;
}> {
  if (Platform.OS === 'web') {
    return { granted: true, pushToken: 'web-push-token-mock' };
  }

  try {
    // Android notification channels configuration
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Thông báo chung',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#208AEF',
      });

      await Notifications.setNotificationChannelAsync('approvals', {
        name: 'Duyệt đơn nghỉ phép',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#F59E0B',
      });

      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Nhắc nhở chấm công',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#10B981',
      });

      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Cảnh báo nhân sự',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 400, 200, 400],
        lightColor: '#EF4444',
      });
    }

    // Check permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return { granted: false, pushToken: null };
    }

    // Get Expo push token (if supported device)
    let pushToken: string | null = null;
    if (Device.isDevice) {
      try {
        const tokenRes = await Notifications.getExpoPushTokenAsync();
        pushToken = tokenRes.data;
      } catch {
        pushToken = `ExpoDevToken-${Platform.OS}-${Date.now().toString(36)}`;
      }
    } else {
      pushToken = `SimulatorToken-${Platform.OS}`;
    }

    return { granted: true, pushToken };
  } catch (error) {
    console.warn('[Notifications] setup error:', error);
    return { granted: false, pushToken: null };
  }
}

/**
 * Dispatch an immediate local native push notification and store in history
 */
export async function sendLocalNotification(params: {
  type: AppNotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  actionUrl?: string;
  channelId?: string;
  id?: string;
}): Promise<AppNotificationItem> {
  const channelMap: Record<AppNotificationType, string> = {
    leave_approval: 'approvals',
    leave_status: 'approvals',
    attendance_reminder: 'reminders',
    attendance_alert: 'alerts',
    payroll: 'default',
    system: 'default',
  };

  const channelId = params.channelId || channelMap[params.type] || 'default';
  const notificationId = params.id || `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // Schedule native push alert
  if (Platform.OS !== 'web') {
    try {
      const perm = await Notifications.getPermissionsAsync().catch(() => null);
      if (perm?.status === 'granted') {
        await Notifications.scheduleNotificationAsync({
          identifier: notificationId,
          content: {
            title: params.title,
            body: params.body,
            data: {
              ...params.data,
              type: params.type,
              actionUrl: params.actionUrl,
              internalId: notificationId,
            },
            sound: true,
            // @ts-expect-error Android specific channel
            channelId,
          },
          trigger: null, // Send immediately
        });
      }
    } catch (err) {
      if (__DEV__) {
        console.log('[Notifications] Native schedule skipped/failed:', (err as Error)?.message || err);
      }
    }
  }

  const item: AppNotificationItem = {
    id: notificationId,
    type: params.type,
    title: params.title,
    body: params.body,
    data: {
      ...params.data,
      internalId: notificationId,
    },
    actionUrl: params.actionUrl,
    timestamp: Date.now(),
    read: false,
  };

  return item;
}

/**
 * Schedule a repeating shift reminder
 */
export async function scheduleShiftReminder(params: {
  identifier: string;
  shiftTitle: string;
  hour: number;
  minute: number;
}): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const perm = await Notifications.getPermissionsAsync().catch(() => null);
    if (perm?.status !== 'granted') return;

    await Notifications.cancelScheduledNotificationAsync(params.identifier).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: params.identifier,
      content: {
        title: 'Nhắc nhở ca làm việc',
        body: `Sắp tới giờ làm việc ${params.shiftTitle} (${String(params.hour).padStart(2, '0')}:${String(params.minute).padStart(2, '0')}). Hãy chấm công đúng giờ nhé!`,
        sound: true,
        // @ts-expect-error Android channel
        channelId: 'reminders',
        data: { actionUrl: '/(staff)/attendance' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: params.hour,
        minute: params.minute,
        channelId: 'reminders',
      },
    });
  } catch (err) {
    if (__DEV__) {
      console.log('[Notifications] scheduleShiftReminder fallback:', (err as Error)?.message || err);
    }
  }
}

/**
 * Load notifications for a specific user from persistent storage
 */
export async function loadNotificationsFromStorage(userKey?: string | null): Promise<AppNotificationItem[]> {
  try {
    const key = getStorageKey(STORAGE_NOTIFS_KEY, userKey);
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } else {
      raw = await SecureStore.getItemAsync(key);
    }
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Save notifications list for a specific user to persistent storage
 */
export async function saveNotificationsToStorage(
  items: AppNotificationItem[],
  userKey?: string | null
): Promise<void> {
  try {
    const key = getStorageKey(STORAGE_NOTIFS_KEY, userKey);
    const trimmed = items.slice(0, MAX_STORED_NOTIFICATIONS);
    const json = JSON.stringify(trimmed);
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, json);
    } else {
      await SecureStore.setItemAsync(key, json);
    }
  } catch (err) {
    console.warn('[Notifications] save error:', err);
  }
}

/**
 * Load notification preferences for a specific user
 */
export async function loadNotificationPrefs(userKey?: string | null): Promise<NotificationPreferences> {
  try {
    const key = getStorageKey(STORAGE_PREFS_KEY, userKey);
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } else {
      raw = await SecureStore.getItemAsync(key);
    }
    if (!raw) return defaultNotificationPrefs;
    return { ...defaultNotificationPrefs, ...JSON.parse(raw) };
  } catch {
    return defaultNotificationPrefs;
  }
}

/**
 * Save notification preferences for a specific user
 */
export async function saveNotificationPrefs(
  prefs: NotificationPreferences,
  userKey?: string | null
): Promise<void> {
  try {
    const key = getStorageKey(STORAGE_PREFS_KEY, userKey);
    const json = JSON.stringify(prefs);
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, json);
    } else {
      await SecureStore.setItemAsync(key, json);
    }
  } catch (err) {
    console.warn('[Notifications] save prefs error:', err);
  }
}

/**
 * Create a personalized welcome notification for the user account
 */
export function createPersonalizedWelcomeNotif(profile?: {
  full_name?: string;
  roles?: string[];
} | null): AppNotificationItem {
  const isManager = profile?.roles?.some(r =>
    ['STORE_MANAGER', 'HR_MANAGER', 'ADMIN'].includes(r)
  );
  const name = profile?.full_name || 'bạn';
  return {
    id: `welcome-${Date.now()}`,
    type: 'system',
    title: 'Chào mừng đến với TechZone HRM',
    body: isManager
      ? `Xin chào ${name}! Hệ thống sẵn sàng cho việc tiếp nhận đơn nghỉ phép cần duyệt và theo dõi nhân sự.`
      : `Xin chào ${name}! Bạn có thể theo dõi thông báo ca làm việc, kết quả duyệt đơn và phiếu lương tại đây.`,
    actionUrl: isManager ? '/(staff)/dashboard' : '/(staff)/summary',
    timestamp: Date.now(),
    read: false,
  };
}

/**
 * Preset sample notifications for testing and demonstration
 */
export const SAMPLE_NOTIFICATIONS: Omit<AppNotificationItem, 'id' | 'timestamp' | 'read'>[] = [
  {
    type: 'leave_approval',
    title: 'Đơn xin nghỉ phép chờ duyệt',
    body: 'Có đơn nghỉ phép mới từ nhân viên chi nhánh cần phê duyệt.',
    actionUrl: '/(staff)/requests',
    data: { requestId: 101 },
  },
  {
    type: 'leave_status',
    title: 'Kết quả duyệt đơn nghỉ phép',
    body: 'Đơn nghỉ phép của bạn đã được phòng nhân sự phê duyệt chính thức.',
    actionUrl: '/(staff)/requests',
    data: { requestId: 99, status: 'HR_APPROVED' },
  },
  {
    type: 'attendance_reminder',
    title: 'Nhắc nhở chấm công vào ca',
    body: 'Sắp tới giờ làm việc. Hãy thực hiện check-in selfie và vị trí tại cửa hàng nhé!',
    actionUrl: '/(staff)/attendance',
    data: { shift: 'Ca Sáng' },
  },
  {
    type: 'attendance_alert',
    title: 'Cảnh báo nhân sự chi nhánh',
    body: 'Có nhân viên check-in trễ giờ tại chi nhánh. Chạm để xem tổng hợp.',
    actionUrl: '/(staff)/dashboard',
    data: { lateCount: 1 },
  },
  {
    type: 'payroll',
    title: 'Phiếu lương tháng mới đã sẵn sàng',
    body: 'Bảng lương kỳ gần nhất đã được hoàn tất. Bạn có thể xem chi tiết hoặc in phiếu lương.',
    actionUrl: '/(staff)/payroll',
    data: { month: '2026-10' },
  },
];
