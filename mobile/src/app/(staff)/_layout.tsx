import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { usePalette } from '@/components/attendance-ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
export default function StaffTabs() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const icon = (symbol: string) => function TabIcon({ color }: { color: ColorValue }) { return <Text style={{ color, fontSize: 24 }}>{symbol}</Text>; };
  return <Tabs screenOptions={{ headerStyle: { backgroundColor: p.card }, headerTintColor: p.text, headerTitleStyle: { fontFamily: 'BeVietnamBold' }, tabBarActiveTintColor: p.accent, tabBarInactiveTintColor: p.muted, tabBarStyle: { backgroundColor: p.card, borderTopColor: p.line, height: 64 + insets.bottom, paddingBottom: Math.max(8, insets.bottom), paddingTop: 6 }, tabBarLabelStyle: { fontFamily: 'BeVietnam', fontSize: 11, lineHeight: 16 }, tabBarHideOnKeyboard: true }}>
    <Tabs.Screen name="index" options={{ title: 'Trang chủ', headerShown: false, tabBarIcon: icon('⌂') }} />
    <Tabs.Screen name="activity" options={{ title: 'Hoạt động', tabBarIcon: icon('≡') }} />
    <Tabs.Screen name="requests" options={{ title: 'Đơn từ', tabBarIcon: icon('▤') }} />
    <Tabs.Screen name="account" options={{ title: 'Tài khoản', tabBarIcon: icon('◎') }} />
    <Tabs.Screen name="attendance" options={{ title: 'Chấm công', href: null }} />
    <Tabs.Screen name="summary" options={{ title: 'Bảng công tháng', href: null }} />
    <Tabs.Screen name="schedules" options={{ title: 'Lịch biểu', href: null }} />
    <Tabs.Screen name="settings" options={{ title: 'Cấu hình', href: null }} />
    <Tabs.Screen name="password" options={{ title: 'Đổi mật khẩu', href: null }} />
  </Tabs>;
}
