import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@/contexts/session';
import { ApiError, request } from '@/services/attendance';
export function useResource<T>(path: string | null, refreshInterval = 0) {
  const { token, signOut } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  useFocusEffect(useCallback(() => {
    if (!token || !path) return;
    let active = true;
    const revision = version; // Explicit reload starts a new request lifetime.
    let fetching = false;
    const load = async (foreground = false) => {
      if (!active || fetching) return;
      fetching = true;
      if (foreground) setLoading(true);
      try {
        const value = await request<T>(path, token);
        if (active && revision === version) { setData(value); setError(''); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
        if (active && e instanceof ApiError && e.status === 401) void signOut();
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    };
    setData(null);
    void load(true);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void load();
    });
    const timer = refreshInterval > 0 ? setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, refreshInterval) : undefined;
    return () => { active = false; subscription.remove(); clearInterval(timer); };
  }, [path, token, signOut, version, refreshInterval]));
  return { data, loading, error, reload: () => setVersion(v => v + 1) };
}
