import { AppIcon, AppText as Text, type AppIconName } from '@/components/app-icon';
import { Tabs, router } from 'expo-router';
import { Pressable, View, type ColorValue } from 'react-native';
import { usePalette } from '@/components/attendance-ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Screens reached from menus/rows (no tab button): they get a back arrow instead of a breadcrumb.
const SUB_SCREENS = new Set(['dashboard', 'activity', 'summary', 'settings', 'password']);

function ScreenHeader({ title, section, back }: { title: string; section: string; back: boolean }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + (back ? 4 : 10), paddingBottom: back ? 6 : 12, paddingHorizontal: back ? 6 : 16, backgroundColor: p.card, borderBottomWidth: 1, borderBottomColor: p.line, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      {back ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quay lại"
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/(staff)'))}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <AppIcon name="chevron-back" size={22} color={p.text} />
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'BeVietnamBold', fontSize: 16, color: p.text }}>{title}</Text>
        </>
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>TechZone › {section}</Text>
          <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 20, lineHeight: 28, color: p.text, letterSpacing: -0.4, marginTop: 2 }}>{title}</Text>
        </View>
      )}
    </View>
  );
}

export default function StaffTabs() {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const icon = (symbol: AppIconName) =>
    function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
      return (
        <View style={{ alignItems: 'center', justifyContent: 'center', width: 36, height: 28 }}>
          <AppIcon name={focused ? (symbol.replace('-outline', '') as AppIconName) : symbol} style={{ color, fontSize: 20 }} />
        </View>
      );
    };

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        header: ({ route, options }) => (
          <ScreenHeader
            title={typeof options.headerTitle === 'string' ? options.headerTitle : options.title || route.name}
            section={options.title || route.name}
            back={SUB_SCREENS.has(route.name)}
          />
        ),
        tabBarActiveTintColor: p.text,
        tabBarInactiveTintColor: p.muted,
        tabBarStyle: {
          backgroundColor: p.card,
          borderTopColor: p.line,
          borderTopWidth: 1,
          height: 84 + insets.bottom,
          paddingBottom: Math.max(10, insets.bottom),
          paddingTop: 10,
          elevation: 0,
          shadowOpacity: 0,
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
      <Tabs.Screen name="index" options={{ title: 'Trang chủ', headerShown: false, tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="schedules" options={{ title: 'Lịch ca', headerTitle: 'Lịch ca & Phân công', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="attendance" options={{ title: 'Chấm công', tabBarIcon: () => <View style={{ width: 52, height: 52, marginTop: -18, borderRadius: 14, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: p.bg }}><AppIcon name="scan-outline" style={{ fontSize: 24, color: p.onBrand }} /></View> }} />
      <Tabs.Screen name="requests" options={{ title: 'Đơn từ', headerTitle: 'Đơn & Tăng ca (OT)', tabBarIcon: icon('document-text-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Tài khoản', headerTitle: 'Hồ sơ cá nhân', tabBarIcon: icon('person-outline') }} />
      {/* Not `href: null`: since expo-router 58 that marks the route hidden and redirects any visit to the first tab. */}
      <Tabs.Screen name="dashboard" options={{ title: 'Báo cáo KPI', headerTitle: 'Báo cáo tổng hợp & KPI', tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="activity" options={{ title: 'Nhật ký làm việc', tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="summary" options={{ title: 'Bảng công tháng', tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings" options={{ title: 'Cấu hình & Tùy biến', tabBarItemStyle: { display: 'none' } }} />
      <Tabs.Screen name="password" options={{ title: 'Đổi mật khẩu', tabBarItemStyle: { display: 'none' } }} />
    </Tabs>
  );
}
