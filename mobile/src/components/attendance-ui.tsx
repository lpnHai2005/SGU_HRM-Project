import { AppText as Text } from '@/components/app-icon';
import {
  Pressable,
  TextInput,
  View,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { usePreferences } from '@/contexts/preferences';
import type { ReactNode } from 'react';

export function usePalette() {
  const { dark } = usePreferences();
  return {
    dark,
    bg: dark ? '#0f172a' : '#f8fafc',
    card: dark ? '#1e293b' : '#ffffff',
    surfaceLow: dark ? '#182234' : '#f1f5f9',
    surfaceHigh: dark ? '#334155' : '#e2e8f0',
    text: dark ? '#f8fafc' : '#0f172a',
    body: dark ? '#cbd5e1' : '#334155',
    muted: dark ? '#94a3b8' : '#64748b',
    line: dark ? '#334155' : '#e2e8f0',
    accent: dark ? '#ffffff' : '#0f172a',
    brand: '#2563eb',
    brandDark: '#1d4ed8',
    brandLight: dark ? '#1e3a8a' : '#eff6ff',
    brandText: dark ? '#93c5fd' : '#1d4ed8',
    danger: dark ? '#f87171' : '#ef4444',
    dangerBg: dark ? '#450a0a' : '#fef2f2',
    dangerText: dark ? '#fca5a5' : '#dc2626',
    emerald: '#10b981',
    emeraldBg: dark ? '#064e3b' : '#ecfdf5',
    emeraldText: dark ? '#6ee7b7' : '#059669',
    amber: '#f59e0b',
    amberBg: dark ? '#78350f' : '#fffbeb',
    amberText: dark ? '#fcd34d' : '#d97706',
    indigo: '#6366f1',
    indigoBg: dark ? '#312e81' : '#e0e7ff',
    indigoText: dark ? '#a5b4fc' : '#4338ca',
  };
}

export function Label({
  children,
  muted = false,
  large = false,
  variant,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  muted?: boolean;
  large?: boolean;
  variant?: 'display' | 'title' | 'subtitle' | 'body' | 'caption' | 'bold';
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const p = usePalette();
  let fontSize = 14;
  let lineHeight = 21;
  let fontFamily = 'BeVietnam';
  let color = muted ? p.muted : p.text;
  let fontWeight: '400' | '500' | '600' | '700' = '400';

  if (large || variant === 'title') {
    fontSize = 20;
    lineHeight = 28;
    fontFamily = 'BeVietnamBold';
    fontWeight = '700';
  } else if (variant === 'display') {
    fontSize = 28;
    lineHeight = 36;
    fontFamily = 'BeVietnamBold';
    fontWeight = '700';
  } else if (variant === 'subtitle') {
    fontSize = 16;
    lineHeight = 24;
    fontFamily = 'BeVietnamBold';
    fontWeight = '600';
  } else if (variant === 'caption') {
    fontSize = 12;
    lineHeight = 16;
    fontWeight = '500';
  } else if (variant === 'bold') {
    fontFamily = 'BeVietnamBold';
    fontWeight = '700';
  }

  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily, color, fontSize, fontWeight, lineHeight }, style]}
    >
      {children}
    </Text>
  );
}

export function Card({
  children,
  style,
  low = false,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  low?: boolean;
  onPress?: () => void;
}) {
  const p = usePalette();
  const cardStyle: ViewStyle = {
    backgroundColor: low ? p.surfaceLow : p.card,
    borderColor: p.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: p.dark ? 0.3 : 0.04,
    shadowRadius: 8,
    elevation: low ? 0 : 2,
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.9 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[cardStyle, style]}>{children}</View>;
}

