import { AppText as Text } from '@/components/app-icon';
import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { usePalette } from '@/components/attendance-ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function StaffTabs() {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const icon = (symbol: string) =>
    function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
      return (
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 28,
            borderRadius: 14,
            backgroundColor: focused ? p.brandLight : 'transparent',
          }}
        >
          <Text style={{ color, fontSize: 18 }}>{symbol}</Text>
        </View>
      );
    };

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: p.card },
        headerTintColor: p.text,
        headerTitleStyle: { fontFamily: 'BeVietnamBold', fontSize: 17 },
        headerShadowVisible: false,
        tabBarActiveTintColor: p.brand,
        tabBarInactiveTintColor: p.muted,
        tabBarStyle: {
          backgroundColor: p.card,
          borderTopColor: p.line,
          borderTopWidth: 1,
          height: 76 + insets.bottom,
          paddingBottom: Math.max(10, insets.bottom),
          paddingTop: 6,
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: p.dark ? 0.3 : 0.04,
          shadowRadius: 6,
        },
        tabBarLabelStyle: {
          fontFamily: 'BeVietnam',
          fontSize: 11,
          fontWeight: '600',
          lineHeight: 14,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trang chủ',
          headerShown: false,
          tabBarIcon: icon('🏠'),
        }}
      />
      <Tabs.Screen
        name="schedules"
        options={{
          title: 'Lịch ca',
          headerTitle: 'Lịch ca & Phân công',
          tabBarIcon: icon('▦'),
        }}
      />
      <Tabs.Screen name="attendance" options={{ title: 'Chấm công', tabBarIcon: () => <View style={{ width: 48, height: 48, borderRadius: 24, marginTop: -20, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: p.card }}><Text style={{ fontSize: 25, color: '#fff' }}>◉</Text></View> }} />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Đơn từ',
          headerTitle: 'Quản lý nghỉ phép & Đơn từ',
          tabBarIcon: icon('📝'),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Tài khoản',
          headerTitle: 'Hồ sơ cá nhân',
          tabBarIcon: icon('👤'),
        }}
      />
      <Tabs.Screen name="activity" options={{ title: 'Nhật ký làm việc', href: null }} />
      <Tabs.Screen name="summary" options={{ title: 'Bảng công tháng', href: null }} />
      <Tabs.Screen name="settings" options={{ title: 'Cấu hình', href: null }} />
      <Tabs.Screen name="password" options={{ title: 'Đổi mật khẩu', href: null }} />
    </Tabs>
  );
}
