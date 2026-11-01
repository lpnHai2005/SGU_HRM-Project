import { AppIcon, AppText as Text, type AppIconName } from '@/components/app-icon';
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
  // Vero tokens, kept in sync with DESIGN.md (web): Paper Crisp light / Obsidian Charcoal dark.
  return {
    dark,
    bg: dark ? '#0d0d0e' : '#f6f6f8',
    card: dark ? '#151517' : '#ffffff',
    surfaceLow: dark ? '#1a1a1d' : '#f0f0f3',
    surfaceHigh: dark ? '#27272a' : '#e4e4e7',
    text: dark ? '#f4f4f5' : '#09090b',
    body: dark ? '#d4d4d8' : '#3f3f46',
    muted: dark ? '#a1a1aa' : '#68686f',
    line: dark ? '#222225' : '#e4e4e7',
    accent: dark ? '#ffffff' : '#09090b',
    // Stark primary: black on paper, white on charcoal. Text on it uses onBrand.
    brand: dark ? '#fafafa' : '#09090b',
    brandDark: dark ? '#e4e4e7' : '#27272a',
    onBrand: dark ? '#09090b' : '#ffffff',
    brandLight: dark ? '#222225' : '#f0f0f3',
    brandText: dark ? '#f4f4f5' : '#09090b',
    danger: dark ? '#ef4444' : '#dc2626',
    dangerBg: dark ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.08)',
    dangerText: dark ? '#f87171' : '#b91c1c',
    emerald: '#10b981',
    emeraldBg: dark ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.10)',
    emeraldText: dark ? '#34d399' : '#047857',
    amber: '#f59e0b',
    amberBg: dark ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.12)',
    amberText: dark ? '#fbbf24' : '#b45309',
    // "indigo" keys now carry the web's info/sky status colour.
    indigo: '#0ea5e9',
    indigoBg: dark ? 'rgba(14,165,233,0.14)' : 'rgba(14,165,233,0.10)',
    indigoText: dark ? '#38bdf8' : '#0369a1',
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
    borderRadius: 8,
    padding: 16,
    gap: 12,
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
  icon?: AppIconName;
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
        paddingHorizontal: size === 'sm' ? 6 : 8,
        paddingVertical: size === 'sm' ? 2 : 4,
        borderRadius: 4,
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
        <AppIcon name={icon} style={{ fontSize: size === 'sm' ? 11 : 13, color: text }} />
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
  onPress,
  label,
  value,
  subtext,
  icon,
  variant = 'neutral',
  style,
}: {
  onPress?: () => void;
  label: string;
  value: string | number;
  subtext?: string;
  icon?: AppIconName;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  let valColor = p.text;
  if (variant === 'success') valColor = p.emeraldText;
  if (variant === 'warning') valColor = p.amberText;
  if (variant === 'danger') valColor = p.dangerText;
  if (variant === 'brand') valColor = p.brandText;
  // "2 người" -> mono "2" + plain "người": only the figure uses the tabular font.
  const [, number = String(value), unit = ''] = String(value).match(/^([\d.,:/%—–+-]+h?)\s*(.*)$/) ?? [];

  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined}
      style={[
        {
          flex: 1,
          minWidth: 0,
          minHeight: 110,
          backgroundColor: p.card,
          padding: 12,
          borderRadius: 8,
          gap: 4,
          borderWidth: 1,
          borderColor: p.line,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, lineHeight: 18, color: p.muted, flex: 1, minWidth: 0 }}>
          {label}
        </Text>
        {icon && <AppIcon name={icon} style={{ fontSize: 16 }} />}
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{
          fontFamily: 'MonoBold',
          fontSize: 22,
          color: valColor,
          lineHeight: 28,
          letterSpacing: -0.5,
        }}
      >
        {number}
        {!!unit && <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted, letterSpacing: 0 }}> {unit}</Text>}
      </Text>
      {subtext && (
        <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
          {subtext}
        </Text>
      )}
    </Pressable>
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
  icon?: AppIconName;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const finalVariant = variant || (secondary ? 'secondary' : 'brand');

  let bgColor = p.brand;
  let textColor = p.onBrand;
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
    textColor = p.onBrand;
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
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          backgroundColor: bgColor,
          borderWidth: 1,
          borderColor,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {icon && <AppIcon name={icon} style={{ fontSize: 16, color: textColor }} />}
      <Text
        style={{
          fontFamily: 'BeVietnamBold',
          color: textColor,
          fontWeight: '700',
          fontSize: 15,
          flexShrink: 1,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Input(
  props: TextInputProps & {
    leftIcon?: AppIconName;
  }
) {
  const p = usePalette();
  const { leftIcon, style, ...rest } = props;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: p.card,
        borderColor: p.line,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 14,
      }}
    >
      {leftIcon && (
        <AppIcon name={leftIcon} size={18} color={p.muted} style={{ marginRight: 10 }} />
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
            minWidth: 0,
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
