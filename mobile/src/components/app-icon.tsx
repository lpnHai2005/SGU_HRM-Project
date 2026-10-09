import Ionicons from '@expo/vector-icons/Ionicons';
import { Children } from 'react';
import { Text, StyleSheet, type TextProps } from 'react-native';

// Translate existing decorative tokens to bundled vector glyphs, never system emoji.
const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  '⏱': 'time-outline', '⏳': 'hourglass-outline', '▦': 'calendar-outline',
  '▥': 'bar-chart-outline', '▤': 'document-text-outline', '◉': 'person-outline',
  '○': 'ellipse-outline', '●': 'checkmark-circle', '☀': 'sunny-outline',
  '☰': 'menu-outline', '⚙': 'settings-outline', '⚠': 'warning-outline',
  '⚡': 'flash-outline', '✅': 'checkmark-circle-outline', '✓': 'checkmark-outline',
  '✕': 'close-outline', '×': 'close-outline', '➜': 'arrow-forward',
  '→': 'arrow-forward', '←': 'arrow-back', '›': 'chevron-forward',
  '🌙': 'moon-outline', '🎉': 'ribbon-outline', '🏖': 'sunny-outline',
  '🏠': 'home-outline', '🏪': 'storefront-outline', '👁': 'eye-outline',
  '👤': 'person-outline', '💼': 'briefcase-outline', '💾': 'save-outline',
  '📅': 'calendar-outline', '📊': 'bar-chart-outline', '📋': 'clipboard-outline',
  '📍': 'location-outline', '📝': 'document-text-outline', '📱': 'phone-portrait-outline',
  '🔍': 'search-outline', '🔑': 'key-outline', '🔒': 'lock-closed-outline',
  '🔔': 'notifications-outline', '🔗': 'link-outline', '🗓': 'calendar-outline',
  '🚪': 'log-out-outline', '🛡': 'shield-checkmark-outline',
};
export const AppIcon = Ionicons;
export function AppText({ children, style, ...props }: TextProps) {
  const appearance = StyleSheet.flatten(style);
  return <Text {...props} style={style}>{Children.map(children, child => {
    if (typeof child !== 'string') return child;
    return Array.from(child.replace(/\uFE0F/g, '')).map((char, index) => icons[char]
      ? <Ionicons key={index} name={icons[char]} size={appearance?.fontSize || 16} color={appearance?.color || '#64748b'} accessible={false} />
      : char);
  })}</Text>;
}
