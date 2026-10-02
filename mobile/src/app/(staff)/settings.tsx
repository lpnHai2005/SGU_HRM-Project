import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { usePreferences } from '@/contexts/preferences';
import { Button, Card, Label, styles, usePalette } from '@/components/attendance-ui';
import { shortcuts } from '@/services/staff';
export default function Settings() {
  const { prefs, update } = usePreferences(); const p = usePalette(); const { section } = useLocalSearchParams(); const [error,setError] = useState('');
  const save = (value: Parameters<typeof update>[0]) => void update(value).catch(e => setError(e.message));
  return <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
    {!!error && <Text style={{ color: p.danger }}>{error}</Text>}
    {section !== 'shortcuts' && <Card><Label>Giao diện</Label>{(['system','light','dark'] as const).map((theme,i) => <Button key={theme} title={`${prefs.theme === theme ? '✓ ' : ''}${['Theo hệ thống','Sáng','Tối'][i]}`} secondary={prefs.theme !== theme} onPress={() => save({ theme })} />)}</Card>}
    <Card><Label>Truy cập nhanh trên Trang chủ</Label>{shortcuts.map(item => <Button key={item.key} title={`${prefs.shortcuts.includes(item.key) ? '✓ ' : ''}${item.title}`} secondary onPress={() => save({ shortcuts: prefs.shortcuts.includes(item.key) ? prefs.shortcuts.filter(k => k !== item.key) : [...prefs.shortcuts,item.key] })} />)}<Label muted>Thiết lập được lưu trên thiết bị của bạn.</Label></Card>
  </ScrollView>;
}
