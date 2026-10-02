import { useFonts } from 'expo-font';
import { LoadingBar } from '@/components/loading-bar';
import { Stack } from 'expo-router';
import { SessionProvider, useSession } from '@/contexts/session';
import { PreferencesProvider } from '@/contexts/preferences';
import { usePalette } from '@/components/attendance-ui';

export default function RootLayout() {
  return <PreferencesProvider><SessionProvider><Navigation /></SessionProvider></PreferencesProvider>;
}
function Navigation() {
  const p = usePalette();
  const { ready, token } = useSession();
  const [loaded, error] = useFonts({ BeVietnam: require('../../assets/fonts/BeVietnamPro-Regular.ttf'), BeVietnamBold: require('../../assets/fonts/BeVietnamPro-Bold.ttf') });
  if ((!loaded && !error) || !ready) return <LoadingBar active label="Đang mở TechZone…" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
    <Stack.Screen name="index" />
    <Stack.Protected guard={!token}><Stack.Screen name="login" /></Stack.Protected>
    <Stack.Protected guard={!!token}><Stack.Screen name="(staff)" /></Stack.Protected>
  </Stack>;
}
