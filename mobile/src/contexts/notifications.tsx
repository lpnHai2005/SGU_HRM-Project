import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useSession } from '@/contexts/session';
import { request } from '@/services/attendance';
import { type Profile } from '@/services/staff';
import {
  type AppNotificationItem,
  type AppNotificationType,
  type NotificationPreferences,
  defaultNotificationPrefs,
  setupPushNotificationsAsync,
  sendLocalNotification,
  loadNotificationsFromStorage,
  saveNotificationsToStorage,
  loadNotificationPrefs,
  saveNotificationPrefs,
  createPersonalizedWelcomeNotif,
  SAMPLE_NOTIFICATIONS,
} from '@/services/notifications';

interface NotificationContextValue {
  notifications: AppNotificationItem[];
  unreadCount: number;
  permissionGranted: boolean;
  pushToken: string | null;
  prefs: NotificationPreferences;
  activeBanner: AppNotificationItem | null;
  isCenterOpen: boolean;
  userProfile: Profile | null;
  isManagerUser: boolean;
  setCenterOpen: (open: boolean) => void;
  requestPermission: () => Promise<boolean>;
  updatePrefs: (value: Partial<NotificationPreferences>) => Promise<void>;
  dispatchNotification: (params: {
    type: AppNotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    actionUrl?: string;
  }) => Promise<AppNotificationItem | null>;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (id: string) => void;
  clearAll: () => void;
  dismissBanner: () => void;
  triggerTestNotification: (type?: AppNotificationType) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { token } = useSession();
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultNotificationPrefs);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [activeBanner, setActiveBanner] = useState<AppNotificationItem | null>(null);
  const [isCenterOpen, setCenterOpen] = useState(false);

  // User identifier for storage partitioning
  const userKey = useMemo(() => {
    if (!userProfile) return null;
    return userProfile.username || userProfile.employee_code || (userProfile.employee_id ? String(userProfile.employee_id) : null);
  }, [userProfile]);

  const isManagerUser = useMemo(() => {
    const roles = userProfile?.roles || [];
    return roles.some(r => ['STORE_MANAGER', 'HR_MANAGER', 'ADMIN'].includes(r));
  }, [userProfile]);

  // Load user profile when token changes
  useEffect(() => {
    let active = true;

    async function syncUser() {
      if (!token) {
        setUserProfile(null);
        setNotifications([]);
        return;
      }

      try {
        const prof = await request<Profile>('/auth/me', token);
        if (active) setUserProfile(prof);
      } catch {
        // Fallback if offline
      }
    }

    void syncUser();

    return () => {
      active = false;
    };
  }, [token]);

  // Load user-scoped notifications and preferences
  useEffect(() => {
    let isMounted = true;

    async function initUserNotifications() {
      if (!userKey) {
        if (!token) setNotifications([]);
        return;
      }

      const [savedNotifs, savedPrefs] = await Promise.all([
        loadNotificationsFromStorage(userKey),
        loadNotificationPrefs(userKey),
      ]);

      if (!isMounted) return;

      if (savedNotifs.length > 0) {
        // Filter out any notification not applicable to this user's role
        const validNotifs = savedNotifs.filter(item => {
          if (!isManagerUser && (item.type === 'leave_approval' || item.type === 'attendance_alert')) {
            return false;
          }
          return true;
        });
        setNotifications(validNotifs);
      } else {
        // Fresh personalized welcome notification
        const welcome = createPersonalizedWelcomeNotif(userProfile);
        setNotifications([welcome]);
        void saveNotificationsToStorage([welcome], userKey);
      }

      setPrefs(savedPrefs);

      if (savedPrefs.enabled) {
        const { granted, pushToken: pToken } = await setupPushNotificationsAsync();
        if (isMounted) {
          setPermissionGranted(granted);
          setPushToken(pToken);
        }
      }
    }

    void initUserNotifications();

    return () => {
      isMounted = false;
    };
  }, [userKey, token, isManagerUser, userProfile]);

  // Setup Expo Notification Listeners
  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Listener when user taps on a push notification in tray/lockscreen
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const actionUrl = response.notification.request.content.data?.actionUrl as string | undefined;
      if (actionUrl) {
        try {
          router.push(actionUrl as any);
        } catch (e) {
          console.warn('[Notifications] Navigation error:', e);
        }
      }
    });

    // Listener when notification is received while foregrounded
    const receivedSub = Notifications.addNotificationReceivedListener(notification => {
      const content = notification.request.content;
      const internalId = content.data?.internalId as string | undefined;
      const type = (content.data?.type as AppNotificationType) || 'system';
      const actionUrl = content.data?.actionUrl as string | undefined;

      // Filter: Non-managers shouldn't receive leave approvals
      if (!isManagerUser && (type === 'leave_approval' || type === 'attendance_alert')) {
        return;
      }

      setNotifications(prev => {
        // Prevent duplicate if item with internalId was already dispatched
        if (internalId && prev.some(p => p.id === internalId || p.data?.internalId === internalId)) {
          return prev;
        }

        // Prevent duplicate by requestId + status
        if (content.data?.requestId) {
          const reqId = content.data.requestId;
          const st = content.data?.status;
          if (prev.some(p => p.data?.requestId === reqId && (!st || p.data?.status === st))) {
            return prev;
          }
        }

        // Prevent duplicate by title + body within 10 seconds
        if (
          prev.some(
            p => p.title === content.title && p.body === content.body && Math.abs(p.timestamp - Date.now()) < 10000
          )
        ) {
          return prev;
        }

        const newItem: AppNotificationItem = {
          id: internalId || `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          type,
          title: content.title || 'Thông báo TechZone',
          body: content.body || '',
          data: content.data as Record<string, unknown> | undefined,
          actionUrl,
          timestamp: Date.now(),
          read: false,
        };

        const next = [newItem, ...prev];
        void saveNotificationsToStorage(next, userKey);
        return next;
      });
    });

    return () => {
      responseSub.remove();
      receivedSub.remove();
    };
  }, [router, isManagerUser, userKey]);

  // Auto-dismiss in-app banner after 4.5 seconds
  useEffect(() => {
    if (!activeBanner) return;
    const timer = setTimeout(() => {
      setActiveBanner(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [activeBanner]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const { granted, pushToken: pToken } = await setupPushNotificationsAsync();
    setPermissionGranted(granted);
    setPushToken(pToken);
    return granted;
  }, []);

  const updatePrefs = useCallback(
    async (partial: Partial<NotificationPreferences>) => {
      const next = { ...prefs, ...partial };
      setPrefs(next);
      await saveNotificationPrefs(next, userKey);
      if (partial.enabled && !permissionGranted) {
        await requestPermission();
      }
    },
    [prefs, userKey, permissionGranted, requestPermission]
  );

  const dispatchNotification = useCallback(
    async (params: {
      type: AppNotificationType;
      title: string;
      body: string;
      data?: Record<string, unknown>;
      actionUrl?: string;
    }): Promise<AppNotificationItem | null> => {
      // Role-based personalization check: Non-managers shouldn't receive manager alerts
      if (!isManagerUser && (params.type === 'leave_approval' || params.type === 'attendance_alert')) {
        return null;
      }

      // Check user preferences
      if (!prefs.enabled) return null;
      if (params.type === 'attendance_reminder' && !prefs.attendanceReminders) return null;
      if (params.type === 'leave_approval' && !prefs.leaveApprovals) return null;
      if (params.type === 'leave_status' && !prefs.leaveStatusUpdates) return null;
      if (params.type === 'payroll' && !prefs.payrollAlerts) return null;

      // Duplicate & Already Read Prevention:
      const isDuplicate = notifications.some(existing => {
        if (params.data?.requestId && existing.data?.requestId === params.data.requestId) {
          if (params.data?.status && existing.data?.status === params.data.status) {
            return true;
          }
        }
        if (params.data?.batchKey && existing.data?.batchKey === params.data.batchKey) {
          return true;
        }
        if (
          existing.title === params.title &&
          existing.body === params.body &&
          Math.abs(existing.timestamp - Date.now()) < 10000
        ) {
          return true;
        }
        return false;
      });

      if (isDuplicate) {
        return null;
      }

      const generatedId = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const item = await sendLocalNotification({ ...params, id: generatedId });

      setNotifications(prev => {
        if (prev.some(p => p.id === item.id)) return prev;
        const next = [item, ...prev];
        void saveNotificationsToStorage(next, userKey);
        return next;
      });

      setActiveBanner(item);
      return item;
    },
    [prefs, isManagerUser, notifications, userKey]
  );

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications(prev => {
        const next = prev.map(n => (n.id === id ? { ...n, read: true } : n));
        void saveNotificationsToStorage(next, userKey);
        return next;
      });
    },
    [userKey]
  );

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => {
      const next = prev.map(n => ({ ...n, read: true }));
      void saveNotificationsToStorage(next, userKey);
      return next;
    });
  }, [userKey]);

  const deleteNotification = useCallback(
    (id: string) => {
      setNotifications(prev => {
        const next = prev.filter(n => n.id !== id);
        void saveNotificationsToStorage(next, userKey);
        return next;
      });
    },
    [userKey]
  );

  const clearAll = useCallback(() => {
    setNotifications([]);
    void saveNotificationsToStorage([], userKey);
  }, [userKey]);

  const dismissBanner = useCallback(() => {
    setActiveBanner(null);
  }, []);

  const triggerTestNotification = useCallback(
    async (type?: AppNotificationType) => {
      // Role-filter sample options
      const availableSamples = isManagerUser
        ? SAMPLE_NOTIFICATIONS
        : SAMPLE_NOTIFICATIONS.filter(s => s.type !== 'leave_approval' && s.type !== 'attendance_alert');

      const sample = type
        ? availableSamples.find(s => s.type === type) || availableSamples[0]
        : availableSamples[Math.floor(Math.random() * availableSamples.length)];

      if (!sample) return;

      await dispatchNotification({
        type: sample.type,
        title: sample.title,
        body: sample.body,
        actionUrl: sample.actionUrl,
        data: sample.data,
      });
    },
    [dispatchNotification, isManagerUser]
  );

  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications]
  );

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      permissionGranted,
      pushToken,
      prefs,
      activeBanner,
      isCenterOpen,
      userProfile,
      isManagerUser,
      setCenterOpen,
      requestPermission,
      updatePrefs,
      dispatchNotification,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      clearAll,
      dismissBanner,
      triggerTestNotification,
    }),
    [
      notifications,
      unreadCount,
      permissionGranted,
      pushToken,
      prefs,
      activeBanner,
      isCenterOpen,
      userProfile,
      isManagerUser,
      requestPermission,
      updatePrefs,
      dispatchNotification,
      markAsRead,
      markAllAsRead,
      deleteNotification,
      clearAll,
      dismissBanner,
      triggerTestNotification,
    ]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return ctx;
}
