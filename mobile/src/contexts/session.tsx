import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { request } from '@/services/attendance';

type Session = { token: string | null; ready: boolean; signIn: (username: string, password: string) => Promise<void>; signOut: () => Promise<void> };
const Context = createContext<Session>(null!);
const key = 'techzone.mobile.token';
export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(Platform.OS === 'web');
  useEffect(() => {
    if (Platform.OS === 'web') return;
    SecureStore.getItemAsync(key).then(setToken).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  const signIn = useCallback(async (username: string, password: string) => {
    const data = await request<{ access_token: string }>('/auth/login', undefined, { username, password });
    await request('/auth/me', data.access_token);
    if (Platform.OS !== 'web') await SecureStore.setItemAsync(key, data.access_token);
    setToken(data.access_token);
  }, []);
  const signOut = useCallback(async () => {
    setToken(null);
    if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key);
  }, []);
  return <Context.Provider value={{ token, ready, signIn, signOut }}>{children}</Context.Provider>;
}
export const useSession = () => useContext(Context);
