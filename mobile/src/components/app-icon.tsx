import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, type TextProps } from 'react-native';
import type { ComponentProps } from 'react';
import { usePreferences } from '@/contexts/preferences';

export type AppIconName = ComponentProps<typeof Ionicons>['name'];

/** Explicit library glyphs; text content is never parsed or replaced. */
export function AppIcon({ size, style, color, ...props }: ComponentProps<typeof Ionicons>) {
  const { dark } = usePreferences();
  const appearance = StyleSheet.flatten(style);
  const iconSize = size ?? appearance?.fontSize ?? 20;
  const iconStyle = { ...appearance };
  delete iconStyle.fontFamily;
  delete iconStyle.fontWeight;
  return <Ionicons {...props} size={iconSize} color={color ?? appearance?.color ?? (dark ? '#94a3b8' : '#64748b')}
    accessible={false} style={[iconStyle, { fontSize: iconSize, lineHeight: iconSize + 4, includeFontPadding: false, textAlign: 'center', flexShrink: 0 }]} />;
}

export function AppText(props: TextProps) {
  return <Text {...props} />;
}
