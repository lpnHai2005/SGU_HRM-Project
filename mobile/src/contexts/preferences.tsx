import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
type Prefs = { theme: 'system' | 'light' | 'dark'; shortcuts: string[] };
const defaults: Prefs = { theme: 'system', shortcuts: ['attendance', 'schedules', 'summary', 'requests'] };
const Context = createContext<{ prefs: Prefs; dark: boolean; update: (value: Partial<Prefs>) => Promise<void> }>({ prefs: defaults, dark: false, update: async () => {} });
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [prefs, setPrefs] = useState(defaults);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    SecureStore.getItemAsync('techzone.preferences').then(raw => {
      if (!raw) return;
      const value = JSON.parse(raw);
      if (['system', 'light', 'dark'].includes(value.theme) && Array.isArray(value.shortcuts)) setPrefs(value);
    }).catch(() => {});
  }, []);
  async function update(value: Partial<Prefs>) {
    const next = { ...prefs, ...value };
    if (Platform.OS !== 'web') await SecureStore.setItemAsync('techzone.preferences', JSON.stringify(next));
    setPrefs(next);
  }
  return <Context.Provider value={{ prefs, dark: prefs.theme === 'system' ? system === 'dark' : prefs.theme === 'dark', update }}>{children}</Context.Provider>;
}
export const usePreferences = () => useContext(Context);
