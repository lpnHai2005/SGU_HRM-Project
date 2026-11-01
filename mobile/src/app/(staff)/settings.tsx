import { AppIcon, AppText as Text } from '@/components/app-icon';
import { useState, type ReactNode } from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { usePreferences } from '@/contexts/preferences';
import { Card, styles, usePalette } from '@/components/attendance-ui';
import { shortcuts } from '@/services/staff';

type Theme = 'light' | 'dark' | 'system';

export default function Settings() {
  const { prefs, update } = usePreferences();
  const p = usePalette();
  const { section } = useLocalSearchParams();
  const [error, setError] = useState('');

  const save = (value: Parameters<typeof update>[0]) =>
    void update(value).catch(e => setError(e.message));

  const themes: { id: Theme; name: string }[] = [
    { id: 'light', name: 'Sáng' },
    { id: 'dark', name: 'Tối' },
    { id: 'system', name: 'Hệ thống' },
  ];

  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
      {!!error && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>{error}</Text>
        </Card>
      )}

      {section !== 'shortcuts' && (
        <Section title="Chủ đề giao diện">
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
            {themes.map(item => {
              const active = prefs.theme === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`Giao diện ${item.name}`}
                  onPress={() => save({ theme: item.id })}
                  style={{ flex: 1, padding: 10, gap: 8, borderRadius: 8, backgroundColor: p.card, borderWidth: active ? 1.5 : 1, borderColor: active ? p.text : p.line }}
                >
                  <ThemePreview mode={item.id} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontFamily: active ? 'BeVietnamBold' : 'BeVietnam', fontSize: 13, color: p.text }}>{item.name}</Text>
                    {active && <AppIcon name="checkmark-circle" size={16} color={p.text} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Section>
      )}

      <Section title="Lối tắt truy cập nhanh (Trang chủ)" right={`${prefs.shortcuts.length}/${shortcuts.length} bật`}>
        <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
          {shortcuts.map((item, i) => {
            const enabled = prefs.shortcuts.includes(item.key);
            const toggle = () => save({ shortcuts: enabled ? prefs.shortcuts.filter(k => k !== item.key) : [...prefs.shortcuts, item.key] });
            return (
              <Pressable
                key={item.key}
                accessibilityRole="switch"
                accessibilityState={{ checked: enabled }}
                accessibilityLabel={item.title}
                onPress={toggle}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 54, borderBottomWidth: i === shortcuts.length - 1 ? 0 : 1, borderBottomColor: p.line }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 6, backgroundColor: p.surfaceLow, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name={item.icon} size={16} color={p.text} />
                </View>
                <Text style={{ flex: 1, fontFamily: 'BeVietnam', fontSize: 14, color: p.text }}>{item.title}</Text>
                <View style={{ width: 40, height: 24, borderRadius: 12, padding: 3, backgroundColor: enabled ? p.brand : p.surfaceHigh, alignItems: enabled ? 'flex-end' : 'flex-start' }}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: enabled ? p.onBrand : p.card }} />
                </View>
              </Pressable>
            );
          })}
        </Card>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
          Cấu hình được lưu trữ an toàn trong bộ nhớ cục bộ trên thiết bị của bạn.
        </Text>
      </Section>
    </ScrollView>
  );

  function Section({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
    return (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>{title}</Text>
          {!!right && <Text style={{ fontFamily: 'Mono', fontSize: 11, color: p.muted }}>{right}</Text>}
        </View>
        {children}
      </View>
    );
  }

  function ThemePreview({ mode }: { mode: Theme }) {
    const tile = (ground: string, line: string, ink: string) => (
      <View style={{ flex: 1, padding: 6, gap: 5, backgroundColor: ground }}>
        <View style={{ height: 5, width: '60%', borderRadius: 2, backgroundColor: ink }} />
        <View style={{ height: 4, width: '85%', borderRadius: 2, backgroundColor: line }} />
        <View style={{ height: 4, width: '70%', borderRadius: 2, backgroundColor: line }} />
      </View>
    );
    return (
      <View style={{ height: 52, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: p.line }}>
        {mode !== 'dark' && tile('#f6f6f8', '#e4e4e7', '#09090b')}
        {mode !== 'light' && tile('#0d0d0e', '#222225', '#f4f4f5')}
      </View>
    );
  }
}