export function Badge({
  label,
  variant = 'neutral',
  pulse = false,
  size = 'md',
  icon,
}: {
  label: string;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
  pulse?: boolean;
  size?: 'sm' | 'md';
  icon?: string;
}) {
  const p = usePalette();
  let bg = p.surfaceLow;
  let text = p.text;
  let dot = p.muted;

  if (variant === 'success') {
    bg = p.emeraldBg;
    text = p.emeraldText;
    dot = p.emerald;
  } else if (variant === 'warning') {
    bg = p.amberBg;
    text = p.amberText;
    dot = p.amber;
  } else if (variant === 'danger') {
    bg = p.dangerBg;
    text = p.dangerText;
    dot = p.danger;
  } else if (variant === 'info') {
    bg = p.indigoBg;
    text = p.indigoText;
    dot = p.indigo;
  } else if (variant === 'brand') {
    bg = p.brandLight;
    text = p.brandText;
    dot = p.brand;
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: bg,
        paddingHorizontal: size === 'sm' ? 8 : 10,
        paddingVertical: size === 'sm' ? 3 : 5,
        borderRadius: 9999,
        alignSelf: 'flex-start',
      }}
    >
      {pulse && (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: dot,
          }}
        />
      )}
      {icon ? (
        <Text style={{ fontSize: size === 'sm' ? 11 : 13, color: text }}>{icon}</Text>
      ) : null}
      <Text
        style={{
          fontFamily: 'BeVietnamBold',
          fontSize: size === 'sm' ? 11 : 12,
          fontWeight: '600',
          color: text,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function MetricBox({
  label,
  value,
  subtext,
  icon,
  variant = 'neutral',
  style,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: string;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  let valColor = p.text;
  if (variant === 'success') valColor = p.emeraldText;
  if (variant === 'warning') valColor = p.amberText;
  if (variant === 'danger') valColor = p.dangerText;
  if (variant === 'brand') valColor = p.brandText;

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: p.surfaceLow,
          padding: 12,
          borderRadius: 14,
          gap: 4,
          borderWidth: 1,
          borderColor: p.line,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>{label}</Text>
        {icon && <Text style={{ fontSize: 16 }}>{icon}</Text>}
      </View>
      <Text
        style={{
          fontFamily: 'BeVietnamBold',
          fontSize: 18,
          fontWeight: '700',
          color: valColor,
          lineHeight: 24,
        }}
      >
        {value}
      </Text>
      {subtext && (
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>{subtext}</Text>
      )}
    </View>
  );
}

export function ProgressBar({
  progress,
  color,
}: {
  progress: number;
  color?: string;
}) {
  const p = usePalette();
  const clamped = Math.min(100, Math.max(0, progress));
  return (
    <View
      style={{
        width: '100%',
        height: 6,
        backgroundColor: p.surfaceHigh,
        borderRadius: 9999,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          height: '100%',
          width: `${clamped}%`,
          backgroundColor: color || p.brand,
          borderRadius: 9999,
        }}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  variant,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  variant?: 'primary' | 'secondary' | 'brand' | 'danger' | 'outline';
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const finalVariant = variant || (secondary ? 'secondary' : 'brand');

  let bgColor = p.brand;
  let textColor = '#ffffff';
  let borderColor = p.brand;

  if (finalVariant === 'secondary') {
    bgColor = p.surfaceLow;
    textColor = p.text;
    borderColor = p.line;
  } else if (finalVariant === 'outline') {
    bgColor = 'transparent';
    textColor = p.brand;
    borderColor = p.brand;
  } else if (finalVariant === 'danger') {
    bgColor = p.danger;
    textColor = '#ffffff';
    borderColor = p.danger;
  } else if (finalVariant === 'primary') {
    bgColor = p.accent;
    textColor = p.dark ? '#09090b' : '#ffffff';
    borderColor = p.accent;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          backgroundColor: bgColor,
          borderWidth: 1,
          borderColor,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
          shadowColor: finalVariant === 'brand' ? p.brand : 'transparent',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: finalVariant === 'brand' ? 0.2 : 0,
          shadowRadius: 4,
          elevation: finalVariant === 'brand' && !disabled ? 2 : 0,
        },
        style,
      ]}
    >
      {icon && <Text style={{ fontSize: 16, color: textColor }}>{icon}</Text>}
      <Text
        style={{
          fontFamily: 'BeVietnamBold',
          color: textColor,
          fontWeight: '700',
          fontSize: 15,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Input(
  props: TextInputProps & {
    leftIcon?: string;
  }
) {
  const p = usePalette();
  const { leftIcon, style, ...rest } = props;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: p.surfaceLow,
        borderColor: p.line,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 14,
      }}
    >
      {leftIcon && (
        <Text style={{ marginRight: 8, fontSize: 16, color: p.muted }}>{leftIcon}</Text>
      )}
      <TextInput
        placeholderTextColor={p.muted}
        {...rest}
        style={[
          {
            flex: 1,
            fontFamily: 'BeVietnam',
            color: p.text,
            paddingVertical: 14,
            fontSize: 15,
          },
          style,
        ]}
      />
    </View>
  );
}

export const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 16,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
});
