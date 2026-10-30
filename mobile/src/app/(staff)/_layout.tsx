import { AppIcon, type AppIconName } from '@/components/app-icon';
import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { usePalette } from '@/components/attendance-ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function StaffTabs() {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const icon = (symbol: AppIconName) =>
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
          <AppIcon name={symbol} style={{ color, fontSize: 18 }} />
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
          height: 88 + insets.bottom,
          paddingBottom: Math.max(10, insets.bottom),
          paddingTop: 14,
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
          tabBarIcon: icon("home-outline"),
        }}
      />
      <Tabs.Screen
        name="schedules"
        options={{
          title: 'Lịch ca',
          headerTitle: 'Lịch ca & Phân công',
          tabBarIcon: icon("calendar-outline"),
        }}
      />
      <Tabs.Screen name="attendance" options={{ title: 'Chấm công', tabBarIcon: () => <View style={{ width: 52, height: 52, marginTop: -18, borderRadius: 26, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: p.card }}><AppIcon name="person-outline" style={{ fontSize: 26, color: '#fff' }} /></View> }} />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Đơn từ',
          headerTitle: 'Quản lý Đơn & Tăng ca (OT)',
          tabBarIcon: icon("document-text-outline"),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Tài khoản',
          headerTitle: 'Hồ sơ cá nhân',
          tabBarIcon: icon("person-outline"),
        }}
      />
      <Tabs.Screen name="dashboard" options={{ title: 'Báo cáo KPI', headerTitle: 'Báo cáo tổng hợp & KPI', href: null }} />
      <Tabs.Screen name="activity" options={{ title: 'Nhật ký làm việc', href: null }} />
      <Tabs.Screen name="summary" options={{ title: 'Bảng công tháng', href: null }} />
      <Tabs.Screen name="settings" options={{ title: 'Cấu hình', href: null }} />
      <Tabs.Screen name="password" options={{ title: 'Đổi mật khẩu', href: null }} />
    </Tabs>
  );
}
