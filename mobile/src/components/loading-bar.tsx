import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { Label, usePalette } from './attendance-ui';

export function LoadingBar({ active, label = 'Đang tải dữ liệu…' }: { active: boolean; label?: string }) {
  const p = usePalette();
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!active) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 850, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, value]);
  if (!active) return null;
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={{ gap: 6 }}>
    <View style={{ height: 4, overflow: 'hidden', borderRadius: 4, backgroundColor: p.line }}>
      <Animated.View style={{ height: 4, backgroundColor: p.accent, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [.3, 1] }), transform: [{ scaleX: value.interpolate({ inputRange: [0, 1], outputRange: [.15, 1] }) }] }} />
    </View><Label muted>{label}</Label>
  </View>;
}
