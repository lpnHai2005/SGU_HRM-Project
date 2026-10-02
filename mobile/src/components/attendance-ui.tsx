import { Pressable, Text, TextInput, View, StyleSheet, type TextInputProps } from 'react-native';
import { usePreferences } from '@/contexts/preferences';
import type { ReactNode } from 'react';
export function usePalette() {
  const { dark } = usePreferences();
  return { dark, bg: dark ? '#0d0d0e' : '#f6f6f8', card: dark ? '#151517' : '#ffffff', text: dark ? '#f4f4f5' : '#09090b', muted: dark ? '#a1a1aa' : '#52525b', line: dark ? '#222225' : '#e4e4e7', accent: dark ? '#ffffff' : '#09090b', danger: dark ? '#ffb2a8' : '#b42318' };
}
export function Label({ children, muted = false, large = false }: { children: ReactNode; muted?: boolean; large?: boolean }) {
  const p = usePalette();
  return <Text style={{ fontFamily: large ? 'BeVietnamBold' : 'BeVietnam', color: muted ? p.muted : p.text, fontSize: large ? 24 : 14, fontWeight: large ? '700' : '400', lineHeight: large ? 35 : 23 }}>{children}</Text>;
}
export function Card({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <View style={{ backgroundColor: p.card, borderColor: p.line, borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 }}>{children}</View>;
}
export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  const p = usePalette();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ padding: 15, borderRadius: 12, alignItems: 'center', backgroundColor: secondary ? p.card : p.accent, borderWidth: 1, borderColor: p.accent, opacity: disabled ? .4 : pressed ? .7 : 1 })}><Text style={{ fontFamily: 'BeVietnamBold', color: secondary ? p.accent : p.dark ? '#09090b' : '#fff', fontWeight: '700', fontSize: 15 }}>{title}</Text></Pressable>;
}
export function Input(props: TextInputProps) {
  const p = usePalette();
  return <TextInput placeholderTextColor={p.muted} {...props} style={[{ fontFamily: 'BeVietnam', color: p.text, borderColor: p.line, borderWidth: 1, padding: 14, borderRadius: 12, fontSize: 16 }, props.style]} />;
}
export const styles = StyleSheet.create({ content: { padding: 16, paddingBottom: 40, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' }, row: { flexDirection: 'row', gap: 10, alignItems: 'center' } });
