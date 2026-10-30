import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { LoadingBar } from '@/components/loading-bar';
import { Stack } from 'expo-router';
import { SessionProvider, useSession } from '@/contexts/session';
import { PreferencesProvider } from '@/contexts/preferences';
import { usePalette } from '@/components/attendance-ui';

import { NotificationProvider, useNotifications } from '@/contexts/notifications';
import { GlobalNotificationBanner, NotificationCenterModal } from '@/components/notification-center';

export default function RootLayout() {
  return (
    <PreferencesProvider>
      <SessionProvider>
        <NotificationProvider>
          <Navigation />
          <GlobalNotificationBanner />
          <RootNotificationCenter />
        </NotificationProvider>
      </SessionProvider>
    </PreferencesProvider>
  );
}

function RootNotificationCenter() {
  const { isCenterOpen, setCenterOpen } = useNotifications();
  return <NotificationCenterModal visible={isCenterOpen} onClose={() => setCenterOpen(false)} />;
}
function Navigation() {
  const p = usePalette();
  const { ready, token } = useSession();
  const [loaded, error] = useFonts({ ...Ionicons.font, BeVietnam: require('../../assets/fonts/BeVietnamPro-Regular.ttf'), BeVietnamBold: require('../../assets/fonts/BeVietnamPro-Bold.ttf') });
  if ((!loaded && !error) || !ready) return <LoadingBar active label="Đang mở TechZone…" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
    <Stack.Screen name="index" />
    <Stack.Protected guard={!token} redirectTo="/(staff)"><Stack.Screen name="login" /></Stack.Protected>
    <Stack.Protected guard={!!token} redirectTo="/login"><Stack.Screen name="(staff)" /></Stack.Protected>
  </Stack>;
}
