import { AppIcon, AppText as Text } from '@/components/app-icon';
import { useState } from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { usePreferences } from '@/contexts/preferences';
import {
  Card,
  Label,
  styles,
  usePalette,
  Badge,
} from '@/components/attendance-ui';
import { shortcuts } from '@/services/staff';

export default function Settings() {
  const { prefs, update } = usePreferences();
  const p = usePalette();
  const { section } = useLocalSearchParams();
  const [error, setError] = useState('');

  const save = (value: Parameters<typeof update>[0]) =>
    void update(value).catch(e => setError(e.message));

  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
      <View style={{ gap: 4 }}>
        <Label variant="title">Cấu hình & Tùy biến</Label>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
          Cài đặt giao diện hiển thị và các lối tắt ưa thích của bạn
        </Text>
      </View>

      {!!error && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>
            <AppIcon name="warning-outline" size={14} /> {error}
          </Text>
        </Card>
      )}

      {/* Theme Selection */}
      {section !== 'shortcuts' && (
        <Card style={{ gap: 12 }}>
          <Label variant="subtitle">Chủ đề giao diện</Label>
          <View style={{ gap: 8 }}>
            {([
              { id: 'system', name: 'Theo cài đặt hệ thống thiết bị', icon: "phone-portrait-outline" },
              { id: 'light', name: 'Giao diện Sáng (Light Mode)', icon: "sunny-outline" },
              { id: 'dark', name: 'Giao diện Tối (Dark Mode)', icon: "moon-outline" },
            ] as const).map(item => {
              const active = prefs.theme === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => save({ theme: item.id as 'system' | 'light' | 'dark' })}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: active ? p.brandLight : p.surfaceLow,
                    borderWidth: 1,
                    borderColor: active ? p.brand : p.line,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <AppIcon name={item.icon} style={{ fontSize: 18 }} />
                    <Text
                      style={{
                        fontFamily: active ? 'BeVietnamBold' : 'BeVietnam',
                        fontSize: 14,
                        color: active ? p.brandText : p.text,
                        fontWeight: active ? '700' : '500',
                      }}
                    >
                      {item.name}
                    </Text>
                  </View>
                  <AppIcon name={active ? 'checkmark-circle' : 'ellipse-outline'} style={{ fontSize: 16, color: active ? p.brand : p.muted }} />
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      {/* Shortcuts Customization */}
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label variant="subtitle">Lối tắt truy cập nhanh (Trang chủ)</Label>
          <Badge label={`${prefs.shortcuts.length} đã chọn`} size="sm" variant="brand" />
        </View>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
          Chọn các tính năng xuất hiện trong danh sách Tiện ích tại Trang chủ:
        </Text>

        <View style={{ gap: 8 }}>
          {shortcuts.map(item => {
            const enabled = prefs.shortcuts.includes(item.key);
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                onPress={() =>
                  save({
                    shortcuts: enabled
                      ? prefs.shortcuts.filter(k => k !== item.key)
                      : [...prefs.shortcuts, item.key],
                  })
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: enabled ? p.card : p.surfaceLow,
                  borderWidth: 1,
                  borderColor: enabled ? p.brand : p.line,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <AppIcon name={item.icon} style={{ fontSize: 22 }} />
                  <View>
                    <Text
                      style={{
                        fontFamily: 'BeVietnamBold',
                        fontSize: 14,
                        color: p.text,
                        fontWeight: '600',
                      }}
                    >
                      {item.title}
                    </Text>
                    <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                      Lối tắt trực tiếp
                    </Text>
                  </View>
                </View>
                <Badge
                  label={enabled ? 'Bật' : 'Tắt'}
                  variant={enabled ? 'success' : 'neutral'}
                  size="sm"
                />
              </Pressable>
            );
          })}
        </View>

        <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted, marginTop: 4 }}>
          Cấu hình được lưu trữ an toàn trong bộ nhớ cục bộ trên thiết bị của bạn.
        </Text>
      </Card>
    </ScrollView>
  );
}
