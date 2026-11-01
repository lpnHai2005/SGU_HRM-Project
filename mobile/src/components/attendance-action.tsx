import { Pressable } from 'react-native';
import { AppIcon, AppText as Text } from './app-icon';
import { usePalette } from './attendance-ui';

export function AttendanceAction({ checkOut, disabled, onPress }: { checkOut: boolean; disabled?: boolean; onPress: () => void }) {
  const p = usePalette();
  const label = checkOut ? 'Chấm công ra ca' : 'Chấm công vào ca';
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ height: 50, borderRadius: 8, backgroundColor: disabled ? p.surfaceHigh : p.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? .8 : 1 })}>
    <AppIcon name={checkOut ? 'log-out-outline' : 'scan-outline'} size={18} color={disabled ? p.muted : p.onBrand} />
    <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 15, color: disabled ? p.muted : p.onBrand }}>{label} →</Text>
  </Pressable>;
}
