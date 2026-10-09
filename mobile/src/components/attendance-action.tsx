import { Pressable, View } from 'react-native';
import { AppIcon } from './app-icon';
import { Label, usePalette } from './attendance-ui';

export function AttendanceAction({ checkOut, disabled, onPress }: { checkOut: boolean; disabled?: boolean; onPress: () => void }) {
  const p = usePalette();
  const color = checkOut ? p.amberText : p.brand;
  const label = checkOut ? 'Chấm công ra' : 'Chấm công vào';
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ alignItems: 'center', gap: 10, padding: 16, opacity: disabled ? .4 : pressed ? .7 : 1 })}>
    <View style={{ width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center', backgroundColor: checkOut ? p.amberBg : p.brandLight, borderWidth: 2, borderColor: color }}>
      <AppIcon name="person-outline" size={40} color={color} />
      <View style={{ position: 'absolute', right: -2, bottom: 0, borderRadius: 14, padding: 5, backgroundColor: color }}><AppIcon name={checkOut ? 'log-out-outline' : 'log-in-outline'} size={18} color="#fff" /></View>
    </View>
    <Label variant="bold" style={{ color }}>{label}</Label>
  </Pressable>;
}
